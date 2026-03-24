import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendLearning, recordFix, readLearnings, summarizeLearnings } from '../src/learnings.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-learnings-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('appendLearning', () => {
  it('creates learnings.md with header on first entry', () => {
    appendLearning(tempDir, '42', 1, 'typecheck error: unused import on line 5');

    const content = readFileSync(join(tempDir, '.canductor/learnings.md'), 'utf-8');
    expect(content).toContain('# Canductor Learnings');
    expect(content).toContain('### #42, attempt 1');
    expect(content).toContain('**Failed:** typecheck error: unused import on line 5');
  });

  it('appends to existing file', () => {
    appendLearning(tempDir, '42', 1, 'tests failed');
    appendLearning(tempDir, '42', 2, 'coverage dropped');

    const content = readFileSync(join(tempDir, '.canductor/learnings.md'), 'utf-8');
    expect(content).toContain('### #42, attempt 1');
    expect(content).toContain('### #42, attempt 2');
  });
});

describe('recordFix', () => {
  it('appends fix to the matching failure entry', () => {
    appendLearning(tempDir, '42', 1, 'no tests for export.ts');
    recordFix(tempDir, '42', 1, 'added export.test.ts with 6 tests');

    const content = readFileSync(join(tempDir, '.canductor/learnings.md'), 'utf-8');
    expect(content).toContain('**Failed:** no tests for export.ts');
    expect(content).toContain('**Fix:** added export.test.ts with 6 tests');
  });

  it('does nothing if learnings file does not exist', () => {
    recordFix(tempDir, '42', 1, 'some fix');
    // Should not throw or create the file
    expect(() => readFileSync(join(tempDir, '.canductor/learnings.md'))).toThrow();
  });
});

describe('readLearnings', () => {
  it('returns empty array when no file exists', () => {
    expect(readLearnings(tempDir)).toHaveLength(0);
  });

  it('parses learnings with failures and fixes', () => {
    appendLearning(tempDir, '42', 1, 'tests failed');
    recordFix(tempDir, '42', 1, 'fixed the assertion');
    appendLearning(tempDir, '43', 1, 'coverage dropped 5%');

    const learnings = readLearnings(tempDir);
    expect(learnings).toHaveLength(2);

    expect(learnings[0].ref).toBe('42');
    expect(learnings[0].attempt).toBe(1);
    expect(learnings[0].failure).toBe('tests failed');
    expect(learnings[0].fix).toBe('fixed the assertion');

    expect(learnings[1].ref).toBe('43');
    expect(learnings[1].failure).toBe('coverage dropped 5%');
    expect(learnings[1].fix).toBe('');
  });
});

describe('summarizeLearnings', () => {
  it('returns empty string when no learnings', () => {
    expect(summarizeLearnings(tempDir)).toBe('');
  });

  it('groups failures by category', () => {
    appendLearning(tempDir, '42', 1, 'no tests for new module export.ts');
    recordFix(tempDir, '42', 1, 'added export.test.ts');
    appendLearning(tempDir, '43', 1, 'test coverage dropped from 87% to 83%');
    recordFix(tempDir, '43', 1, 'added missing tests for all new functions');
    appendLearning(tempDir, '44', 1, 'typecheck error TS2304 on line 15');

    const summary = summarizeLearnings(tempDir);
    expect(summary).toContain('Learnings from past failures');
    expect(summary).toContain('missing tests');
    expect(summary).toContain('type errors');
  });

  it('includes fix suggestions from past fixes', () => {
    appendLearning(tempDir, '42', 1, 'new file had no tests, coverage dropped');
    recordFix(tempDir, '42', 1, 'always add a test file when creating a new module');

    const summary = summarizeLearnings(tempDir);
    expect(summary).toContain('Fix:');
    expect(summary).toContain('always add a test file');
  });

  it('categorizes build and lint failures correctly', () => {
    appendLearning(tempDir, '50', 1, 'build failed: cannot find module');
    appendLearning(tempDir, '51', 1, 'eslint found 3 errors');
    appendLearning(tempDir, '52', 1, 'lint errors in config.ts');

    const summary = summarizeLearnings(tempDir);
    expect(summary).toContain('build errors');
    expect(summary).toContain('lint errors');
  });

  it('puts all entries in other category when none match known patterns', () => {
    appendLearning(tempDir, '50', 1, 'flaky network timeout');
    appendLearning(tempDir, '51', 1, 'disk space ran out');

    const summary = summarizeLearnings(tempDir);
    expect(summary).toContain('other');
    expect(summary).toContain('flaky network timeout');
  });
});

describe('appendLearning edge cases', () => {
  it('preserves multiple entries for same ref with different attempts', () => {
    appendLearning(tempDir, '55', 1, 'first failure');
    appendLearning(tempDir, '55', 2, 'second failure');
    appendLearning(tempDir, '55', 3, 'third failure');

    const learnings = readLearnings(tempDir);
    const refEntries = learnings.filter(l => l.ref === '55');
    expect(refEntries).toHaveLength(3);
    expect(refEntries[0].attempt).toBe(1);
    expect(refEntries[1].attempt).toBe(2);
    expect(refEntries[2].attempt).toBe(3);
  });

  it('handles empty failure string gracefully', () => {
    appendLearning(tempDir, '56', 1, '');

    const content = readFileSync(join(tempDir, '.canductor/learnings.md'), 'utf-8');
    expect(content).toContain('### #56, attempt 1');
    expect(content).toContain('**Failed:** ');

    const learnings = readLearnings(tempDir);
    expect(learnings).toHaveLength(1);
    expect(learnings[0].failure).toBe('');
  });
});

describe('recordFix edge cases', () => {
  it('is a no-op when ref/attempt does not exist in the file', () => {
    appendLearning(tempDir, '42', 1, 'some failure');
    const before = readFileSync(join(tempDir, '.canductor/learnings.md'), 'utf-8');

    recordFix(tempDir, '99', 1, 'fix for nonexistent ref');

    const after = readFileSync(join(tempDir, '.canductor/learnings.md'), 'utf-8');
    expect(after).toBe(before);
  });

  it('inserts fix between two adjacent failure entries without corrupting either', () => {
    appendLearning(tempDir, '60', 1, 'first failure');
    appendLearning(tempDir, '60', 2, 'second failure');
    recordFix(tempDir, '60', 1, 'fixed the first issue');

    const content = readFileSync(join(tempDir, '.canductor/learnings.md'), 'utf-8');

    // Fix should appear after the first failure
    const fixIdx = content.indexOf('**Fix:** fixed the first issue');
    const firstFailIdx = content.indexOf('**Failed:** first failure');
    const secondEntryIdx = content.indexOf('### #60, attempt 2');

    expect(fixIdx).toBeGreaterThan(firstFailIdx);
    expect(fixIdx).toBeLessThan(secondEntryIdx);

    // Second entry should still be intact
    expect(content).toContain('**Failed:** second failure');

    // Both entries should still parse correctly
    const learnings = readLearnings(tempDir);
    expect(learnings).toHaveLength(2);
    expect(learnings[0].fix).toBe('fixed the first issue');
    expect(learnings[1].failure).toBe('second failure');
  });
});

describe('readLearnings edge cases', () => {
  it('returns empty array for a file with only the header', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'learnings.md'), '# Canductor Learnings\n\nWhat went wrong.\n');

    const learnings = readLearnings(tempDir);
    expect(learnings).toHaveLength(0);
  });

  it('returns empty array for a file containing only whitespace', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'learnings.md'), '   \n\n  \n');

    const learnings = readLearnings(tempDir);
    expect(learnings).toHaveLength(0);
  });

  it('skips malformed entries missing attempt number', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'learnings.md'), [
      '# Canductor Learnings',
      '',
      '### #42, attempt 1 (2026-01-01T00:00:00Z)',
      '**Failed:** valid failure',
      '',
      '### #43 (2026-01-02T00:00:00Z)',
      '**Failed:** missing attempt number',
      '',
      '### #44, attempt 2 (2026-01-03T00:00:00Z)',
      '**Failed:** another valid failure',
    ].join('\n'));

    const learnings = readLearnings(tempDir);
    expect(learnings).toHaveLength(2);
    expect(learnings[0].ref).toBe('42');
    expect(learnings[1].ref).toBe('44');
  });

  it('skips entries missing Failed marker', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'learnings.md'), [
      '# Canductor Learnings',
      '',
      '### #42, attempt 1 (2026-01-01T00:00:00Z)',
      '**Failed:** valid failure',
      '',
      '### #43, attempt 1 (2026-01-02T00:00:00Z)',
      'Some random text without failed marker',
      '',
      '### #44, attempt 1 (2026-01-03T00:00:00Z)',
      '**Failed:** also valid',
    ].join('\n'));

    const learnings = readLearnings(tempDir);
    // Entry #43 parses but with empty failure since regex doesn't match
    expect(learnings).toHaveLength(3);
    expect(learnings[0].failure).toBe('valid failure');
    expect(learnings[1].failure).toBe('');
    expect(learnings[2].failure).toBe('also valid');
  });
});
