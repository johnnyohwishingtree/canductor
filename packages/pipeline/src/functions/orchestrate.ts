import { inngest } from '../inngest.js';

export const orchestrate = inngest.createFunction(
  { id: 'canductor/orchestrate', retries: 2 },
  { event: 'canductor/story.completed' },
  async ({ event, step }) => {
    const { repo } = event.data;

    // Find next pending story
    const nextIssue = await step.run('find-next-story', async () => {
      const gh = await import('../github.js');
      const octokit = gh.getOctokit();
      const { owner, repo: repoName } = gh.parseRepo(repo);

      const issues = await octokit.issues.listForRepo({
        owner,
        repo: repoName,
        labels: 'story,pending',
        state: 'open',
        sort: 'created',
        direction: 'asc',
        per_page: 1,
      });

      return issues.data[0] ?? null;
    });

    if (!nextIssue) return { status: 'no_more_stories' };

    // Trigger implementation
    await step.run('trigger-next', async () => {
      await inngest.send({
        name: 'canductor/issue.assigned',
        data: { issueNumber: nextIssue.number, repo },
      });
    });

    return { status: 'triggered', nextIssue: nextIssue.number };
  }
);
