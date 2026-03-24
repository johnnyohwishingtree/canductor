import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendResult } from '../src/results.js';
import { diffResults, getStatus, getTrend, computeAutoBaseline, getBaseline } from '../src/results-query.js';
import type { VerifyResult, CanductorConfig } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-results-query-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Factory for VerifyResult test data. */
function makeVerifyResult(
  ref: string,
  score: number,
  pass: boolean,
  layers?: { name: string; score: number }[],
): VerifyResult {
  const defaultLayers = [
    { name: 'tests', type: 'deterministic' as const, pass, score: pass ? 100 : 0, errors: '', duration_ms: 100 },
    { name: 'ux', type: 'agent-review' as const, pass: true, score, errors: '', duration_ms: 200 },
  ];
  const resultLayers = layers
    ? layers.map(l => ({ name: l.name, type: 'deterministic' as const, pass: true, score: l.score, errors: '', duration_ms: 100 }))
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

// ---------------------------------------------------------------------------
// diffResults
// ---------------------------------------------------------------------------
describe('diffResults', () => {
  it('computes diff between two known refs', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged', layers: [{ name: 'tests', score: 100 }, { name: 'ux', score: 60 }] },
      { ref: '#2', score: 90, pass: true, status: 'merged', layers: [{ name: 'tests', score: 100 }, { name: 'ux', score: 80 }] },
    ]);

    const diff = diffResults(tempDir, '#1', '#2');

    expect(diff).not.toBeNull();
    expect(diff!.ref1).toBe('#1');
    expect(diff!.ref2).toBe('#2');
    expect(diff!.composite1).toBe(80);
    expect(diff!.composite2).toBe(90);
    expect(diff!.delta).toBe(10);
    expect(diff!.layers.length).toBe(2);
  });

  it('returns null when a ref is not found', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
    ]);

    expect(diffResults(tempDir, '#1', '#unknown')).toBeNull();
    expect(diffResults(tempDir, '#unknown', '#1')).toBeNull();
  });

  it('handles layers added or removed between refs', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged', layers: [{ name: 'tests', score: 100 }] },
      { ref: '#2', score: 90, pass: true, status: 'merged', layers: [{ name: 'tests', score: 100 }, { name: 'perf', score: 80 }] },
    ]);

    const diff = diffResults(tempDir, '#1', '#2');

    expect(diff).not.toBeNull();
    const addedLayer = diff!.layers.find(l => l.name === 'perf');
    expect(addedLayer).toBeDefined();
    expect(addedLayer!.change).toBe('added');
    expect(addedLayer!.score1).toBeNull();
    expect(addedLayer!.score2).toBe(80);
  });

  it('returns null for empty results log', () => {
    expect(diffResults(tempDir, '#1', '#2')).toBeNull();
  });

  it('sorts layers with regressed first, then improved', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged', layers: [{ name: 'a', score: 90 }, { name: 'b', score: 50 }] },
      { ref: '#2', score: 85, pass: true, status: 'merged', layers: [{ name: 'a', score: 70 }, { name: 'b', score: 80 }] },
    ]);

    const diff = diffResults(tempDir, '#1', '#2');
    expect(diff!.layers[0].change).toBe('regressed');
    expect(diff!.layers[1].change).toBe('improved');
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------
describe('getStatus', () => {
  it('returns correct counts for mixed results', () => {
    seedResults([
      { ref: '#1', score: 85, pass: true, status: 'merged' },
      { ref: '#2', score: 72, pass: true, status: 'merged' },
      { ref: '#3', score: 45, pass: false, status: 'rejected' },
      { ref: '#4', score: 90, pass: true, status: 'pending' },
    ]);

    const status = getStatus(tempDir);

    expect(status.total).toBe(4);
    expect(status.merged).toBe(2);
    expect(status.rejected).toBe(1);
    expect(status.pending).toBe(1);
  });

  it('reports last score and ref', () => {
    seedResults([
      { ref: '#1', score: 85, pass: true, status: 'merged' },
      { ref: '#2', score: 92, pass: true, status: 'merged' },
    ]);

    const status = getStatus(tempDir);

    expect(status.lastScore).toBe(92);
    expect(status.lastRef).toBe('#2');
    expect(status.lastStatus).toBe('merged');
  });

  it('returns empty status for no results', () => {
    const status = getStatus(tempDir);

    expect(status.total).toBe(0);
    expect(status.merged).toBe(0);
    expect(status.lastScore).toBeNull();
    expect(status.lastRef).toBeNull();
    expect(status.trendDirection).toBeNull();
  });

  it('computes trend direction from recent results', () => {
    seedResults([
      { ref: '#1', score: 70, pass: true, status: 'merged' },
      { ref: '#2', score: 72, pass: true, status: 'merged' },
      { ref: '#3', score: 74, pass: true, status: 'merged' },
      { ref: '#4', score: 76, pass: true, status: 'merged' },
      { ref: '#5', score: 78, pass: true, status: 'merged' },
      { ref: '#6', score: 80, pass: true, status: 'merged' },
      { ref: '#7', score: 82, pass: true, status: 'merged' },
      { ref: '#8', score: 84, pass: true, status: 'merged' },
      { ref: '#9', score: 86, pass: true, status: 'merged' },
      { ref: '#10', score: 88, pass: true, status: 'merged' },
    ]);

    const status = getStatus(tempDir);

    expect(status.trendDirection).toBe('improving');
    expect(status.trendNew).not.toBeNull();
    expect(status.trendOld).not.toBeNull();
    expect(status.trendNew!).toBeGreaterThan(status.trendOld!);
  });

  it('computes baseline from last 5 merged scores', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
      { ref: '#2', score: 90, pass: true, status: 'merged' },
      { ref: '#3', score: 100, pass: true, status: 'merged' },
      { ref: '#4', score: 70, pass: true, status: 'merged' },
      { ref: '#5', score: 60, pass: true, status: 'merged' },
    ]);

    const status = getStatus(tempDir);

    expect(status.baseline).toBe(80); // (80+90+100+70+60)/5 = 80
  });
});

// ---------------------------------------------------------------------------
// getTrend
// ---------------------------------------------------------------------------
describe('getTrend', () => {
  it('returns correct entries for last N results', () => {
    seedResults([
      { ref: '#1', score: 70, pass: true, status: 'merged' },
      { ref: '#2', score: 80, pass: true, status: 'merged' },
      { ref: '#3', score: 90, pass: true, status: 'merged' },
      { ref: '#4', score: 85, pass: true, status: 'merged' },
      { ref: '#5', score: 95, pass: true, status: 'merged' },
    ]);

    const trend = getTrend(tempDir, 3);

    expect(trend.entries).toHaveLength(3);
    expect(trend.entries[0].ref).toBe('#3');
    expect(trend.entries[2].ref).toBe('#5');
  });

  it('returns empty result for no results', () => {
    const trend = getTrend(tempDir);

    expect(trend.entries).toHaveLength(0);
    expect(trend.avg).toBe(0);
    expect(trend.direction).toBeNull();
    expect(trend.delta).toBeNull();
  });

  it('computes average, best, and worst correctly', () => {
    seedResults([
      { ref: '#1', score: 60, pass: true, status: 'merged' },
      { ref: '#2', score: 80, pass: true, status: 'merged' },
      { ref: '#3', score: 100, pass: true, status: 'merged' },
    ]);

    const trend = getTrend(tempDir);

    expect(trend.avg).toBe(80); // (60+80+100)/3 = 80
    expect(trend.best.score).toBe(100);
    expect(trend.best.refs).toContain('#3');
    expect(trend.worst.score).toBe(60);
    expect(trend.worst.refs).toContain('#1');
  });

  it('detects improving direction', () => {
    seedResults([
      { ref: '#1', score: 60, pass: true, status: 'merged' },
      { ref: '#2', score: 90, pass: true, status: 'merged' },
    ]);

    const trend = getTrend(tempDir);

    expect(trend.direction).toBe('improving');
    expect(trend.delta).toBe(30);
  });

  it('detects declining direction', () => {
    seedResults([
      { ref: '#1', score: 90, pass: true, status: 'merged' },
      { ref: '#2', score: 60, pass: true, status: 'merged' },
    ]);

    const trend = getTrend(tempDir);

    expect(trend.direction).toBe('declining');
    expect(trend.delta).toBe(-30);
  });

  it('detects stable direction when scores are equal', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
      { ref: '#2', score: 80, pass: true, status: 'merged' },
    ]);

    const trend = getTrend(tempDir);

    expect(trend.direction).toBe('stable');
    expect(trend.delta).toBe(0);
  });

  it('returns null direction for single result', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
    ]);

    const trend = getTrend(tempDir);

    expect(trend.direction).toBeNull();
    expect(trend.delta).toBeNull();
    expect(trend.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeAutoBaseline
// ---------------------------------------------------------------------------
describe('computeAutoBaseline', () => {
  it('computes baseline from last 5 merged scores', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
      { ref: '#2', score: 85, pass: true, status: 'merged' },
      { ref: '#3', score: 90, pass: true, status: 'merged' },
      { ref: '#4', score: 95, pass: true, status: 'merged' },
      { ref: '#5', score: 100, pass: true, status: 'merged' },
    ]);

    expect(computeAutoBaseline(tempDir)).toBe(90); // (80+85+90+95+100)/5 = 90
  });

  it('handles fewer than 5 merged results', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
      { ref: '#2', score: 90, pass: true, status: 'merged' },
    ]);

    expect(computeAutoBaseline(tempDir)).toBe(85); // (80+90)/2 = 85
  });

  it('returns 0 for no merged results', () => {
    seedResults([
      { ref: '#1', score: 50, pass: false, status: 'rejected' },
    ]);

    expect(computeAutoBaseline(tempDir)).toBe(0);
  });

  it('returns 0 for empty results log', () => {
    expect(computeAutoBaseline(tempDir)).toBe(0);
  });

  it('only uses merged results, ignoring rejected and pending', () => {
    seedResults([
      { ref: '#1', score: 50, pass: false, status: 'rejected' },
      { ref: '#2', score: 80, pass: true, status: 'merged' },
      { ref: '#3', score: 60, pass: true, status: 'pending' },
      { ref: '#4', score: 90, pass: true, status: 'merged' },
    ]);

    expect(computeAutoBaseline(tempDir)).toBe(85); // (80+90)/2 = 85
  });

  it('uses only the last 5 merged when more exist', () => {
    seedResults([
      { ref: '#1', score: 50, pass: true, status: 'merged' },
      { ref: '#2', score: 80, pass: true, status: 'merged' },
      { ref: '#3', score: 85, pass: true, status: 'merged' },
      { ref: '#4', score: 90, pass: true, status: 'merged' },
      { ref: '#5', score: 95, pass: true, status: 'merged' },
      { ref: '#6', score: 100, pass: true, status: 'merged' },
    ]);

    // Last 5 merged: 80, 85, 90, 95, 100 = avg 90
    expect(computeAutoBaseline(tempDir)).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// getBaseline
// ---------------------------------------------------------------------------
describe('getBaseline', () => {
  it('returns config baseline when set', () => {
    const config = { baseline: 75 } as CanductorConfig;

    expect(getBaseline(tempDir, config)).toBe(75);
  });

  it('falls back to auto baseline when config has no baseline', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
      { ref: '#2', score: 90, pass: true, status: 'merged' },
    ]);

    const config = {} as CanductorConfig;

    expect(getBaseline(tempDir, config)).toBe(85);
  });

  it('falls back to auto baseline when config is null', () => {
    seedResults([
      { ref: '#1', score: 80, pass: true, status: 'merged' },
      { ref: '#2', score: 90, pass: true, status: 'merged' },
    ]);

    expect(getBaseline(tempDir, null)).toBe(85);
  });

  it('returns 0 when config is null and no merged results exist', () => {
    expect(getBaseline(tempDir, null)).toBe(0);
  });
});
