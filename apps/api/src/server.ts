import { Hono } from 'hono';
import { serve } from 'inngest/hono';
import { inngest, implement, verifyAndFix, autoMerge, orchestrate } from '@canductor/pipeline';

const app = new Hono();

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'canductor-api' }));

// Inngest endpoint — serves the functions and receives events from Inngest
app.on(['GET', 'POST', 'PUT'], '/api/inngest',
  serve({
    client: inngest,
    functions: [implement, verifyAndFix, autoMerge, orchestrate],
  })
);

// GitHub webhook receiver — translates webhooks to Inngest events
app.post('/api/webhooks/github', async (c) => {
  const event = c.req.header('X-GitHub-Event');
  const body = await c.req.json();

  // Determine repo from webhook
  const repo = body.repository?.full_name;
  if (!repo) return c.json({ error: 'no repo' }, 400);

  switch (event) {
    case 'issue_comment': {
      // Check for @canductor trigger in comment
      const comment = body.comment?.body ?? '';
      const issueNumber = body.issue?.number;
      if (comment.includes('@canductor') && issueNumber) {
        await inngest.send({
          name: 'canductor/issue.assigned',
          data: { issueNumber, repo },
        });
        return c.json({ triggered: 'issue.assigned', issueNumber });
      }
      break;
    }

    case 'pull_request_review': {
      const prNumber = body.pull_request?.number;
      const branch = body.pull_request?.head?.ref;
      const approved = body.review?.state === 'approved';
      const feedback = body.review?.body;
      if (prNumber && branch) {
        await inngest.send({
          name: 'canductor/pr.reviewed',
          data: { prNumber, branch, repo, approved, feedback },
        });
        return c.json({ triggered: 'pr.reviewed', prNumber });
      }
      break;
    }

    case 'workflow_run': {
      // When a CI workflow completes, send ci.completed event
      if (body.action === 'completed') {
        const branch = body.workflow_run?.head_branch;
        const passed = body.workflow_run?.conclusion === 'success';
        // Try to find associated PR
        const prNumber = body.workflow_run?.pull_requests?.[0]?.number;
        if (branch) {
          await inngest.send({
            name: 'canductor/ci.completed',
            data: { prNumber: prNumber ?? 0, branch, repo, passed },
          });
          return c.json({ triggered: 'ci.completed', branch, passed });
        }
      }
      break;
    }

    case 'push': {
      // Agent pushed code — trigger verification
      const branch = body.ref?.replace('refs/heads/', '');
      if (branch?.startsWith('canductor/')) {
        await inngest.send({
          name: 'canductor/verify.requested',
          data: { branch, repo },
        });
        return c.json({ triggered: 'verify.requested', branch });
      }
      break;
    }
  }

  return c.json({ ignored: true, event });
});

// Start server
const port = parseInt(process.env.PORT ?? '3123');
console.log(`Canductor API listening on port ${port}`);
export default app;
