/**
 * Guardrail — pre-action pattern matching verification layer.
 *
 * Scans source files for forbidden patterns (regex) and reports matches
 * as violations. Enables rules like "no `any` types" or "no console.log
 * in production code" at verification time.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { LayerConfig, LayerResult, GuardrailViolation, VerifyOptions } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a guardrail layer: scan files matching include globs for forbidden patterns.
 *
 * @param layer - Layer configuration with include, exclude, and patterns
 * @param repoRoot - Repository root directory for resolving globs
 * @returns Layer result with score proportional to violation count
 */
export function runGuardrailLayer(layer: LayerConfig, repoRoot: string, options?: VerifyOptions): LayerResult {
  const start = Date.now();
  const log = options?.verbose ? (options.logger ?? console.log) : undefined;

  if (!layer.patterns || layer.patterns.length === 0) {
    return {
      name: layer.name,
      type: 'guardrail',
      pass: true,
      score: 100,
      errors: 'No patterns configured',
      duration_ms: Date.now() - start,
    };
  }

  if (!layer.include || layer.include.length === 0) {
    return {
      name: layer.name,
      type: 'guardrail',
      pass: true,
      score: 100,
      errors: 'No include globs configured',
      duration_ms: Date.now() - start,
    };
  }

  const files = collectFiles(repoRoot, layer.include, layer.exclude ?? []);
  if (log) {
    log(`[${layer.name}] Scanning ${files.length} files`);
    for (const f of files) {
      log(`[${layer.name}]   ${f}`);
    }
  }
  const violations = scanFiles(files, layer.patterns, repoRoot);
  if (log && violations.length > 0) {
    log(`[${layer.name}] Found ${violations.length} violations`);
    for (const v of violations) {
      log(`[${layer.name}]   ${v.file}:${v.line} — ${v.message} (matched: "${v.match}")`);
    }
  }

  const score = violations.length === 0
    ? 100
    : Math.max(0, 100 - violations.length * 10);

  const errors = violations
    .map(v => `${v.file}:${v.line} — ${v.message} (matched: "${v.match}")`)
    .join('\n');

  return {
    name: layer.name,
    type: 'guardrail',
    pass: violations.length === 0,
    score,
    errors,
    duration_ms: Date.now() - start,
  };
}

/**
 * Validate guardrail regex patterns and return errors for invalid ones.
 * Used by config-check to report bad patterns before running the layer.
 */
export function validateGuardrailPatterns(
  patterns: Array<{ pattern: string; message: string }>,
): string[] {
  const errors: string[] = [];
  for (const { pattern } of patterns) {
    try {
      new RegExp(pattern, 'g');
    } catch (err) {
      errors.push(`Invalid regex "${pattern}": ${(err as Error).message}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collect files matching include globs, excluding files matching exclude globs.
 * Uses simple glob matching (supports * and ** patterns).
 */
function collectFiles(root: string, include: string[], exclude: string[]): string[] {
  const results: string[] = [];
  const allFiles: string[] = [];
  walkDirForFiles(root, allFiles);

  for (const file of allFiles) {
    const rel = relative(root, file);
    if (matchesAny(rel, include) && !matchesAny(rel, exclude)) {
      results.push(file);
    }
  }

  return results.sort();
}

function walkDirForFiles(dir: string, results: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDirForFiles(fullPath, results);
      } else if (stat.isFile()) {
        results.push(fullPath);
      }
    } catch {
      // Skip files we can't stat
    }
  }
}

/**
 * Simple glob matcher supporting * (single segment) and ** (any depth).
 */
function matchesAny(filePath: string, globs: string[]): boolean {
  return globs.some(glob => matchGlob(filePath, glob));
}

function matchGlob(filePath: string, glob: string): boolean {
  // Convert glob to regex
  // Handle **/ as "zero or more path segments"
  const regexStr = glob
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '(.*\\/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');

  return new RegExp(`^${regexStr}$`).test(filePath);
}

/**
 * Scan files for pattern violations.
 */
function scanFiles(
  files: string[],
  patterns: Array<{ pattern: string; message: string }>,
  repoRoot: string
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue; // Skip unreadable files
    }

    const lines = content.split('\n');
    const relPath = relative(repoRoot, file);

    for (const { pattern, message } of patterns) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'g');
      } catch {
        continue; // Skip invalid regex
      }

      for (let i = 0; i < lines.length; i++) {
        const lineMatches = lines[i].match(regex);
        if (lineMatches) {
          violations.push({
            file: relPath,
            line: i + 1,
            pattern,
            message,
            match: lineMatches[0],
          });
        }
      }
    }
  }

  return violations;
}
