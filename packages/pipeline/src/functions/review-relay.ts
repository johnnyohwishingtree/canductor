import { inngest } from '../inngest.js';

const MAX_ROUNDS = 3;

export const reviewRelay = inngest.createFunction(
  { id: 'canductor/review-relay', retries: 1 },
  { event: 'canductor/pr.reviewed' },
  async ({ event, step }) => {
    const { prNumber, branch, repo, approved, feedback, reviewRound = 0 } = event.data;

    // Nothing to fix if the review was an approval
    if (approved) {
      return { status: 'approved', prNumber, branch };
    }

    // Escalate to human after max rounds
    if (reviewRound >= MAX_ROUNDS) {
      await step.run('escalate-to-human', async () => {
        const gh = await import('../github.js');
        await gh.commentOnIssue(
          repo,
          prNumber,
          `Review relay exhausted after ${MAX_ROUNDS} rounds on branch \`${branch}\`. Human review required.`
        );
      });
      return { status: 'escalated', prNumber, branch, rounds: reviewRound };
    }

    // Get review comments — prefer inline feedback from event, fall back to GitHub API
    const reviewComments = await step.run('get-review-comments', async () => {
      if (feedback) return feedback;
      const gh = await import('../github.js');
      return await gh.getPRReviewComments(repo, prNumber);
    });

    // Dispatch fix agent with review context
    const round = reviewRound + 1;
    const fixPrompt =
      `Fix review feedback on PR #${prNumber} (round ${round}/${MAX_ROUNDS}):\n\n` +
      `${reviewComments}\n\n` +
      `Address all review comments and push to branch \`${branch}\`.`;

    await step.run('dispatch-fix', async () => {
      const gh = await import('../github.js');
      await gh.dispatchWorkflow(repo, 'agent.yml', {
        issue_number: String(prNumber),
        branch,
        prompt: fixPrompt,
      });
    });

    // Wait for agent to push changes (CI sends canductor/verify.requested)
    const agentDone = await step.waitForEvent('wait-for-fix', {
      event: 'canductor/verify.requested',
      match: 'data.branch',
      timeout: '60m',
    });

    if (!agentDone) {
      await step.run('comment-timeout', async () => {
        const gh = await import('../github.js');
        await gh.commentOnIssue(
          repo,
          prNumber,
          `Review fix agent timed out after 60 minutes on branch \`${branch}\`.`
        );
      });
      return { status: 'timeout', prNumber, branch };
    }

    // Trigger re-verification so verify-and-fix picks up the new push
    await step.run('trigger-reverify', async () => {
      await inngest.send({
        name: 'canductor/verify.requested',
        data: { branch, repo, prNumber },
      });
    });

    return { status: 'fixed', prNumber, branch, round };
  }
);
