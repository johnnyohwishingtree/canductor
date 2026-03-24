import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runDeterministicLayer,
  runScreenshotDiffLayer,
  runAgentReviewLayer,
  getAgentReviewPrompt,
  runLayer,
  defaultTimeoutMs,
  defaultRetry,
} from '../src/layers.js';
import type { LayerConfig, AgentReviewResult } from '../src/types.js';

const TEST_DIR = join(tmpdir(), `canductor-layers-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// runDeterministicLayer
// ---------------------------------------------------------------------------
describe('runDeterministicLayer', () => {
  it('returns pass when command exits 0', () => {
    const layer: LayerConfig = {
      name: 'echo-test',
      type: 'deterministic',
      run: 'echo ok',
      weight: 1,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.errors).toBe('');
    expect(result.type).toBe('deterministic');
    expect(result.name).toBe('echo-test');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns fail when command exits non-zero', () => {
    const layer: LayerConfig = {
      name: 'fail-test',
      type: 'deterministic',
      run: 'exit 1',
      weight: 1,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.type).toBe('deterministic');
  });

  it('captures stderr output on failure', () => {
    const layer: LayerConfig = {
      name: 'stderr-test',
      type: 'deterministic',
      run: 'echo "something broke" >&2 && exit 1',
      weight: 1,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.errors).toContain('something broke');
  });

  it('returns fail with error message when no run command specified', () => {
    const layer: LayerConfig = {
      name: 'no-cmd',
      type: 'deterministic',
      weight: 1,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.errors).toBe('No "run" command specified');
    expect(result.duration_ms).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runScreenshotDiffLayer
// ---------------------------------------------------------------------------
describe('runScreenshotDiffLayer', () => {
  it('returns pass with first-run message when no baseline exists', () => {
    const layer: LayerConfig = {
      name: 'visual',
      type: 'screenshot-diff',
      baseline: join(TEST_DIR, 'nonexistent-baseline'),
      weight: 1,
    };

    const result = runScreenshotDiffLayer(layer);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.errors).toContain('No baseline directory');
  });

  it('returns fail when current directory does not exist', () => {
    const baselineDir = join(TEST_DIR, 'baseline');
    mkdirSync(baselineDir, { recursive: true });
    writeFileSync(join(baselineDir, 'placeholder'), '');

    const layer: LayerConfig = {
      name: 'visual',
      type: 'screenshot-diff',
      baseline: baselineDir,
      capture: 'echo capture',
      weight: 1,
    };

    // capture runs but baseline-current dir won't exist
    const result = runScreenshotDiffLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.errors).toContain('Current screenshots directory not found');
  });

  it('returns fail when capture command fails', () => {
    const baselineDir = join(TEST_DIR, 'baseline');
    mkdirSync(baselineDir, { recursive: true });

    const layer: LayerConfig = {
      name: 'visual',
      type: 'screenshot-diff',
      baseline: baselineDir,
      capture: 'exit 1',
      weight: 1,
    };

    const result = runScreenshotDiffLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.errors).toContain('Screenshot capture failed');
  });

  it('returns pass when baseline and current match (no capture, self-compare)', () => {
    // When no capture command, currentDir = baseline (self-compare → 0% diff)
    const baselineDir = join(TEST_DIR, 'baseline-selfcmp');
    mkdirSync(baselineDir, { recursive: true });

    // Create a minimal 1x1 PNG
    const { PNG } = require('pngjs');
    const png = new PNG({ width: 1, height: 1 });
    png.data[0] = 255; // R
    png.data[1] = 0;   // G
    png.data[2] = 0;   // B
    png.data[3] = 255; // A
    const buffer = PNG.sync.write(png);
    writeFileSync(join(baselineDir, 'test.png'), buffer);

    const layer: LayerConfig = {
      name: 'visual',
      type: 'screenshot-diff',
      baseline: baselineDir,
      weight: 1,
    };

    const result = runScreenshotDiffLayer(layer);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// runAgentReviewLayer
// ---------------------------------------------------------------------------
describe('runAgentReviewLayer', () => {
  it('returns pass with skip message when no rubric specified', async () => {
    const layer: LayerConfig = {
      name: 'review',
      type: 'agent-review',
      weight: 0.5,
    };

    const result = await runAgentReviewLayer(layer);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.errors).toContain('No rubric file specified');
  });

  it('uses selfReviewResult when provided', async () => {
    const layer: LayerConfig = {
      name: 'code_quality',
      type: 'agent-review',
      rubric: '/some/rubric.md',
      weight: 0.6,
    };

    const selfReview: AgentReviewResult = {
      pass: true,
      score: 92,
      issues: [],
      summary: 'Clean code',
    };

    const result = await runAgentReviewLayer(layer, selfReview);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(92);
    expect(result.errors).toBe('Clean code');
  });

  it('formats multiple issues in errors string', async () => {
    const layer: LayerConfig = {
      name: 'code_quality',
      type: 'agent-review',
      rubric: '/some/rubric.md',
      weight: 0.6,
    };

    const selfReview: AgentReviewResult = {
      pass: false,
      score: 30,
      issues: [
        { severity: 'critical', description: 'SQL injection' },
        { severity: 'medium', description: 'Missing validation' },
      ],
      summary: 'Security issues',
    };

    const result = await runAgentReviewLayer(layer, selfReview);

    expect(result.pass).toBe(false);
    expect(result.errors).toContain('[critical] SQL injection');
    expect(result.errors).toContain('[medium] Missing validation');
  });

  it('calls runAgentReview when no selfReviewResult and rubric present', async () => {
    // Mock the agent-review module to avoid real API calls
    const agentReview = await import('../src/agent-review.js');
    const spy = vi.spyOn(agentReview, 'runAgentReview').mockResolvedValue({
      pass: true,
      score: 85,
      issues: [],
      summary: 'Mocked review',
    });

    // We need to re-import layers to pick up the mock — but since
    // the module is already loaded, the spy on the named export works
    // because layers.ts calls runAgentReview from the imported binding.
    // Actually, since layers imports { runAgentReview } at the top level,
    // the spy on the module export won't affect it. Instead, let's test
    // the no-API-key path which returns a skip result.

    spy.mockRestore();

    // Without ANTHROPIC_API_KEY, runAgentReview returns a skip result
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const rubricPath = join(TEST_DIR, 'rubric.md');
    writeFileSync(rubricPath, '# Test Rubric\n- Check stuff');

    const layer: LayerConfig = {
      name: 'code_quality',
      type: 'agent-review',
      rubric: rubricPath,
      context: [],
      weight: 0.6,
    };

    const result = await runAgentReviewLayer(layer);

    expect(result.name).toBe('code_quality');
    expect(result.type).toBe('agent-review');
    // Without API key, the underlying runAgentReview skips
    expect(result.errors).toContain('Skipped');

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });
});

// ---------------------------------------------------------------------------
// getAgentReviewPrompt
// ---------------------------------------------------------------------------
describe('getAgentReviewPrompt', () => {
  it('returns structured prompt when rubric exists', () => {
    const rubricPath = join(TEST_DIR, 'rubric.md');
    writeFileSync(rubricPath, '# Review Criteria\n- No any types');

    const layer: LayerConfig = {
      name: 'review',
      type: 'agent-review',
      rubric: rubricPath,
      context: [],
      weight: 0.5,
    };

    const prompt = getAgentReviewPrompt(layer);

    expect(prompt).not.toBeNull();
    expect(prompt!.rubricContent).toContain('Review Criteria');
    expect(prompt!.systemPrompt).toContain('code quality reviewer');
    expect(prompt!.contextFileCount).toBe(0);
  });

  it('includes context files in prompt', () => {
    const rubricPath = join(TEST_DIR, 'rubric.md');
    writeFileSync(rubricPath, '# Rubric');

    const ctxFile = join(TEST_DIR, 'sample.ts');
    writeFileSync(ctxFile, 'export const x = 1;');

    const layer: LayerConfig = {
      name: 'review',
      type: 'agent-review',
      rubric: rubricPath,
      context: [ctxFile],
      weight: 0.5,
    };

    const prompt = getAgentReviewPrompt(layer);

    expect(prompt).not.toBeNull();
    expect(prompt!.contextFileCount).toBe(1);
    expect(prompt!.userPrompt).toContain('sample.ts');
  });

  it('returns null when no rubric specified', () => {
    const layer: LayerConfig = {
      name: 'review',
      type: 'agent-review',
      weight: 0.5,
    };

    expect(getAgentReviewPrompt(layer)).toBeNull();
  });

  it('returns null when rubric file does not exist', () => {
    const layer: LayerConfig = {
      name: 'review',
      type: 'agent-review',
      rubric: join(TEST_DIR, 'nonexistent.md'),
      weight: 0.5,
    };

    expect(getAgentReviewPrompt(layer)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runLayer (dispatch)
// ---------------------------------------------------------------------------
describe('runLayer', () => {
  it('dispatches deterministic layer correctly', async () => {
    const layer: LayerConfig = {
      name: 'tests',
      type: 'deterministic',
      run: 'echo pass',
      weight: 1,
    };

    const result = await runLayer(layer);

    expect(result.type).toBe('deterministic');
    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('dispatches screenshot-diff layer correctly', async () => {
    const layer: LayerConfig = {
      name: 'visual',
      type: 'screenshot-diff',
      baseline: join(TEST_DIR, 'no-baseline'),
      weight: 1,
    };

    const result = await runLayer(layer);

    expect(result.type).toBe('screenshot-diff');
    expect(result.pass).toBe(true);
  });

  it('dispatches agent-review layer correctly', async () => {
    const layer: LayerConfig = {
      name: 'review',
      type: 'agent-review',
      weight: 0.5,
    };

    const result = await runLayer(layer);

    expect(result.type).toBe('agent-review');
    expect(result.pass).toBe(true);
  });

  it('passes selfReviewResult to agent-review layer', async () => {
    const layer: LayerConfig = {
      name: 'review',
      type: 'agent-review',
      rubric: '/some/rubric.md',
      weight: 0.5,
    };

    const selfReview: AgentReviewResult = {
      pass: true,
      score: 90,
      issues: [],
      summary: 'Great',
    };

    const result = await runLayer(layer, selfReview);

    expect(result.score).toBe(90);
    expect(result.errors).toBe('Great');
  });

  it('returns error for unknown layer type', async () => {
    const layer = {
      name: 'mystery',
      type: 'unknown-type' as LayerConfig['type'],
      weight: 1,
    };

    const result = await runLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.errors).toContain('Unknown layer type');
  });
});

// ---------------------------------------------------------------------------
// defaultTimeoutMs
// ---------------------------------------------------------------------------
describe('defaultTimeoutMs', () => {
  it('returns 300000 for deterministic layers', () => {
    expect(defaultTimeoutMs('deterministic')).toBe(300_000);
  });

  it('returns 300000 for screenshot-diff layers', () => {
    expect(defaultTimeoutMs('screenshot-diff')).toBe(300_000);
  });

  it('returns 120000 for guardrail layers', () => {
    expect(defaultTimeoutMs('guardrail')).toBe(120_000);
  });

  it('returns undefined for agent-review layers', () => {
    expect(defaultTimeoutMs('agent-review')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runDeterministicLayer — timeout
// ---------------------------------------------------------------------------
describe('runDeterministicLayer timeout', () => {
  it('returns timeout error when command exceeds timeout_ms', () => {
    const layer: LayerConfig = {
      name: 'slow-test',
      type: 'deterministic',
      run: 'sleep 10',
      weight: 1,
      timeout_ms: 100,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.errors).toContain('timed out');
    expect(result.errors).toContain('100');
    expect(result.timed_out).toBe(true);
  });

  it('passes normally when command finishes within timeout', () => {
    const layer: LayerConfig = {
      name: 'fast-test',
      type: 'deterministic',
      run: 'echo hi',
      weight: 1,
      timeout_ms: 10000,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('uses default timeout when timeout_ms is not set', () => {
    const layer: LayerConfig = {
      name: 'default-timeout-test',
      type: 'deterministic',
      run: 'echo ok',
      weight: 1,
    };

    // Should pass — default is 5 min, echo is instant
    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// runScreenshotDiffLayer — timeout
// ---------------------------------------------------------------------------
describe('runScreenshotDiffLayer timeout', () => {
  it('returns timeout error when capture command exceeds timeout_ms', () => {
    const baselineDir = join(TEST_DIR, 'baseline');
    mkdirSync(baselineDir, { recursive: true });

    const layer: LayerConfig = {
      name: 'visual-slow',
      type: 'screenshot-diff',
      baseline: baselineDir,
      capture: 'sleep 10',
      weight: 1,
      timeout_ms: 100,
    };

    const result = runScreenshotDiffLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.errors).toContain('timed out');
    expect(result.errors).toContain('100');
    expect(result.timed_out).toBe(true);
  });

  it('passes when capture command finishes within timeout', () => {
    const layer: LayerConfig = {
      name: 'visual-fast',
      type: 'screenshot-diff',
      baseline: join(TEST_DIR, 'nonexistent'),
      capture: 'echo done',
      weight: 1,
      timeout_ms: 10000,
    };

    const result = runScreenshotDiffLayer(layer);

    // No baseline → first-run pass
    expect(result.pass).toBe(true);
    expect(result.timed_out).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// defaultRetry
// ---------------------------------------------------------------------------
describe('defaultRetry', () => {
  it('returns 0 for all layer types', () => {
    expect(defaultRetry('deterministic')).toBe(0);
    expect(defaultRetry('screenshot-diff')).toBe(0);
    expect(defaultRetry('guardrail')).toBe(0);
    expect(defaultRetry('agent-review')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runDeterministicLayer — retry
// ---------------------------------------------------------------------------
describe('runDeterministicLayer retry', () => {
  it('retries on failure and returns retries_attempted count', () => {
    const layer: LayerConfig = {
      name: 'always-fail',
      type: 'deterministic',
      run: 'exit 1',
      weight: 1,
      retry: 2,
      retry_delay_ms: 10,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.retries_attempted).toBe(2);
  });

  it('succeeds on retry using flag file pattern', () => {
    const flagFile = join(TEST_DIR, `retry-flag-${Date.now()}`);
    const layer: LayerConfig = {
      name: 'retry-success',
      type: 'deterministic',
      run: `test -f ${flagFile} && echo ok || (touch ${flagFile} && exit 1)`,
      weight: 1,
      retry: 2,
      retry_delay_ms: 10,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.retries_attempted).toBe(1);
  });

  it('does not retry when retry is 0', () => {
    const layer: LayerConfig = {
      name: 'no-retry',
      type: 'deterministic',
      run: 'exit 1',
      weight: 1,
      retry: 0,
      retry_delay_ms: 10,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.retries_attempted).toBe(0);
  });

  it('does not retry when retry is not set', () => {
    const layer: LayerConfig = {
      name: 'default-no-retry',
      type: 'deterministic',
      run: 'exit 1',
      weight: 1,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.retries_attempted).toBe(0);
  });

  it('sets retries_attempted to 0 on first-attempt success', () => {
    const layer: LayerConfig = {
      name: 'instant-pass',
      type: 'deterministic',
      run: 'echo ok',
      weight: 1,
      retry: 3,
      retry_delay_ms: 10,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(true);
    expect(result.retries_attempted).toBe(0);
  });

  it('retries on timeout (ETIMEDOUT is transient)', () => {
    const layer: LayerConfig = {
      name: 'timeout-retry',
      type: 'deterministic',
      run: 'sleep 10',
      weight: 1,
      timeout_ms: 100,
      retry: 1,
      retry_delay_ms: 10,
    };

    const result = runDeterministicLayer(layer);

    expect(result.pass).toBe(false);
    expect(result.timed_out).toBe(true);
    expect(result.retries_attempted).toBe(1);
  });
});
