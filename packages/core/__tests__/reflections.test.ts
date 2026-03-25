import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseReflections, filterByRef, filterGapsOnly } from '../src/reflections.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-reflections-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeReflections(content: string): void {
  const dir = join(tempDir, '.canductor');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'reflections.md'), content);
}

const SAMPLE = `# Reflections

## #160 — 2026-03-24T16:30:00Z

### [test] analytics-diagnostics.test.ts
**Followed:** .canductor/templates/test.md
**Covered:** test structure, describe blocks
**Missing from template:** how to mock execFileSync for CLI commands
**Found elsewhere:** packages/core/__tests__/guardrail.test.ts line 15
**Issues during verify:** none

### [module] analytics-diagnostics.ts
**Followed:** .canductor/templates/module.md
**Covered:** module structure, imports, exports
**Missing from template:** No gaps
**Found elsewhere:** none
**Issues during verify:** none

## #165 — 2026-03-24T18:00:00Z

### [test] utility.test.ts
**Followed:** .canductor/templates/test.md
**Covered:** basic test structure
**Missing from template:** async test patterns for commands that spawn processes
**Found elsewhere:** packages/cli/__tests__/cli.test.ts
**Issues during verify:** typecheck failed on missing import, fixed inline
`;

describe('parseReflections', () => {
  it('returns empty array when file does not exist', () => {
    expect(parseReflections(tempDir)).toHaveLength(0);
  });

  it('returns empty array for empty file', () => {
    writeReflections('');
    expect(parseReflections(tempDir)).toHaveLength(0);
  });

  it('parses multiple reflections with tasks', () => {
    writeReflections(SAMPLE);
    const reflections = parseReflections(tempDir);

    expect(reflections).toHaveLength(2);
    expect(reflections[0].ref).toBe('160');
    expect(reflections[0].timestamp).toBe('2026-03-24T16:30:00Z');
    expect(reflections[0].tasks).toHaveLength(2);
    expect(reflections[1].ref).toBe('165');
    expect(reflections[1].tasks).toHaveLength(1);
  });

  it('extracts task fields correctly', () => {
    writeReflections(SAMPLE);
    const task = parseReflections(tempDir)[0].tasks[0];

    expect(task.taskType).toBe('test');
    expect(task.description).toBe('analytics-diagnostics.test.ts');
    expect(task.followed).toBe('.canductor/templates/test.md');
    expect(task.covered).toBe('test structure, describe blocks');
    expect(task.missing).toBe('how to mock execFileSync for CLI commands');
    expect(task.foundElsewhere).toBe('packages/core/__tests__/guardrail.test.ts line 15');
    expect(task.issuesDuringVerify).toBe('none');
  });

  it('handles "No gaps" in missing field', () => {
    writeReflections(SAMPLE);
    const moduleTask = parseReflections(tempDir)[0].tasks[1];

    expect(moduleTask.taskType).toBe('module');
    expect(moduleTask.missing).toBe('No gaps');
  });
});

describe('filterByRef', () => {
  it('filters to matching ref', () => {
    writeReflections(SAMPLE);
    const all = parseReflections(tempDir);
    const filtered = filterByRef(all, '160');

    expect(filtered).toHaveLength(1);
    expect(filtered[0].ref).toBe('160');
  });

  it('returns empty for non-existent ref', () => {
    writeReflections(SAMPLE);
    const all = parseReflections(tempDir);
    expect(filterByRef(all, '999')).toHaveLength(0);
  });
});

describe('filterGapsOnly', () => {
  it('returns only tasks with real missing content', () => {
    writeReflections(SAMPLE);
    const all = parseReflections(tempDir);
    const gaps = filterGapsOnly(all);

    // #160 has 1 gap (test task), #165 has 1 gap (test task)
    // #160's module task has "No gaps" — excluded
    expect(gaps).toHaveLength(2);
    expect(gaps[0].tasks).toHaveLength(1);
    expect(gaps[0].tasks[0].taskType).toBe('test');
    expect(gaps[1].tasks).toHaveLength(1);
  });

  it('returns empty when no gaps exist', () => {
    writeReflections(`# Reflections

## #100 — 2026-03-24T10:00:00Z

### [module] clean.ts
**Followed:** .canductor/templates/module.md
**Covered:** everything
**Missing from template:** No gaps
**Found elsewhere:** none
**Issues during verify:** none
`);
    const all = parseReflections(tempDir);
    expect(filterGapsOnly(all)).toHaveLength(0);
  });
});
