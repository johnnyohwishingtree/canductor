import { inngest } from '../inngest.js';

export const autoMerge = inngest.createFunction(
  { id: 'canductor/auto-merge', retries: 2 },
  { event: 'canductor/ci.completed' },
  async ({ event, step }) => {
    const { prNumber, branch, repo, passed } = event.data;
    if (!passed || !prNumber) return { status: 'skipped' };

    // Check merge conditions
    const canMerge = await step.run('check-conditions', async () => {
      const gh = await import('../github.js');
      const octokit = gh.getOctokit();
      const { owner, repo: repoName } = gh.parseRepo(repo);

      const pr = await octokit.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });
      if (pr.data.state !== 'open') return false;
      if (pr.data.mergeable === false) return false;

      // Check for approvals (owner PRs are implicitly approved)
      const reviews = await octokit.pulls.listReviews({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });
      const approved =
        reviews.data.some((r) => r.state === 'APPROVED') ||
        pr.data.user?.login === owner;

      return approved;
    });

    if (!canMerge) return { status: 'not_ready', prNumber };

    // Merge
    await step.run('merge', async () => {
      const gh = await import('../github.js');
      await gh.mergePR(repo, prNumber, 'squash');
    });

    // Trigger next story
    await step.run('chain-next', async () => {
      await inngest.send({
        name: 'canductor/story.completed',
        data: { issueNumber: 0, repo },
      });
    });

    return { status: 'merged', prNumber };
  }
);
