import { inngest } from '../inngest.js';

export const implement = inngest.createFunction(
  { id: 'canductor/implement', retries: 2 },
  { event: 'canductor/issue.assigned' },
  async ({ event, step }) => {
    const { issueNumber, repo, agent } = event.data;

    // Step 1: Get issue details
    const issue = await step.run('get-issue', async () => {
      const gh = await import('../github.js');
      return await gh.getIssue(repo, issueNumber);
    });

    // Step 2: Create a working branch
    const branch = await step.run('create-branch', async () => {
      const gh = await import('../github.js');
      const sha = await gh.getDefaultBranchSha(repo);
      const branchName = `canductor/issue-${issueNumber}`;
      await gh.createBranch(repo, branchName, sha);
      return branchName;
    });

    // Step 3: Dispatch claude-code-action to implement
    await step.run('dispatch-agent', async () => {
      const gh = await import('../github.js');
      await gh.dispatchWorkflow(repo, 'agent.yml', {
        issue_number: String(issueNumber),
        branch,
        prompt: `Implement this issue:\n\nTitle: ${issue.title}\n\n${issue.body ?? ''}`,
      });
    });

    // Step 4: Comment status
    await step.run('comment-started', async () => {
      const gh = await import('../github.js');
      await gh.commentOnIssue(
        repo,
        issueNumber,
        `Implementation started on branch \`${branch}\`. Agent: ${agent ?? 'claude-code'}`
      );
    });

    // Step 5: Wait for agent to finish (CI will trigger verify)
    const verifyEvent = await step.waitForEvent('wait-for-agent', {
      event: 'canductor/verify.requested',
      match: 'data.branch',
      timeout: '90m',
    });

    if (!verifyEvent) {
      await step.run('comment-timeout', async () => {
        const gh = await import('../github.js');
        await gh.commentOnIssue(
          repo,
          issueNumber,
          `Agent timed out after 90 minutes on branch \`${branch}\`.`
        );
      });
      return { status: 'timeout', branch };
    }

    return { status: 'implemented', branch, issueNumber };
  }
);
