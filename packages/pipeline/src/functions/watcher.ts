import { inngest } from '../inngest.js';

/** Stale threshold: 20 minutes in milliseconds */
const STALE_MS = 20 * 60 * 1000;

export const watcher = inngest.createFunction(
  {
    id: 'canductor/watcher',
    concurrency: { limit: 1, key: 'watcher' },
  },
  { cron: '*/20 * * * *' },
  async ({ step }) => {
    const repo = process.env.CANDUCTOR_REPO;
    if (!repo) return { status: 'skipped', reason: 'CANDUCTOR_REPO not set' };

    // Step 1: Find stalled in-progress issues
    const stalledIssues = await step.run('find-stalled-issues', async () => {
      const gh = await import('../github.js');
      const octokit = gh.getOctokit();
      const { owner, repo: repoName } = gh.parseRepo(repo);

      const { data: issues } = await octokit.issues.listForRepo({
        owner,
        repo: repoName,
        state: 'open',
        labels: 'story',
        per_page: 50,
      });

      const stalled: number[] = [];
      const now = Date.now();

      for (const issue of issues) {
        const branchName = `canductor/issue-${issue.number}`;

        // Check if branch exists
        let branchExists = false;
        try {
          await octokit.git.getRef({
            owner,
            repo: repoName,
            ref: `heads/${branchName}`,
          });
          branchExists = true;
        } catch {
          // Branch doesn't exist — issue hasn't been picked up yet, skip
          continue;
        }

        if (!branchExists) continue;

        // Check for recent workflow runs on this branch
        const { data: runs } = await octokit.actions.listWorkflowRunsForRepo({
          owner,
          repo: repoName,
          branch: branchName,
          per_page: 5,
        });

        const hasActiveRun = runs.workflow_runs.some(
          (r) => r.status === 'in_progress' || r.status === 'queued'
        );
        if (hasActiveRun) continue;

        const lastActivity = runs.workflow_runs[0]?.updated_at
          ? new Date(runs.workflow_runs[0].updated_at).getTime()
          : new Date(issue.updated_at).getTime();

        if (now - lastActivity > STALE_MS) {
          stalled.push(issue.number);
        }
      }

      return stalled;
    });

    // Step 2: Re-trigger verify for each stalled issue
    const retriggered: number[] = [];
    for (const issueNumber of stalledIssues) {
      await step.run(`retrigger-verify-${issueNumber}`, async () => {
        const branch = `canductor/issue-${issueNumber}`;
        await inngest.send({
          name: 'canductor/verify.requested',
          data: { branch, repo, issueNumber },
        });
      });
      retriggered.push(issueNumber);
    }

    // Step 3: Find PRs ready to merge that haven't been
    const stalledPRs = await step.run('find-stalled-prs', async () => {
      const gh = await import('../github.js');
      const octokit = gh.getOctokit();
      const { owner, repo: repoName } = gh.parseRepo(repo);

      const { data: prs } = await octokit.pulls.list({
        owner,
        repo: repoName,
        state: 'open',
        per_page: 50,
      });

      const stalled: Array<{ prNumber: number; branch: string }> = [];
      const now = Date.now();

      for (const pr of prs) {
        if (!pr.head.ref.startsWith('canductor/')) continue;

        // Check for active workflow runs
        const { data: runs } = await octokit.actions.listWorkflowRunsForRepo({
          owner,
          repo: repoName,
          branch: pr.head.ref,
          per_page: 5,
        });

        const hasActiveRun = runs.workflow_runs.some(
          (r) => r.status === 'in_progress' || r.status === 'queued'
        );
        if (hasActiveRun) continue;

        const lastActivity = runs.workflow_runs[0]?.updated_at
          ? new Date(runs.workflow_runs[0].updated_at).getTime()
          : new Date(pr.updated_at).getTime();

        if (now - lastActivity <= STALE_MS) continue;

        // Check if mergeable + approved
        const { data: reviews } = await octokit.pulls.listReviews({
          owner,
          repo: repoName,
          pull_number: pr.number,
        });

        const approved =
          reviews.some((r) => r.state === 'APPROVED') || pr.user?.login === owner;

        if (approved) {
          stalled.push({ prNumber: pr.number, branch: pr.head.ref });
        }
      }

      return stalled;
    });

    // Step 4: Re-trigger auto-merge for stalled PRs
    const mergeRetriggered: number[] = [];
    for (const { prNumber, branch } of stalledPRs) {
      await step.run(`retrigger-merge-${prNumber}`, async () => {
        await inngest.send({
          name: 'canductor/ci.completed',
          data: { prNumber, branch, repo, passed: true },
        });
      });
      mergeRetriggered.push(prNumber);
    }

    return {
      status: 'done',
      stalledIssues: retriggered,
      stalledPRs: mergeRetriggered,
    };
  }
);
