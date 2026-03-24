import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendTaskResult,
  readTaskResults,
  analyzeTaskTypes,
  getOptimizationTargets,
  resolveGuidedBy,
  summarizeTaskPerformance,
} from '../src/tasks.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-tasks-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('appendTaskResult', () => {
  it('creates tasks.tsv with header on first entry', () => {
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 1, '');

    const content = readFileSync(join(tempDir, '.canductor/tasks.tsv'), 'utf-8');
    expect(content).toContain('task_type\tguided_by');
    expect(content).toContain('test\t.claude/templates/test.md\t#42\t1\tnone');
  });

  it('appends multiple entries', () => {
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 1, 'vague assertions');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 2, '');
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#42', 1, '');

    const results = readTaskResults(tempDir);
    expect(results).toHaveLength(3);
    expect(results[0].failure).toBe('vague assertions');
    expect(results[1].failure).toBe('');
    expect(results[2].task_type).toBe('module');
  });
});

describe('readTaskResults', () => {
  it('returns empty array when no file exists', () => {
    expect(readTaskResults(tempDir)).toHaveLength(0);
  });

  it('parses all fields correctly', () => {
    appendTaskResult(tempDir, 'new-cli-command', '.claude/patterns/new-cli-command.md', '#43', 2, 'wrong import path');

    const results = readTaskResults(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].task_type).toBe('new-cli-command');
    expect(results[0].guided_by).toBe('.claude/patterns/new-cli-command.md');
    expect(results[0].ref).toBe('#43');
    expect(results[0].verify_cycle).toBe(2);
    expect(results[0].failure).toBe('wrong import path');
    expect(results[0].timestamp).toBeTruthy();
  });
});

describe('analyzeTaskTypes', () => {
  it('returns empty array when no results', () => {
    expect(analyzeTaskTypes(tempDir)).toHaveLength(0);
  });

  it('computes average cycles per task type', () => {
    // Story #42: test took 2 cycles
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 1, 'no error path');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 2, '');
    // Story #43: test took 1 cycle
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#43', 1, '');
    // Story #44: test took 3 cycles
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#44', 1, 'wrong mock');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#44', 2, 'missing assertion');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#44', 3, '');

    const analyses = analyzeTaskTypes(tempDir);
    expect(analyses).toHaveLength(1);
    expect(analyses[0].task_type).toBe('test');
    expect(analyses[0].avg_cycles).toBe(2); // (2 + 1 + 3) / 3
    expect(analyses[0].total_uses).toBe(3);
    expect(analyses[0].total_failures).toBe(3);
    expect(analyses[0].converged).toBe(false);
  });

  it('marks type as converged after 3 consecutive cycle-1 successes', () => {
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#42', 1, '');
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#43', 1, '');
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#44', 1, '');

    const analyses = analyzeTaskTypes(tempDir);
    expect(analyses[0].converged).toBe(true);
    expect(analyses[0].avg_cycles).toBe(1);
  });

  it('does not mark as converged if recent use had multiple cycles', () => {
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 1, '');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#43', 1, '');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#44', 1, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#44', 2, '');

    const analyses = analyzeTaskTypes(tempDir);
    expect(analyses[0].converged).toBe(false);
  });

  it('sorts by highest avg_cycles first', () => {
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#42', 1, '');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 1, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 2, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 3, '');

    const analyses = analyzeTaskTypes(tempDir);
    expect(analyses[0].task_type).toBe('test');
    expect(analyses[1].task_type).toBe('module');
  });
});

describe('getOptimizationTargets', () => {
  it('returns empty when all types are at 1 cycle', () => {
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#42', 1, '');
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#43', 1, '');
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#44', 1, '');

    expect(getOptimizationTargets(tempDir)).toHaveLength(0);
  });

  it('returns types with avg > 1 and 3+ uses', () => {
    // test: 3 uses, avg 2 cycles
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 1, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 2, '');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#43', 1, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#43', 2, '');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#44', 1, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#44', 2, '');

    // module: 3 uses, avg 1 cycle (should NOT be a target)
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#42', 1, '');
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#43', 1, '');
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#44', 1, '');

    const targets = getOptimizationTargets(tempDir);
    expect(targets).toHaveLength(1);
    expect(targets[0].task_type).toBe('test');
    expect(targets[0].avg_cycles).toBe(2);
    expect(targets[0].failures).toHaveLength(3);
  });

  it('excludes types with fewer than 3 uses', () => {
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 1, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 2, '');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#43', 1, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#43', 2, '');
    // Only 2 uses — not enough data

    expect(getOptimizationTargets(tempDir)).toHaveLength(0);
  });
});

describe('resolveGuidedBy', () => {
  it('finds pattern file', () => {
    mkdirSync(join(tempDir, '.claude/patterns'), { recursive: true });
    writeFileSync(join(tempDir, '.claude/patterns/new-cli-command.md'), '# Pattern');

    expect(resolveGuidedBy(tempDir, 'new-cli-command')).toBe('.claude/patterns/new-cli-command.md');
  });

  it('finds template file', () => {
    mkdirSync(join(tempDir, '.claude/templates'), { recursive: true });
    writeFileSync(join(tempDir, '.claude/templates/test.md'), '# Template');

    expect(resolveGuidedBy(tempDir, 'test')).toBe('.claude/templates/test.md');
  });

  it('prefers pattern over template', () => {
    mkdirSync(join(tempDir, '.claude/patterns'), { recursive: true });
    mkdirSync(join(tempDir, '.claude/templates'), { recursive: true });
    writeFileSync(join(tempDir, '.claude/patterns/test.md'), '# Pattern');
    writeFileSync(join(tempDir, '.claude/templates/test.md'), '# Template');

    expect(resolveGuidedBy(tempDir, 'test')).toBe('.claude/patterns/test.md');
  });

  it('returns null when no file exists', () => {
    expect(resolveGuidedBy(tempDir, 'nonexistent')).toBeNull();
  });
});

describe('summarizeTaskPerformance', () => {
  it('returns empty string when no results', () => {
    expect(summarizeTaskPerformance(tempDir)).toBe('');
  });

  it('shows performance summary with status', () => {
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 1, 'fail');
    appendTaskResult(tempDir, 'test', '.claude/templates/test.md', '#42', 2, '');
    appendTaskResult(tempDir, 'module', '.claude/templates/module.md', '#42', 1, '');

    const summary = summarizeTaskPerformance(tempDir);
    expect(summary).toContain('Task type performance');
    expect(summary).toContain('test');
    expect(summary).toContain('module');
    expect(summary).toContain('needs work');
    expect(summary).toContain('good');
  });
});
