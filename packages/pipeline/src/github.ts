import { Octokit } from '@octokit/rest';

export function getOctokit(): Octokit {
  const token = process.env.GH_PAT || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_PAT or GITHUB_TOKEN required');
  return new Octokit({ auth: token });
}

export function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  return { owner, repo: name };
}

/** Get issue title and body. */
export async function getIssue(
  repo: string,
  number: number
): Promise<{ title: string; body: string | null }> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  const { data } = await octokit.issues.get({ owner, repo: repoName, issue_number: number });
  return { title: data.title, body: data.body ?? null };
}

/** Post a comment on an issue or PR. */
export async function commentOnIssue(
  repo: string,
  number: number,
  body: string
): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  await octokit.issues.createComment({ owner, repo: repoName, issue_number: number, body });
}

/** Create a branch from a given SHA. */
export async function createBranch(
  repo: string,
  branchName: string,
  baseSha: string
): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  await octokit.git.createRef({
    owner,
    repo: repoName,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });
}

/** Get the HEAD SHA of the default branch. */
export async function getDefaultBranchSha(repo: string): Promise<string> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  const { data: repoData } = await octokit.repos.get({ owner, repo: repoName });
  const defaultBranch = repoData.default_branch;
  const { data: ref } = await octokit.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${defaultBranch}`,
  });
  return ref.object.sha;
}

/** Merge a PR (squash by default). */
export async function mergePR(
  repo: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash'
): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  await octokit.pulls.merge({ owner, repo: repoName, pull_number: prNumber, merge_method: method });
}

/** Create a pull request. Returns the PR number. */
export async function createPR(
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string
): Promise<number> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  const { data } = await octokit.pulls.create({ owner, repo: repoName, head, base, title, body });
  return data.number;
}

/** Dispatch a GitHub Actions workflow. */
export async function dispatchWorkflow(
  repo: string,
  workflow: string,
  inputs: Record<string, string>
): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  const { data: repoData } = await octokit.repos.get({ owner, repo: repoName });
  await octokit.actions.createWorkflowDispatch({
    owner,
    repo: repoName,
    workflow_id: workflow,
    ref: repoData.default_branch,
    inputs,
  });
}

/** Get all review comments from a pull request as a formatted string. */
export async function getPRReviewComments(repo: string, prNumber: number): Promise<string> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  const { data } = await octokit.pulls.listReviews({ owner, repo: repoName, pull_number: prNumber });
  const comments = data
    .filter((r) => r.body && r.state !== 'APPROVED')
    .map((r) => `[${r.user?.login ?? 'reviewer'}]: ${r.body}`)
    .join('\n\n');
  return comments || 'No specific comments provided.';
}

/** Close an issue and optionally add labels. */
export async function closeIssue(
  repo: string,
  number: number,
  labels?: string[]
): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo: repoName } = parseRepo(repo);
  await octokit.issues.update({ owner, repo: repoName, issue_number: number, state: 'closed' });
  if (labels && labels.length > 0) {
    await octokit.issues.addLabels({ owner, repo: repoName, issue_number: number, labels });
  }
}
