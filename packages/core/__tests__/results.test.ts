import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendResult, readResults, updateResultStatus, analyzeResults, detectStalls, correlateLayerFailures, generatePromptContext, diffResults, getStatus, getTrend, computeAutoBaseline, getBaseline } from '../src/results.js';
import type { VerifyResult, CanductorConfig, ResultRow } from '../src/types.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeVerifyResult(ref: string, score: number, pass: boolean): VerifyResult {
  return {
    ref,
    timestamp: '2026-03-21T00:00:00Z',
    layers: [
      { name: 'tests', type: 'deterministic', pass, score: pass ? 100 : 0, errors: '', duration_ms: 100 },
      { name: 'ux', type: 'agent-review', pass: true, score, errors: '', duration_ms: 200 },
    ],
    composite_score: score,
    decision: pass ? 'auto_merge' : 'block',
    summary: '',
  };
}

describe('results log', () => {
  it('creates TSV file with header on first append', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'first PR');

    const content = readFileSync(join(tempDir, '.canductor/results.tsv'), 'utf-8');
    expect(content).toContain('ref\ttimestamp\tcomposite_score');
    expect(content).toContain('#1');
  });

  it('appends multiple results', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'first');
    appendResult(tempDir, makeVerifyResult('#2', 72, true), 'merged', 'second');
    appendResult(tempDir, makeVerifyResult('#3', 45, false), 'rejected', 'third');

    const rows = readResults(tempDir);
    expect(rows).toHaveLength(3);
    expect(rows[0].ref).toBe('#1');
    expect(rows[2].status).toBe('rejected');
  });

  it('returns empty array when no file exists', () => {
    expect(readResults(tempDir)).toHaveLength(0);
  });
});

describe('updateResultStatus', () => {
  it('updates status of an existing row', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'pending', 'first PR');

    const updated = updateResultStatus(tempDir, '#1', 'merged');
    expect(updated).toBe(true);

    const rows = readResults(tempDir);
    expect(rows[0].status).toBe('merged');
  });

  it('returns false when ref is not found', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'pending', 'first PR');

    const updated = updateResultStatus(tempDir, '#99', 'merged');
    expect(updated).toBe(false);
  });

  it('updates the last matching row when multiple refs exist', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'pending', 'first');
    appendResult(tempDir, makeVerifyResult('#1', 90, true), 'pending', 'second');

    const updated = updateResultStatus(tempDir, '#1', 'merged');
    expect(updated).toBe(true);

    const rows = readResults(tempDir);
    expect(rows[0].status).toBe('pending');
    expect(rows[1].status).toBe('merged');
  });

  it('returns false when results file does not exist', () => {
    const updated = updateResultStatus(tempDir, '#1', 'merged');
    expect(updated).toBe(false);
  });
});

describe('analyzeResults', () => {
  it('computes baseline from last 5 merged scores', () => {
    for (let i = 1; i <= 5; i++) {
      appendResult(tempDir, makeVerifyResult(`#${i}`, 80 + i, true), 'merged', `pr ${i}`);
    }
    const ctx = analyzeResults(tempDir);
    // (81+82+83+84+85) / 5 = 83
    expect(ctx.baseline_score).toBe(83);
  });

  it('detects recurring layer failures', () => {
    // Two rejected PRs with low ux scores
    appendResult(tempDir, makeVerifyResult('#1', 40, false), 'rejected', 'bad ux 1');
    appendResult(tempDir, makeVerifyResult('#2', 35, false), 'rejected', 'bad ux 2');

    const ctx = analyzeResults(tempDir);
    expect(ctx.recurring_issues.length).toBeGreaterThan(0);
    // Both "tests" (score 0) and "ux" (score 40/35) are below threshold
    const allIssues = ctx.recurring_issues.join(' ');
    expect(allIssues).toContain('tests');
    expect(allIssues).toContain('ux');
  });
});

describe('diffResults', () => {
  it('returns null when either ref is not found', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'first');
    expect(diffResults(tempDir, '#1', '#99')).toBeNull();
    expect(diffResults(tempDir, '#99', '#1')).toBeNull();
  });

  it('computes composite delta and layer diffs', () => {
    appendResult(tempDir, makeVerifyResult('#1', 70, false), 'rejected', 'first');
    appendResult(tempDir, makeVerifyResult('#2', 90, true), 'merged', 'second');

    const diff = diffResults(tempDir, '#1', '#2');
    expect(diff).not.toBeNull();
    expect(diff!.ref1).toBe('#1');
    expect(diff!.ref2).toBe('#2');
    expect(diff!.composite1).toBe(70);
    expect(diff!.composite2).toBe(90);
    expect(diff!.delta).toBe(20);
  });

  it('classifies layers as improved, regressed, or unchanged', () => {
    // ref1: tests=0, ux=70 (pass=false gives tests=0, score=70 -> ux=70)
    appendResult(tempDir, makeVerifyResult('#1', 70, false), 'rejected', 'low tests');
    // ref2: tests=100, ux=90 (pass=true)
    appendResult(tempDir, makeVerifyResult('#2', 90, true), 'merged', 'high tests');

    const diff = diffResults(tempDir, '#1', '#2');
    expect(diff).not.toBeNull();

    const testsLayer = diff!.layers.find(l => l.name === 'tests');
    expect(testsLayer).toBeDefined();
    expect(testsLayer!.change).toBe('improved');
    expect(testsLayer!.delta).toBe(100);

    // ux went from 70 -> 90 (score param in makeVerifyResult)
    const uxLayer = diff!.layers.find(l => l.name === 'ux');
    expect(uxLayer).toBeDefined();
    expect(uxLayer!.change).toBe('improved');
  });

  it('marks a layer as regressed when score drops', () => {
    appendResult(tempDir, makeVerifyResult('#1', 90, true), 'merged', 'good');
    appendResult(tempDir, makeVerifyResult('#2', 60, false), 'rejected', 'bad');

    const diff = diffResults(tempDir, '#1', '#2');
    expect(diff).not.toBeNull();
    expect(diff!.delta).toBe(-30);

    const testsLayer = diff!.layers.find(l => l.name === 'tests');
    expect(testsLayer!.change).toBe('regressed');
  });
});

describe('getStatus', () => {
  it('returns zero totals and nulls when no results exist', () => {
    const s = getStatus(tempDir);
    expect(s.total).toBe(0);
    expect(s.merged).toBe(0);
    expect(s.rejected).toBe(0);
    expect(s.pending).toBe(0);
    expect(s.lastScore).toBeNull();
    expect(s.lastRef).toBeNull();
    expect(s.trendDirection).toBeNull();
  });

  it('counts statuses correctly', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'first');
    appendResult(tempDir, makeVerifyResult('#2', 72, true), 'merged', 'second');
    appendResult(tempDir, makeVerifyResult('#3', 45, false), 'rejected', 'third');
    appendResult(tempDir, makeVerifyResult('#4', 60, true), 'pending', 'fourth');

    const s = getStatus(tempDir);
    expect(s.total).toBe(4);
    expect(s.merged).toBe(2);
    expect(s.rejected).toBe(1);
    expect(s.pending).toBe(1);
  });

  it('reports last score and ref', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'first');
    appendResult(tempDir, makeVerifyResult('#2', 90, true), 'merged', 'second');

    const s = getStatus(tempDir);
    expect(s.lastScore).toBe(90);
    expect(s.lastRef).toBe('#2');
    expect(s.lastStatus).toBe('merged');
  });

  it('computes baseline from last 5 merged scores', () => {
    for (let i = 1; i <= 5; i++) {
      appendResult(tempDir, makeVerifyResult(`#${i}`, 80 + i, true), 'merged', `pr ${i}`);
    }
    const s = getStatus(tempDir);
    // (81+82+83+84+85) / 5 = 83
    expect(s.baseline).toBe(83);
  });

  it('detects improving trend', () => {
    // Old 5 avg = 70, new 5 avg = 85
    for (let i = 0; i < 5; i++) {
      appendResult(tempDir, makeVerifyResult(`#old${i}`, 70, true), 'merged', 'old');
    }
    for (let i = 0; i < 5; i++) {
      appendResult(tempDir, makeVerifyResult(`#new${i}`, 85, true), 'merged', 'new');
    }
    const s = getStatus(tempDir);
    expect(s.trendDirection).toBe('improving');
    expect(s.trendOld).toBe(70);
    expect(s.trendNew).toBe(85);
  });

  it('detects declining trend', () => {
    for (let i = 0; i < 5; i++) {
      appendResult(tempDir, makeVerifyResult(`#old${i}`, 90, true), 'merged', 'old');
    }
    for (let i = 0; i < 5; i++) {
      appendResult(tempDir, makeVerifyResult(`#new${i}`, 60, false), 'rejected', 'new');
    }
    const s = getStatus(tempDir);
    expect(s.trendDirection).toBe('declining');
  });

  it('reports recurring issues', () => {
    appendResult(tempDir, makeVerifyResult('#1', 40, false), 'rejected', 'bad ux 1');
    appendResult(tempDir, makeVerifyResult('#2', 35, false), 'rejected', 'bad ux 2');

    const s = getStatus(tempDir);
    expect(s.recurringIssues.length).toBeGreaterThan(0);
  });

  it('returns no recurring issues for clean history', () => {
    appendResult(tempDir, makeVerifyResult('#1', 95, true), 'merged', 'good 1');
    appendResult(tempDir, makeVerifyResult('#2', 90, true), 'merged', 'good 2');

    const s = getStatus(tempDir);
    expect(s.recurringIssues).toHaveLength(0);
  });
});

describe('getTrend', () => {
  it('returns empty result when no results exist', () => {
    const trend = getTrend(tempDir);
    expect(trend.entries).toHaveLength(0);
    expect(trend.direction).toBeNull();
    expect(trend.delta).toBeNull();
  });

  it('returns all results when fewer than last N exist', () => {
    appendResult(tempDir, makeVerifyResult('#1', 77, true), 'merged', 'first');
    appendResult(tempDir, makeVerifyResult('#2', 85, true), 'merged', 'second');

    const trend = getTrend(tempDir, 10);
    expect(trend.entries).toHaveLength(2);
  });

  it('limits to last N results', () => {
    for (let i = 1; i <= 8; i++) {
      appendResult(tempDir, makeVerifyResult(`#${i}`, 80 + i, true), 'merged', `pr ${i}`);
    }

    const trend = getTrend(tempDir, 5);
    expect(trend.entries).toHaveLength(5);
    expect(trend.entries[0].ref).toBe('#4');
    expect(trend.entries[4].ref).toBe('#8');
  });

  it('computes avg, best, worst correctly', () => {
    appendResult(tempDir, makeVerifyResult('#3', 77, true), 'merged', 'a');
    appendResult(tempDir, makeVerifyResult('#4', 77, true), 'merged', 'b');
    appendResult(tempDir, makeVerifyResult('#5', 82, true), 'merged', 'c');
    appendResult(tempDir, makeVerifyResult('#6', 85, true), 'merged', 'd');

    const trend = getTrend(tempDir);
    // avg = (77+77+82+85)/4 = 321/4 = 80.25 → 80
    expect(trend.avg).toBe(80);
    expect(trend.best.score).toBe(85);
    expect(trend.best.refs).toEqual(['#6']);
    expect(trend.worst.score).toBe(77);
    expect(trend.worst.refs).toEqual(['#3', '#4']);
  });

  it('detects improving direction', () => {
    appendResult(tempDir, makeVerifyResult('#1', 70, true), 'merged', 'old');
    appendResult(tempDir, makeVerifyResult('#2', 90, true), 'merged', 'new');

    const trend = getTrend(tempDir);
    expect(trend.direction).toBe('improving');
    expect(trend.delta).toBe(20);
  });

  it('detects declining direction', () => {
    appendResult(tempDir, makeVerifyResult('#1', 90, true), 'merged', 'old');
    appendResult(tempDir, makeVerifyResult('#2', 60, false), 'rejected', 'new');

    const trend = getTrend(tempDir);
    expect(trend.direction).toBe('declining');
    expect(trend.delta).toBe(-30);
  });

  it('detects stable direction', () => {
    appendResult(tempDir, makeVerifyResult('#1', 80, true), 'merged', 'first');
    appendResult(tempDir, makeVerifyResult('#2', 80, true), 'merged', 'second');

    const trend = getTrend(tempDir);
    expect(trend.direction).toBe('stable');
    expect(trend.delta).toBe(0);
  });

  it('returns null direction for single entry', () => {
    appendResult(tempDir, makeVerifyResult('#1', 80, true), 'merged', 'only');

    const trend = getTrend(tempDir);
    expect(trend.direction).toBeNull();
    expect(trend.delta).toBeNull();
  });

  it('preserves status from result rows', () => {
    appendResult(tempDir, makeVerifyResult('#1', 80, true), 'merged', 'good');
    appendResult(tempDir, makeVerifyResult('#2', 50, false), 'rejected', 'bad');
    appendResult(tempDir, makeVerifyResult('#3', 70, true), 'pending', 'pending');

    const trend = getTrend(tempDir);
    expect(trend.entries[0].status).toBe('merged');
    expect(trend.entries[1].status).toBe('rejected');
    expect(trend.entries[2].status).toBe('pending');
  });
});

describe('computeAutoBaseline', () => {
  it('returns 0 when no results exist', () => {
    expect(computeAutoBaseline(tempDir)).toBe(0);
  });

  it('computes average of last 5 merged scores', () => {
    for (let i = 1; i <= 5; i++) {
      appendResult(tempDir, makeVerifyResult(`#${i}`, 80 + i, true), 'merged', `pr ${i}`);
    }
    // (81+82+83+84+85) / 5 = 83
    expect(computeAutoBaseline(tempDir)).toBe(83);
  });

  it('ignores rejected results', () => {
    appendResult(tempDir, makeVerifyResult('#1', 90, true), 'merged', 'good');
    appendResult(tempDir, makeVerifyResult('#2', 20, false), 'rejected', 'bad');
    appendResult(tempDir, makeVerifyResult('#3', 80, true), 'merged', 'ok');
    // Only merged: (90+80)/2 = 85
    expect(computeAutoBaseline(tempDir)).toBe(85);
  });

  it('only uses last 5 merged scores', () => {
    for (let i = 1; i <= 8; i++) {
      appendResult(tempDir, makeVerifyResult(`#${i}`, 50 + i * 5, true), 'merged', `pr ${i}`);
    }
    // Last 5 merged: 70,75,80,85,90 -> avg = 80
    expect(computeAutoBaseline(tempDir)).toBe(80);
  });
});

describe('getBaseline', () => {
  const makeConfig = (baseline?: number): CanductorConfig => ({
    version: 1,
    layers: {},
    policy: { auto_merge: 'true', human_review: 'false', block: 'false' },
    ...(baseline !== undefined ? { baseline } : {}),
  });

  it('uses config override when present', () => {
    appendResult(tempDir, makeVerifyResult('#1', 90, true), 'merged', 'good');
    expect(getBaseline(tempDir, makeConfig(50))).toBe(50);
  });

  it('falls back to computed baseline when no config override', () => {
    appendResult(tempDir, makeVerifyResult('#1', 90, true), 'merged', 'good');
    expect(getBaseline(tempDir, makeConfig())).toBe(90);
  });

  it('falls back to computed baseline when config is null', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'good');
    expect(getBaseline(tempDir, null)).toBe(85);
  });

  it('returns 0 when no config and no results', () => {
    expect(getBaseline(tempDir, null)).toBe(0);
  });
});

describe('generatePromptContext', () => {
  it('generates markdown context block', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'good PR');
    appendResult(tempDir, makeVerifyResult('#2', 40, false), 'rejected', 'bad PR');

    const context = generatePromptContext(tempDir);
    expect(context).toContain('Canductor Quality Context');
    expect(context).toContain('baseline');
    expect(context).toContain('#1');
  });

  it('returns minimal context when no history', () => {
    const context = generatePromptContext(tempDir);
    expect(context).toContain('baseline quality score: 0');
  });

  it('includes stalled refs section when stalls detected', () => {
    // Create 3 results for the same ref with similar scores
    for (let i = 0; i < 3; i++) {
      appendResult(tempDir, makeVerifyResult('stuck-42', 85, true), 'pending', `Attempt ${i + 1}`);
    }

    const context = generatePromptContext(tempDir);
    expect(context).toContain('Stalled refs');
    expect(context).toContain('stuck-42');
  });
});

// ---------------------------------------------------------------------------
// detectStalls
// ---------------------------------------------------------------------------
describe('detectStalls', () => {
  function makeRow(overrides: Partial<ResultRow>): ResultRow {
    return {
      ref: '1',
      timestamp: new Date().toISOString(),
      composite_score: 90,
      decision: 'auto_merge',
      layer_scores: 'tests:100',
      status: 'pending',
      description: 'Test',
      ...overrides,
    };
  }

  it('detects stall when same ref appears 3+ times within ±2 score', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '42', composite_score: 85 }),
      makeRow({ ref: '42', composite_score: 86 }),
      makeRow({ ref: '42', composite_score: 85 }),
    ];

    const stalls = detectStalls(results);

    expect(stalls).toHaveLength(1);
    expect(stalls[0].ref).toBe('42');
    expect(stalls[0].attempts).toBe(3);
    expect(stalls[0].scoreRange.min).toBe(85);
    expect(stalls[0].scoreRange.max).toBe(86);
    expect(stalls[0].suggestion).toContain('fundamentally different approach');
  });

  it('does not flag refs with fewer than 3 attempts', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '42', composite_score: 85 }),
      makeRow({ ref: '42', composite_score: 85 }),
    ];

    const stalls = detectStalls(results);
    expect(stalls).toEqual([]);
  });

  it('does not flag refs with improving scores', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '42', composite_score: 80 }),
      makeRow({ ref: '42', composite_score: 85 }),
      makeRow({ ref: '42', composite_score: 90 }),
    ];

    const stalls = detectStalls(results);
    expect(stalls).toEqual([]);
  });

  it('returns empty array for no results', () => {
    const stalls = detectStalls([]);
    expect(stalls).toEqual([]);
  });

  it('detects multiple stalled refs', () => {
    const results: ResultRow[] = [
      makeRow({ ref: 'a', composite_score: 70 }),
      makeRow({ ref: 'a', composite_score: 71 }),
      makeRow({ ref: 'a', composite_score: 70 }),
      makeRow({ ref: 'b', composite_score: 90 }),
      makeRow({ ref: 'b', composite_score: 91 }),
      makeRow({ ref: 'b', composite_score: 90 }),
    ];

    const stalls = detectStalls(results);
    expect(stalls).toHaveLength(2);
  });

  it('returns no stalls when ref has fewer than 3 entries', () => {
    const results: ResultRow[] = [
      makeRow({ ref: 'x', composite_score: 70 }),
      makeRow({ ref: 'x', composite_score: 71 }),
    ];

    const stalls = detectStalls(results);
    expect(stalls).toHaveLength(0);
  });
});

describe('readResults edge cases', () => {
  it('skips rows with wrong field count (corrupted row)', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'results.tsv'), [
      'ref\ttimestamp\tcomposite_score\tdecision\tlayer_scores\tstatus\tdescription',
      '#1\t2026-01-01T00:00:00Z\t95\tauto_merge\ttests:100\tmerged\tgood',
      '#2\tCORRUPTED_ROW',
      '#3\t2026-01-02T00:00:00Z\t88\tauto_merge\ttests:88\tmerged\talso good',
    ].join('\n'));

    const rows = readResults(tempDir);
    expect(rows).toHaveLength(2);
    expect(rows[0].ref).toBe('#1');
    expect(rows[1].ref).toBe('#3');
  });

  it('handles empty lines between rows', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'results.tsv'), [
      'ref\ttimestamp\tcomposite_score\tdecision\tlayer_scores\tstatus\tdescription',
      '#1\t2026-01-01T00:00:00Z\t95\tauto_merge\ttests:100\tmerged\tgood',
      '',
      '',
      '#2\t2026-01-02T00:00:00Z\t88\tauto_merge\ttests:88\tmerged\talso good',
    ].join('\n'));

    const rows = readResults(tempDir);
    expect(rows).toHaveLength(2);
    expect(rows[0].ref).toBe('#1');
    expect(rows[1].ref).toBe('#2');
  });

  it('returns empty array for file with only header', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'results.tsv'),
      'ref\ttimestamp\tcomposite_score\tdecision\tlayer_scores\tstatus\tdescription\n');

    const rows = readResults(tempDir);
    expect(rows).toHaveLength(0);
  });

  it('treats first data row as data when no standard header present', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    // File has no header — the current implementation always skips the first line
    writeFileSync(join(dir, 'results.tsv'), [
      '#1\t2026-01-01T00:00:00Z\t95\tauto_merge\ttests:100\tmerged\tgood',
      '#2\t2026-01-02T00:00:00Z\t88\tauto_merge\ttests:88\tmerged\talso good',
    ].join('\n'));

    // First row is treated as header and skipped
    const rows = readResults(tempDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe('#2');
  });

  it('round-trips appendResult followed by readResults correctly', () => {
    const result = makeVerifyResult('#10', 92, true);
    appendResult(tempDir, result, 'merged', 'round trip test');

    const rows = readResults(tempDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe('#10');
    expect(rows[0].composite_score).toBe(92);
    expect(rows[0].decision).toBe('auto_merge');
    expect(rows[0].status).toBe('merged');
    expect(rows[0].description).toBe('round trip test');
  });
});

describe('updateResultStatus edge cases', () => {
  it('returns false for a ref that does not exist', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'exists');

    const updated = updateResultStatus(tempDir, 'nonexistent', 'rejected');
    expect(updated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// correlateLayerFailures
// ---------------------------------------------------------------------------
describe('correlateLayerFailures', () => {
  function makeRow(overrides: Partial<ResultRow>): ResultRow {
    return {
      ref: '1',
      timestamp: new Date().toISOString(),
      composite_score: 90,
      decision: 'auto_merge',
      layer_scores: 'tests:100',
      status: 'pending',
      description: 'Test',
      ...overrides,
    };
  }

  it('returns correlation of 1.0 for two layers that always fail together', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '1', layer_scores: 'tests:50,visual:60' }),
      makeRow({ ref: '2', layer_scores: 'tests:40,visual:70' }),
      makeRow({ ref: '3', layer_scores: 'tests:30,visual:50' }),
    ];

    const correlations = correlateLayerFailures(results);
    expect(correlations).toHaveLength(1);
    expect(correlations[0].layer1).toBe('tests');
    expect(correlations[0].layer2).toBe('visual');
    expect(correlations[0].coFailures).toBe(3);
    expect(correlations[0].ratio).toBe(1.0);
  });

  it('returns no correlation for layers that never co-fail', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '1', layer_scores: 'tests:50,visual:90' }),
      makeRow({ ref: '2', layer_scores: 'tests:90,visual:50' }),
      makeRow({ ref: '3', layer_scores: 'tests:40,visual:95' }),
    ];

    const correlations = correlateLayerFailures(results);
    expect(correlations).toEqual([]);
  });

  it('returns empty array when no failures exist', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '1', layer_scores: 'tests:90,visual:85' }),
      makeRow({ ref: '2', layer_scores: 'tests:95,visual:80' }),
    ];

    const correlations = correlateLayerFailures(results);
    expect(correlations).toEqual([]);
  });

  it('returns empty array for single-layer results', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '1', layer_scores: 'tests:50' }),
      makeRow({ ref: '2', layer_scores: 'tests:40' }),
      makeRow({ ref: '3', layer_scores: 'tests:30' }),
    ];

    const correlations = correlateLayerFailures(results);
    expect(correlations).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const correlations = correlateLayerFailures([]);
    expect(correlations).toEqual([]);
  });

  it('requires at least 2 co-failures to report a correlation', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '1', layer_scores: 'tests:50,visual:60' }),
      makeRow({ ref: '2', layer_scores: 'tests:90,visual:90' }),
    ];

    const correlations = correlateLayerFailures(results);
    expect(correlations).toEqual([]);
  });

  it('handles results with different layer configurations', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '1', layer_scores: 'tests:50,visual:60' }),
      makeRow({ ref: '2', layer_scores: 'tests:40,ux:70' }),
      makeRow({ ref: '3', layer_scores: 'tests:30,visual:50,ux:60' }),
    ];

    const correlations = correlateLayerFailures(results);
    // tests+visual co-fail in runs 1 and 3 (2 co-failures)
    expect(correlations.some(c =>
      c.layer1 === 'tests' && c.layer2 === 'visual' && c.coFailures === 2
    )).toBe(true);
    // tests+ux co-fail in runs 2 and 3 (2 co-failures)
    expect(correlations.some(c =>
      c.layer1 === 'tests' && c.layer2 === 'ux' && c.coFailures === 2
    )).toBe(true);
  });

  it('sorts correlations by ratio descending', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '1', layer_scores: 'a:50,b:50,c:50' }),
      makeRow({ ref: '2', layer_scores: 'a:50,b:50,c:50' }),
      makeRow({ ref: '3', layer_scores: 'a:50,b:90,c:50' }),
    ];

    const correlations = correlateLayerFailures(results);
    // a+c always co-fail (ratio 1.0), a+b co-fail 2/3 times
    expect(correlations.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < correlations.length; i++) {
      expect(correlations[i - 1].ratio).toBeGreaterThanOrEqual(correlations[i].ratio);
    }
  });

  it('handles empty layer_scores gracefully', () => {
    const results: ResultRow[] = [
      makeRow({ ref: '1', layer_scores: '' }),
      makeRow({ ref: '2', layer_scores: 'tests:50,visual:60' }),
      makeRow({ ref: '3', layer_scores: 'tests:40,visual:50' }),
    ];

    const correlations = correlateLayerFailures(results);
    expect(correlations).toHaveLength(1);
    expect(correlations[0].coFailures).toBe(2);
  });
});
