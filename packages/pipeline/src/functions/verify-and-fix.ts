import { inngest } from '../inngest.js';

export const verifyAndFix = inngest.createFunction(
  { id: 'canductor/verify-and-fix', retries: 1 },
  { event: 'canductor/verify.requested' },
  async ({ event, step }) => {
    const { branch, repo, issueNumber } = event.data;
    const MAX_ATTEMPTS = 6;

    let attempt = 0;

    while (attempt < MAX_ATTEMPTS) {
      // Dispatch the verification workflow
      await step.run(`verify-${attempt}`, async () => {
        const gh = await import('../github.js');
        await gh.dispatchWorkflow(repo, 'verify.yml', {
          branch,
          issue_number: String(issueNumber ?? ''),
          repo,
        });
        return { dispatched: true, attempt };
      });

      // Wait for canductor verify.completed event (sent by verify.yml)
      const verifyResult = await step.waitForEvent(`wait-ci-${attempt}`, {
        event: 'canductor/verify.completed',
        match: 'data.branch',
        timeout: '30m',
      });

      if (!verifyResult) {
        // Verification timed out
        break;
      }

      const { score, decision } = verifyResult.data;
      const passed = decision !== 'block';

      if (passed) {
        // Verification passed — create PR and trigger merge evaluation
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

        // Log result status update
        await step.run('log-result', async () => {
          // Results are appended by verify.yml (canductor verify CLI).
          // Update the last entry status to merged once PR is created.
        });

        // Trigger auto-merge evaluation
        await step.run('request-merge', async () => {
          await inngest.send({
            name: 'canductor/ci.completed',
            data: { prNumber, branch, repo, passed: true },
          });
        });

        return { status: 'verified', branch, attempt, prNumber };
      }

      // Verification failed (decision: block) — dispatch agent to fix
      attempt++;
      if (attempt < MAX_ATTEMPTS) {
        const fixPrompt = `Fix attempt ${attempt}/${MAX_ATTEMPTS}. Verification score: ${score}/100, decision: ${decision}. Fix the errors and push to the branch.`;

        await step.run(`fix-${attempt}`, async () => {
          const gh = await import('../github.js');
          await gh.dispatchWorkflow(repo, 'agent.yml', {
            issue_number: String(issueNumber ?? ''),
            branch,
            prompt: fixPrompt,
          });
        });

        // Wait for agent to push code (triggers verify.requested)
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
