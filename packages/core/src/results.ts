/**
 * Results log — the autoresearch-inspired TSV that accumulates
 * verification history in the repo.
 *
 * This is the "training data" that feeds back into agent prompts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ResultRow, VerifyResult } from './types.js';

const RESULTS_PATH = '.canductor/results.tsv';
const HEADER = 'ref\ttimestamp\tcomposite_score\tdecision\tlayer_scores\tstatus\tdescription';

/** Ensure the .canductor directory exists. */
function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, '.canductor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Read all result rows from the TSV log. */
export function readResults(repoRoot: string): ResultRow[] {
  const path = join(repoRoot, RESULTS_PATH);
  if (!existsSync(path)) return [];

  const lines = readFileSync(path, 'utf-8').trim().split('\n');
  if (lines.length <= 1) return []; // header only

  const rows: ResultRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue; // skip empty lines

    const fields = line.split('\t');
    if (fields.length !== 7) continue; // skip corrupted rows

    const [ref, timestamp, composite_score, decision, layer_scores, status, description] = fields;
    rows.push({
      ref,
      timestamp,
      composite_score: parseFloat(composite_score),
      decision,
      layer_scores,
      status: status as ResultRow['status'],
      description,
    });
  }
  return rows;
}

/** Append a verification result to the TSV log. */
export function appendResult(
  repoRoot: string,
  result: VerifyResult,
  status: ResultRow['status'],
  description: string
): void {
  ensureDir(repoRoot);
  const path = join(repoRoot, RESULTS_PATH);

  const layerScores = result.layers
    .map(l => `${l.name}:${l.score}`)
    .join(',');

  const row = [
    result.ref,
    result.timestamp,
    result.composite_score,
    result.decision,
    layerScores,
    status,
    description,
  ].join('\t');

  if (!existsSync(path)) {
    writeFileSync(path, HEADER + '\n' + row + '\n');
  } else {
    const content = readFileSync(path, 'utf-8');
    writeFileSync(path, content.trimEnd() + '\n' + row + '\n');
  }
}

/**
 * Update the status of a result row by ref.
 * If multiple rows share the same ref, updates the last match.
 * Returns true if a row was updated, false if ref not found.
 */
export function updateResultStatus(
  repoRoot: string,
  ref: string,
  newStatus: ResultRow['status']
): boolean {
  const path = join(repoRoot, RESULTS_PATH);
  if (!existsSync(path)) return false;

  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length <= 1) return false;

  // Find last matching row index (1-based, since index 0 is header)
  let lastMatchIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const columns = lines[i].split('\t');
    if (columns[0] === ref) {
      lastMatchIdx = i;
    }
  }

  if (lastMatchIdx === -1) return false;

  const columns = lines[lastMatchIdx].split('\t');
  columns[5] = newStatus; // status is the 6th column
  lines[lastMatchIdx] = columns.join('\t');

  writeFileSync(path, lines.join('\n') + '\n');
  return true;
}
