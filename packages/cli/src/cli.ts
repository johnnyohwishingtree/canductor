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
  findConfigPath,
  writeConfigBaseline,
  verify,
  appendResult,
  readResults,
  updateResultStatus,
  generatePromptContext,
  injectContext,
  suggestRuleImprovements,
  diffResults,
  getStatus,
  getTrend,
  computeAutoBaseline,
  getBaseline,
  getAgentReviewPrompt,
  parseReviewJson,
  detectToolchain,
  scaffoldRubric,
  runFirstVerification,
  lintSkills,
  generateReport,
  listStaleBranches,
  deleteBranches,
  validateConfig,
} from '@canductor/core';
import type { AgentReviewResult } from '@canductor/core';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const repoRoot = process.cwd();

function printUsage(): void {
  console.log(`canductor — quality verification for agentic output

Usage:
  canductor verify [ref]                     Run all layers, log result, print decision
  canductor verify [ref] --self-review       Output review prompt for agent-review layers (no API key needed)
  canductor verify [ref] --review-json <j>   Use pre-evaluated review JSON for agent-review layers
  canductor verify [ref] --exit-code=N       Exit 1 if score < N (use "auto" for baseline)
  canductor score [ref]                      Run layers, print composite score only
  canductor status [--json]                   Show pipeline health overview
  canductor trend [--last N] [--json]        Show quality trend over last N results (default 10)
  canductor history [--json]                 Show results history table
  canductor diff <ref1> <ref2> [--json]      Compare quality scores between two refs
  canductor baseline [--json]                Show current quality baseline
  canductor baseline --set N                 Set baseline override to N
  canductor baseline --auto                  Set baseline from last 5 merged scores
  canductor result-update <ref> <status>     Update result status (merged|rejected|pending)
  canductor context                          Generate quality context for agent prompts
  canductor inject <file>                    Inject quality context into a file (e.g. CLAUDE.md)
  canductor suggest                          Suggest rule improvements based on history
  canductor init                             Create starter config
  canductor report [ref] [--json]             Generate markdown quality summary
  canductor config-check [--json]             Validate config file and policy expressions
  canductor clean [--force]                  Remove merged canductor branches
  canductor skill-lint                       Validate SKILL.md frontmatter
  canductor help                             Show this message
`);
}

async function cmdInit(): Promise<void> {
  const dir = join(repoRoot, '.canductor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const configPath = join(dir, 'config.yaml');
  if (existsSync(configPath)) {
    console.log('.canductor/config.yaml already exists');
    return;
  }

  const toolchain = detectToolchain(repoRoot);

  const rubricCreated = scaffoldRubric(repoRoot);
  const agentReviewSection = rubricCreated
    ? `
  code_quality:
    name: code_quality
    type: agent-review
    model: claude-sonnet-4-6
    rubric: ".canductor/rubrics/code-quality.md"
    context: ["src/"]
    weight: 0.6
`
    : '';

  writeFileSync(configPath, `# canductor verification config
# Docs: https://canductor.ai/docs/config
version: 1

layers:
  tests:
    name: tests
    type: deterministic
    run: "${toolchain.testCmd}"
    weight: 1.0

  typecheck:
    name: typecheck
    type: deterministic
    run: "${toolchain.typecheckCmd}"
    weight: 1.0
${agentReviewSection}
  # Uncomment to add visual regression:
  # visual:
  #   name: visual
  #   type: screenshot-diff
  #   capture: "npx playwright test --project=screenshots"
  #   baseline: ".canductor/baselines/"
  #   threshold: 5
  #   weight: 0.8

policy:
  auto_merge: "all_deterministic_pass AND all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`);

  console.log(`Detected toolchain: ${toolchain.packageManager}`);
  console.log('Created .canductor/config.yaml');
  if (rubricCreated) {
    console.log('Created .canductor/rubrics/code-quality.md');
  }

  const result = await runFirstVerification(repoRoot);
  if (result) {
    console.log(`Initial verification score: ${result.composite_score}/100 (${result.decision})`);
    console.log(`Baseline set to ${result.composite_score}`);
  } else {
    console.log('Warning: initial verification could not run. Run manually: canductor verify');
  }
}

async function cmdVerify(): Promise<void> {
  const ref = args[1] && !args[1].startsWith('--') ? args[1] : 'HEAD';
  const jsonMode = args.includes('--json');
  const selfReviewMode = args.includes('--self-review');
  const reviewJsonIdx = args.indexOf('--review-json');
  const exitCodeArg = args.find(a => a.startsWith('--exit-code='));
  const config = loadConfig(repoRoot);

  // Self-review mode: output the review prompt for agent-review layers and exit
  if (selfReviewMode) {
    let foundPrompt = false;
    for (const [name, layerConfig] of Object.entries(config.layers)) {
      if (layerConfig.type !== 'agent-review') continue;
      const prompt = getAgentReviewPrompt({ ...layerConfig, name });
      if (!prompt) {
        console.error(`Could not build review prompt for layer "${name}"`);
        continue;
      }
      foundPrompt = true;
      console.log(`=== CANDUCTOR SELF-REVIEW: ${name} ===`);
      console.log('Evaluate the following code against this rubric and respond with JSON:');
      console.log('{"pass": boolean, "score": 0-100, "issues": [...], "summary": "..."}');
      console.log('');
      console.log(prompt.userPrompt);
      console.log(`=== END SELF-REVIEW: ${name} ===`);
    }
    if (!foundPrompt) {
      console.log('No agent-review layers found in config.');
    }
    return;
  }

  // Review-json mode: parse provided JSON for agent-review layers
  let selfReviewResults: Record<string, AgentReviewResult> | undefined;
  if (reviewJsonIdx !== -1) {
    const rawJson = args[reviewJsonIdx + 1];
    if (!rawJson) {
      console.error('--review-json requires a JSON argument');
      process.exit(1);
    }
    const parsed = parseReviewJson(rawJson);
    // Apply the parsed result to all agent-review layers
    selfReviewResults = {};
    for (const [name, layerConfig] of Object.entries(config.layers)) {
      if (layerConfig.type === 'agent-review') {
        selfReviewResults[name] = parsed;
      }
    }
  }

  const result = await verify(ref, config, selfReviewResults, repoRoot);

  // Resolve --exit-code threshold
  let threshold: number | null = null;
  if (exitCodeArg) {
    const value = exitCodeArg.split('=')[1];
    if (value === 'auto') {
      threshold = getBaseline(repoRoot, config);
    } else {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed)) {
        console.error(`Invalid --exit-code value: "${value}". Use a number or "auto".`);
        process.exit(1);
      }
      threshold = parsed;
    }
  }

  const thresholdPassed = threshold === null || result.composite_score >= threshold;

  if (jsonMode) {
    const output: Record<string, unknown> = {
      score: result.composite_score,
      decision: result.decision,
      summary: result.summary,
      passed: result.decision !== 'block' && thresholdPassed,
    };
    if (threshold !== null) {
      output.threshold = threshold;
    }
    console.log(JSON.stringify(output));
  } else {
    console.log(result.summary);
    console.log(`\nComposite score: ${result.composite_score}/100`);
    console.log(`Decision: ${result.decision}`);
  }

  appendResult(repoRoot, result, 'pending', `Verified ${ref}`);
  if (!jsonMode) {
    console.log('\nResult logged to .canductor/results.tsv');
  }

  if (!thresholdPassed) {
    if (!jsonMode) {
      console.log(`Score ${result.composite_score} below threshold ${threshold}`);
    }
    process.exit(1);
  }

  if (result.decision === 'block') {
    process.exit(1);
  }
}

async function cmdScore(): Promise<void> {
  const ref = args[1] ?? 'HEAD';
  const config = loadConfig(repoRoot);
  const result = await verify(ref, config);
  console.log(result.composite_score);
}

function cmdHistory(): void {
  const jsonMode = args.includes('--json');
  const results = readResults(repoRoot);
  if (results.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify([]));
    } else {
      console.log('No results yet. Run: canductor verify');
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(results.slice(-20)));
    return;
  }

  console.log('ref\tscore\tdecision\tstatus\tdescription');
  console.log('---\t-----\t--------\t------\t-----------');
  for (const r of results.slice(-20)) {
    console.log(`${r.ref}\t${r.composite_score}\t${r.decision}\t${r.status}\t${r.description}`);
  }
}

function cmdDiff(): void {
  const jsonMode = args.includes('--json');
  const ref1 = args[1];
  const ref2 = args[2];
  if (!ref1 || !ref2) {
    console.error('Usage: canductor diff <ref1> <ref2>');
    process.exit(1);
  }

  const diff = diffResults(repoRoot, ref1, ref2);
  if (!diff) {
    const results = readResults(repoRoot);
    const found = results.map(r => r.ref);
    if (!results.find(r => r.ref === ref1)) {
      console.error(`Ref not found in results log: ${ref1}`);
    }
    if (!results.find(r => r.ref === ref2)) {
      console.error(`Ref not found in results log: ${ref2}`);
    }
    if (found.length > 0) {
      console.error(`Available refs: ${found.join(', ')}`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify(diff));
    return;
  }

  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const deltaStr = sign(diff.delta);

  console.log(`\nDiff: ${diff.ref1} → ${diff.ref2}`);
  console.log(`Composite score: ${diff.composite1} → ${diff.composite2} (${deltaStr})\n`);
  console.log('Layer breakdown:');
  console.log('  Layer'.padEnd(24) + 'Before'.padEnd(10) + 'After'.padEnd(10) + 'Change');
  console.log('  ' + '-'.repeat(52));

  for (const layer of diff.layers) {
    const before = layer.score1 !== null ? String(layer.score1) : '—';
    const after  = layer.score2 !== null ? String(layer.score2) : '—';
    let changeLabel: string;
    if (layer.change === 'improved')  changeLabel = `▲ +${layer.delta}`;
    else if (layer.change === 'regressed') changeLabel = `▼ ${layer.delta}`;
    else if (layer.change === 'unchanged') changeLabel = '= no change';
    else if (layer.change === 'added')    changeLabel = '+ added';
    else                                  changeLabel = '- removed';

    console.log(
      `  ${layer.name.padEnd(22)}${before.padEnd(10)}${after.padEnd(10)}${changeLabel}`
    );
  }
  console.log('');
}

function cmdTrend(): void {
  const jsonMode = args.includes('--json');
  const lastIdx = args.indexOf('--last');
  const last = lastIdx !== -1 && args[lastIdx + 1] ? parseInt(args[lastIdx + 1], 10) : 10;

  const trend = getTrend(repoRoot, last);

  if (trend.entries.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify(trend));
    } else {
      console.log('No results yet. Run: canductor verify');
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(trend));
    return;
  }

  console.log(`Canductor Trend (last ${trend.entries.length} results)`);
  console.log('==================================');

  const BAR_WIDTH = 10;
  for (const entry of trend.entries) {
    const filled = Math.round(entry.score / 100 * BAR_WIDTH);
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const ref = entry.ref.padEnd(6);
    console.log(`${ref} ${entry.score}  ${bar}  ${entry.status}`);
  }

  console.log('');

  const bestRefs = trend.best.refs.join(', ');
  const worstRefs = trend.worst.refs.join(', ');
  console.log(`Avg: ${trend.avg} | Best: ${trend.best.score} (${bestRefs}) | Worst: ${trend.worst.score} (${worstRefs})`);

  if (trend.direction !== null && trend.delta !== null && trend.entries.length >= 2) {
    const arrow = trend.direction === 'improving' ? '↑' : trend.direction === 'declining' ? '↓' : '→';
    const sign = trend.delta >= 0 ? `+${trend.delta}` : `${trend.delta}`;
    console.log(`Direction: ${arrow} ${trend.direction} (${sign} over ${trend.entries.length} runs)`);
  }
}

function cmdStatus(): void {
  const jsonMode = args.includes('--json');
  const s = getStatus(repoRoot);

  if (s.total === 0) {
    if (jsonMode) {
      console.log(JSON.stringify(s));
    } else {
      console.log('No results yet. Run: canductor verify');
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(s));
    return;
  }

  console.log('Canductor Status');
  console.log('================');
  console.log(`Results:     ${s.total} total (${s.merged} merged, ${s.rejected} rejected, ${s.pending} pending)`);
  console.log(`Baseline:    ${s.baseline}/100`);

  if (s.lastScore !== null) {
    console.log(`Last score:  ${s.lastScore}/100 (${s.lastRef}, ${s.lastStatus})`);
  }

  if (s.trendDirection !== null && s.trendOld !== null && s.trendNew !== null) {
    const arrow = s.trendDirection === 'improving' ? '↑' : s.trendDirection === 'declining' ? '↓' : '→';
    console.log(`Trend:       ${arrow} ${s.trendDirection} (last 5 avg: ${s.trendOld} → ${s.trendNew})`);
  }

  if (s.recurringIssues.length > 0) {
    const label = s.recurringIssues.length === 1 ? 'issue' : 'issues';
    console.log(`Recurring:   ${s.recurringIssues.length} ${label} (${s.recurringIssues[0]})`);
  } else {
    console.log('Recurring:   none');
  }

  if (s.stalls.length > 0) {
    const stallSummary = s.stalls.map(
      st => `ref ${st.ref}, ${st.attempts} attempts at score ${st.scoreRange.min}-${st.scoreRange.max}`
    ).join('; ');
    console.log(`Stalls:      ${s.stalls.length} ref(s) stuck (${stallSummary})`);
  }
}

function cmdBaseline(): void {
  const setIdx = args.indexOf('--set');
  const autoMode = args.includes('--auto');

  if (setIdx !== -1) {
    const val = args[setIdx + 1];
    if (!val || isNaN(parseInt(val, 10))) {
      console.error('Usage: canductor baseline --set <number>');
      process.exit(1);
    }
    const score = parseInt(val, 10);
    if (score < 0 || score > 100) {
      console.error('Baseline must be between 0 and 100');
      process.exit(1);
    }
    writeConfigBaseline(repoRoot, score);
    console.log(`Baseline set to ${score}/100`);
    return;
  }

  if (autoMode) {
    const score = computeAutoBaseline(repoRoot);
    writeConfigBaseline(repoRoot, score);
    console.log(`Baseline set to ${score}/100 (computed from last 5 merged scores)`);
    return;
  }

  // Show current baseline
  const jsonMode = args.includes('--json');
  let config = null;
  try {
    config = loadConfig(repoRoot);
  } catch {
    // no config file — that's fine, we'll compute from results
  }
  const baseline = getBaseline(repoRoot, config);

  if (jsonMode) {
    console.log(JSON.stringify({ baseline }));
    return;
  }

  const source = config?.baseline !== undefined ? 'config override' : 'computed from last 5 merged scores';
  console.log(`Current baseline: ${baseline}/100 (${source})`);
}

function cmdResultUpdate(): void {
  const ref = args[1];
  const status = args[2];

  if (!ref || !status) {
    console.error('Usage: canductor result-update <ref> <status>');
    console.error('Status must be one of: merged, rejected, pending');
    process.exit(1);
  }

  const validStatuses = ['merged', 'rejected', 'pending'] as const;
  if (!validStatuses.includes(status as typeof validStatuses[number])) {
    console.error(`Invalid status: ${status}`);
    console.error('Status must be one of: merged, rejected, pending');
    process.exit(1);
  }

  const updated = updateResultStatus(repoRoot, ref, status as 'merged' | 'rejected' | 'pending');
  if (updated) {
    console.log(`Updated result for ref "${ref}" to status "${status}"`);
  } else {
    console.error(`Ref not found in results log: ${ref}`);
    process.exit(1);
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

function cmdReport(): void {
  const jsonFlag = args.includes('--json');
  const ref = args.slice(1).find(a => !a.startsWith('--'));

  const report = generateReport(repoRoot, ref);

  if (jsonFlag) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(report.markdown);
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

function cmdClean(): void {
  const force = args.includes('--force');
  const branches = listStaleBranches(repoRoot);

  if (branches.length === 0) {
    console.log('No stale canductor branches found.');
    return;
  }

  if (!force) {
    console.log('Stale branches (merged into master):');
    for (const branch of branches) {
      console.log(`  ${branch.remote}/${branch.name}`);
    }
    console.log(`\n${branches.length} branch(es) would be deleted. Run with --force to delete.`);
    return;
  }

  const results = deleteBranches(repoRoot, branches);
  for (const result of results) {
    const status = result.deleted ? 'Deleted' : `Failed: ${result.error}`;
    console.log(`  ${result.branch}: ${status}`);
  }

  const deleted = results.filter(r => r.deleted).length;
  console.log(`\n${deleted}/${results.length} branch(es) deleted.`);
}

function cmdSkillLint(): void {
  const results = lintSkills(repoRoot);

  if (results.length === 0) {
    console.log('No SKILL.md files found under .claude/skills/');
    return;
  }

  let hasErrors = false;
  for (const result of results) {
    const status = result.valid ? 'PASS' : 'FAIL';
    console.log(`  ${status} ${result.path}`);
    for (const error of result.errors) {
      console.log(`       ${error}`);
    }
    if (!result.valid) hasErrors = true;
  }

  console.log(`\n${results.length} skill(s) checked, ${results.filter(r => !r.valid).length} error(s)`);

  if (hasErrors) {
    process.exit(1);
  }
}

function cmdConfigCheck(): void {
  const jsonMode = args.includes('--json');
  const result = validateConfig(repoRoot);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log('Config is valid. No errors or warnings.');
    } else {
      for (const issue of result.errors) {
        const pathStr = issue.path ? ` (${issue.path})` : '';
        console.log(`ERROR${pathStr}: ${issue.message}`);
      }
      for (const issue of result.warnings) {
        const pathStr = issue.path ? ` (${issue.path})` : '';
        console.log(`WARNING${pathStr}: ${issue.message}`);
      }

      const summary = [];
      if (result.errors.length > 0) summary.push(`${result.errors.length} error(s)`);
      if (result.warnings.length > 0) summary.push(`${result.warnings.length} warning(s)`);
      console.log(`\n${summary.join(', ')}`);
    }
  }

  if (!result.valid) {
    process.exit(1);
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
    case 'status':
      cmdStatus();
      break;
    case 'trend':
      cmdTrend();
      break;
    case 'history':
      cmdHistory();
      break;
    case 'diff':
      cmdDiff();
      break;
    case 'baseline':
      cmdBaseline();
      break;
    case 'result-update':
      cmdResultUpdate();
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
      await cmdInit();
      break;
    case 'report':
      cmdReport();
      break;
    case 'config-check':
      cmdConfigCheck();
      break;
    case 'clean':
      cmdClean();
      break;
    case 'skill-lint':
      cmdSkillLint();
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
