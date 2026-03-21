/**
 * The verification engine — runs all layers, computes composite score,
 * evaluates policy, returns a decision.
 */

import type { CanductorConfig, LayerResult, VerifyResult } from './types.js';
import { runLayer } from './layers.js';
import { buildPolicyContext, evaluateAllPolicies } from './policy.js';

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
 * Delegates to the expression parser in policy.ts which evaluates
 * the policy strings from config.yaml against a PolicyContext.
 *
 * @param results - Layer results from running all verification layers.
 * @param compositeScore - Weighted composite score (0-100).
 * @param config - Full canductor configuration including policy expressions.
 * @param baseline - Current baseline score (default 0). Used for
 *   expressions like "composite_score >= baseline".
 */
export function evaluatePolicy(
  results: LayerResult[],
  compositeScore: number,
  config: CanductorConfig,
  baseline: number = 0
): 'auto_merge' | 'human_review' | 'block' {
  const context = buildPolicyContext(results, compositeScore, baseline);
  return evaluateAllPolicies(config, context);
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
export async function verify(ref: string, config: CanductorConfig): Promise<VerifyResult> {
  const results: LayerResult[] = [];

  for (const [name, layerConfig] of Object.entries(config.layers)) {
    const result = await runLayer({ ...layerConfig, name });
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
