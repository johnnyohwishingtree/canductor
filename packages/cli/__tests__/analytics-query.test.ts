import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cmdStatus, cmdTrend, cmdDiff, cmdBaseline, cmdHistory } from '../src/commands/analytics-query.js';
import { appendResult } from '@canductor/core';
import type { VerifyResult } from '@canductor/core';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

const MINIMAL_CONFIG = `version: 1

layers:
  echo_test:
    name: echo_test
    type: deterministic
    run: "echo ok"
    weight: 1.0

policy:
  auto_merge: "all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-analytics-test-'));
  mkdirSync(join(tempDir, '.canductor'), { recursive: true });
  writeFileSync(join(tempDir, '.canductor', 'config.yaml'), MINIMAL_CONFIG);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
});

function makeVerifyResult(ref: string, score: number, pass: boolean): VerifyResult {
  return {
    ref,
    timestamp: '2026-03-21T00:00:00Z',
    layers: [
      { name: 'echo_test', type: 'deterministic', pass, score: pass ? 100 : 0, errors: '', duration_ms: 100 },
    ],
    composite_score: score,
    decision: pass ? 'auto_merge' : 'block',
    summary: `Test result for ${ref}`,
  };
}

function seedResults(count: number): void {
  for (let i = 1; i <= count; i++) {
    const result = makeVerifyResult(`ref-${i}`, 90 + (i % 10), true);
    appendResult(tempDir, result, 'merged', `Verified ref-${i}`);
  }
}

// ---------------------------------------------------------------------------
// cmdStatus
// ---------------------------------------------------------------------------
describe('cmdStatus', () => {
  it('outputs status overview with results', () => {
    seedResults(3);

    cmdStatus(['status'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Canductor Status');
    expect(output).toContain('Results:');
    expect(output).toContain('3 total');
    expect(output).toContain('Baseline:');
  });

  it('handles no results with friendly message', () => {
    cmdStatus(['status'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No results yet');
  });

  it('outputs JSON when --json flag is passed', () => {
    seedResults(2);

    cmdStatus(['status', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('total', 2);
    expect(parsed).toHaveProperty('merged');
    expect(parsed).toHaveProperty('baseline');
  });

  it('outputs JSON even with no results', () => {
    cmdStatus(['status', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('total', 0);
  });
});

// ---------------------------------------------------------------------------
// cmdTrend
// ---------------------------------------------------------------------------
describe('cmdTrend', () => {
  it('outputs trend data with results', () => {
    seedResults(5);

    cmdTrend(['trend'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Canductor Trend');
    expect(output).toContain('Avg:');
  });

  it('handles --last flag to limit results', () => {
    seedResults(10);

    cmdTrend(['trend', '--last', '3'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('last 3 results');
  });

  it('handles empty results', () => {
    cmdTrend(['trend'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No results yet');
  });

  it('outputs JSON when --json flag is passed', () => {
    seedResults(3);

    cmdTrend(['trend', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('entries');
    expect(parsed).toHaveProperty('avg');
    expect(parsed.entries).toHaveLength(3);
  });

  it('outputs JSON even with empty results', () => {
    cmdTrend(['trend', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('entries');
    expect(parsed.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// cmdDiff
// ---------------------------------------------------------------------------
describe('cmdDiff', () => {
  it('outputs score comparison between two refs', () => {
    seedResults(3);

    cmdDiff(['diff', 'ref-1', 'ref-2'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Diff:');
    expect(output).toContain('ref-1');
    expect(output).toContain('ref-2');
    expect(output).toContain('Composite score:');
  });

  it('exits 1 when refs are missing', () => {
    expect(() => cmdDiff(['diff'], tempDir)).toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Usage: canductor diff <ref1> <ref2>');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 for unknown refs', () => {
    seedResults(2);

    expect(() => cmdDiff(['diff', 'unknown-1', 'unknown-2'], tempDir)).toThrow('process.exit called');

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join('\n');
    expect(errorOutput).toContain('Ref not found');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('outputs JSON when --json flag is passed', () => {
    seedResults(3);

    cmdDiff(['diff', 'ref-1', 'ref-2', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('ref1', 'ref-1');
    expect(parsed).toHaveProperty('ref2', 'ref-2');
    expect(parsed).toHaveProperty('delta');
  });
});

// ---------------------------------------------------------------------------
// cmdBaseline
// ---------------------------------------------------------------------------
describe('cmdBaseline', () => {
  it('shows current baseline', () => {
    seedResults(5);

    cmdBaseline(['baseline'], tempDir);

    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('Current baseline:');
    expect(output).toContain('/100');
  });

  it('computes baseline with --auto flag', () => {
    seedResults(5);

    cmdBaseline(['baseline', '--auto'], tempDir);

    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('Baseline set to');
    expect(output).toContain('computed from last 5 merged scores');
  });

  it('outputs JSON when --json flag is passed', () => {
    seedResults(5);

    cmdBaseline(['baseline', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('baseline');
    expect(typeof parsed.baseline).toBe('number');
  });

  it('exits 1 when --set has invalid value', () => {
    expect(() => cmdBaseline(['baseline', '--set', 'abc'], tempDir)).toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Usage: canductor baseline --set <number>');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when --set value is out of range', () => {
    expect(() => cmdBaseline(['baseline', '--set', '150'], tempDir)).toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Baseline must be between 0 and 100');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('sets baseline with --set flag', () => {
    cmdBaseline(['baseline', '--set', '85'], tempDir);

    const output = logSpy.mock.calls[0][0];
    expect(output).toContain('Baseline set to 85/100');
  });
});

// ---------------------------------------------------------------------------
// cmdHistory
// ---------------------------------------------------------------------------
describe('cmdHistory', () => {
  it('outputs results table', () => {
    seedResults(3);

    cmdHistory(['history'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('ref');
    expect(output).toContain('score');
    expect(output).toContain('ref-1');
    expect(output).toContain('ref-2');
    expect(output).toContain('ref-3');
  });

  it('handles no results', () => {
    cmdHistory(['history'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No results yet');
  });

  it('outputs JSON when --json flag is passed', () => {
    seedResults(3);

    cmdHistory(['history', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toHaveProperty('ref', 'ref-1');
    expect(parsed[0]).toHaveProperty('composite_score');
  });

  it('outputs empty JSON array when no results', () => {
    cmdHistory(['history', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([]);
  });
});
