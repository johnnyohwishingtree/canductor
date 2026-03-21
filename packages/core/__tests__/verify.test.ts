import { describe, it, expect } from 'vitest';
import { computeCompositeScore, evaluatePolicy } from '../src/verify.js';
import type { CanductorConfig, LayerResult } from '../src/types.js';

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
