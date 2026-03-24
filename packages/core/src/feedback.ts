/**
 * Feedback loop — auto-inject quality context into agent prompt files
 * and suggest rule improvements based on results history.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generatePromptContext, analyzeResults } from './results-analysis.js';
import type { RuleImprovement } from './types.js';

const MARKER_START = '<!-- canductor:start -->';
const MARKER_END = '<!-- canductor:end -->';

/**
 * Inject quality context into a target file (e.g., CLAUDE.md).
 *
 * If the file contains `<!-- canductor:start -->` / `<!-- canductor:end -->`
 * markers, replaces the content between them. Otherwise, appends a new
 * block with markers at the end of the file.
 *
 * @param repoRoot   - Repository root directory
 * @param targetFile - Absolute path to the target file
 * @returns true if the file was modified, false if content was unchanged
 */
export function injectContext(repoRoot: string, targetFile: string): boolean {
  const context = generatePromptContext(repoRoot);
  const block = `${MARKER_START}\n${context}\n${MARKER_END}`;

  if (!existsSync(targetFile)) {
    writeFileSync(targetFile, block + '\n');
    return true;
  }

  const original = readFileSync(targetFile, 'utf-8');

  let updated: string;
  const startIdx = original.indexOf(MARKER_START);
  const endIdx = original.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace content between markers (inclusive of markers)
    const before = original.substring(0, startIdx);
    const after = original.substring(endIdx + MARKER_END.length);
    updated = before + block + after;
  } else {
    // Append block at end of file
    const separator = original.endsWith('\n') ? '\n' : '\n\n';
    updated = original + separator + block + '\n';
  }

  if (updated === original) {
    return false;
  }

  writeFileSync(targetFile, updated);
  return true;
}

/**
 * Analyze results history and suggest rule improvements.
 *
 * For each recurring issue pattern, generates a specific rule suggestion
 * with the actual content to add.
 *
 * @param repoRoot - Repository root directory
 * @returns Array of structured rule improvements
 */
export function suggestRuleImprovements(repoRoot: string): RuleImprovement[] {
  const ctx = analyzeResults(repoRoot);
  const improvements: RuleImprovement[] = [];

  // No results at all — nothing to suggest
  if (ctx.recent_results.length === 0) {
    return improvements;
  }

  // Analyze layer failure patterns
  const layerFailCounts = new Map<string, number>();
  const totalRuns = ctx.recent_results.length;

  for (const row of ctx.recent_results) {
    if (row.status === 'rejected' || row.decision === 'block') {
      const scores = row.layer_scores.split(',');
      for (const s of scores) {
        const [name, val] = s.split(':');
        if (parseInt(val) < 80) {
          layerFailCounts.set(name, (layerFailCounts.get(name) ?? 0) + 1);
        }
      }
    }
  }

  // Generate specific improvements for recurring failures
  for (const [layer, count] of layerFailCounts) {
    if (count < 2) continue;

    const confidence = Math.min(1, count / totalRuns);

    improvements.push({
      type: 'add_rule',
      description: `Layer "${layer}" failed ${count}/${totalRuns} recent runs. Add a rule to prevent this pattern.`,
      content: `# Quality Rule: ${layer}\n\nThe "${layer}" verification layer has failed ${count} times recently. Before submitting, ensure:\n- All ${layer}-related checks pass locally\n- Review the ${layer} criteria in the rubric\n`,
      confidence,
    });

    improvements.push({
      type: 'add_rubric_check',
      description: `Add a rubric check targeting "${layer}" failures.`,
      content: `## ${layer} Quality Check\n\nVerify that the "${layer}" layer passes consistently. This layer has a ${Math.round(confidence * 100)}% failure rate in recent history.\n`,
      confidence,
    });
  }

  // Suggest baseline update if scores are trending significantly higher/lower
  const mergedResults = ctx.recent_results.filter(r => r.status === 'merged');
  if (mergedResults.length >= 3 && ctx.baseline_score > 0) {
    const recentMergedScores = mergedResults.slice(-3).map(r => r.composite_score);
    const recentAvg = recentMergedScores.reduce((a, b) => a + b, 0) / recentMergedScores.length;
    const drift = Math.abs(recentAvg - ctx.baseline_score);

    if (drift >= 10) {
      improvements.push({
        type: 'update_baseline',
        description: `Baseline score (${ctx.baseline_score}) has drifted ${drift > 0 ? 'from' : 'to'} recent average (${Math.round(recentAvg)}). Consider updating.`,
        content: `Update the baseline score from ${ctx.baseline_score} to ${Math.round(recentAvg)} to reflect current quality standards.`,
        confidence: Math.min(1, drift / 20),
      });
    }
  }

  return improvements;
}
