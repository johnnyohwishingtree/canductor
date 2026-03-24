import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { listStaleBranches, deleteBranches } from '../src/clean.js';

let tempDir: string;

function git(cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd: tempDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-clean-test-'));

  // Create a bare remote and a working clone
  const bareDir = join(tempDir, 'bare.git');
  const workDir = join(tempDir, 'work');

  execSync(`git init --bare ${bareDir}`, { stdio: 'pipe' });
  execSync(`git clone ${bareDir} ${workDir}`, { stdio: 'pipe' });

  // Set up the working dir as our tempDir for tests
  tempDir = workDir;

  // Configure git user for commits and disable signing
  git('config user.email "test@test.com"');
  git('config user.name "Test"');
  git('config commit.gpgsign false');
  git('config tag.gpgsign false');

  // Create initial commit on master
  execSync('touch file.txt', { cwd: tempDir, stdio: 'pipe' });
  git('add file.txt');
  git('commit -m "initial"');
  git('push origin master');
});

afterEach(() => {
  // Clean up the parent temp dir (contains both bare and work)
  const parentDir = join(tempDir, '..');
  rmSync(parentDir, { recursive: true, force: true });
});

describe('listStaleBranches', () => {
  it('returns empty array when no canductor branches exist', () => {
    const branches = listStaleBranches(tempDir);
    expect(branches).toEqual([]);
  });

  it('lists merged canductor branches', () => {
    // Create a canductor branch, merge it, and push
    git('checkout -b canductor/issue-42');
    execSync('echo "change" >> file.txt', { cwd: tempDir, stdio: 'pipe' });
    git('add file.txt');
    git('commit -m "issue 42"');
    git('push origin canductor/issue-42');
    git('checkout master');
    git('merge canductor/issue-42');
    git('push origin master');

    // Fetch to update remote tracking
    git('fetch --prune');

    const branches = listStaleBranches(tempDir);
    expect(branches.length).toBe(1);
    expect(branches[0].name).toBe('canductor/issue-42');
    expect(branches[0].remote).toBe('origin');
  });

  it('does not list unmerged canductor branches', () => {
    // Create a canductor branch with divergent changes (not merged)
    git('checkout -b canductor/issue-99');
    execSync('echo "divergent" >> file.txt', { cwd: tempDir, stdio: 'pipe' });
    git('add file.txt');
    git('commit -m "issue 99"');
    git('push origin canductor/issue-99');
    git('checkout master');

    // Fetch to update remote tracking
    git('fetch --prune');

    const branches = listStaleBranches(tempDir);
    // Should not appear since it's not merged
    const found = branches.find(b => b.name === 'canductor/issue-99');
    expect(found).toBeUndefined();
  });

  it('returns empty array for non-git directory', () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'canductor-nongit-'));
    const branches = listStaleBranches(nonGitDir);
    expect(branches).toEqual([]);
    rmSync(nonGitDir, { recursive: true, force: true });
  });
});

describe('deleteBranches', () => {
  it('deletes merged remote branches', () => {
    // Create and merge a branch
    git('checkout -b canductor/issue-10');
    execSync('echo "change10" >> file.txt', { cwd: tempDir, stdio: 'pipe' });
    git('add file.txt');
    git('commit -m "issue 10"');
    git('push origin canductor/issue-10');
    git('checkout master');
    git('merge canductor/issue-10');
    git('push origin master');
    git('fetch --prune');

    const branches = listStaleBranches(tempDir);
    expect(branches.length).toBe(1);

    const results = deleteBranches(tempDir, branches);
    expect(results.length).toBe(1);
    expect(results[0].deleted).toBe(true);

    // Verify branch is gone
    git('fetch --prune');
    const remaining = listStaleBranches(tempDir);
    expect(remaining.length).toBe(0);
  });

  it('reports error for nonexistent branch', () => {
    const results = deleteBranches(tempDir, [
      { name: 'canductor/issue-nonexistent', remote: 'origin' },
    ]);
    expect(results.length).toBe(1);
    expect(results[0].deleted).toBe(false);
    expect(results[0].error).toBeDefined();
  });
});
