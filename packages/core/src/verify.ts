/**
 * The verification engine — runs all layers, computes composite score,
 * evaluates policy, returns a decision.
 */

import type { CanductorConfig, LayerResult, VerifyResult, AgentReviewResult, VerifyOptions } from './types.js';
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
function buildSummary(results: LayerResult[], decision: string, wallClockMs: number): string {
  const lines: string[] = [];
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    const timedOutTag = r.timed_out ? ' (timed out)' : '';
    lines.push(`  ${icon} ${r.name}: ${r.score}/100 (${r.duration_ms}ms)${timedOutTag}`);
    if (r.errors) {
      lines.push(`       ${r.errors.split('\n')[0]}`);
    }
  }
  const sequentialMs = results.reduce((sum, r) => sum + r.duration_ms, 0);
  const speedup = sequentialMs > 0 ? sequentialMs / wallClockMs : 1;
  lines.push('');
  lines.push(`  Wall clock: ${wallClockMs}ms (${speedup.toFixed(1)}x speedup vs sequential ${sequentialMs}ms)`);
  return `Decision: ${decision}\n${lines.join('\n')}`;
}

/**
 * Run all verification layers and return a complete result.
 *
 * @param ref - Git ref (PR number, branch, or commit)
 * @param config - Canductor configuration
 * @param selfReviewResults - Optional map of layer name → pre-evaluated agent review result.
 *   Used in self-review mode to inject results from the parent Claude session.
 */
/** Determine whether a layer should run in parallel based on its config. */
function isParallelLayer(layerConfig: import('./types.js').LayerConfig): boolean {
  if (layerConfig.parallel !== undefined) return layerConfig.parallel;
  return layerConfig.type === 'deterministic' || layerConfig.type === 'guardrail';
}

export async function verify(
  ref: string,
  config: CanductorConfig,
  selfReviewResults?: Record<string, AgentReviewResult>,
  repoRoot?: string,
  options?: VerifyOptions
): Promise<VerifyResult> {
  const startTime = Date.now();

  const entries = Object.entries(config.layers);
  const parallelEntries = entries.filter(([, lc]) => isParallelLayer(lc));
  const sequentialEntries = entries.filter(([, lc]) => !isParallelLayer(lc));

  // Run parallel layers concurrently
  const parallelResults = await Promise.all(
    parallelEntries.map(([name, layerConfig]) => {
      const reviewResult = selfReviewResults?.[name];
      return runLayer({ ...layerConfig, name }, reviewResult, repoRoot, options);
    })
  );

  // Run sequential layers in order
  const sequentialResults: LayerResult[] = [];
  for (const [name, layerConfig] of sequentialEntries) {
    const reviewResult = selfReviewResults?.[name];
    const result = await runLayer({ ...layerConfig, name }, reviewResult, repoRoot, options);
    sequentialResults.push(result);
  }

  // Combine results preserving original config order
  const resultMap = new Map<string, LayerResult>();
  for (const r of [...parallelResults, ...sequentialResults]) {
    resultMap.set(r.name, r);
  }
  const results = entries.map(([name]) => resultMap.get(name)!);

  const wallClockMs = Date.now() - startTime;
  const compositeScore = computeCompositeScore(results, config);
  const decision = evaluatePolicy(results, compositeScore, config);
  const summary = buildSummary(results, decision, wallClockMs);

  return {
    ref,
    timestamp: new Date().toISOString(),
    layers: results,
    composite_score: compositeScore,
    decision,
    summary,
    wall_clock_ms: wallClockMs,
  };
}
