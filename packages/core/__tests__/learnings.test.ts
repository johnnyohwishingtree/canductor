import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
});
