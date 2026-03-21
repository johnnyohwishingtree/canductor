import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { compareScreenshots, updateBaseline } from '../src/screenshot.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-screenshot-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Create a solid-color 10x10 PNG and write it to disk. */
function createPng(dir: string, filename: string, r: number, g: number, b: number): void {
  const width = 10;
  const height = 10;
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255; // alpha
    }
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), PNG.sync.write(png));
}

describe('compareScreenshots', () => {
  it('returns 0% diff and pass for identical PNGs', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    createPng(currentDir, 'screen1.png', 255, 0, 0);
    createPng(baselineDir, 'screen1.png', 255, 0, 0);

    const result = compareScreenshots(currentDir, baselineDir, 1);

    expect(result.pass).toBe(true);
    expect(result.overallDiffPercent).toBe(0);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0].status).toBe('match');
    expect(result.comparisons[0].diffPercent).toBe(0);
    expect(result.comparisons[0].filename).toBe('screen1.png');
  });

  it('detects pixel differences between modified PNGs', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    // Create a red image as baseline
    createPng(baselineDir, 'screen1.png', 255, 0, 0);
    // Create a blue image as current
    createPng(currentDir, 'screen1.png', 0, 0, 255);

    const result = compareScreenshots(currentDir, baselineDir, 1);

    expect(result.pass).toBe(false);
    expect(result.overallDiffPercent).toBeGreaterThan(0);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0].status).toBe('changed');
    expect(result.comparisons[0].diffPercent).toBeGreaterThan(0);
  });

  it('marks new files (no baseline) as "new" and passes', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    mkdirSync(baselineDir, { recursive: true });
    createPng(currentDir, 'brand-new.png', 0, 255, 0);

    const result = compareScreenshots(currentDir, baselineDir, 1);

    expect(result.pass).toBe(true);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0].status).toBe('new');
    expect(result.comparisons[0].filename).toBe('brand-new.png');
    // New files excluded from overallDiffPercent
    expect(result.overallDiffPercent).toBe(0);
  });

  it('marks removed files (in baseline, not in current) and fails', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    mkdirSync(currentDir, { recursive: true });
    createPng(baselineDir, 'old-screen.png', 128, 128, 128);

    const result = compareScreenshots(currentDir, baselineDir, 1);

    expect(result.pass).toBe(false);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0].status).toBe('removed');
    expect(result.comparisons[0].filename).toBe('old-screen.png');
  });

  it('handles mix of match, changed, new, and removed files', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    // Identical file (match)
    createPng(currentDir, 'a-same.png', 100, 100, 100);
    createPng(baselineDir, 'a-same.png', 100, 100, 100);

    // Changed file
    createPng(currentDir, 'b-changed.png', 255, 0, 0);
    createPng(baselineDir, 'b-changed.png', 0, 255, 0);

    // New file (only in current)
    createPng(currentDir, 'c-new.png', 50, 50, 50);

    // Removed file (only in baseline)
    createPng(baselineDir, 'd-removed.png', 200, 200, 200);

    const result = compareScreenshots(currentDir, baselineDir, 100);

    expect(result.comparisons).toHaveLength(4);

    const byFilename = new Map(result.comparisons.map(c => [c.filename, c]));
    expect(byFilename.get('a-same.png')!.status).toBe('match');
    expect(byFilename.get('b-changed.png')!.status).toBe('changed');
    expect(byFilename.get('c-new.png')!.status).toBe('new');
    expect(byFilename.get('d-removed.png')!.status).toBe('removed');

    // Fails because there is a removed file, even though threshold is generous
    expect(result.pass).toBe(false);
  });

  it('passes when diff is within threshold', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    // Create two images that are almost identical (1 pixel changed)
    createPng(baselineDir, 'screen.png', 100, 100, 100);

    // Create current with one pixel different
    const width = 10;
    const height = 10;
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (width * y + x) << 2;
        // First pixel is different, rest are the same
        if (x === 0 && y === 0) {
          png.data[idx] = 255;
          png.data[idx + 1] = 0;
          png.data[idx + 2] = 0;
        } else {
          png.data[idx] = 100;
          png.data[idx + 1] = 100;
          png.data[idx + 2] = 100;
        }
        png.data[idx + 3] = 255;
      }
    }
    mkdirSync(currentDir, { recursive: true });
    writeFileSync(join(currentDir, 'screen.png'), PNG.sync.write(png));

    // 1 pixel out of 100 = 1% diff, threshold = 5 → should pass
    const result = compareScreenshots(currentDir, baselineDir, 5);
    expect(result.pass).toBe(true);
    expect(result.overallDiffPercent).toBeGreaterThan(0);
    expect(result.overallDiffPercent).toBeLessThanOrEqual(5);
  });

  it('handles empty directories', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');
    mkdirSync(currentDir, { recursive: true });
    mkdirSync(baselineDir, { recursive: true });

    const result = compareScreenshots(currentDir, baselineDir, 1);

    expect(result.pass).toBe(true);
    expect(result.overallDiffPercent).toBe(0);
    expect(result.comparisons).toHaveLength(0);
  });

  it('includes summary in result', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    createPng(currentDir, 'screen.png', 255, 0, 0);
    createPng(baselineDir, 'screen.png', 255, 0, 0);

    const result = compareScreenshots(currentDir, baselineDir, 1);

    expect(result.summary).toContain('1 files compared');
    expect(result.summary).toContain('PASS');
  });
});

describe('updateBaseline', () => {
  it('copies all PNGs from current to baseline directory', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    createPng(currentDir, 'screen1.png', 255, 0, 0);
    createPng(currentDir, 'screen2.png', 0, 255, 0);

    updateBaseline(currentDir, baselineDir);

    expect(existsSync(join(baselineDir, 'screen1.png'))).toBe(true);
    expect(existsSync(join(baselineDir, 'screen2.png'))).toBe(true);

    // Verify content is identical
    const original = readFileSync(join(currentDir, 'screen1.png'));
    const copied = readFileSync(join(baselineDir, 'screen1.png'));
    expect(original.equals(copied)).toBe(true);
  });

  it('creates baseline directory if it does not exist', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'new-baseline');

    createPng(currentDir, 'screen.png', 128, 128, 128);

    expect(existsSync(baselineDir)).toBe(false);
    updateBaseline(currentDir, baselineDir);
    expect(existsSync(baselineDir)).toBe(true);
    expect(existsSync(join(baselineDir, 'screen.png'))).toBe(true);
  });

  it('replaces existing baseline files', () => {
    const currentDir = join(tempDir, 'current');
    const baselineDir = join(tempDir, 'baseline');

    // Create old baseline (red)
    createPng(baselineDir, 'screen.png', 255, 0, 0);
    // Create new current (blue)
    createPng(currentDir, 'screen.png', 0, 0, 255);

    updateBaseline(currentDir, baselineDir);

    // After update, baseline should match current
    const result = compareScreenshots(currentDir, baselineDir, 0);
    expect(result.overallDiffPercent).toBe(0);
    expect(result.comparisons[0].status).toBe('match');
  });
});
