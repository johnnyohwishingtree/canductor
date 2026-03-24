/**
 * Task tracking — tracks verify attempts per task type to optimize
 * the .claude/ files that guide agent implementation.
 *
 * Each story is broken into tasks (e.g., [module], [test], [new-cli-command]).
 * Each task type maps to a .claude/ file by name. When verification fails,
 * the failure is attributed to the task that caused it.
 *
 * Over time, task types with high average attempts signal that their
 * corresponding .claude/ file needs improvement.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const TASKS_PATH = '.canductor/tasks.tsv';
const HEADER = 'task_type\tguided_by\tref\tverify_cycle\tfailure\ttimestamp';

export interface TaskResult {
  task_type: string;
  guided_by: string;
  ref: string;
  verify_cycle: number;
  failure: string;
  timestamp: string;
}

export interface TaskTypeAnalysis {
  task_type: string;
  guided_by: string;
  total_uses: number;
  total_failures: number;
  avg_cycles: number;
  recent_failures: string[];
  converged: boolean;
}

export interface OptimizationTarget {
  task_type: string;
  guided_by: string;
  avg_cycles: number;
  total_uses: number;
  failures: string[];
}

/** Append a task result to the TSV log. */
export function appendTaskResult(
  repoRoot: string,
  taskType: string,
  guidedBy: string,
  ref: string,
  verifyCycle: number,
  failure: string,
): void {
  const fullPath = join(repoRoot, TASKS_PATH);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString();
  const row = [taskType, guidedBy, ref, verifyCycle, failure || 'none', timestamp].join('\t');

  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, HEADER + '\n' + row + '\n');
  } else {
    const content = readFileSync(fullPath, 'utf-8');
    writeFileSync(fullPath, content.trimEnd() + '\n' + row + '\n');
  }
}

/** Read all task results from the TSV log. */
export function readTaskResults(repoRoot: string): TaskResult[] {
  const fullPath = join(repoRoot, TASKS_PATH);
  if (!existsSync(fullPath)) return [];

  const lines = readFileSync(fullPath, 'utf-8').trim().split('\n');
  if (lines.length <= 1) return [];

  const results: TaskResult[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    if (fields.length < 6) continue;

    results.push({
      task_type: fields[0],
      guided_by: fields[1],
      ref: fields[2],
      verify_cycle: parseInt(fields[3]),
      failure: fields[4] === 'none' ? '' : fields[4],
      timestamp: fields[5],
    });
  }

  return results;
}

/**
 * Analyze task types — group results by type, compute average cycles
 * to success, identify which types are converged vs need optimization.
 */
export function analyzeTaskTypes(repoRoot: string): TaskTypeAnalysis[] {
  const results = readTaskResults(repoRoot);
  if (results.length === 0) return [];

  // Group by task_type
  const byType = new Map<string, TaskResult[]>();
  for (const r of results) {
    const existing = byType.get(r.task_type) ?? [];
    existing.push(r);
    byType.set(r.task_type, existing);
  }

  const analyses: TaskTypeAnalysis[] = [];

  for (const [taskType, typeResults] of byType) {
    // Group by ref to count cycles per story
    const byRef = new Map<string, TaskResult[]>();
    for (const r of typeResults) {
      const existing = byRef.get(r.ref) ?? [];
      existing.push(r);
      byRef.set(r.ref, existing);
    }

    // Max verify_cycle per ref = how many cycles that story needed for this task
    const cyclesPerRef: number[] = [];
    for (const refResults of byRef.values()) {
      const maxCycle = Math.max(...refResults.map(r => r.verify_cycle));
      cyclesPerRef.push(maxCycle);
    }

    const totalUses = cyclesPerRef.length;
    const avgCycles = cyclesPerRef.reduce((a, b) => a + b, 0) / totalUses;

    const failures = typeResults
      .filter(r => r.failure)
      .map(r => r.failure);

    // Converged = last 3 uses all at cycle 1
    const lastThree = cyclesPerRef.slice(-3);
    const converged = lastThree.length >= 3 && lastThree.every(c => c === 1);

    const guidedBy = typeResults[0].guided_by;

    analyses.push({
      task_type: taskType,
      guided_by: guidedBy,
      total_uses: totalUses,
      total_failures: failures.length,
      avg_cycles: Math.round(avgCycles * 10) / 10,
      recent_failures: failures.slice(-5),
      converged,
    });
  }

  // Sort: highest avg_cycles first (most room for improvement)
  analyses.sort((a, b) => b.avg_cycles - a.avg_cycles);
  return analyses;
}

/**
 * Get task types that need optimization: avg > 1 cycle, seen 3+ times,
 * not yet converged.
 */
export function getOptimizationTargets(repoRoot: string): OptimizationTarget[] {
  const analyses = analyzeTaskTypes(repoRoot);
  return analyses
    .filter(a => a.avg_cycles > 1 && a.total_uses >= 3 && !a.converged)
    .map(a => ({
      task_type: a.task_type,
      guided_by: a.guided_by,
      avg_cycles: a.avg_cycles,
      total_uses: a.total_uses,
      failures: a.recent_failures,
    }));
}

/**
 * Resolve the .claude/ file path for a task type name.
 * Checks patterns/ first, then templates/.
 * Returns the path if found, or null if no file exists.
 */
export function resolveGuidedBy(repoRoot: string, taskType: string): string | null {
  const candidates = [
    `.claude/patterns/${taskType}.md`,
    `.claude/templates/${taskType}.md`,
  ];
  for (const candidate of candidates) {
    if (existsSync(join(repoRoot, candidate))) return candidate;
  }
  return null;
}

/**
 * Generate a summary of task type performance for prompt injection.
 */
export function summarizeTaskPerformance(repoRoot: string): string {
  const analyses = analyzeTaskTypes(repoRoot);
  if (analyses.length === 0) return '';

  const lines: string[] = ['### Task type performance:'];

  for (const a of analyses) {
    const status = a.converged ? 'converged' : a.avg_cycles > 1 ? 'needs work' : 'good';
    lines.push(`- **${a.task_type}** (${a.guided_by}): avg ${a.avg_cycles} cycles, ${a.total_uses} uses — ${status}`);
    if (a.recent_failures.length > 0 && !a.converged) {
      lines.push(`  - Recent failures: ${a.recent_failures.slice(-2).join('; ')}`);
    }
  }

  return lines.join('\n');
}
