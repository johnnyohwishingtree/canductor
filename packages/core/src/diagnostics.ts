/**
 * Diagnostics — aggregated pipeline health checks.
 *
 * Composes existing health signals (results, tasks, config, branches, findings)
 * into a single HealthReport for the CLI health command.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getStatus } from './results-query.js';
import type { PipelineStatus } from './results-query.js';
import { analyzeTaskTypes } from './tasks.js';
import type { TaskTypeAnalysis } from './tasks.js';
import { validateConfig } from './config.js';
import { listStaleBranches } from './clean.js';
import type { StaleBranch } from './clean.js';
import type { ConfigValidation, Finding } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FINDINGS_PATH = '.canductor/findings.tsv';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Aggregated pipeline health report. */
export interface HealthReport {
  status: PipelineStatus;
  taskPerformance: TaskTypeAnalysis[];
  configValidation: ConfigValidation;
  staleBranches: StaleBranch[];
  findings: Finding[];
}

/**
 * Read audit findings from `.canductor/findings.tsv`.
 *
 * @param repoRoot - Path to the repository root
 * @returns Array of findings, empty if the file does not exist
 */
export function readFindings(repoRoot: string): Finding[] {
  const fullPath = join(repoRoot, FINDINGS_PATH);
  if (!existsSync(fullPath)) return [];

  const content = readFileSync(fullPath, 'utf-8').trim();
  const lines = content.split('\n');
  if (lines.length <= 1) return [];

  const findings: Finding[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    if (fields.length < 5) continue;

    findings.push({
      category: fields[0],
      template: fields[1],
      finding: fields[2],
      ref: fields[3],
      timestamp: fields[4],
    });
  }

  return findings;
}

/**
 * Run a full health check by aggregating all pipeline health signals.
 *
 * @param repoRoot - Path to the repository root
 * @returns A complete HealthReport
 */
export function runHealthCheck(repoRoot: string): HealthReport {
  const status = getStatus(repoRoot);
  const taskPerformance = analyzeTaskTypes(repoRoot);
  const configValidation = validateConfig(repoRoot);
  const staleBranches = listStaleBranches(repoRoot);
  const findings = readFindings(repoRoot);

  return {
    status,
    taskPerformance,
    configValidation,
    staleBranches,
    findings,
  };
}
