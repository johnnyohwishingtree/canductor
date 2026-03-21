/**
 * Layer executors — run each verification layer type and return a result.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import type { LayerConfig, LayerResult } from './types.js';

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

  // Step 2: Compare to baseline
  // TODO: Implement pixel diff comparison
  // For now, pass if baseline directory exists (captures were taken)
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

  // Placeholder: real implementation would do pixel diff and return % change
  return {
    name: layer.name,
    type: 'screenshot-diff',
    pass: true,
    score: 100,
    errors: '',
    duration_ms: Date.now() - start,
  };
}

/** Run an agent-review layer (send context + rubric to LLM, parse verdict). */
export function runAgentReviewLayer(layer: LayerConfig): LayerResult {
  const start = Date.now();

  // Load rubric
  const rubricContent = layer.rubric && existsSync(layer.rubric)
    ? readFileSync(layer.rubric, 'utf-8')
    : null;

  if (!rubricContent) {
    return {
      name: layer.name,
      type: 'agent-review',
      pass: true,
      score: 100,
      errors: 'No rubric file found — skipping agent review',
      duration_ms: Date.now() - start,
    };
  }

  // TODO: Call LLM API with rubric + context, parse structured response
  // For now, placeholder that passes
  return {
    name: layer.name,
    type: 'agent-review',
    pass: true,
    score: 100,
    errors: '',
    duration_ms: Date.now() - start,
  };
}

/** Dispatch to the correct layer executor based on type. */
export function runLayer(layer: LayerConfig): LayerResult {
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
