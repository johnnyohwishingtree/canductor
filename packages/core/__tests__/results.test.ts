import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendResult, readResults, analyzeResults, generatePromptContext, diffResults, getStatus } from '../src/results.js';
import type { VerifyResult } from '../src/types.js';

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
});
