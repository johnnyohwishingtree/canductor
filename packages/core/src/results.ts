/**
 * Results log — the autoresearch-inspired TSV that accumulates
 * verification history in the repo.
 *
 * This is the "training data" that feeds back into agent prompts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ResultRow, VerifyResult, QualityContext, CanductorConfig, StallDetection, LayerCorrelation } from './types.js';
import { summarizeLearnings } from './learnings.js';

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

  const rows: ResultRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue; // skip empty lines

    const fields = line.split('\t');
    if (fields.length !== 7) continue; // skip corrupted rows

    const [ref, timestamp, composite_score, decision, layer_scores, status, description] = fields;
    rows.push({
      ref,
      timestamp,
      composite_score: parseFloat(composite_score),
      decision,
      layer_scores,
      status: status as ResultRow['status'],
      description,
    });
  }
  return rows;
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
 * Update the status of a result row by ref.
 * If multiple rows share the same ref, updates the last match.
 * Returns true if a row was updated, false if ref not found.
 */
export function updateResultStatus(
  repoRoot: string,
  ref: string,
  newStatus: ResultRow['status']
): boolean {
  const path = join(repoRoot, RESULTS_PATH);
  if (!existsSync(path)) return false;

  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length <= 1) return false;

  // Find last matching row index (1-based, since index 0 is header)
  let lastMatchIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const columns = lines[i].split('\t');
    if (columns[0] === ref) {
      lastMatchIdx = i;
    }
  }

  if (lastMatchIdx === -1) return false;

  const columns = lines[lastMatchIdx].split('\t');
  columns[5] = newStatus; // status is the 6th column
  lines[lastMatchIdx] = columns.join('\t');

  writeFileSync(path, lines.join('\n') + '\n');
  return true;
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

  const stalls = detectStalls(results);

  if (stalls.length > 0) {
    for (const stall of stalls) {
      recurringIssues.push(
        `Ref "${stall.ref}" stalled: ${stall.attempts} attempts with scores ${stall.scoreRange.min}-${stall.scoreRange.max}`
      );
    }
  }

  return {
    recent_results: recent,
    recurring_issues: recurringIssues,
    suggested_rules: suggestedRules,
    baseline_score: baselineScore,
    stalls,
  };
}

/**
 * Detect refs that are stuck in a verify loop with no score improvement.
 *
 * A stall is detected when the same ref appears 3+ times in the results
 * log with all scores within a ±2 point range.
 *
 * @param results - All result rows to analyze
 * @returns Array of detected stalls
 */
export function detectStalls(results: ResultRow[]): StallDetection[] {
  const byRef = new Map<string, number[]>();

  for (const row of results) {
    const scores = byRef.get(row.ref) ?? [];
    scores.push(row.composite_score);
    byRef.set(row.ref, scores);
  }

  const stalls: StallDetection[] = [];

  for (const [ref, scores] of byRef) {
    if (scores.length < 3) continue;

    const min = Math.min(...scores);
    const max = Math.max(...scores);

    if (max - min <= 2) {
      stalls.push({
        ref,
        attempts: scores.length,
        scores,
        scoreRange: { min, max },
        suggestion: `Ref "${ref}" has been attempted ${scores.length} times with no meaningful improvement (scores: ${min}-${max}). Try a fundamentally different approach.`,
      });
    }
  }

  return stalls;
}

/**
 * Analyze which layer failures tend to co-occur across verification runs.
 * Returns pairs of layers sorted by correlation strength (highest first).
 */
export function correlateLayerFailures(results: ResultRow[]): LayerCorrelation[] {
  // Parse layer scores for each run, identifying which layers scored < 80
  const failureSets: Set<string>[] = [];

  for (const row of results) {
    if (!row.layer_scores || row.layer_scores.trim() === '') continue;

    const failed = new Set<string>();
    const scores = row.layer_scores.split(',');
    for (const s of scores) {
      const colonIdx = s.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const name = s.slice(0, colonIdx).trim();
      const val = parseFloat(s.slice(colonIdx + 1));
      if (!isNaN(val) && val < 80) {
        failed.add(name);
      }
    }
    if (failed.size > 0) {
      failureSets.push(failed);
    }
  }

  // Count co-failures and individual failures for each layer pair
  const allFailedLayers = new Set<string>();
  for (const fs of failureSets) {
    for (const l of fs) allFailedLayers.add(l);
  }

  const layers = [...allFailedLayers].sort();
  const correlations: LayerCorrelation[] = [];

  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      const l1 = layers[i];
      const l2 = layers[j];

      let coFailures = 0;
      let eitherFailed = 0;

      for (const fs of failureSets) {
        const has1 = fs.has(l1);
        const has2 = fs.has(l2);
        if (has1 || has2) eitherFailed++;
        if (has1 && has2) coFailures++;
      }

      if (coFailures >= 2) {
        correlations.push({
          layer1: l1,
          layer2: l2,
          coFailures,
          eitherFailed,
          ratio: eitherFailed > 0 ? coFailures / eitherFailed : 0,
        });
      }
    }
  }

  correlations.sort((a, b) => b.ratio - a.ratio);
  return correlations;
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
  /** Detected stalls — refs with repeated attempts and no score improvement. */
  stalls: StallDetection[];
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
      stalls: [],
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
    stalls: ctx.stalls,
  };
}

/** A single entry in the trend output. */
export interface TrendEntry {
  ref: string;
  score: number;
  status: ResultRow['status'];
}

/** Result of getTrend(). */
export interface TrendResult {
  entries: TrendEntry[];
  avg: number;
  best: { score: number; refs: string[] };
  worst: { score: number; refs: string[] };
  direction: 'improving' | 'declining' | 'stable' | null;
  /** Score delta from first to last entry. */
  delta: number | null;
}

/**
 * Compute a trend summary for the last N results.
 */
export function getTrend(repoRoot: string, last: number = 10): TrendResult {
  const results = readResults(repoRoot);
  const slice = results.slice(-last);

  if (slice.length === 0) {
    return {
      entries: [],
      avg: 0,
      best: { score: 0, refs: [] },
      worst: { score: 0, refs: [] },
      direction: null,
      delta: null,
    };
  }

  const entries: TrendEntry[] = slice.map(r => ({
    ref: r.ref,
    score: r.composite_score,
    status: r.status,
  }));

  const scores = entries.map(e => e.score);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const bestScore = Math.max(...scores);
  const worstScore = Math.min(...scores);
  const bestRefs = entries.filter(e => e.score === bestScore).map(e => e.ref);
  const worstRefs = entries.filter(e => e.score === worstScore).map(e => e.ref);

  let direction: TrendResult['direction'] = null;
  let delta: number | null = null;

  if (entries.length >= 2) {
    delta = entries[entries.length - 1].score - entries[0].score;
    if (delta > 0) direction = 'improving';
    else if (delta < 0) direction = 'declining';
    else direction = 'stable';
  }

  return {
    entries,
    avg,
    best: { score: bestScore, refs: bestRefs },
    worst: { score: worstScore, refs: worstRefs },
    direction,
    delta,
  };
}

/**
 * Compute the auto-baseline from the last 5 merged scores.
 * Returns 0 if there are no merged results.
 */
export function computeAutoBaseline(repoRoot: string): number {
  const results = readResults(repoRoot);
  const mergedScores = results
    .filter(r => r.status === 'merged')
    .map(r => r.composite_score)
    .slice(-5);
  return mergedScores.length > 0
    ? Math.round(mergedScores.reduce((a, b) => a + b, 0) / mergedScores.length)
    : 0;
}

/**
 * Get the effective baseline score.
 * If a config override exists, use that. Otherwise compute from results history.
 */
export function getBaseline(repoRoot: string, config: CanductorConfig | null): number {
  if (config?.baseline !== undefined) {
    return config.baseline;
  }
  return computeAutoBaseline(repoRoot);
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

  if (ctx.stalls.length > 0) {
    lines.push('### Stalled refs:');
    for (const stall of ctx.stalls) {
      lines.push(`- ${stall.suggestion}`);
    }
    lines.push('');
  }

  // Include learnings from past failures
  const learningsSummary = summarizeLearnings(repoRoot);
  if (learningsSummary) {
    lines.push(learningsSummary);
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
