/**
 * Clean — identifies and removes stale canductor branches
 * that have been merged to master.
 *
 * Uses git commands to find branches matching `canductor/issue-*`
 * that are fully merged into the default branch.
 */

import { execSync } from 'node:child_process';

/** A branch identified as stale (merged into master). */
export interface StaleBranch {
  name: string;
  remote: string;
}

/**
 * List remote branches matching `canductor/issue-*` that are merged into master.
 *
 * @param repoRoot - Path to the repository root
 * @returns Array of stale branch info
 */
export function listStaleBranches(repoRoot: string): StaleBranch[] {
  let mergedOutput: string;
  try {
    mergedOutput = execSync('git branch -r --merged master', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return [];
  }

  return mergedOutput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('canductor/issue-'))
    .map(line => {
      // Format: "origin/canductor/issue-42"
      const parts = line.split('/');
      const remote = parts[0];
      const name = parts.slice(1).join('/');
      return { name, remote };
    });
}

/**
 * Delete stale branches from their remotes.
 *
 * @param repoRoot - Path to the repository root
 * @param branches - Branches to delete
 * @returns Array of results: branch name and whether deletion succeeded
 */
export function deleteBranches(
  repoRoot: string,
  branches: StaleBranch[]
): Array<{ branch: string; deleted: boolean; error?: string }> {
  return branches.map(({ name, remote }) => {
    try {
      execSync(`git push ${remote} --delete ${name}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { branch: `${remote}/${name}`, deleted: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { branch: `${remote}/${name}`, deleted: false, error: message };
    }
  });
}
