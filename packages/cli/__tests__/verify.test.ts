import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cmdVerify, cmdScore, cmdLayerTest } from '../src/commands/verify.js';
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

function makeAgentReviewConfig(rubricPath: string, contextPath: string): string {
  return `version: 1

layers:
  echo_test:
    name: echo_test
    type: deterministic
    run: "echo ok"
    weight: 1.0
  code_quality:
    name: code_quality
    type: agent-review
    model: claude-sonnet-4-6
    rubric: "${rubricPath}"
    context:
      - "${contextPath}"
    weight: 0.6

policy:
  auto_merge: "all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-verify-test-'));
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

// ---------------------------------------------------------------------------
// cmdVerify
// ---------------------------------------------------------------------------
describe('cmdVerify', () => {
  it('runs verification and outputs decision', async () => {
    await cmdVerify(['verify'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Decision:');
    expect(output).toContain('Result logged to .canductor/results.tsv');
  });

  it('outputs JSON when --json flag is passed', async () => {
    await cmdVerify(['verify', '--json'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('score');
    expect(parsed).toHaveProperty('decision');
    expect(parsed).toHaveProperty('layers');
    expect(typeof parsed.score).toBe('number');
  });

  it('outputs self-review prompt when --self-review is passed', async () => {
    const rubricPath = join(tempDir, 'rubric.md');
    writeFileSync(rubricPath, '# Test Rubric\n\nEvaluate code quality.');
    writeFileSync(join(tempDir, '.canductor', 'config.yaml'), makeAgentReviewConfig(rubricPath, tempDir));

    await cmdVerify(['verify', '--self-review'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('CANDUCTOR SELF-REVIEW');
    expect(output).toContain('END SELF-REVIEW');
  });

  it('reports no agent-review layers for --self-review with deterministic-only config', async () => {
    await cmdVerify(['verify', '--self-review'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No agent-review layers found');
  });

  it('uses custom ref when provided', async () => {
    await cmdVerify(['verify', '42'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Decision:');
  });

  it('exits 1 when --review-json is missing its argument', async () => {
    await expect(cmdVerify(['verify', '--review-json'], tempDir)).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('--review-json requires a JSON argument');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// cmdScore
// ---------------------------------------------------------------------------
describe('cmdScore', () => {
  it('outputs composite score as a number', async () => {
    await cmdScore(['score'], tempDir);

    const output = logSpy.mock.calls[0][0];
    expect(typeof output).toBe('number');
    expect(output).toBeGreaterThanOrEqual(0);
    expect(output).toBeLessThanOrEqual(100);
  });

  it('accepts a custom ref argument', async () => {
    await cmdScore(['score', '42'], tempDir);

    const output = logSpy.mock.calls[0][0];
    expect(typeof output).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// cmdLayerTest
// ---------------------------------------------------------------------------
describe('cmdLayerTest', () => {
  it('runs a single layer and shows result', async () => {
    await cmdLayerTest(['layer-test', 'echo_test'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('PASS');
    expect(output).toContain('echo_test');
    expect(output).toContain('Score:');
  });

  it('outputs JSON when --json flag is passed', async () => {
    await cmdLayerTest(['layer-test', 'echo_test', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('name', 'echo_test');
    expect(parsed).toHaveProperty('pass', true);
    expect(parsed).toHaveProperty('score');
  });

  it('exits 1 when no layer name is provided', async () => {
    await expect(cmdLayerTest(['layer-test'], tempDir)).rejects.toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Usage: canductor layer-test <layer-name>');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when layer name is not found', async () => {
    await expect(cmdLayerTest(['layer-test', 'nonexistent'], tempDir)).rejects.toThrow('process.exit called');

    expect(errorSpy.mock.calls[0][0]).toContain('Layer not found: nonexistent');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
