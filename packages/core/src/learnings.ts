/**
 * Learnings log — captures what went wrong during verification attempts
 * and how it was fixed. This is the persistent memory between sessions.
 *
 * Unlike results.tsv (scores), learnings.md captures the narrative:
 * what failed, why, and what the fix was. This is what makes the
 * autoresearch-style loop work — agents read past failures and avoid
 * repeating them.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const LEARNINGS_PATH = '.canductor/learnings.md';

export interface Learning {
  ref: string;
  attempt: number;
  timestamp: string;
  failure: string;
  fix: string;
}

/**
 * Append a learning entry when a verify attempt fails.
 * Called by the pipeline skill during the fix loop.
 */
export function appendLearning(
  repoRoot: string,
  ref: string,
  attempt: number,
  failure: string,
): void {
  const fullPath = join(repoRoot, LEARNINGS_PATH);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString();
  const entry = `### #${ref}, attempt ${attempt} (${timestamp})\n**Failed:** ${failure}\n\n`;

  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, `# Canductor Learnings\n\nWhat went wrong during verification and how it was fixed.\nThis file is read by \`canductor inject\` to prevent repeating mistakes.\n\n${entry}`);
  } else {
    const content = readFileSync(fullPath, 'utf-8');
    writeFileSync(fullPath, content.trimEnd() + '\n\n' + entry);
  }
}

/**
 * Record the fix that resolved a failure.
 * Called after the agent fixes the issue and verify passes.
 */
export function recordFix(
  repoRoot: string,
  ref: string,
  attempt: number,
  fix: string,
): void {
  const fullPath = join(repoRoot, LEARNINGS_PATH);
  if (!existsSync(fullPath)) return;

  const content = readFileSync(fullPath, 'utf-8');
  const marker = `### #${ref}, attempt ${attempt}`;
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return;

  // Find end of the failure block and append the fix
  const afterMarker = content.substring(idx);
  const nextEntry = afterMarker.indexOf('\n### ', 1);
  const insertPoint = nextEntry !== -1
    ? idx + nextEntry
    : content.length;

  const fixBlock = `**Fix:** ${fix}\n`;
  const updated = content.substring(0, insertPoint).trimEnd() + '\n' + fixBlock + '\n' + content.substring(insertPoint);
  writeFileSync(fullPath, updated);
}

/**
 * Read all learnings and return them as structured data.
 */
export function readLearnings(repoRoot: string): Learning[] {
  const fullPath = join(repoRoot, LEARNINGS_PATH);
  if (!existsSync(fullPath)) return [];

  const content = readFileSync(fullPath, 'utf-8');
  const entries = content.split(/(?=### #)/);
  const learnings: Learning[] = [];

  for (const entry of entries) {
    const headerMatch = entry.match(/^### #(.+?), attempt (\d+) \((.+?)\)/);
    if (!headerMatch) continue;

    const failureMatch = entry.match(/\*\*Failed:\*\* (.+?)(?:\n|$)/);
    const fixMatch = entry.match(/\*\*Fix:\*\* (.+?)(?:\n|$)/);

    learnings.push({
      ref: headerMatch[1],
      attempt: parseInt(headerMatch[2]),
      timestamp: headerMatch[3],
      failure: failureMatch?.[1] ?? '',
      fix: fixMatch?.[1] ?? '',
    });
  }

  return learnings;
}

/**
 * Summarize learnings into actionable patterns for prompt injection.
 * Groups similar failures and extracts the lessons.
 */
export function summarizeLearnings(repoRoot: string): string {
  const learnings = readLearnings(repoRoot);
  if (learnings.length === 0) return '';

  // Group failures by pattern (simple keyword matching)
  const patterns = new Map<string, { count: number; examples: string[]; fixes: string[] }>();

  const categorize = (failure: string): string => {
    const lower = failure.toLowerCase();
    if (lower.includes('coverage') || lower.includes('no tests') || lower.includes('test coverage')) return 'missing-tests';
    if (lower.includes('typecheck') || lower.includes('error ts') || lower.includes('type error')) return 'type-errors';
    if (lower.includes('unused') || lower.includes('import')) return 'unused-code';
    if (lower.includes('export') || lower.includes('index.ts') || lower.includes('barrel')) return 'missing-exports';
    if (lower.includes('lint') || lower.includes('eslint')) return 'lint-errors';
    if (lower.includes('build') || lower.includes('bundle') || lower.includes('compile')) return 'build-errors';
    return 'other';
  };

  for (const l of learnings) {
    if (!l.failure) continue;
    const category = categorize(l.failure);
    const existing = patterns.get(category) ?? { count: 0, examples: [], fixes: [] };
    existing.count++;
    if (existing.examples.length < 2) existing.examples.push(`#${l.ref}: ${l.failure}`);
    if (l.fix && existing.fixes.length < 2) existing.fixes.push(l.fix);
    patterns.set(category, existing);
  }

  const lines: string[] = ['### Learnings from past failures:'];

  // Sort by count descending — most common failures first
  const sorted = [...patterns.entries()].sort((a, b) => b[1].count - a[1].count);

  for (const [category, data] of sorted) {
    if (data.count < 1) continue;

    const label = category.replace('-', ' ');
    lines.push(`- **${label}** (${data.count}x): ${data.examples[0]}`);
    if (data.fixes.length > 0) {
      lines.push(`  - Fix: ${data.fixes[0]}`);
    }
  }

  return lines.join('\n');
}
