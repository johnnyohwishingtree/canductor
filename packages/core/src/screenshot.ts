/**
 * Screenshot comparison — pixel-level diff between current and baseline PNGs.
 *
 * Uses pixelmatch for pixel comparison and pngjs for PNG I/O.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** Result of comparing all screenshots in two directories. */
export interface ScreenshotDiffResult {
  pass: boolean;
  overallDiffPercent: number;
  comparisons: Array<{
    filename: string;
    diffPercent: number;
    status: 'match' | 'changed' | 'new' | 'removed';
  }>;
  summary: string;
}

/** List all .png files in a directory (non-recursive). */
function listPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).sort();
}

/**
 * Compare screenshots in currentDir against a baseline directory.
 *
 * @param currentDir   Directory containing current screenshots
 * @param baselineDir  Directory containing baseline screenshots
 * @param threshold    Maximum allowed overall diff percentage (0-100)
 * @returns Comparison result with per-file and overall metrics
 */
export function compareScreenshots(
  currentDir: string,
  baselineDir: string,
  threshold: number,
): ScreenshotDiffResult {
  const currentFiles = listPngs(currentDir);
  const baselineFiles = listPngs(baselineDir);

  const currentSet = new Set(currentFiles);
  const baselineSet = new Set(baselineFiles);

  const comparisons: ScreenshotDiffResult['comparisons'] = [];

  // Compare files present in current directory
  for (const filename of currentFiles) {
    if (!baselineSet.has(filename)) {
      // New file — no baseline to compare against
      comparisons.push({ filename, diffPercent: 0, status: 'new' });
      continue;
    }

    // Both files exist — do pixel comparison
    const currentPng = PNG.sync.read(readFileSync(join(currentDir, filename)));
    const baselinePng = PNG.sync.read(readFileSync(join(baselineDir, filename)));

    const { width, height } = currentPng;
    const totalPixels = width * height;

    if (totalPixels === 0) {
      comparisons.push({ filename, diffPercent: 0, status: 'match' });
      continue;
    }

    // If dimensions differ, treat as 100% different
    if (width !== baselinePng.width || height !== baselinePng.height) {
      comparisons.push({ filename, diffPercent: 100, status: 'changed' });
      continue;
    }

    const diffPixels = pixelmatch(
      currentPng.data,
      baselinePng.data,
      undefined,
      width,
      height,
      { threshold: 0.1 },
    );

    const diffPercent = (diffPixels / totalPixels) * 100;
    comparisons.push({
      filename,
      diffPercent,
      status: diffPercent === 0 ? 'match' : 'changed',
    });
  }

  // Files in baseline but not in current — removed
  for (const filename of baselineFiles) {
    if (!currentSet.has(filename)) {
      comparisons.push({ filename, diffPercent: 0, status: 'removed' });
    }
  }

  // Compute overall diff (average of files that have both current and baseline)
  const comparableFiles = comparisons.filter(
    c => c.status === 'match' || c.status === 'changed',
  );
  const overallDiffPercent =
    comparableFiles.length > 0
      ? comparableFiles.reduce((sum, c) => sum + c.diffPercent, 0) / comparableFiles.length
      : 0;

  // Pass conditions: overall diff within threshold AND no removed files
  const hasRemovedFiles = comparisons.some(c => c.status === 'removed');
  const pass = overallDiffPercent <= threshold && !hasRemovedFiles;

  // Build summary
  const summaryParts: string[] = [];
  const matchCount = comparisons.filter(c => c.status === 'match').length;
  const changedCount = comparisons.filter(c => c.status === 'changed').length;
  const newCount = comparisons.filter(c => c.status === 'new').length;
  const removedCount = comparisons.filter(c => c.status === 'removed').length;

  summaryParts.push(`${comparisons.length} files compared`);
  if (matchCount > 0) summaryParts.push(`${matchCount} match`);
  if (changedCount > 0) summaryParts.push(`${changedCount} changed`);
  if (newCount > 0) summaryParts.push(`${newCount} new`);
  if (removedCount > 0) summaryParts.push(`${removedCount} removed`);
  summaryParts.push(`overall diff: ${overallDiffPercent.toFixed(2)}%`);
  summaryParts.push(pass ? 'PASS' : 'FAIL');

  return {
    pass,
    overallDiffPercent,
    comparisons,
    summary: summaryParts.join(', '),
  };
}

/**
 * Update baseline by copying all PNGs from currentDir to baselineDir.
 * Creates baselineDir if it does not exist. Replaces existing files.
 */
export function updateBaseline(currentDir: string, baselineDir: string): void {
  if (!existsSync(baselineDir)) {
    mkdirSync(baselineDir, { recursive: true });
  }

  const pngs = listPngs(currentDir);
  for (const filename of pngs) {
    copyFileSync(join(currentDir, filename), join(baselineDir, filename));
  }
}
