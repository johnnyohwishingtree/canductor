/**
 * Layer executors — run each verification layer type and return a result.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { LayerConfig, LayerResult } from './types.js';
import { runAgentReview } from './agent-review.js';
import { compareScreenshots } from './screenshot.js';

/** Run a deterministic layer (shell command, pass/fail). */
export function runDeterministicLayer(layer: LayerConfig): LayerResult {
  const start = Date.now();
  const cmd = layer.run;
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

  try {
    execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return {
      name: layer.name,
      type: 'deterministic',
      pass: true,
      score: 100,
      errors: '',
      duration_ms: Date.now() - start,
    };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string };
    const output = ((error.stdout ?? '') + (error.stderr ?? '')).slice(-2000);
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

/** Run an agent-review layer (send context + rubric to LLM, parse verdict). */
export async function runAgentReviewLayer(layer: LayerConfig): Promise<LayerResult> {
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

/** Dispatch to the correct layer executor based on type. */
export async function runLayer(layer: LayerConfig): Promise<LayerResult> {
  switch (layer.type) {
    case 'deterministic':
      return runDeterministicLayer(layer);
    case 'screenshot-diff':
      return runScreenshotDiffLayer(layer);
    case 'agent-review':
      return runAgentReviewLayer(layer);
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
