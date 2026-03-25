/**
 * Reflections — parses .canductor/reflections.md to extract
 * per-task implementation reflections written by the pipeline.
 *
 * Each reflection captures what the template covered, what was missing,
 * and where the agent found guidance instead. This feeds /optimize.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REFLECTIONS_PATH = '.canductor/reflections.md';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskReflection {
  taskType: string;
  description: string;
  followed: string;
  covered: string;
  missing: string;
  foundElsewhere: string;
  issuesDuringVerify: string;
}

export interface Reflection {
  ref: string;
  timestamp: string;
  tasks: TaskReflection[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse all reflections from .canductor/reflections.md.
 * Returns empty array if file doesn't exist or is empty.
 */
export function parseReflections(repoRoot: string): Reflection[] {
  const fullPath = join(repoRoot, REFLECTIONS_PATH);
  if (!existsSync(fullPath)) return [];

  const content = readFileSync(fullPath, 'utf-8');
  if (!content.trim()) return [];

  const reflections: Reflection[] = [];
  const storyBlocks = content.split(/(?=^## #)/m);

  for (const block of storyBlocks) {
    const headerMatch = block.match(/^## #(\S+)\s*—\s*(\S+)/);
    if (!headerMatch) continue;

    const ref = headerMatch[1];
    const timestamp = headerMatch[2];
    const tasks: TaskReflection[] = [];

    const taskBlocks = block.split(/(?=^### \[)/m);
    for (const taskBlock of taskBlocks) {
      const taskMatch = taskBlock.match(/^### \[([^\]]+)\]\s*(.*)/);
      if (!taskMatch) continue;

      tasks.push({
        taskType: taskMatch[1],
        description: taskMatch[2].trim(),
        followed: extractField(taskBlock, 'Followed'),
        covered: extractField(taskBlock, 'Covered'),
        missing: extractField(taskBlock, 'Missing from template'),
        foundElsewhere: extractField(taskBlock, 'Found elsewhere'),
        issuesDuringVerify: extractField(taskBlock, 'Issues during verify'),
      });
    }

    if (tasks.length > 0) {
      reflections.push({ ref, timestamp, tasks });
    }
  }

  return reflections;
}

/**
 * Filter reflections to a specific story ref.
 */
export function filterByRef(reflections: Reflection[], ref: string): Reflection[] {
  return reflections.filter(r => r.ref === ref);
}

/**
 * Filter to only tasks where "Missing from template" has real content.
 * Excludes "none", "No gaps", empty, etc.
 */
export function filterGapsOnly(reflections: Reflection[]): Reflection[] {
  const isRealGap = (missing: string): boolean => {
    const lower = missing.toLowerCase().trim();
    if (lower === '' || lower === 'none' || lower === 'n/a') return false;
    if (lower.startsWith('no gaps')) return false;
    return true;
  };

  return reflections
    .map(r => ({
      ...r,
      tasks: r.tasks.filter(t => isRealGap(t.missing)),
    }))
    .filter(r => r.tasks.length > 0);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract a **Bold:** field value from a markdown block. */
function extractField(block: string, fieldName: string): string {
  const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+?)(?:\\n|$)`);
  const match = block.match(pattern);
  return match?.[1]?.trim() ?? '';
}
