/**
 * Config loader — reads .canductor/config.yaml from the repo.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { CanductorConfig } from './types.js';

const LayerSchema = z.object({
  name: z.string(),
  type: z.enum(['deterministic', 'screenshot-diff', 'agent-review']),
  run: z.string().optional(),
  capture: z.string().optional(),
  baseline: z.string().optional(),
  threshold: z.number().optional(),
  model: z.string().optional(),
  rubric: z.string().optional(),
  context: z.array(z.string()).optional(),
  weight: z.number().min(0).max(1),
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
