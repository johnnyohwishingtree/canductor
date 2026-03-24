/**
 * Config loader — reads .canductor/config.yaml from the repo.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { CanductorConfig, ConfigValidation, ConfigValidationIssue, LayerInfo } from './types.js';
import { evaluateExpression, buildPolicyContext } from './policy.js';
import { validateGuardrailPatterns } from './guardrail.js';

const GuardrailPatternSchema = z.object({
  pattern: z.string(),
  message: z.string(),
});

const LayerSchema = z.object({
  name: z.string(),
  type: z.enum(['deterministic', 'screenshot-diff', 'agent-review', 'guardrail']),
  run: z.string().optional(),
  capture: z.string().optional(),
  baseline: z.string().optional(),
  threshold: z.number().optional(),
  model: z.string().optional(),
  rubric: z.string().optional(),
  context: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  patterns: z.array(GuardrailPatternSchema).optional(),
  weight: z.number().min(0).max(1),
  parallel: z.boolean().optional(),
});

const PolicySchema = z.object({
  auto_merge: z.string(),
  human_review: z.string(),
  block: z.string(),
});

const ConfigSchema = z.object({
  version: z.literal(1),
  layers: z.record(LayerSchema),
  policy: PolicySchema,
  baseline: z.number().min(0).max(100).optional(),
});

const CONFIG_PATHS = [
  '.canductor/config.yaml',
  '.canductor/config.yml',
  'canductor.yaml',
  'canductor.yml',
];

export function findConfigPath(repoRoot: string): string | null {
  for (const p of CONFIG_PATHS) {
    const full = join(repoRoot, p);
    if (existsSync(full)) return full;
  }
  return null;
}

export function loadConfig(repoRoot: string): CanductorConfig {
  const configPath = findConfigPath(repoRoot);
  if (!configPath) {
    throw new Error(
      `No canductor config found. Create one of: ${CONFIG_PATHS.join(', ')}`
    );
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  return ConfigSchema.parse(parsed);
}

/**
 * Write a baseline value to the config YAML file.
 * Preserves existing config and adds/updates the baseline field.
 */
export function writeConfigBaseline(repoRoot: string, baseline: number): void {
  const configPath = findConfigPath(repoRoot);
  if (!configPath) {
    throw new Error(
      `No canductor config found. Run: canductor init`
    );
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  parsed.baseline = baseline;
  writeFileSync(configPath, stringifyYaml(parsed));
}

/**
 * List all configured verification layers with their type, weight, and key detail.
 */
export function listLayers(config: CanductorConfig): LayerInfo[] {
  return Object.entries(config.layers).map(([key, layer]) => {
    let detail: string;
    switch (layer.type) {
      case 'deterministic':
        detail = layer.run ? `run: ${layer.run}` : 'no run command';
        break;
      case 'agent-review':
        detail = layer.rubric ? `rubric: ${layer.rubric}` : 'no rubric';
        break;
      case 'guardrail':
        detail = layer.patterns ? `${layer.patterns.length} pattern(s)` : 'no patterns';
        break;
      case 'screenshot-diff':
        detail = layer.baseline ? `baseline: ${layer.baseline}` : 'no baseline';
        break;
      default:
        detail = '';
    }
    return { name: key, type: layer.type, weight: layer.weight, detail };
  });
}

/**
 * Validate a canductor config without running any layers.
 * Checks: file exists, YAML parses, Zod schema validates, policy expressions parse,
 * rubric files exist for agent-review layers, run commands non-empty for deterministic,
 * include/patterns non-empty for guardrail layers.
 */
export function validateConfig(repoRoot: string): ConfigValidation {
  const errors: ConfigValidationIssue[] = [];
  const warnings: ConfigValidationIssue[] = [];

  // Check config file exists
  const configPath = findConfigPath(repoRoot);
  if (!configPath) {
    errors.push({
      level: 'error',
      message: `No config file found. Expected one of: ${CONFIG_PATHS.join(', ')}`,
    });
    return { valid: false, errors, warnings };
  }

  // Check YAML parses
  let raw: string;
  let parsed: unknown;
  try {
    raw = readFileSync(configPath, 'utf-8');
    parsed = parseYaml(raw);
  } catch (err) {
    errors.push({
      level: 'error',
      message: `Failed to parse YAML: ${(err as Error).message}`,
      path: configPath,
    });
    return { valid: false, errors, warnings };
  }

  // Check Zod schema validates
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : undefined;
      errors.push({
        level: 'error',
        message: issue.message,
        path,
      });
    }
    return { valid: false, errors, warnings };
  }

  const config = result.data as CanductorConfig;

  // Check layer-specific requirements
  const layerEntries = Object.entries(config.layers);
  let totalWeight = 0;

  for (const [key, layer] of layerEntries) {
    totalWeight += layer.weight;

    if (layer.type === 'deterministic' && (!layer.run || layer.run.trim() === '')) {
      errors.push({
        level: 'error',
        message: `Deterministic layer "${key}" has no run command`,
        path: `layers.${key}.run`,
      });
    }

    if (layer.type === 'agent-review' && layer.rubric) {
      const rubricPath = join(repoRoot, layer.rubric);
      if (!existsSync(rubricPath)) {
        errors.push({
          level: 'error',
          message: `Rubric file not found: ${layer.rubric}`,
          path: `layers.${key}.rubric`,
        });
      }
    }

    if (layer.type === 'guardrail') {
      if ((!layer.include || layer.include.length === 0) && (!layer.patterns || layer.patterns.length === 0)) {
        errors.push({
          level: 'error',
          message: `Guardrail layer "${key}" has no include patterns and no patterns — nothing to check`,
          path: `layers.${key}`,
        });
      }

      if (layer.patterns && layer.patterns.length > 0) {
        const regexErrors = validateGuardrailPatterns(layer.patterns);
        for (const regexError of regexErrors) {
          errors.push({
            level: 'error',
            message: `Guardrail layer "${key}": ${regexError}`,
            path: `layers.${key}.patterns`,
          });
        }
      }
    }
  }

  // Warn on suspicious weight sums
  if (totalWeight === 0 && layerEntries.length > 0) {
    warnings.push({
      level: 'warning',
      message: 'All layer weights sum to 0 — no scoring is possible',
    });
  }

  // Warn on suspicious baseline
  if (config.baseline !== undefined) {
    if (config.baseline > 100) {
      warnings.push({
        level: 'warning',
        message: `Baseline ${config.baseline} is greater than 100`,
        path: 'baseline',
      });
    }
    if (config.baseline < 0) {
      warnings.push({
        level: 'warning',
        message: `Baseline ${config.baseline} is less than 0`,
        path: 'baseline',
      });
    }
  }

  // Check policy expressions parse by evaluating with a dummy context
  // populated from the config's layers so all layer identifiers resolve.
  const dummyLayerResults: import('./types.js').LayerResult[] = Object.entries(config.layers).map(
    ([key, layer]) => ({
      name: key,
      type: layer.type,
      pass: true,
      score: 100,
      errors: '',
      duration_ms: 0,
    })
  );
  const dummyContext = buildPolicyContext(dummyLayerResults, 100, 100);
  for (const [policyName, expr] of Object.entries(config.policy)) {
    try {
      evaluateExpression(expr, dummyContext);
    } catch (err) {
      const msg = (err as Error).message;
      // Skip unknown identifier errors — they may reference runtime-only values.
      // Only report actual syntax/parse errors.
      if (!msg.includes('Unknown identifier') && !msg.includes('Unknown layer') && !msg.includes('Unknown field')) {
        errors.push({
          level: 'error',
          message: `Invalid policy expression for "${policyName}": ${msg}`,
          path: `policy.${policyName}`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
