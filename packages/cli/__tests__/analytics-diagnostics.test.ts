import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cmdInsights, cmdTasks, cmdReport, cmdHealth } from '../src/commands/analytics-diagnostics.js';
import { appendResult } from '@canductor/core';
import type { VerifyResult } from '@canductor/core';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

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
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-analytics-diag-'));
  mkdirSync(join(tempDir, '.canductor'), { recursive: true });
  writeFileSync(join(tempDir, '.canductor', 'config.yaml'), MINIMAL_CONFIG);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
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

function seedTasksTsv(): void {
  const header = 'task_type\tguided_by\tref\tverify_cycle\tfailure\ttimestamp';
  const rows = [
    'module\t.canductor/templates/module.md\t#100\t1\tnone\t2026-03-20T00:00:00Z',
    'module\t.canductor/templates/module.md\t#101\t1\tnone\t2026-03-21T00:00:00Z',
    'module\t.canductor/templates/module.md\t#102\t1\tnone\t2026-03-21T02:00:00Z',
    'test\t.canductor/templates/test.md\t#103\t2\ttype error\t2026-03-21T00:00:00Z',
    'test\t.canductor/templates/test.md\t#103\t2\tnone\t2026-03-21T01:00:00Z',
  ];
  writeFileSync(join(tempDir, '.canductor', 'tasks.tsv'), [header, ...rows].join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// cmdInsights
// ---------------------------------------------------------------------------
describe('cmdInsights', () => {
  it('outputs trajectory and recommendations', () => {
    seedResults(5);

    cmdInsights(['insights'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Canductor Insights');
    expect(output).toContain('Overall:');
    expect(output).toContain('Recommendations:');
  });

  it('outputs JSON when --json flag is passed', () => {
    seedResults(5);

    cmdInsights(['insights', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('trajectory');
    expect(parsed).toHaveProperty('correlations');
    expect(parsed).toHaveProperty('recommendations');
  });

  it('handles empty results gracefully', () => {
    cmdInsights(['insights'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Canductor Insights');
    expect(output).toContain('Recommendations:');
  });
});

// ---------------------------------------------------------------------------
// cmdTasks
// ---------------------------------------------------------------------------
describe('cmdTasks', () => {
  it('outputs task type summary table', () => {
    seedTasksTsv();

    cmdTasks(['tasks'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Task Type Performance');
    expect(output).toContain('module');
    expect(output).toContain('test');
  });

  it('handles empty tasks.tsv', () => {
    cmdTasks(['tasks'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No task data yet');
  });

  it('shows converged status for task types with consistent results', () => {
    seedTasksTsv();

    cmdTasks(['tasks'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('converged');
  });
});

// ---------------------------------------------------------------------------
// cmdReport
// ---------------------------------------------------------------------------
describe('cmdReport', () => {
  it('outputs markdown report', () => {
    seedResults(3);

    cmdReport(['report'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('#');
  });

  it('outputs JSON when --json flag is passed', () => {
    seedResults(3);

    cmdReport(['report', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('markdown');
  });

  it('handles empty results', () => {
    cmdReport(['report'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(typeof output).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// cmdHealth
// ---------------------------------------------------------------------------
describe('cmdHealth', () => {
  it('outputs health overview', () => {
    seedResults(3);

    cmdHealth(['health'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Results');
    expect(output).toContain('Config');
    expect(output).toContain('Branches');
    expect(output).toContain('Findings');
  });

  it('shows resolved findings count when findings exist', () => {
    seedResults(2);
    const findingsHeader = 'category\ttemplate\tfinding\tref\ttimestamp\tresolved';
    const findingsRows = [
      'drift\t-\tUnused export in foo.ts\t#100\t2026-03-20T00:00:00Z\tfalse',
      'drift\t-\tOld export in bar.ts\t#101\t2026-03-20T00:00:00Z\ttrue',
    ];
    writeFileSync(
      join(tempDir, '.canductor', 'findings.tsv'),
      [findingsHeader, ...findingsRows].join('\n') + '\n'
    );

    cmdHealth(['health'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('1 active');
    expect(output).toContain('1 resolved');
  });

  it('outputs JSON when --json flag is passed', () => {
    seedResults(2);

    cmdHealth(['health', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('status');
    expect(parsed).toHaveProperty('findings');
    expect(parsed).toHaveProperty('configValidation');
    expect(parsed).toHaveProperty('resolvedFindings');
  });

  it('shows healthy message when no issues', () => {
    cmdHealth(['health'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Pipeline healthy');
  });
});
