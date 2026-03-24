import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFindings, resolveFindings, runHealthCheck } from '../src/diagnostics.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;
let parentDir: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: tempDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

beforeEach(() => {
  parentDir = mkdtempSync(join(tmpdir(), 'canductor-diagnostics-'));
  const bareDir = join(parentDir, 'bare.git');
  const workDir = join(parentDir, 'work');

  execSync(`git init --bare ${bareDir}`, { stdio: 'pipe' });
  execSync(`git clone ${bareDir} ${workDir}`, { stdio: 'pipe' });

  tempDir = workDir;

  git('config user.email "test@test.com"');
  git('config user.name "Test"');
  git('config commit.gpgsign false');
  git('config tag.gpgsign false');

  execSync('touch file.txt', { cwd: tempDir, stdio: 'pipe' });
  git('add file.txt');
  git('commit -m "initial"');
  git('push origin master');

  mkdirSync(join(tempDir, '.canductor'), { recursive: true });
});

afterEach(() => {
  rmSync(parentDir, { recursive: true, force: true });
});

/** Create a findings.tsv with given rows (5-column format). */
function writeFindingsTsv(rows: string[]): void {
  const header = 'category\ttemplate\tfinding\tref\ttimestamp';
  const content = [header, ...rows].join('\n') + '\n';
  writeFileSync(join(tempDir, '.canductor/findings.tsv'), content);
}

/** Create a findings.tsv with given rows (6-column format with resolved). */
function writeFindingsTsv6(rows: string[]): void {
  const header = 'category\ttemplate\tfinding\tref\ttimestamp\tresolved';
  const content = [header, ...rows].join('\n') + '\n';
  writeFileSync(join(tempDir, '.canductor/findings.tsv'), content);
}

/** Create a minimal config.yaml. */
function writeMinimalConfig(): void {
  const config = `version: 1
layers:
  tests:
    name: tests
    type: deterministic
    run: "echo ok"
    weight: 1.0
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`;
  writeFileSync(join(tempDir, '.canductor/config.yaml'), config);
}

/** Create a minimal results.tsv. */
function writeMinimalResults(): void {
  const header = 'ref\ttimestamp\tcomposite_score\tdecision\tlayer_scores\tstatus\tdescription';
  const row = '1\t2026-01-01T00:00:00Z\t95\tauto_merge\ttests:95\tmerged\tVerified 1';
  writeFileSync(join(tempDir, '.canductor/results.tsv'), header + '\n' + row + '\n');
}

// ---------------------------------------------------------------------------
// readFindings
// ---------------------------------------------------------------------------
describe('readFindings', () => {
  it('returns parsed findings from a valid 5-column TSV file', () => {
    writeFindingsTsv([
      'drift\tmodule.md\tMissing barrel export\t#100\t2026-01-01T00:00:00Z',
      'dead-code\tmodule.md\tUnused helper function\t#101\t2026-01-02T00:00:00Z',
    ]);

    const findings = readFindings(tempDir);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      category: 'drift',
      template: 'module.md',
      finding: 'Missing barrel export',
      ref: '#100',
      timestamp: '2026-01-01T00:00:00Z',
      resolved: false,
    });
    expect(findings[1].category).toBe('dead-code');
    expect(findings[1].resolved).toBe(false);
  });

  it('parses 6-column TSV with resolved field', () => {
    writeFindingsTsv6([
      'drift\tmodule.md\tMissing export\t#100\t2026-01-01T00:00:00Z\ttrue',
      'dead-code\tmodule.md\tUnused function\t#101\t2026-01-02T00:00:00Z\t',
    ]);

    const findings = readFindings(tempDir);

    expect(findings).toHaveLength(2);
    expect(findings[0].resolved).toBe(true);
    expect(findings[1].resolved).toBe(false);
  });

  it('filters active (unresolved) findings', () => {
    writeFindingsTsv6([
      'drift\tmodule.md\tActive finding\t#100\t2026-01-01T00:00:00Z\t',
      'drift\tmodule.md\tResolved finding\t#101\t2026-01-02T00:00:00Z\ttrue',
    ]);

    const findings = readFindings(tempDir, 'active');

    expect(findings).toHaveLength(1);
    expect(findings[0].finding).toBe('Active finding');
  });

  it('filters resolved findings', () => {
    writeFindingsTsv6([
      'drift\tmodule.md\tActive finding\t#100\t2026-01-01T00:00:00Z\t',
      'drift\tmodule.md\tResolved finding\t#101\t2026-01-02T00:00:00Z\ttrue',
    ]);

    const findings = readFindings(tempDir, 'resolved');

    expect(findings).toHaveLength(1);
    expect(findings[0].finding).toBe('Resolved finding');
  });

  it('returns all findings with filter "all" (default)', () => {
    writeFindingsTsv6([
      'drift\tmodule.md\tActive\t#100\t2026-01-01T00:00:00Z\t',
      'drift\tmodule.md\tResolved\t#101\t2026-01-02T00:00:00Z\ttrue',
    ]);

    const findings = readFindings(tempDir, 'all');

    expect(findings).toHaveLength(2);
  });

  it('returns empty array when findings.tsv does not exist', () => {
    // Use parentDir which has no .canductor
    const findings = readFindings(parentDir);

    expect(findings).toEqual([]);
  });

  it('returns empty array when file has only a header', () => {
    writeFindingsTsv([]);

    const findings = readFindings(tempDir);

    expect(findings).toEqual([]);
  });

  it('skips malformed rows with fewer than 5 fields', () => {
    writeFindingsTsv([
      'drift\tmodule.md\tMissing export\t#100\t2026-01-01T00:00:00Z',
      'bad\trow',
    ]);

    const findings = readFindings(tempDir);

    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('drift');
  });
});

// ---------------------------------------------------------------------------
// resolveFindings
// ---------------------------------------------------------------------------
describe('resolveFindings', () => {
  it('resolves findings at specific indices', () => {
    writeFindingsTsv([
      'drift\tmodule.md\tFinding A\t#100\t2026-01-01T00:00:00Z',
      'dead-code\tmodule.md\tFinding B\t#101\t2026-01-02T00:00:00Z',
      'drift\tmodule.md\tFinding C\t#102\t2026-01-03T00:00:00Z',
    ]);

    resolveFindings(tempDir, [0, 2]);

    const findings = readFindings(tempDir);
    expect(findings).toHaveLength(3);
    expect(findings[0].resolved).toBe(true);
    expect(findings[1].resolved).toBe(false);
    expect(findings[2].resolved).toBe(true);
  });

  it('resolves all findings when passed "all"', () => {
    writeFindingsTsv([
      'drift\tmodule.md\tFinding A\t#100\t2026-01-01T00:00:00Z',
      'dead-code\tmodule.md\tFinding B\t#101\t2026-01-02T00:00:00Z',
    ]);

    resolveFindings(tempDir, 'all');

    const findings = readFindings(tempDir);
    expect(findings).toHaveLength(2);
    expect(findings[0].resolved).toBe(true);
    expect(findings[1].resolved).toBe(true);
  });

  it('preserves existing resolved state for non-targeted indices', () => {
    writeFindingsTsv6([
      'drift\tmodule.md\tAlready resolved\t#100\t2026-01-01T00:00:00Z\ttrue',
      'drift\tmodule.md\tNot resolved\t#101\t2026-01-02T00:00:00Z\t',
    ]);

    resolveFindings(tempDir, [1]);

    const findings = readFindings(tempDir);
    expect(findings[0].resolved).toBe(true);
    expect(findings[1].resolved).toBe(true);
  });

  it('preserves TSV header and all columns', () => {
    writeFindingsTsv([
      'drift\tmodule.md\tFinding\t#100\t2026-01-01T00:00:00Z',
    ]);

    resolveFindings(tempDir, [0]);

    const raw = readFileSync(join(tempDir, '.canductor/findings.tsv'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines[0]).toContain('resolved');
    expect(lines[1].split('\t')).toHaveLength(6);
    expect(lines[1].split('\t')[5]).toBe('true');
  });

  it('does nothing when findings.tsv does not exist', () => {
    // Should not throw
    resolveFindings(parentDir, [0]);
  });
});

// ---------------------------------------------------------------------------
// runHealthCheck
// ---------------------------------------------------------------------------
describe('runHealthCheck', () => {
  it('returns a complete health report with all sections populated', () => {
    writeMinimalConfig();
    writeMinimalResults();

    const report = runHealthCheck(tempDir);

    expect(report.status).toBeDefined();
    expect(report.status.total).toBe(1);
    expect(report.status.merged).toBe(1);
    expect(report.configValidation).toBeDefined();
    expect(report.configValidation.valid).toBe(true);
    expect(Array.isArray(report.taskPerformance)).toBe(true);
    expect(Array.isArray(report.staleBranches)).toBe(true);
    expect(Array.isArray(report.findings)).toBe(true);
  });

  it('returns empty arrays and zero counts when repo has no data', () => {
    const report = runHealthCheck(tempDir);

    expect(report.status.total).toBe(0);
    expect(report.taskPerformance).toEqual([]);
    expect(report.configValidation.valid).toBe(false);
    expect(report.staleBranches).toEqual([]);
    expect(report.findings).toEqual([]);
  });

  it('includes findings when findings.tsv exists', () => {
    writeMinimalConfig();
    writeMinimalResults();
    writeFindingsTsv([
      'drift\tmodule.md\tMissing export\t#50\t2026-01-01T00:00:00Z',
    ]);

    const report = runHealthCheck(tempDir);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].finding).toBe('Missing export');
  });
});
