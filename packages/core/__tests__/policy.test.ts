import { describe, it, expect } from 'vitest';
import { evaluateExpression, evaluateAllPolicies, buildPolicyContext } from '../src/policy.js';
import type { PolicyContext } from '../src/policy.js';
import type { CanductorConfig, LayerResult } from '../src/types.js';

/** Helper to create a PolicyContext with sensible defaults. */
function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    all_deterministic_pass: true,
    any_deterministic_fail: false,
    all_pass: true,
    any_agent_review_fail: false,
    composite_score: 85,
    baseline: 80,
    layers: {
      tests: { pass: true, score: 100, has_issues: false },
      visual: { pass: true, score: 90, has_issues: false },
      ux_review: { pass: true, score: 75, has_issues: false },
    },
    ...overrides,
  };
}

describe('evaluateExpression', () => {
  describe('simple boolean values', () => {
    it('returns true when all_deterministic_pass is true', () => {
      const ctx = makeContext({ all_deterministic_pass: true });
      expect(evaluateExpression('all_deterministic_pass', ctx)).toBe(true);
    });

    it('returns false when all_deterministic_pass is false', () => {
      const ctx = makeContext({ all_deterministic_pass: false });
      expect(evaluateExpression('all_deterministic_pass', ctx)).toBe(false);
    });

    it('returns true for all_pass when all layers pass', () => {
      const ctx = makeContext({ all_pass: true });
      expect(evaluateExpression('all_pass', ctx)).toBe(true);
    });

    it('returns false for all_pass when not all layers pass', () => {
      const ctx = makeContext({ all_pass: false });
      expect(evaluateExpression('all_pass', ctx)).toBe(false);
    });

    it('evaluates any_deterministic_fail', () => {
      expect(evaluateExpression('any_deterministic_fail', makeContext({ any_deterministic_fail: true }))).toBe(true);
      expect(evaluateExpression('any_deterministic_fail', makeContext({ any_deterministic_fail: false }))).toBe(false);
    });

    it('evaluates any_agent_review_fail', () => {
      expect(evaluateExpression('any_agent_review_fail', makeContext({ any_agent_review_fail: true }))).toBe(true);
      expect(evaluateExpression('any_agent_review_fail', makeContext({ any_agent_review_fail: false }))).toBe(false);
    });
  });

  describe('AND operator', () => {
    it('returns true only when both operands are true', () => {
      const ctx = makeContext({ all_deterministic_pass: true, all_pass: true });
      expect(evaluateExpression('all_deterministic_pass AND all_pass', ctx)).toBe(true);
    });

    it('returns false when left operand is false', () => {
      const ctx = makeContext({ all_deterministic_pass: false, all_pass: true });
      expect(evaluateExpression('all_deterministic_pass AND all_pass', ctx)).toBe(false);
    });

    it('returns false when right operand is false', () => {
      const ctx = makeContext({ all_deterministic_pass: true, all_pass: false });
      expect(evaluateExpression('all_deterministic_pass AND all_pass', ctx)).toBe(false);
    });

    it('returns false when both operands are false', () => {
      const ctx = makeContext({ all_deterministic_pass: false, all_pass: false });
      expect(evaluateExpression('all_deterministic_pass AND all_pass', ctx)).toBe(false);
    });

    it('is case-insensitive', () => {
      const ctx = makeContext({ all_deterministic_pass: true, all_pass: true });
      expect(evaluateExpression('all_deterministic_pass and all_pass', ctx)).toBe(true);
    });
  });

  describe('OR operator', () => {
    it('returns true when either operand is true', () => {
      const ctx = makeContext({ any_deterministic_fail: true, any_agent_review_fail: false });
      expect(evaluateExpression('any_deterministic_fail OR any_agent_review_fail', ctx)).toBe(true);
    });

    it('returns true when both operands are true', () => {
      const ctx = makeContext({ any_deterministic_fail: true, any_agent_review_fail: true });
      expect(evaluateExpression('any_deterministic_fail OR any_agent_review_fail', ctx)).toBe(true);
    });

    it('returns false when both operands are false', () => {
      const ctx = makeContext({ any_deterministic_fail: false, any_agent_review_fail: false });
      expect(evaluateExpression('any_deterministic_fail OR any_agent_review_fail', ctx)).toBe(false);
    });

    it('is case-insensitive', () => {
      const ctx = makeContext({ any_deterministic_fail: false, any_agent_review_fail: true });
      expect(evaluateExpression('any_deterministic_fail or any_agent_review_fail', ctx)).toBe(true);
    });
  });

  describe('NOT operator', () => {
    it('negates a true value to false', () => {
      const ctx = makeContext({ any_deterministic_fail: true });
      expect(evaluateExpression('NOT any_deterministic_fail', ctx)).toBe(false);
    });

    it('negates a false value to true', () => {
      const ctx = makeContext({ any_deterministic_fail: false });
      expect(evaluateExpression('NOT any_deterministic_fail', ctx)).toBe(true);
    });

    it('double NOT is identity', () => {
      const ctx = makeContext({ all_pass: true });
      expect(evaluateExpression('NOT NOT all_pass', ctx)).toBe(true);
    });

    it('is case-insensitive', () => {
      const ctx = makeContext({ any_deterministic_fail: true });
      expect(evaluateExpression('not any_deterministic_fail', ctx)).toBe(false);
    });
  });

  describe('comparison operators', () => {
    it('evaluates composite_score >= 80 as true when score is 85', () => {
      const ctx = makeContext({ composite_score: 85 });
      expect(evaluateExpression('composite_score >= 80', ctx)).toBe(true);
    });

    it('evaluates composite_score >= 80 as true when score is exactly 80', () => {
      const ctx = makeContext({ composite_score: 80 });
      expect(evaluateExpression('composite_score >= 80', ctx)).toBe(true);
    });

    it('evaluates composite_score >= 80 as false when score is 79', () => {
      const ctx = makeContext({ composite_score: 79 });
      expect(evaluateExpression('composite_score >= 80', ctx)).toBe(false);
    });

    it('evaluates composite_score > 80 correctly', () => {
      expect(evaluateExpression('composite_score > 80', makeContext({ composite_score: 81 }))).toBe(true);
      expect(evaluateExpression('composite_score > 80', makeContext({ composite_score: 80 }))).toBe(false);
    });

    it('evaluates composite_score < 50 correctly', () => {
      expect(evaluateExpression('composite_score < 50', makeContext({ composite_score: 49 }))).toBe(true);
      expect(evaluateExpression('composite_score < 50', makeContext({ composite_score: 50 }))).toBe(false);
    });

    it('evaluates composite_score <= 50 correctly', () => {
      expect(evaluateExpression('composite_score <= 50', makeContext({ composite_score: 50 }))).toBe(true);
      expect(evaluateExpression('composite_score <= 50', makeContext({ composite_score: 51 }))).toBe(false);
    });

    it('evaluates composite_score == 85 correctly', () => {
      expect(evaluateExpression('composite_score == 85', makeContext({ composite_score: 85 }))).toBe(true);
      expect(evaluateExpression('composite_score == 85', makeContext({ composite_score: 84 }))).toBe(false);
    });

    it('evaluates composite_score != 85 correctly', () => {
      expect(evaluateExpression('composite_score != 85', makeContext({ composite_score: 84 }))).toBe(true);
      expect(evaluateExpression('composite_score != 85', makeContext({ composite_score: 85 }))).toBe(false);
    });
  });

  describe('baseline comparison', () => {
    it('evaluates composite_score >= baseline as true when score meets baseline', () => {
      const ctx = makeContext({ composite_score: 85, baseline: 80 });
      expect(evaluateExpression('composite_score >= baseline', ctx)).toBe(true);
    });

    it('evaluates composite_score >= baseline as true at exact baseline', () => {
      const ctx = makeContext({ composite_score: 80, baseline: 80 });
      expect(evaluateExpression('composite_score >= baseline', ctx)).toBe(true);
    });

    it('evaluates composite_score >= baseline as false below baseline', () => {
      const ctx = makeContext({ composite_score: 75, baseline: 80 });
      expect(evaluateExpression('composite_score >= baseline', ctx)).toBe(false);
    });

    it('evaluates composite_score < baseline correctly', () => {
      const ctx = makeContext({ composite_score: 70, baseline: 80 });
      expect(evaluateExpression('composite_score < baseline', ctx)).toBe(true);
    });
  });

  describe('layer access', () => {
    it('evaluates layer.pass as true when layer passes', () => {
      const ctx = makeContext();
      expect(evaluateExpression('ux_review.pass', ctx)).toBe(true);
    });

    it('evaluates layer.pass as false when layer fails', () => {
      const ctx = makeContext({
        layers: {
          ...makeContext().layers,
          ux_review: { pass: false, score: 40, has_issues: true },
        },
      });
      expect(evaluateExpression('ux_review.pass', ctx)).toBe(false);
    });

    it('evaluates layer.has_issues', () => {
      const ctx = makeContext({
        layers: {
          ...makeContext().layers,
          ux_review: { pass: true, score: 75, has_issues: true },
        },
      });
      expect(evaluateExpression('ux_review.has_issues', ctx)).toBe(true);
    });

    it('evaluates layer.score comparison', () => {
      const ctx = makeContext({
        layers: {
          ...makeContext().layers,
          visual: { pass: true, score: 95, has_issues: false },
        },
      });
      expect(evaluateExpression('visual.score > 90', ctx)).toBe(true);
      expect(evaluateExpression('visual.score > 95', ctx)).toBe(false);
    });

    it('throws on unknown layer', () => {
      const ctx = makeContext();
      expect(() => evaluateExpression('nonexistent.pass', ctx)).toThrow(
        "Unknown layer 'nonexistent'"
      );
    });

    it('throws on unknown layer field', () => {
      const ctx = makeContext();
      expect(() => evaluateExpression('tests.unknown', ctx)).toThrow(
        "Unknown field 'unknown' on layer 'tests'"
      );
    });
  });

  describe('combined expressions', () => {
    it('evaluates all_deterministic_pass AND composite_score >= baseline', () => {
      const ctx = makeContext({
        all_deterministic_pass: true,
        composite_score: 85,
        baseline: 80,
      });
      expect(
        evaluateExpression('all_deterministic_pass AND composite_score >= baseline', ctx)
      ).toBe(true);
    });

    it('returns false when one part of AND fails', () => {
      const ctx = makeContext({
        all_deterministic_pass: false,
        composite_score: 85,
        baseline: 80,
      });
      expect(
        evaluateExpression('all_deterministic_pass AND composite_score >= baseline', ctx)
      ).toBe(false);
    });

    it('handles AND with OR (AND binds tighter)', () => {
      // "A OR B AND C" should be parsed as "A OR (B AND C)"
      const ctx = makeContext({
        any_deterministic_fail: true,
        all_pass: false,
        any_agent_review_fail: false,
      });
      // true OR (false AND false) => true OR false => true
      expect(
        evaluateExpression(
          'any_deterministic_fail OR all_pass AND any_agent_review_fail',
          ctx
        )
      ).toBe(true);
    });

    it('respects parentheses overriding precedence', () => {
      // "(A OR B) AND C" vs "A OR (B AND C)"
      const ctx = makeContext({
        any_deterministic_fail: true,
        all_pass: false,
        any_agent_review_fail: false,
      });
      // (true OR false) AND false => true AND false => false
      expect(
        evaluateExpression(
          '(any_deterministic_fail OR all_pass) AND any_agent_review_fail',
          ctx
        )
      ).toBe(false);
    });

    it('handles NOT combined with AND', () => {
      const ctx = makeContext({
        any_deterministic_fail: false,
        all_pass: true,
      });
      expect(
        evaluateExpression('NOT any_deterministic_fail AND all_pass', ctx)
      ).toBe(true);
    });

    it('handles complex nested expression', () => {
      const ctx = makeContext({
        all_deterministic_pass: true,
        composite_score: 90,
        baseline: 80,
        layers: {
          ...makeContext().layers,
          ux_review: { pass: true, score: 75, has_issues: true },
        },
      });
      expect(
        evaluateExpression(
          'all_deterministic_pass AND (composite_score >= baseline OR ux_review.has_issues)',
          ctx
        )
      ).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty expression', () => {
      const ctx = makeContext();
      expect(evaluateExpression('', ctx)).toBe(false);
    });

    it('handles whitespace-only expression as empty', () => {
      const ctx = makeContext();
      expect(evaluateExpression('   ', ctx)).toBe(false);
    });

    it('throws on unknown identifier', () => {
      const ctx = makeContext();
      expect(() => evaluateExpression('nonexistent_field', ctx)).toThrow(
        "Unknown identifier 'nonexistent_field'"
      );
    });

    it('throws on unexpected character', () => {
      const ctx = makeContext();
      expect(() => evaluateExpression('all_pass & all_deterministic_pass', ctx)).toThrow(
        "Unexpected character '&'"
      );
    });
  });
});

describe('buildPolicyContext', () => {
  function makeResult(
    name: string,
    type: LayerResult['type'],
    pass: boolean,
    score: number,
    errors: string = ''
  ): LayerResult {
    return { name, type, pass, score, errors, duration_ms: 100 };
  }

  it('sets all_deterministic_pass when all deterministic layers pass', () => {
    const results = [
      makeResult('tests', 'deterministic', true, 100),
      makeResult('lint', 'deterministic', true, 100),
      makeResult('ux', 'agent-review', false, 40),
    ];
    const ctx = buildPolicyContext(results, 80, 75);
    expect(ctx.all_deterministic_pass).toBe(true);
    expect(ctx.any_deterministic_fail).toBe(false);
  });

  it('sets any_deterministic_fail when a deterministic layer fails', () => {
    const results = [
      makeResult('tests', 'deterministic', false, 0),
      makeResult('ux', 'agent-review', true, 80),
    ];
    const ctx = buildPolicyContext(results, 40, 75);
    expect(ctx.all_deterministic_pass).toBe(false);
    expect(ctx.any_deterministic_fail).toBe(true);
  });

  it('sets all_pass only when every layer passes', () => {
    const results = [
      makeResult('tests', 'deterministic', true, 100),
      makeResult('ux', 'agent-review', true, 80),
    ];
    expect(buildPolicyContext(results, 90, 75).all_pass).toBe(true);

    results[1] = makeResult('ux', 'agent-review', false, 40);
    expect(buildPolicyContext(results, 70, 75).all_pass).toBe(false);
  });

  it('sets any_agent_review_fail when an agent-review layer fails', () => {
    const results = [
      makeResult('tests', 'deterministic', true, 100),
      makeResult('ux', 'agent-review', false, 40),
    ];
    const ctx = buildPolicyContext(results, 70, 75);
    expect(ctx.any_agent_review_fail).toBe(true);
  });

  it('populates layers record with per-layer data', () => {
    const results = [
      makeResult('tests', 'deterministic', true, 100),
      makeResult('visual', 'screenshot-diff', true, 90, 'minor diffs'),
    ];
    const ctx = buildPolicyContext(results, 95, 80);
    expect(ctx.layers['tests']).toEqual({ pass: true, score: 100, has_issues: false });
    expect(ctx.layers['visual']).toEqual({ pass: true, score: 90, has_issues: true }); // has errors string
  });

  it('marks has_issues true when layer fails even without error string', () => {
    const results = [
      makeResult('tests', 'deterministic', false, 0, ''),
    ];
    const ctx = buildPolicyContext(results, 0, 75);
    expect(ctx.layers['tests'].has_issues).toBe(true);
  });

  it('carries composite_score and baseline through', () => {
    const ctx = buildPolicyContext([], 85, 80);
    expect(ctx.composite_score).toBe(85);
    expect(ctx.baseline).toBe(80);
  });
});

describe('evaluateAllPolicies', () => {
  const baseConfig: CanductorConfig = {
    version: 1,
    layers: {
      tests: { name: 'tests', type: 'deterministic', run: 'pnpm test', weight: 1.0 },
      visual: { name: 'visual', type: 'screenshot-diff', weight: 0.8 },
      ux: { name: 'ux', type: 'agent-review', weight: 0.6 },
    },
    policy: {
      auto_merge: 'all_deterministic_pass AND all_pass AND composite_score >= baseline',
      human_review: 'any_agent_review_fail',
      block: 'any_deterministic_fail',
    },
  };

  it('blocks when block expression is true (evaluated first)', () => {
    const ctx = makeContext({
      any_deterministic_fail: true,
      all_deterministic_pass: false,
      all_pass: false,
    });
    expect(evaluateAllPolicies(baseConfig, ctx)).toBe('block');
  });

  it('auto-merges when block is false and auto_merge is true', () => {
    const ctx = makeContext({
      any_deterministic_fail: false,
      all_deterministic_pass: true,
      all_pass: true,
      composite_score: 90,
      baseline: 80,
    });
    expect(evaluateAllPolicies(baseConfig, ctx)).toBe('auto_merge');
  });

  it('falls back to human_review when neither block nor auto_merge match', () => {
    const ctx = makeContext({
      any_deterministic_fail: false,
      all_deterministic_pass: true,
      all_pass: false,            // prevents auto_merge
      any_agent_review_fail: true,
    });
    expect(evaluateAllPolicies(baseConfig, ctx)).toBe('human_review');
  });

  it('falls back to human_review even when human_review expression is false', () => {
    // The human_review policy expression doesn't gate the fallback — it's always the default
    const ctx = makeContext({
      any_deterministic_fail: false,
      all_deterministic_pass: true,
      all_pass: false,
      any_agent_review_fail: false,  // human_review expr is false
      composite_score: 70,
      baseline: 80,                  // auto_merge fails on baseline
    });
    expect(evaluateAllPolicies(baseConfig, ctx)).toBe('human_review');
  });

  it('block takes priority over auto_merge even when both would match', () => {
    const ctx = makeContext({
      any_deterministic_fail: true,
      all_deterministic_pass: true,  // contradictory but tests priority
      all_pass: true,
      composite_score: 90,
      baseline: 80,
    });
    expect(evaluateAllPolicies(baseConfig, ctx)).toBe('block');
  });

  it('works with composite_score >= baseline expressions', () => {
    const config: CanductorConfig = {
      ...baseConfig,
      policy: {
        auto_merge: 'all_deterministic_pass AND composite_score >= baseline',
        human_review: 'composite_score < baseline',
        block: 'any_deterministic_fail',
      },
    };

    // Score meets baseline -> auto_merge
    const ctxAbove = makeContext({
      any_deterministic_fail: false,
      all_deterministic_pass: true,
      composite_score: 85,
      baseline: 80,
    });
    expect(evaluateAllPolicies(config, ctxAbove)).toBe('auto_merge');

    // Score below baseline -> human_review (block is false, auto_merge fails)
    const ctxBelow = makeContext({
      any_deterministic_fail: false,
      all_deterministic_pass: true,
      composite_score: 70,
      baseline: 80,
    });
    expect(evaluateAllPolicies(config, ctxBelow)).toBe('human_review');
  });

  it('works with layer access in policy expressions', () => {
    const config: CanductorConfig = {
      ...baseConfig,
      policy: {
        auto_merge: 'all_pass AND NOT ux.has_issues',
        human_review: 'ux.has_issues',
        block: 'any_deterministic_fail',
      },
    };

    const ctx = makeContext({
      any_deterministic_fail: false,
      all_pass: true,
      layers: {
        tests: { pass: true, score: 100, has_issues: false },
        visual: { pass: true, score: 90, has_issues: false },
        ux: { pass: true, score: 75, has_issues: true },
      },
    });

    // ux.has_issues is true, so NOT ux.has_issues is false -> auto_merge fails -> human_review
    expect(evaluateAllPolicies(config, ctx)).toBe('human_review');
  });
});
