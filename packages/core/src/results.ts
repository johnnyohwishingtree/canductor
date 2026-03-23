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

/** A single layer diff entry. */
export interface LayerDiff {
  name: string;
  score1: number | null;
  score2: number | null;
  delta: number | null;
  change: 'improved' | 'regressed' | 'unchanged' | 'added' | 'removed';
}

/** Result of comparing two refs from the results log. */
export interface DiffResult {
  ref1: string;
  ref2: string;
  composite1: number;
  composite2: number;
  delta: number;
  layers: LayerDiff[];
}

/**
 * Parse a layer_scores string ("tests:100,ux:80") into a map.
 */
function parseLayerScores(raw: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!raw) return map;
  for (const entry of raw.split(',')) {
    const [name, val] = entry.split(':');
    if (name && val !== undefined) map.set(name, parseFloat(val));
  }
  return map;
}

/**
 * Compare two refs from the results log and show how quality changed.
 * Returns null if either ref is not found.
 */
export function diffResults(repoRoot: string, ref1: string, ref2: string): DiffResult | null {
  const results = readResults(repoRoot);

  const row1 = results.find(r => r.ref === ref1);
  const row2 = results.find(r => r.ref === ref2);

  if (!row1 || !row2) return null;

  const scores1 = parseLayerScores(row1.layer_scores);
  const scores2 = parseLayerScores(row2.layer_scores);

  const allLayers = new Set([...scores1.keys(), ...scores2.keys()]);
  const layers: LayerDiff[] = [];

  for (const name of allLayers) {
    const s1 = scores1.has(name) ? scores1.get(name)! : null;
    const s2 = scores2.has(name) ? scores2.get(name)! : null;

    let change: LayerDiff['change'];
    let delta: number | null = null;

    if (s1 === null) {
      change = 'added';
    } else if (s2 === null) {
      change = 'removed';
    } else {
      delta = s2 - s1;
      if (delta > 0) change = 'improved';
      else if (delta < 0) change = 'regressed';
      else change = 'unchanged';
    }

    layers.push({ name, score1: s1, score2: s2, delta, change });
  }

  // Sort: regressed first, then improved, then unchanged, then added/removed
  const order = { regressed: 0, improved: 1, unchanged: 2, added: 3, removed: 4 };
  layers.sort((a, b) => order[a.change] - order[b.change]);

  return {
    ref1,
    ref2,
    composite1: row1.composite_score,
    composite2: row2.composite_score,
    delta: row2.composite_score - row1.composite_score,
    layers,
  };
}

/** A summary of pipeline health derived from the results log. */
export interface PipelineStatus {
  total: number;
  merged: number;
  rejected: number;
  pending: number;
  baseline: number;
  lastScore: number | null;
  lastRef: string | null;
  lastStatus: 'merged' | 'rejected' | 'pending' | null;
  /** Average score of the 5 runs before the most recent 5. */
  trendOld: number | null;
  /** Average score of the most recent 5 runs. */
  trendNew: number | null;
  trendDirection: 'improving' | 'declining' | 'stable' | null;
  recurringIssues: string[];
}

/**
 * Compute a quick pipeline health summary from the results log.
 */
export function getStatus(repoRoot: string): PipelineStatus {
  const results = readResults(repoRoot);

  if (results.length === 0) {
    return {
      total: 0, merged: 0, rejected: 0, pending: 0,
      baseline: 0, lastScore: null, lastRef: null, lastStatus: null,
      trendOld: null, trendNew: null, trendDirection: null,
      recurringIssues: [],
    };
  }

  const total = results.length;
  const merged = results.filter(r => r.status === 'merged').length;
  const rejected = results.filter(r => r.status === 'rejected').length;
  const pending = results.filter(r => r.status === 'pending').length;

  const mergedScores = results
    .filter(r => r.status === 'merged')
    .map(r => r.composite_score)
    .slice(-5);
  const baseline = mergedScores.length > 0
    ? Math.round(mergedScores.reduce((a, b) => a + b, 0) / mergedScores.length)
    : 0;

  const last = results[results.length - 1];

  const avg = (arr: number[]): number | null =>
    arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const recent10 = results.slice(-10);
  const trendNew = avg(recent10.slice(-5).map(r => r.composite_score));
  const trendOld = avg(recent10.slice(0, Math.max(0, recent10.length - 5)).map(r => r.composite_score));

  let trendDirection: PipelineStatus['trendDirection'] = null;
  if (trendNew !== null && trendOld !== null) {
    if (trendNew > trendOld) trendDirection = 'improving';
    else if (trendNew < trendOld) trendDirection = 'declining';
    else trendDirection = 'stable';
  }

  const ctx = analyzeResults(repoRoot);

  return {
    total, merged, rejected, pending,
    baseline,
    lastScore: last.composite_score,
    lastRef: last.ref,
    lastStatus: last.status,
    trendOld,
    trendNew,
    trendDirection,
    recurringIssues: ctx.recurring_issues,
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
