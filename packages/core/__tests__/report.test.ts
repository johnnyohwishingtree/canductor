import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendResult } from '../src/results.js';
import { generateReport } from '../src/report.js';
import type { VerifyResult } from '../src/types.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-report-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeResult(ref: string, score: number): VerifyResult {
  return {
    ref,
    timestamp: '2026-03-21T00:00:00Z',
    layers: [
      { name: 'tests', type: 'deterministic', pass: true, score: 100, errors: '', duration_ms: 100 },
      { name: 'code_quality', type: 'agent-review', pass: true, score, errors: '', duration_ms: 200 },
    ],
    composite_score: score,
    decision: score >= 80 ? 'auto_merge' : 'block',
    summary: '',
    wall_clock_ms: 150,
  };
}

describe('generateReport', () => {
  it('returns empty report when no results exist', () => {
    const report = generateReport(tempDir);

    expect(report.score).toBe(0);
    expect(report.decision).toBe('none');
    expect(report.ref).toBe('');
    expect(report.markdown).toContain('No verification results found');
  });

  it('generates report with results', () => {
    appendResult(tempDir, makeResult('#10', 95), 'merged', 'Test PR');
    appendResult(tempDir, makeResult('#11', 88), 'merged', 'Another PR');

    const report = generateReport(tempDir);

    expect(report.score).toBe(88);
    expect(report.decision).toBe('auto_merge');
    expect(report.ref).toBe('#11');
    expect(report.markdown).toContain('## Quality Report');
    expect(report.markdown).toContain('**Score: 88/100**');
    expect(report.markdown).toContain('auto_merge');
  });

  it('includes layer breakdown table', () => {
    appendResult(tempDir, makeResult('#10', 92), 'merged', 'Test PR');

    const report = generateReport(tempDir);

    expect(report.markdown).toContain('### Layer Breakdown');
    expect(report.markdown).toContain('| Layer | Score |');
    expect(report.markdown).toContain('| tests |');
    expect(report.markdown).toContain('| code_quality |');
  });

  it('includes trend section', () => {
    appendResult(tempDir, makeResult('#1', 80), 'merged', 'PR 1');
    appendResult(tempDir, makeResult('#2', 85), 'merged', 'PR 2');
    appendResult(tempDir, makeResult('#3', 90), 'merged', 'PR 3');

    const report = generateReport(tempDir);

    expect(report.markdown).toContain('### Trend (last 5)');
    expect(report.markdown).toContain('avg:');
  });

  it('filters to specific ref', () => {
    appendResult(tempDir, makeResult('#10', 95), 'merged', 'First');
    appendResult(tempDir, makeResult('#11', 72), 'pending', 'Second');

    const report = generateReport(tempDir, '#10');

    expect(report.score).toBe(95);
    expect(report.ref).toBe('#10');
    expect(report.markdown).toContain('**Score: 95/100**');
  });

  it('returns not-found report for unknown ref', () => {
    appendResult(tempDir, makeResult('#10', 95), 'merged', 'First');

    const report = generateReport(tempDir, '#999');

    expect(report.score).toBe(0);
    expect(report.decision).toBe('none');
    expect(report.markdown).toContain('No results found for ref `#999`');
  });

  it('uses green badge for high scores', () => {
    appendResult(tempDir, makeResult('#10', 95), 'merged', 'High');

    const report = generateReport(tempDir);

    expect(report.markdown).toContain('🟢');
  });

  it('uses yellow badge for medium scores', () => {
    appendResult(tempDir, makeResult('#10', 75), 'pending', 'Medium');

    const report = generateReport(tempDir);

    expect(report.markdown).toContain('🟡');
  });

  it('uses red badge for low scores', () => {
    appendResult(tempDir, makeResult('#10', 50), 'rejected', 'Low');

    const report = generateReport(tempDir);

    expect(report.markdown).toContain('🔴');
  });

  it('includes timing section when verifyResult is provided', () => {
    const vr = makeResult('#10', 92);
    appendResult(tempDir, vr, 'merged', 'Test PR');

    const report = generateReport(tempDir, '#10', vr);

    expect(report.markdown).toContain('### Timing');
    expect(report.markdown).toContain('Wall clock: 150ms');
    expect(report.markdown).toContain('speedup vs sequential 300ms');
    expect(report.markdown).toContain('| tests | 100ms |');
    expect(report.markdown).toContain('| code_quality | 200ms |');
  });

  it('includes timing data in report data when verifyResult provided', () => {
    const vr = makeResult('#10', 92);
    appendResult(tempDir, vr, 'merged', 'Test PR');

    const report = generateReport(tempDir, '#10', vr);

    expect(report.timing).toBeDefined();
    expect(report.timing!.wall_clock_ms).toBe(150);
    expect(report.timing!.sequential_ms).toBe(300);
    expect(report.timing!.speedup).toBe(2);
    expect(report.timing!.layers).toHaveLength(2);
    expect(report.timing!.layers[0]).toEqual({ name: 'tests', duration_ms: 100 });
  });

  it('omits timing section when no verifyResult', () => {
    appendResult(tempDir, makeResult('#10', 92), 'merged', 'Test PR');

    const report = generateReport(tempDir, '#10');

    expect(report.markdown).not.toContain('### Timing');
    expect(report.timing).toBeUndefined();
  });

  it('JSON mode returns structured data', () => {
    appendResult(tempDir, makeResult('#10', 92), 'merged', 'PR');

    const report = generateReport(tempDir);

    expect(report).toHaveProperty('markdown');
    expect(report).toHaveProperty('score', 92);
    expect(report).toHaveProperty('decision', 'auto_merge');
    expect(report).toHaveProperty('ref', '#10');
    expect(typeof report.markdown).toBe('string');
  });
});
