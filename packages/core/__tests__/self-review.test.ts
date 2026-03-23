import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgentReviewLayer, getAgentReviewPrompt } from '../src/layers.js';
import { computeCompositeScore } from '../src/verify.js';
import type { LayerConfig, CanductorConfig, AgentReviewResult, LayerResult } from '../src/types.js';

const TEST_DIR = join(tmpdir(), `canductor-self-review-test-${Date.now()}`);

describe('runAgentReviewLayer with selfReviewResult', () => {
  it('uses provided result instead of calling API', async () => {
    const layer: LayerConfig = {
      name: 'code_quality',
      type: 'agent-review',
      rubric: '/some/rubric.md',
      context: [],
      weight: 0.6,
    };

    const selfReviewResult: AgentReviewResult = {
      pass: true,
      score: 88,
      issues: [{ severity: 'low', description: 'Minor naming issue' }],
      summary: 'Good quality code',
    };

    const result = await runAgentReviewLayer(layer, selfReviewResult);

    expect(result.name).toBe('code_quality');
    expect(result.type).toBe('agent-review');
    expect(result.pass).toBe(true);
    expect(result.score).toBe(88);
    expect(result.errors).toContain('[low] Minor naming issue');
  });

  it('uses provided failing result correctly', async () => {
    const layer: LayerConfig = {
      name: 'code_quality',
      type: 'agent-review',
      rubric: '/some/rubric.md',
      context: [],
      weight: 0.6,
    };

    const selfReviewResult: AgentReviewResult = {
      pass: false,
      score: 45,
      issues: [
        { severity: 'critical', description: 'Uses any type' },
        { severity: 'high', description: 'Missing error handling' },
      ],
      summary: 'Needs improvement',
    };

    const result = await runAgentReviewLayer(layer, selfReviewResult);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(45);
    expect(result.errors).toContain('[critical] Uses any type');
    expect(result.errors).toContain('[high] Missing error handling');
  });

  it('uses summary as errors when no issues', async () => {
    const layer: LayerConfig = {
      name: 'code_quality',
      type: 'agent-review',
      rubric: '/some/rubric.md',
      context: [],
      weight: 0.6,
    };

    const selfReviewResult: AgentReviewResult = {
      pass: true,
      score: 95,
      issues: [],
      summary: 'Excellent code',
    };

    const result = await runAgentReviewLayer(layer, selfReviewResult);

    expect(result.errors).toBe('Excellent code');
  });
});

describe('getAgentReviewPrompt', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns prompt for layer with rubric', () => {
    const rubricPath = join(TEST_DIR, 'rubric.md');
    writeFileSync(rubricPath, '# Quality Check');

    const layer: LayerConfig = {
      name: 'code_quality',
      type: 'agent-review',
      rubric: rubricPath,
      context: [],
      weight: 0.6,
    };

    const prompt = getAgentReviewPrompt(layer);

    expect(prompt).not.toBeNull();
    expect(prompt!.rubricContent).toBe('# Quality Check');
  });

  it('returns null for layer without rubric', () => {
    const layer: LayerConfig = {
      name: 'code_quality',
      type: 'agent-review',
      weight: 0.6,
    };

    const prompt = getAgentReviewPrompt(layer);

    expect(prompt).toBeNull();
  });
});

describe('composite score with self-review results', () => {
  it('includes agent-review score from self-review in composite', () => {
    const config: CanductorConfig = {
      version: 1,
      layers: {
        tests: { name: 'tests', type: 'deterministic', run: 'echo ok', weight: 1.0 },
        code_quality: { name: 'code_quality', type: 'agent-review', rubric: 'r.md', weight: 0.6 },
      },
      policy: {
        auto_merge: 'all_pass',
        human_review: 'any_agent_review_fail',
        block: 'any_deterministic_fail',
      },
    };

    const results: LayerResult[] = [
      { name: 'tests', type: 'deterministic', pass: true, score: 100, errors: '', duration_ms: 50 },
      { name: 'code_quality', type: 'agent-review', pass: true, score: 85, errors: '', duration_ms: 10 },
    ];

    // (100*1.0 + 85*0.6) / (1.0 + 0.6) = (100 + 51) / 1.6 = 94.375 → 94
    const score = computeCompositeScore(results, config);
    expect(score).toBe(94);
  });
});
