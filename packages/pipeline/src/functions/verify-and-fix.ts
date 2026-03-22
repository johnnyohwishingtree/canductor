import { inngest } from '../inngest.js';

export const verifyAndFix = inngest.createFunction(
  { id: 'canductor/verify-and-fix', retries: 1 },
  { event: 'canductor/verify.requested' },
  async ({ event, step }) => {
    const { branch, repo, issueNumber } = event.data;
    const MAX_ATTEMPTS = 6;

    let attempt = 0;

    while (attempt < MAX_ATTEMPTS) {
      // Verify: dispatch the verification workflow
      await step.run(`verify-${attempt}`, async () => {
        const gh = await import('../github.js');
        await gh.dispatchWorkflow(repo, 'verify.yml', {
          branch,
          issue_number: String(issueNumber ?? ''),
        });
        return { dispatched: true, attempt };
      });

      // Wait for verification result
      const ciResult = await step.waitForEvent(`wait-ci-${attempt}`, {
        event: 'canductor/ci.completed',
        match: 'data.branch',
        timeout: '30m',
      });

      if (!ciResult) {
        // CI timed out
        break;
      }

      if (ciResult.data.passed) {
        // Verification passed — create PR and merge
        const prNumber = await step.run('create-pr', async () => {
          const gh = await import('../github.js');
          const pr = await gh.createPR(
            repo,
            branch,
            'master',
            `Implement #${issueNumber}`,
            `Closes #${issueNumber}\n\nAutonomously implemented by canductor.`
          );
          return pr;
        });

        // Log canductor result
        await step.run('log-result', async () => {
          // Would call appendResult here
        });

        // Dispatch auto-merge evaluation
        await step.run('request-merge', async () => {
          await inngest.send({
            name: 'canductor/ci.completed',
            data: { prNumber, branch, repo, passed: true },
          });
        });

        return { status: 'verified', branch, attempt, prNumber };
      }

      // Verification failed — dispatch fix
      attempt++;
      if (attempt < MAX_ATTEMPTS) {
        await step.run(`fix-${attempt}`, async () => {
          const gh = await import('../github.js');
          await gh.dispatchWorkflow(repo, 'agent.yml', {
            issue_number: String(issueNumber ?? ''),
            branch,
            prompt: `Fix attempt ${attempt}/${MAX_ATTEMPTS}. The verification failed. Fix the errors and push to the branch.`,
          });
        });

        // Wait for fix to complete
        await step.waitForEvent(`wait-fix-${attempt}`, {
          event: 'canductor/verify.requested',
          match: 'data.branch',
          timeout: '60m',
        });
      }
    }

    // Give up
    if (issueNumber) {
      await step.run('give-up', async () => {
        const gh = await import('../github.js');
        await gh.commentOnIssue(
          repo,
          issueNumber,
          `Verification failed after ${MAX_ATTEMPTS} attempts on branch \`${branch}\`.`
        );
      });
    }

    return { status: 'failed', branch, attempts: attempt };
  }
);
