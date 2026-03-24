import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { readFindings, runHealthCheck } from '../src/diagnostics.js';

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

/** Create a findings.tsv with given rows. */
function writeFindingsTsv(rows: string[]): void {
  const header = 'category\ttemplate\tfinding\tref\ttimestamp';
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
  it('returns parsed findings from a valid TSV file', () => {
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
    });
    expect(findings[1].category).toBe('dead-code');
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
