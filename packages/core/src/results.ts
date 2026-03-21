/**
 * Results log — the autoresearch-inspired TSV that accumulates
 * verification history in the repo.
 *
 * This is the "training data" that feeds back into agent prompts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ResultRow, VerifyResult, QualityContext } from './types.js';

const RESULTS_PATH = '.canductor/results.tsv';
const HEADER = 'ref\ttimestamp\tcomposite_score\tdecision\tlayer_scores\tstatus\tdescription';

/** Ensure the .canductor directory exists. */
function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, '.canductor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Read all result rows from the TSV log. */
export function readResults(repoRoot: string): ResultRow[] {
  const path = join(repoRoot, RESULTS_PATH);
  if (!existsSync(path)) return [];

  const lines = readFileSync(path, 'utf-8').trim().split('\n');
  if (lines.length <= 1) return []; // header only

  return lines.slice(1).map(line => {
    const [ref, timestamp, composite_score, decision, layer_scores, status, description] =
      line.split('\t');
    return {
      ref,
      timestamp,
      composite_score: parseFloat(composite_score),
      decision,
      layer_scores,
      status: status as ResultRow['status'],
      description,
    };
  });
}

/** Append a verification result to the TSV log. */
export function appendResult(
  repoRoot: string,
  result: VerifyResult,
  status: ResultRow['status'],
  description: string
): void {
  ensureDir(repoRoot);
  const path = join(repoRoot, RESULTS_PATH);

  const layerScores = result.layers
    .map(l => `${l.name}:${l.score}`)
    .join(',');

  const row = [
    result.ref,
    result.timestamp,
    result.composite_score,
    result.decision,
    layerScores,
    status,
    description,
  ].join('\t');

  if (!existsSync(path)) {
    writeFileSync(path, HEADER + '\n' + row + '\n');
  } else {
    const content = readFileSync(path, 'utf-8');
    writeFileSync(path, content.trimEnd() + '\n' + row + '\n');
  }
}

/**
 * Analyze results history to generate quality context for agent prompts.
 * This is the "learning" loop — patterns from past results inform future runs.
 */
export function analyzeResults(repoRoot: string): QualityContext {
  const results = readResults(repoRoot);
  const recent = results.slice(-20);

  // Find the current baseline (moving average of last 5 merged scores)
  const mergedScores = results
    .filter(r => r.status === 'merged')
    .map(r => r.composite_score)
    .slice(-5);
  const baselineScore = mergedScores.length > 0
    ? Math.round(mergedScores.reduce((a, b) => a + b, 0) / mergedScores.length)
    : 0;

  // Detect recurring issues from layer scores
  const layerFailCounts = new Map<string, number>();
  for (const row of recent) {
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

  const recurringIssues: string[] = [];
  for (const [layer, count] of layerFailCounts) {
    if (count >= 2) {
      recurringIssues.push(
        `"${layer}" layer failed ${count} times in the last ${recent.length} runs`
      );
    }
  }

  // Generate suggested rules based on patterns
  const suggestedRules: string[] = [];
  if (recurringIssues.length > 0) {
    suggestedRules.push(
      'Consider adding specific instructions to CLAUDE.md addressing: ' +
      recurringIssues.join('; ')
    );
  }

  const rejectedRecent = recent.filter(r => r.status === 'rejected');
  if (rejectedRecent.length > 0) {
    suggestedRules.push(
      'Recent rejected PRs: ' +
      rejectedRecent.map(r => `${r.ref} (${r.description})`).join(', ')
    );
  }

  return {
    recent_results: recent,
    recurring_issues: recurringIssues,
    suggested_rules: suggestedRules,
    baseline_score: baselineScore,
  };
}

/**
 * Generate a context block to inject into agent prompts.
 * This is what makes the agent "learn" from past results.
 */
export function generatePromptContext(repoRoot: string): string {
  const ctx = analyzeResults(repoRoot);

  const lines: string[] = [
    '## Canductor Quality Context',
    '',
    `Current baseline quality score: ${ctx.baseline_score}/100`,
    '',
  ];

  if (ctx.recurring_issues.length > 0) {
    lines.push('### Recurring issues (avoid these patterns):');
    for (const issue of ctx.recurring_issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  if (ctx.suggested_rules.length > 0) {
    lines.push('### Quality notes:');
    for (const rule of ctx.suggested_rules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (ctx.recent_results.length > 0) {
    lines.push('### Recent verification results:');
    for (const r of ctx.recent_results.slice(-5)) {
      lines.push(`- ${r.ref}: score=${r.composite_score} ${r.status} (${r.description})`);
    }
  }

  return lines.join('\n');
}
