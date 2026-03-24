import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendResult } from '../src/results.js';
import {
  analyzeResults,
  detectStalls,
  correlateLayerFailures,
  analyzeTrajectory,
  generateInsights,
  generatePromptContext,
} from '../src/results-analysis.js';
import type { VerifyResult, ResultRow } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-results-analysis-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Factory for VerifyResult test data. */
function makeVerifyResult(
  ref: string,
  score: number,
  pass: boolean,
  layerScores?: { name: string; score: number }[],
): VerifyResult {
  const defaultLayers = [
    { name: 'tests', type: 'deterministic' as const, pass, score: pass ? 100 : 0, errors: '', duration_ms: 100 },
    { name: 'code_quality', type: 'agent-review' as const, pass: true, score, errors: '', duration_ms: 200 },
  ];
  const resultLayers = layerScores
    ? layerScores.map(l => ({ name: l.name, type: 'deterministic' as const, pass: l.score >= 80, score: l.score, errors: '', duration_ms: 100 }))
    : defaultLayers;
  return {
    ref,
    timestamp: '2026-03-21T00:00:00Z',
    layers: resultLayers,
    composite_score: score,
    decision: pass ? 'auto_merge' : 'block',
    summary: '',
  };
}

/** Seed the results log with multiple entries. */
function seedResults(entries: { ref: string; score: number; pass: boolean; status: string; layers?: { name: string; score: number }[] }[]): void {
  for (const e of entries) {
    appendResult(tempDir, makeVerifyResult(e.ref, e.score, e.pass, e.layers), e.status, `Result for ${e.ref}`);
  }
}

/** Build a ResultRow for direct use in functions that take ResultRow[]. */
function makeResultRow(
  ref: string,
  score: number,
  status: string,
  layerScores: string,
): ResultRow {
  return {
    ref,
    timestamp: '2026-03-21T00:00:00Z',
    composite_score: score,
    decision: score >= 80 ? 'auto_merge' : 'block',
    layer_scores: layerScores,
    status,
    description: `Result for ${ref}`,
  };
}

// ---------------------------------------------------------------------------
// analyzeResults
// ---------------------------------------------------------------------------
describe('analyzeResults', () => {
  it('generates quality context from results history', () => {
    seedResults([
      { ref: '#1', score: 85, pass: true, status: 'merged' },
      { ref: '#2', score: 90, pass: true, status: 'merged' },
      { ref: '#3', score: 95, pass: true, status: 'merged' },
    ]);

    const ctx = analyzeResults(tempDir);

    expect(ctx.baseline_score).toBeGreaterThan(0);
    expect(ctx.recent_results).toHaveLength(3);
    expect(ctx.recurring_issues).toBeInstanceOf(Array);
    expect(ctx.suggested_rules).toBeInstanceOf(Array);
  });

  it('handles empty results', () => {
    const ctx = analyzeResults(tempDir);

    expect(ctx.baseline_score).toBe(0);
    expect(ctx.recent_results).toHaveLength(0);
    expect(ctx.recurring_issues).toHaveLength(0);
    expect(ctx.suggested_rules).toHaveLength(0);
    expect(ctx.stalls).toHaveLength(0);
  });

  it('detects recurring layer failures from rejected results', () => {
    seedResults([
      { ref: '#1', score: 50, pass: false, status: 'rejected', layers: [{ name: 'tests', score: 50 }, { name: 'ux', score: 90 }] },
      { ref: '#2', score: 55, pass: false, status: 'rejected', layers: [{ name: 'tests', score: 55 }, { name: 'ux', score: 85 }] },
      { ref: '#3', score: 90, pass: true, status: 'merged', layers: [{ name: 'tests', score: 100 }, { name: 'ux', score: 90 }] },
    ]);

    const ctx = analyzeResults(tempDir);

    expect(ctx.recurring_issues.some(i => i.includes('tests'))).toBe(true);
  });

  it('computes baseline from last 5 merged scores', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
      { ref: '#2', score: 90, pass: true, status: 'merged' },
      { ref: '#3', score: 100, pass: true, status: 'merged' },
    ]);

    const ctx = analyzeResults(tempDir);

    expect(ctx.baseline_score).toBe(90); // (80+90+100)/3 = 90
  });
});

// ---------------------------------------------------------------------------
// detectStalls
// ---------------------------------------------------------------------------
describe('detectStalls', () => {
  it('detects stalled ref with 3+ attempts and no improvement', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 75, 'pending', 'tests:100,ux:50'),
      makeResultRow('#1', 76, 'pending', 'tests:100,ux:51'),
      makeResultRow('#1', 75, 'pending', 'tests:100,ux:50'),
    ];

    const stalls = detectStalls(results);

    expect(stalls).toHaveLength(1);
    expect(stalls[0].ref).toBe('#1');
    expect(stalls[0].attempts).toBe(3);
    expect(stalls[0].scoreRange.min).toBe(75);
    expect(stalls[0].scoreRange.max).toBe(76);
    expect(stalls[0].suggestion).toContain('#1');
  });

  it('returns empty for improving scores', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 70, 'pending', 'tests:100'),
      makeResultRow('#1', 80, 'pending', 'tests:100'),
      makeResultRow('#1', 90, 'merged', 'tests:100'),
    ];

    const stalls = detectStalls(results);

    expect(stalls).toHaveLength(0);
  });

  it('returns empty for single result per ref', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 85, 'merged', 'tests:100'),
      makeResultRow('#2', 90, 'merged', 'tests:100'),
    ];

    const stalls = detectStalls(results);

    expect(stalls).toHaveLength(0);
  });

  it('returns empty for empty results', () => {
    expect(detectStalls([])).toHaveLength(0);
  });

  it('does not flag refs with only 2 attempts', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 75, 'pending', 'tests:100'),
      makeResultRow('#1', 76, 'pending', 'tests:100'),
    ];

    const stalls = detectStalls(results);

    expect(stalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// correlateLayerFailures
// ---------------------------------------------------------------------------
describe('correlateLayerFailures', () => {
  it('finds correlated failure patterns between two layers', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 60, 'rejected', 'tests:50,ux:60'),
      makeResultRow('#2', 55, 'rejected', 'tests:40,ux:55'),
      makeResultRow('#3', 90, 'merged', 'tests:100,ux:90'),
    ];

    const correlations = correlateLayerFailures(results);

    expect(correlations.length).toBeGreaterThanOrEqual(1);
    const pair = correlations.find(c =>
      (c.layer1 === 'tests' && c.layer2 === 'ux') ||
      (c.layer1 === 'ux' && c.layer2 === 'tests')
    );
    expect(pair).toBeDefined();
    expect(pair!.coFailures).toBe(2);
  });

  it('returns empty when no failures exist', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 90, 'merged', 'tests:100,ux:90'),
      makeResultRow('#2', 95, 'merged', 'tests:100,ux:95'),
    ];

    const correlations = correlateLayerFailures(results);

    expect(correlations).toHaveLength(0);
  });

  it('returns empty for single-layer results', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 60, 'rejected', 'tests:50'),
      makeResultRow('#2', 55, 'rejected', 'tests:40'),
    ];

    const correlations = correlateLayerFailures(results);

    expect(correlations).toHaveLength(0);
  });

  it('returns empty for empty results', () => {
    expect(correlateLayerFailures([])).toHaveLength(0);
  });

  it('requires at least 2 co-failures to report a correlation', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 60, 'rejected', 'tests:50,ux:60'),
      makeResultRow('#2', 90, 'merged', 'tests:100,ux:90'),
    ];

    const correlations = correlateLayerFailures(results);

    expect(correlations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// analyzeTrajectory
// ---------------------------------------------------------------------------
describe('analyzeTrajectory', () => {
  it('computes improving trajectory for increasing scores', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 70, 'merged', 'tests:70'),
      makeResultRow('#2', 75, 'merged', 'tests:75'),
      makeResultRow('#3', 80, 'merged', 'tests:80'),
      makeResultRow('#4', 85, 'merged', 'tests:85'),
      makeResultRow('#5', 90, 'merged', 'tests:90'),
    ];

    const trajectory = analyzeTrajectory(results);

    expect(trajectory.overall.direction).toBe('improving');
    expect(trajectory.overall.slope).toBeGreaterThan(0);
  });

  it('computes declining trajectory for decreasing scores', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 95, 'merged', 'tests:95'),
      makeResultRow('#2', 90, 'merged', 'tests:90'),
      makeResultRow('#3', 85, 'merged', 'tests:85'),
      makeResultRow('#4', 80, 'merged', 'tests:80'),
      makeResultRow('#5', 70, 'merged', 'tests:70'),
    ];

    const trajectory = analyzeTrajectory(results);

    expect(trajectory.overall.direction).toBe('declining');
    expect(trajectory.overall.slope).toBeLessThan(0);
  });

  it('handles empty results', () => {
    const trajectory = analyzeTrajectory([]);

    expect(trajectory.overall.direction).toBe('stable');
    expect(trajectory.overall.recentScores).toHaveLength(0);
    expect(trajectory.layers).toHaveLength(0);
  });

  it('respects window parameter', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 50, 'merged', 'tests:50'),
      makeResultRow('#2', 55, 'merged', 'tests:55'),
      makeResultRow('#3', 80, 'merged', 'tests:80'),
      makeResultRow('#4', 85, 'merged', 'tests:85'),
      makeResultRow('#5', 90, 'merged', 'tests:90'),
    ];

    const trajectory = analyzeTrajectory(results, 3);

    expect(trajectory.overall.recentScores).toHaveLength(3);
    expect(trajectory.overall.recentScores).toEqual([80, 85, 90]);
  });

  it('computes per-layer trajectories', () => {
    const results: ResultRow[] = [
      makeResultRow('#1', 80, 'merged', 'tests:90,ux:70'),
      makeResultRow('#2', 85, 'merged', 'tests:95,ux:75'),
      makeResultRow('#3', 90, 'merged', 'tests:100,ux:80'),
    ];

    const trajectory = analyzeTrajectory(results);

    expect(trajectory.layers.length).toBeGreaterThanOrEqual(2);
    const testsLayer = trajectory.layers.find(l => l.layer === 'tests');
    expect(testsLayer).toBeDefined();
    expect(testsLayer!.recentScores).toEqual([90, 95, 100]);
  });
});

// ---------------------------------------------------------------------------
// generateInsights
// ---------------------------------------------------------------------------
describe('generateInsights', () => {
  it('produces recommendations for declining layers', () => {
    // Create results with declining scores
    seedResults([
      { ref: '#1', score: 95, pass: true, status: 'merged', layers: [{ name: 'tests', score: 95 }] },
      { ref: '#2', score: 90, pass: true, status: 'merged', layers: [{ name: 'tests', score: 90 }] },
      { ref: '#3', score: 85, pass: true, status: 'merged', layers: [{ name: 'tests', score: 85 }] },
      { ref: '#4', score: 78, pass: true, status: 'merged', layers: [{ name: 'tests', score: 78 }] },
      { ref: '#5', score: 70, pass: true, status: 'merged', layers: [{ name: 'tests', score: 70 }] },
    ]);

    const insights = generateInsights(tempDir);

    expect(insights.recommendations.length).toBeGreaterThan(0);
    expect(insights.trajectory).toBeDefined();
    expect(insights.correlations).toBeInstanceOf(Array);
  });

  it('returns stable message for healthy results', () => {
    seedResults([
      { ref: '#1', score: 90, pass: true, status: 'merged', layers: [{ name: 'tests', score: 100 }] },
      { ref: '#2', score: 91, pass: true, status: 'merged', layers: [{ name: 'tests', score: 100 }] },
      { ref: '#3', score: 90, pass: true, status: 'merged', layers: [{ name: 'tests', score: 100 }] },
    ]);

    const insights = generateInsights(tempDir);

    expect(insights.recommendations).toContain('All layers are stable. No action needed.');
  });

  it('handles empty results', () => {
    const insights = generateInsights(tempDir);

    expect(insights.trajectory).toBeDefined();
    expect(insights.correlations).toHaveLength(0);
    expect(insights.recommendations).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// generatePromptContext
// ---------------------------------------------------------------------------
describe('generatePromptContext', () => {
  it('returns formatted string with baseline score', () => {
    seedResults([
      { ref: '#1', score: 85, pass: true, status: 'merged' },
      { ref: '#2', score: 90, pass: true, status: 'merged' },
    ]);

    const context = generatePromptContext(tempDir);

    expect(context).toContain('Canductor Quality Context');
    expect(context).toContain('baseline quality score');
    expect(context).toContain('/100');
  });

  it('includes recent verification results', () => {
    seedResults([
      { ref: '#10', score: 85, pass: true, status: 'merged' },
      { ref: '#11', score: 90, pass: true, status: 'merged' },
    ]);

    const context = generatePromptContext(tempDir);

    expect(context).toContain('#10');
    expect(context).toContain('#11');
    expect(context).toContain('Recent verification results');
  });

  it('handles empty results without error', () => {
    const context = generatePromptContext(tempDir);

    expect(context).toContain('Canductor Quality Context');
    expect(context).toContain('0/100');
  });

  it('includes recurring issues when present', () => {
    seedResults([
      { ref: '#1', score: 50, pass: false, status: 'rejected', layers: [{ name: 'tests', score: 50 }, { name: 'ux', score: 90 }] },
      { ref: '#2', score: 55, pass: false, status: 'rejected', layers: [{ name: 'tests', score: 55 }, { name: 'ux', score: 85 }] },
    ]);

    const context = generatePromptContext(tempDir);

    expect(context).toContain('Recurring issues');
  });
});
