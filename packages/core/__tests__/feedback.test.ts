import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { injectContext, suggestRuleImprovements } from '../src/feedback.js';
import { appendResult } from '../src/results.js';
import type { VerifyResult } from '../src/types.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-feedback-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeVerifyResult(ref: string, score: number, pass: boolean): VerifyResult {
  return {
    ref,
    timestamp: '2026-03-21T00:00:00Z',
    layers: [
      { name: 'tests', type: 'deterministic', pass, score: pass ? 100 : 0, errors: '', duration_ms: 100 },
      { name: 'ux', type: 'agent-review', pass: true, score, errors: '', duration_ms: 200 },
    ],
    composite_score: score,
    decision: pass ? 'auto_merge' : 'block',
    summary: '',
  };
}

describe('injectContext', () => {
  it('replaces content between existing markers', () => {
    // Seed some results for context
    appendResult(tempDir, makeVerifyResult('#1', 90, true), 'merged', 'good PR');

    const targetFile = join(tempDir, 'CLAUDE.md');
    writeFileSync(targetFile, [
      '# My Project',
      '',
      '<!-- canductor:start -->',
      'old context here',
      '<!-- canductor:end -->',
      '',
      '## Other stuff',
    ].join('\n'));

    const modified = injectContext(tempDir, targetFile);

    expect(modified).toBe(true);

    const content = readFileSync(targetFile, 'utf-8');
    expect(content).toContain('<!-- canductor:start -->');
    expect(content).toContain('<!-- canductor:end -->');
    expect(content).not.toContain('old context here');
    expect(content).toContain('Canductor Quality Context');
    // Preserve surrounding content
    expect(content).toContain('# My Project');
    expect(content).toContain('## Other stuff');
  });

  it('appends block with markers when no markers exist', () => {
    appendResult(tempDir, makeVerifyResult('#1', 85, true), 'merged', 'first PR');

    const targetFile = join(tempDir, 'CLAUDE.md');
    writeFileSync(targetFile, '# My Project\n\nSome existing content.\n');

    const modified = injectContext(tempDir, targetFile);

    expect(modified).toBe(true);

    const content = readFileSync(targetFile, 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Some existing content.');
    expect(content).toContain('<!-- canductor:start -->');
    expect(content).toContain('<!-- canductor:end -->');
    expect(content).toContain('Canductor Quality Context');
  });

  it('returns false when file content does not change', () => {
    // No results → minimal context
    const targetFile = join(tempDir, 'CLAUDE.md');

    // First inject
    const firstModified = injectContext(tempDir, targetFile);
    expect(firstModified).toBe(true);

    // Second inject with same data should produce same content
    const secondModified = injectContext(tempDir, targetFile);
    expect(secondModified).toBe(false);
  });

  it('creates the file if it does not exist', () => {
    const targetFile = join(tempDir, 'NEW_FILE.md');

    const modified = injectContext(tempDir, targetFile);

    expect(modified).toBe(true);
    const content = readFileSync(targetFile, 'utf-8');
    expect(content).toContain('<!-- canductor:start -->');
    expect(content).toContain('<!-- canductor:end -->');
  });
});

describe('suggestRuleImprovements', () => {
  it('generates suggestions for recurring issues', () => {
    // Create multiple rejected PRs with the same failing layer
    appendResult(tempDir, makeVerifyResult('#1', 40, false), 'rejected', 'bad ux 1');
    appendResult(tempDir, makeVerifyResult('#2', 35, false), 'rejected', 'bad ux 2');
    appendResult(tempDir, makeVerifyResult('#3', 30, false), 'rejected', 'bad ux 3');

    const improvements = suggestRuleImprovements(tempDir);

    expect(improvements.length).toBeGreaterThan(0);

    // Should have suggestions for failing layers
    const addRules = improvements.filter(i => i.type === 'add_rule');
    expect(addRules.length).toBeGreaterThan(0);

    // Each improvement should have required fields
    for (const imp of improvements) {
      expect(imp.type).toBeDefined();
      expect(imp.description).toBeTruthy();
      expect(imp.content).toBeTruthy();
      expect(imp.confidence).toBeGreaterThan(0);
      expect(imp.confidence).toBeLessThanOrEqual(1);
    }

    // Should reference the failing layers
    const descriptions = improvements.map(i => i.description).join(' ');
    expect(descriptions).toContain('tests');
  });

  it('returns empty array when no history exists', () => {
    const improvements = suggestRuleImprovements(tempDir);
    expect(improvements).toHaveLength(0);
  });

  it('returns empty array when all results pass', () => {
    appendResult(tempDir, makeVerifyResult('#1', 95, true), 'merged', 'great');
    appendResult(tempDir, makeVerifyResult('#2', 90, true), 'merged', 'good');

    const improvements = suggestRuleImprovements(tempDir);
    expect(improvements).toHaveLength(0);
  });

  it('suggests baseline update when scores drift', () => {
    // Build up a baseline with older results
    for (let i = 1; i <= 5; i++) {
      appendResult(tempDir, makeVerifyResult(`#${i}`, 60, true), 'merged', `pr ${i}`);
    }
    // Add newer, much higher scores
    for (let i = 6; i <= 8; i++) {
      appendResult(tempDir, makeVerifyResult(`#${i}`, 95, true), 'merged', `pr ${i}`);
    }

    const improvements = suggestRuleImprovements(tempDir);
    const baselineUpdates = improvements.filter(i => i.type === 'update_baseline');
    expect(baselineUpdates.length).toBeGreaterThan(0);
  });
});
