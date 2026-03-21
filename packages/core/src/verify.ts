/**
 * The verification engine — runs all layers, computes composite score,
 * evaluates policy, returns a decision.
 */

import type { CanductorConfig, LayerResult, VerifyResult } from './types.js';
import { runLayer } from './layers.js';

/** Compute weighted composite score from layer results. */
export function computeCompositeScore(
  results: LayerResult[],
  config: CanductorConfig
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const result of results) {
    const layerConfig = config.layers[result.name];
    if (!layerConfig) continue;

    totalWeight += layerConfig.weight;
    weightedSum += result.score * layerConfig.weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round(weightedSum / totalWeight);
}

/**
 * Evaluate the policy to determine the decision.
 *
 * Policy expressions are simple boolean conditions:
 *   "all_deterministic_pass AND composite_score >= 80"
 *
 * For v1, we use a simplified evaluator. A full expression
 * parser can come later.
 */
export function evaluatePolicy(
  results: LayerResult[],
  compositeScore: number,
  config: CanductorConfig
): 'auto_merge' | 'human_review' | 'block' {
  const allDeterministicPass = results
    .filter(r => r.type === 'deterministic')
    .every(r => r.pass);

  const anyDeterministicFail = results
    .some(r => r.type === 'deterministic' && !r.pass);

  const allPass = results.every(r => r.pass);

  // Block takes priority
  if (anyDeterministicFail) return 'block';

  // Auto-merge if everything passes
  if (allDeterministicPass && allPass) return 'auto_merge';

  // Otherwise human review
  return 'human_review';
}

/** Build a human-readable summary of the verification. */
function buildSummary(results: LayerResult[], decision: string): string {
  const lines: string[] = [];
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    lines.push(`  ${icon} ${r.name}: ${r.score}/100 (${r.duration_ms}ms)`);
    if (r.errors) {
      lines.push(`       ${r.errors.split('\n')[0]}`);
    }
  }
  return `Decision: ${decision}\n${lines.join('\n')}`;
}

/** Run all verification layers and return a complete result. */
export function verify(ref: string, config: CanductorConfig): VerifyResult {
  const results: LayerResult[] = [];

  for (const [name, layerConfig] of Object.entries(config.layers)) {
    const result = runLayer({ ...layerConfig, name });
    results.push(result);
  }

  const compositeScore = computeCompositeScore(results, config);
  const decision = evaluatePolicy(results, compositeScore, config);
  const summary = buildSummary(results, decision);

  return {
    ref,
    timestamp: new Date().toISOString(),
    layers: results,
    composite_score: compositeScore,
    decision,
    summary,
  };
}
