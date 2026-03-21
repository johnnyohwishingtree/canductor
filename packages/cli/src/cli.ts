#!/usr/bin/env node

/**
 * canductor CLI
 *
 * Usage:
 *   canductor verify [ref]        — Run all verification layers, log result
 *   canductor score [ref]         — Run layers and print composite score
 *   canductor history             — Show results history
 *   canductor context             — Generate quality context for agent prompts
 *   canductor inject <target>     — Inject quality context into a file (e.g. CLAUDE.md)
 *   canductor suggest             — Suggest rule improvements based on history
 *   canductor init                — Create a starter .canductor/config.yaml
 */

import {
  loadConfig,
  verify,
  appendResult,
  readResults,
  generatePromptContext,
  injectContext,
  suggestRuleImprovements,
} from '@canductor/core';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const repoRoot = process.cwd();

function printUsage(): void {
  console.log(`canductor — quality verification for agentic output

Usage:
  canductor verify [ref]     Run all layers, log result, print decision
  canductor score [ref]      Run layers, print composite score only
  canductor history          Show results history table
  canductor context          Generate quality context for agent prompts
  canductor inject <file>    Inject quality context into a file (e.g. CLAUDE.md)
  canductor suggest          Suggest rule improvements based on history
  canductor init             Create starter config
  canductor help             Show this message
`);
}

function cmdInit(): void {
  const dir = join(repoRoot, '.canductor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const configPath = join(dir, 'config.yaml');
  if (existsSync(configPath)) {
    console.log('.canductor/config.yaml already exists');
    return;
  }

  writeFileSync(configPath, `# canductor verification config
# Docs: https://canductor.ai/docs/config
version: 1

layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 1.0

  typecheck:
    name: typecheck
    type: deterministic
    run: "npx tsc --noEmit"
    weight: 1.0

  # Uncomment to add visual regression:
  # visual:
  #   name: visual
  #   type: screenshot-diff
  #   capture: "npx playwright test --project=screenshots"
  #   baseline: ".canductor/baselines/"
  #   threshold: 5
  #   weight: 0.8

  # Uncomment to add AI-powered review:
  # ux_review:
  #   name: ux_review
  #   type: agent-review
  #   model: claude-sonnet-4-6
  #   rubric: ".canductor/rubrics/ux.md"
  #   context: ["src/", "docs/design-system.md"]
  #   weight: 0.6

policy:
  auto_merge: "all_deterministic_pass AND all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`);

  console.log('Created .canductor/config.yaml');
  console.log('Edit the config to match your project, then run: canductor verify');
}

async function cmdVerify(): Promise<void> {
  const ref = args[1] ?? 'HEAD';
  const config = loadConfig(repoRoot);
  const result = await verify(ref, config);

  console.log(result.summary);
  console.log(`\nComposite score: ${result.composite_score}/100`);
  console.log(`Decision: ${result.decision}`);

  appendResult(repoRoot, result, 'pending', `Verified ${ref}`);
  console.log('\nResult logged to .canductor/results.tsv');
}

async function cmdScore(): Promise<void> {
  const ref = args[1] ?? 'HEAD';
  const config = loadConfig(repoRoot);
  const result = await verify(ref, config);
  console.log(result.composite_score);
}

function cmdHistory(): void {
  const results = readResults(repoRoot);
  if (results.length === 0) {
    console.log('No results yet. Run: canductor verify');
    return;
  }

  console.log('ref\tscore\tdecision\tstatus\tdescription');
  console.log('---\t-----\t--------\t------\t-----------');
  for (const r of results.slice(-20)) {
    console.log(`${r.ref}\t${r.composite_score}\t${r.decision}\t${r.status}\t${r.description}`);
  }
}

function cmdContext(): void {
  const context = generatePromptContext(repoRoot);
  console.log(context);
}

function cmdInject(): void {
  const targetArg = args[1];
  if (!targetArg) {
    console.error('Usage: canductor inject <target-file>');
    console.error('Example: canductor inject CLAUDE.md');
    process.exit(1);
  }

  const targetFile = resolve(repoRoot, targetArg);
  const modified = injectContext(repoRoot, targetFile);

  if (modified) {
    console.log(`Injected quality context into ${targetArg}`);
  } else {
    console.log(`${targetArg} is already up to date`);
  }
}

function cmdSuggest(): void {
  const improvements = suggestRuleImprovements(repoRoot);

  if (improvements.length === 0) {
    console.log('No rule improvements suggested. Build more history with: canductor verify');
    return;
  }

  for (const imp of improvements) {
    const confidencePct = Math.round(imp.confidence * 100);
    console.log(`[${imp.type}] (${confidencePct}% confidence) ${imp.description}`);
    console.log(`  Content:\n${imp.content.split('\n').map(l => `    ${l}`).join('\n')}`);
    console.log('');
  }
}

async function main(): Promise<void> {
  switch (command) {
    case 'verify':
      await cmdVerify();
      break;
    case 'score':
      await cmdScore();
      break;
    case 'history':
      cmdHistory();
      break;
    case 'context':
      cmdContext();
      break;
    case 'inject':
      cmdInject();
      break;
    case 'suggest':
      cmdSuggest();
      break;
    case 'init':
      cmdInit();
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
