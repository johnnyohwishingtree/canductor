/**
 * Results queries — diffing, status, trends, and baseline computation
 * from the verification results log.
 */

import type { ResultRow, CanductorConfig, StallDetection, LayerTrendResult, LayerTrendEntry } from './types.js';
import { readResults, parseLayerScores } from './results.js';
import { analyzeResults } from './results-analysis.js';

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
 * Get trend data for a specific verification layer.
 * Returns per-layer score history, average, min, max, and trend direction.
 */
export function getLayerTrend(repoRoot: string, layerName: string, last?: number): LayerTrendResult {
  const results = readResults(repoRoot);

  const entries: LayerTrendEntry[] = [];
  for (const row of results) {
    const scores = parseLayerScores(row.layer_scores);
    const score = scores.get(layerName);
    if (score !== undefined) {
      entries.push({ ref: row.ref, score, timestamp: row.timestamp });
    }
  }

  const sliced = last !== undefined ? entries.slice(-last) : entries;

  if (sliced.length === 0) {
    return { layer: layerName, entries: [], avg: 0, min: 0, max: 0, direction: null };
  }

  const scores = sliced.map(e => e.score);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  let direction: LayerTrendResult['direction'] = null;
  if (sliced.length >= 2) {
    const delta = sliced[sliced.length - 1].score - sliced[0].score;
    if (delta > 0) direction = 'improving';
    else if (delta < 0) direction = 'declining';
    else direction = 'stable';
  }

  return { layer: layerName, entries: sliced, avg, min, max, direction };
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
