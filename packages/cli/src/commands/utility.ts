/**
 * Utility commands — setup, maintenance, and context management
 */

import {
  loadConfig,
  generatePromptContext,
  injectContext,
  suggestRuleImprovements,
  updateResultStatus,
  detectToolchain,
  scaffoldRubric,
  runFirstVerification,
  lintSkills,
  listStaleBranches,
  deleteBranches,
  validateConfig,
  listLayers,
} from '@canductor/core';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Create starter .canductor/config.yaml.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export async function cmdInit(args: string[], repoRoot: string): Promise<void> {
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

/**
 * Inject quality context into a file.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdInject(args: string[], repoRoot: string): void {
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

/**
 * Suggest rule improvements based on history.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdSuggest(args: string[], repoRoot: string): void {
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

/**
 * Generate quality context for agent prompts.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdContext(args: string[], repoRoot: string): void {
  const context = generatePromptContext(repoRoot);
  console.log(context);
}

/**
 * Update result status (merged|rejected|pending).
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdResultUpdate(args: string[], repoRoot: string): void {
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

/**
 * Validate config file and policy expressions.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdConfigCheck(args: string[], repoRoot: string): void {
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

/**
 * Remove merged canductor branches.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdClean(args: string[], repoRoot: string): void {
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

/**
 * Validate SKILL.md frontmatter.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdSkillLint(args: string[], repoRoot: string): void {
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

/**
 * List configured verification layers.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdLayers(args: string[], repoRoot: string): void {
  const jsonMode = args.includes('--json');
  const config = loadConfig(repoRoot);
  const layers = listLayers(config);

  if (layers.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify([]));
    } else {
      console.log('No layers configured.');
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(layers, null, 2));
    return;
  }

  console.log('Name'.padEnd(20) + 'Type'.padEnd(20) + 'Weight'.padEnd(10) + 'Detail');
  console.log('-'.repeat(70));
  for (const layer of layers) {
    console.log(
      `${layer.name.padEnd(20)}${layer.type.padEnd(20)}${String(layer.weight).padEnd(10)}${layer.detail}`
    );
  }

  const totalWeight = layers.reduce((sum, l) => sum + l.weight, 0);
  console.log('-'.repeat(70));
  console.log(`${''.padEnd(40)}${totalWeight.toFixed(1)}`);
}
