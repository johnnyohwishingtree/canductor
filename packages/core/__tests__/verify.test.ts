import { describe, it, expect } from 'vitest';
import { computeCompositeScore, evaluatePolicy, verify } from '../src/verify.js';
import type { CanductorConfig, LayerResult, AgentReviewResult } from '../src/types.js';

const baseConfig: CanductorConfig = {
  version: 1,
  layers: {
    tests: { name: 'tests', type: 'deterministic', run: 'pnpm test', weight: 1.0 },
    visual: { name: 'visual', type: 'screenshot-diff', weight: 0.8 },
    ux: { name: 'ux', type: 'agent-review', weight: 0.6 },
  },
  policy: {
    auto_merge: 'all_pass',
    human_review: 'any_agent_review_fail',
    block: 'any_deterministic_fail',
  },
};

function makeResult(name: string, type: LayerResult['type'], pass: boolean, score: number): LayerResult {
  return { name, type, pass, score, errors: '', duration_ms: 100 };
}

describe('computeCompositeScore', () => {
  it('computes weighted average', () => {
    const results: LayerResult[] = [
      makeResult('tests', 'deterministic', true, 100),
      makeResult('visual', 'screenshot-diff', true, 80),
      makeResult('ux', 'agent-review', true, 60),
    ];
    // (100*1.0 + 80*0.8 + 60*0.6) / (1.0 + 0.8 + 0.6) = (100 + 64 + 36) / 2.4 = 83.33
    expect(computeCompositeScore(results, baseConfig)).toBe(83);
  });

  it('returns 0 when no layers match config', () => {
    const results: LayerResult[] = [
      makeResult('unknown', 'deterministic', true, 100),
    ];
    expect(computeCompositeScore(results, baseConfig)).toBe(0);
  });
});

describe('evaluatePolicy', () => {
  it('blocks when any deterministic layer fails', () => {
    const results: LayerResult[] = [
      makeResult('tests', 'deterministic', false, 0),
      makeResult('visual', 'screenshot-diff', true, 100),
    ];
    expect(evaluatePolicy(results, 50, baseConfig)).toBe('block');
  });

  it('auto-merges when all layers pass', () => {
    const results: LayerResult[] = [
      makeResult('tests', 'deterministic', true, 100),
      makeResult('visual', 'screenshot-diff', true, 95),
      makeResult('ux', 'agent-review', true, 85),
    ];
    expect(evaluatePolicy(results, 93, baseConfig)).toBe('auto_merge');
  });

  it('requests human review when agent-review fails but deterministic passes', () => {
    const results: LayerResult[] = [
      makeResult('tests', 'deterministic', true, 100),
      makeResult('ux', 'agent-review', false, 45),
    ];
    expect(evaluatePolicy(results, 70, baseConfig)).toBe('human_review');
  });
});

// ---------------------------------------------------------------------------
// verify() integration tests
// ---------------------------------------------------------------------------
describe('verify() integration', () => {
  it('runs deterministic layers and produces auto_merge decision', async () => {
    const config: CanductorConfig = {
      version: 1,
      layers: {
        echo_pass: {
          name: 'echo_pass',
          type: 'deterministic',
          run: 'echo ok',
          weight: 1.0,
        },
      },
      policy: {
        auto_merge: 'all_pass',
        human_review: 'any_agent_review_fail',
        block: 'any_deterministic_fail',
      },
    };

    const result = await verify('test-ref', config);

    expect(result.ref).toBe('test-ref');
    expect(result.composite_score).toBe(100);
    expect(result.decision).toBe('auto_merge');
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].pass).toBe(true);
    expect(result.layers[0].score).toBe(100);
    expect(result.timestamp).toBeTruthy();
    expect(result.summary).toContain('PASS');
  });

  it('returns block decision when deterministic layer fails', async () => {
    const config: CanductorConfig = {
      version: 1,
      layers: {
        failing_test: {
          name: 'failing_test',
          type: 'deterministic',
          run: 'exit 1',
          weight: 1.0,
        },
      },
      policy: {
        auto_merge: 'all_pass',
        human_review: 'any_agent_review_fail',
        block: 'any_deterministic_fail',
      },
    };

    const result = await verify('fail-ref', config);

    expect(result.composite_score).toBe(0);
    expect(result.decision).toBe('block');
    expect(result.layers[0].pass).toBe(false);
    expect(result.summary).toContain('FAIL');
  });

  it('computes correct weighted average with multiple layers', async () => {
    const config: CanductorConfig = {
      version: 1,
      layers: {
        pass_layer: {
          name: 'pass_layer',
          type: 'deterministic',
          run: 'echo ok',
          weight: 1.0,
        },
        another_pass: {
          name: 'another_pass',
          type: 'deterministic',
          run: 'echo fine',
          weight: 0.5,
        },
      },
      policy: {
        auto_merge: 'all_pass',
        human_review: 'any_agent_review_fail',
        block: 'any_deterministic_fail',
      },
    };

    const result = await verify('multi-ref', config);

    // Both pass with 100, so weighted average = (100*1.0 + 100*0.5) / (1.0+0.5) = 100
    expect(result.composite_score).toBe(100);
    expect(result.decision).toBe('auto_merge');
    expect(result.layers).toHaveLength(2);
  });

  it('incorporates selfReviewResults into agent-review layers', async () => {
    const config: CanductorConfig = {
      version: 1,
      layers: {
        tests: {
          name: 'tests',
          type: 'deterministic',
          run: 'echo ok',
          weight: 1.0,
        },
        code_quality: {
          name: 'code_quality',
          type: 'agent-review',
          rubric: '/some/rubric.md',
          weight: 0.6,
        },
      },
      policy: {
        auto_merge: 'all_pass',
        human_review: 'any_agent_review_fail',
        block: 'any_deterministic_fail',
      },
    };

    const selfReviewResults: Record<string, AgentReviewResult> = {
      code_quality: {
        pass: true,
        score: 85,
        issues: [],
        summary: 'Solid code',
      },
    };

    const result = await verify('review-ref', config, selfReviewResults);

    // tests: 100*1.0=100, code_quality: 85*0.6=51 → (100+51)/(1.0+0.6) = 94.375 → 94
    expect(result.composite_score).toBe(94);
    expect(result.decision).toBe('auto_merge');
    expect(result.layers).toHaveLength(2);

    const reviewLayer = result.layers.find(l => l.name === 'code_quality');
    expect(reviewLayer).toBeDefined();
    expect(reviewLayer!.score).toBe(85);
    expect(reviewLayer!.type).toBe('agent-review');
  });

  it('produces human_review when agent-review fails via selfReviewResults', async () => {
    const config: CanductorConfig = {
      version: 1,
      layers: {
        tests: {
          name: 'tests',
          type: 'deterministic',
          run: 'echo ok',
          weight: 1.0,
        },
        code_quality: {
          name: 'code_quality',
          type: 'agent-review',
          rubric: '/some/rubric.md',
          weight: 0.6,
        },
      },
      policy: {
        auto_merge: 'all_pass',
        human_review: 'any_agent_review_fail',
        block: 'any_deterministic_fail',
      },
    };

    const selfReviewResults: Record<string, AgentReviewResult> = {
      code_quality: {
        pass: false,
        score: 40,
        issues: [{ severity: 'critical', description: 'Uses any types' }],
        summary: 'Poor quality',
      },
    };

    const result = await verify('bad-ref', config, selfReviewResults);

    expect(result.decision).toBe('human_review');

    const reviewLayer = result.layers.find(l => l.name === 'code_quality');
    expect(reviewLayer!.pass).toBe(false);
    expect(reviewLayer!.score).toBe(40);
  });
});
