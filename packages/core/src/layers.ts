/**
 * Layer executors — run each verification layer type and return a result.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { LayerConfig, LayerResult, AgentReviewResult, SelfReviewPrompt, VerifyOptions } from './types.js';
import { runAgentReview, buildReviewPrompt } from './agent-review.js';
import { compareScreenshots } from './screenshot.js';
import { runGuardrailLayer } from './guardrail.js';

/** Return the default timeout in ms for a given layer type. */
export function defaultTimeoutMs(type: LayerConfig['type']): number | undefined {
  switch (type) {
    case 'deterministic':
    case 'screenshot-diff':
      return 300_000; // 5 minutes
    case 'guardrail':
      return 120_000; // 2 minutes
    case 'agent-review':
      return undefined; // handled by the SDK
  }
}

/** Run a deterministic layer (shell command, pass/fail). */
export function runDeterministicLayer(layer: LayerConfig, options?: VerifyOptions): LayerResult {
  const start = Date.now();
  const cmd = layer.run;
  const log = options?.verbose ? (options.logger ?? console.log) : undefined;

  if (!cmd) {
    return {
      name: layer.name,
      type: 'deterministic',
      pass: false,
      score: 0,
      errors: 'No "run" command specified',
      duration_ms: 0,
    };
  }

  const timeout = layer.timeout_ms ?? defaultTimeoutMs(layer.type);

  try {
    const stdout = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout });
    if (log && stdout) {
      log(`[${layer.name}] stdout:\n${stdout}`);
    }
    return {
      name: layer.name,
      type: 'deterministic',
      pass: true,
      score: 100,
      errors: '',
      duration_ms: Date.now() - start,
    };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; killed?: boolean; code?: string; signal?: string };
    if (error.code === 'ETIMEDOUT') {
      const usedTimeout = timeout ?? 0;
      return {
        name: layer.name,
        type: 'deterministic',
        pass: false,
        score: 0,
        errors: `Command timed out after ${usedTimeout}ms`,
        duration_ms: Date.now() - start,
      };
    }
    const fullOutput = (error.stdout ?? '') + (error.stderr ?? '');
    if (log) {
      log(`[${layer.name}] stdout+stderr:\n${fullOutput}`);
    }
    const output = fullOutput.slice(-2000);
    return {
      name: layer.name,
      type: 'deterministic',
      pass: false,
      score: 0,
      errors: output,
      duration_ms: Date.now() - start,
    };
  }
}

/** Run a screenshot-diff layer (capture + compare to baseline). */
export function runScreenshotDiffLayer(layer: LayerConfig): LayerResult {
  const start = Date.now();

  // Step 1: Capture current screenshots
  if (layer.capture) {
    try {
      execSync(layer.capture, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err: unknown) {
      const error = err as { stderr?: string };
      return {
        name: layer.name,
        type: 'screenshot-diff',
        pass: false,
        score: 0,
        errors: `Screenshot capture failed: ${error.stderr ?? 'unknown error'}`,
        duration_ms: Date.now() - start,
      };
    }
  }

  // Step 2: Compare to baseline using pixel diff
  const baselineExists = layer.baseline && existsSync(layer.baseline);
  if (!baselineExists) {
    return {
      name: layer.name,
      type: 'screenshot-diff',
      pass: true,
      score: 100,
      errors: 'No baseline directory — first run, establishing baseline',
      duration_ms: Date.now() - start,
    };
  }

  // Determine currentDir: if capture command was provided, use the directory
  // from the layer config; otherwise fall back to baseline (self-compare).
  // The capture command is expected to place screenshots in a known directory.
  // For now, we expect the capture output directory to match the layer's
  // "run" or a sibling of baseline. Convention: currentDir = baseline + '-current'
  // or override via layer config. We use the baseline parent + '/current' as default.
  const currentDir = layer.capture
    ? layer.baseline!.replace(/\/?$/, '-current')
    : layer.baseline!;

  if (!existsSync(currentDir)) {
    return {
      name: layer.name,
      type: 'screenshot-diff',
      pass: false,
      score: 0,
      errors: `Current screenshots directory not found: ${currentDir}`,
      duration_ms: Date.now() - start,
    };
  }

  const threshold = layer.threshold ?? 1;
  const diffResult = compareScreenshots(currentDir, layer.baseline!, threshold);

  const score = Math.max(0, Math.min(100, Math.round(100 - diffResult.overallDiffPercent)));

  return {
    name: layer.name,
    type: 'screenshot-diff',
    pass: diffResult.pass,
    score,
    errors: diffResult.pass ? '' : diffResult.summary,
    duration_ms: Date.now() - start,
  };
}

/**
 * Run an agent-review layer (send context + rubric to LLM, parse verdict).
 *
 * @param layer - Layer configuration
 * @param selfReviewResult - Pre-evaluated result for self-review mode.
 *   When provided, skips the API call and uses this result directly.
 */
export async function runAgentReviewLayer(
  layer: LayerConfig,
  selfReviewResult?: AgentReviewResult
): Promise<LayerResult> {
  const start = Date.now();

  if (!layer.rubric) {
    return {
      name: layer.name,
      type: 'agent-review',
      pass: true,
      score: 100,
      errors: 'No rubric file specified — skipping agent review',
      duration_ms: Date.now() - start,
    };
  }

  // Use pre-evaluated result if provided (self-review mode)
  if (selfReviewResult) {
    return {
      name: layer.name,
      type: 'agent-review',
      pass: selfReviewResult.pass,
      score: selfReviewResult.score,
      errors: selfReviewResult.issues.map(i => `[${i.severity}] ${i.description}`).join('\n') || selfReviewResult.summary,
      duration_ms: Date.now() - start,
    };
  }

  const model = layer.model ?? 'claude-sonnet-4-6';
  const context = layer.context ?? [];

  const result = await runAgentReview(layer.rubric, context, model);

  return {
    name: layer.name,
    type: 'agent-review',
    pass: result.pass,
    score: result.score,
    errors: result.issues.map(i => `[${i.severity}] ${i.description}`).join('\n') || result.summary,
    duration_ms: Date.now() - start,
  };
}

/**
 * Build the self-review prompt for an agent-review layer.
 * Returns null if the layer has no rubric or the rubric can't be read.
 */
export function getAgentReviewPrompt(layer: LayerConfig): SelfReviewPrompt | null {
  if (!layer.rubric) return null;
  return buildReviewPrompt(layer.rubric, layer.context ?? []);
}

/**
 * Dispatch to the correct layer executor based on type.
 *
 * @param layer - Layer configuration
 * @param selfReviewResult - Optional pre-evaluated result for agent-review layers
 */
export async function runLayer(
  layer: LayerConfig,
  selfReviewResult?: AgentReviewResult,
  repoRoot?: string,
  options?: VerifyOptions
): Promise<LayerResult> {
  switch (layer.type) {
    case 'deterministic':
      return runDeterministicLayer(layer, options);
    case 'screenshot-diff':
      return runScreenshotDiffLayer(layer);
    case 'agent-review':
      return runAgentReviewLayer(layer, selfReviewResult);
    case 'guardrail':
      return runGuardrailLayer(layer, repoRoot ?? process.cwd(), options);
    default:
      return {
        name: layer.name,
        type: layer.type,
        pass: false,
        score: 0,
        errors: `Unknown layer type: ${layer.type}`,
        duration_ms: 0,
      };
  }
}
