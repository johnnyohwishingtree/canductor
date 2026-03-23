import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { inngest } from '../src/inngest.js';

vi.mock('../src/inngest.js', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, _trigger: unknown, handler: unknown) => handler),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockGetOctokit = vi.fn();
const mockParseRepo = vi.fn((repo: string) => {
  const [owner, name] = repo.split('/');
  return { owner, repo: name };
});

vi.mock('../src/github.js', () => ({
  getOctokit: mockGetOctokit,
  parseRepo: mockParseRepo,
}));

type StepRun = (name: string, fn: () => Promise<unknown>) => Promise<unknown>;

const createMockStep = () => ({
  run: vi.fn<Parameters<StepRun>, ReturnType<StepRun>>().mockImplementation((_name, fn) => fn()),
});

// Helpers to build GitHub API mock responses
const makeIssue = (number: number, updatedAt: string) => ({
  number,
  updated_at: updatedAt,
});

const makeRun = (status: string, updatedAt: string) => ({
  status,
  updated_at: updatedAt,
});

const makePR = (
  number: number,
  branch: string,
  updatedAt: string,
  _mergeable: boolean | null = true,
  userLogin = 'bot'
) => ({
  number,
  head: { ref: branch },
  updated_at: updatedAt,
  user: { login: userLogin },
});

const OLD_DATE = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
const RECENT_DATE = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

describe('watcher function', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: (ctx: { step: ReturnType<typeof createMockStep> }) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CANDUCTOR_REPO = 'acme/repo';
    const mod = await import('../src/functions/watcher.js');
    handler = mod.watcher as typeof handler;
  });

  afterEach(() => {
    delete process.env.CANDUCTOR_REPO;
  });

  it('returns skipped when CANDUCTOR_REPO is not set', async () => {
    delete process.env.CANDUCTOR_REPO;
    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });
    expect(result).toEqual({ status: 'skipped', reason: 'CANDUCTOR_REPO not set' });
    expect(mockStep.run).not.toHaveBeenCalled();
  });

  it('does nothing when no stalled issues or PRs', async () => {
    mockGetOctokit.mockReturnValue({
      issues: {
        listForRepo: vi.fn().mockResolvedValue({ data: [] }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: { getRef: vi.fn() },
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({ data: { workflow_runs: [] } }),
      },
    });

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [] });
  });

  it('skips issues with no branch', async () => {
    const mockOctokit = {
      issues: {
        listForRepo: vi.fn().mockResolvedValue({ data: [makeIssue(7, OLD_DATE)] }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: {
        getRef: vi.fn().mockRejectedValue(new Error('Not Found')),
      },
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({ data: { workflow_runs: [] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [] });
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it('skips issues with active workflow runs', async () => {
    const mockOctokit = {
      issues: {
        listForRepo: vi.fn().mockResolvedValue({ data: [makeIssue(7, OLD_DATE)] }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: { getRef: vi.fn().mockResolvedValue({}) },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [makeRun('in_progress', OLD_DATE)] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [] });
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it('skips issues with recent activity', async () => {
    const mockOctokit = {
      issues: {
        listForRepo: vi.fn().mockResolvedValue({ data: [makeIssue(7, RECENT_DATE)] }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: { getRef: vi.fn().mockResolvedValue({}) },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [makeRun('completed', RECENT_DATE)] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [] });
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it('re-triggers verify for stalled issues', async () => {
    const mockOctokit = {
      issues: {
        listForRepo: vi.fn().mockResolvedValue({ data: [makeIssue(7, OLD_DATE)] }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: { getRef: vi.fn().mockResolvedValue({}) },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [makeRun('completed', OLD_DATE)] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [7], stalledPRs: [] });
    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith({
      name: 'canductor/verify.requested',
      data: { branch: 'canductor/issue-7', repo: 'acme/repo', issueNumber: 7 },
    });
  });

  it('uses issue updated_at when no workflow runs exist', async () => {
    const mockOctokit = {
      issues: {
        listForRepo: vi.fn().mockResolvedValue({ data: [makeIssue(3, OLD_DATE)] }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: { getRef: vi.fn().mockResolvedValue({}) },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result.stalledIssues).toContain(3);
  });

  it('skips non-canductor PRs', async () => {
    const mockOctokit = {
      issues: { listForRepo: vi.fn().mockResolvedValue({ data: [] }) },
      pulls: {
        list: vi.fn().mockResolvedValue({
          data: [makePR(5, 'feature/other', OLD_DATE)],
        }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: { getRef: vi.fn() },
      actions: {
        listWorkflowRunsForRepo: vi.fn().mockResolvedValue({ data: { workflow_runs: [] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [] });
  });

  it('skips PRs with active workflow runs', async () => {
    const mockOctokit = {
      issues: { listForRepo: vi.fn().mockResolvedValue({ data: [] }) },
      pulls: {
        list: vi
          .fn()
          .mockResolvedValue({ data: [makePR(5, 'canductor/issue-2', OLD_DATE)] }),
        listReviews: vi.fn().mockResolvedValue({ data: [{ state: 'APPROVED' }] }),
      },
      git: { getRef: vi.fn() },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [makeRun('queued', OLD_DATE)] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [] });
  });

  it('skips PRs with recent activity', async () => {
    const mockOctokit = {
      issues: { listForRepo: vi.fn().mockResolvedValue({ data: [] }) },
      pulls: {
        list: vi
          .fn()
          .mockResolvedValue({ data: [makePR(5, 'canductor/issue-2', RECENT_DATE)] }),
        listReviews: vi.fn().mockResolvedValue({ data: [{ state: 'APPROVED' }] }),
      },
      git: { getRef: vi.fn() },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [makeRun('completed', RECENT_DATE)] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [] });
  });

  it('skips PRs without approval', async () => {
    const mockOctokit = {
      issues: { listForRepo: vi.fn().mockResolvedValue({ data: [] }) },
      pulls: {
        list: vi
          .fn()
          .mockResolvedValue({ data: [makePR(5, 'canductor/issue-2', OLD_DATE, true, 'contributor')] }),
        listReviews: vi.fn().mockResolvedValue({ data: [] }),
      },
      git: { getRef: vi.fn() },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [makeRun('completed', OLD_DATE)] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [] });
  });

  it('re-triggers auto-merge for stalled approved PRs', async () => {
    const mockOctokit = {
      issues: { listForRepo: vi.fn().mockResolvedValue({ data: [] }) },
      pulls: {
        list: vi
          .fn()
          .mockResolvedValue({ data: [makePR(5, 'canductor/issue-2', OLD_DATE)] }),
        listReviews: vi.fn().mockResolvedValue({ data: [{ state: 'APPROVED' }] }),
      },
      git: { getRef: vi.fn() },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [makeRun('completed', OLD_DATE)] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [], stalledPRs: [5] });
    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith({
      name: 'canductor/ci.completed',
      data: { prNumber: 5, branch: 'canductor/issue-2', repo: 'acme/repo', passed: true },
    });
  });

  it('handles stalled issues and PRs together', async () => {
    const mockOctokit = {
      issues: {
        listForRepo: vi.fn().mockResolvedValue({ data: [makeIssue(7, OLD_DATE)] }),
      },
      pulls: {
        list: vi
          .fn()
          .mockResolvedValue({ data: [makePR(5, 'canductor/issue-2', OLD_DATE)] }),
        listReviews: vi.fn().mockResolvedValue({ data: [{ state: 'APPROVED' }] }),
      },
      git: { getRef: vi.fn().mockResolvedValue({}) },
      actions: {
        listWorkflowRunsForRepo: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [makeRun('completed', OLD_DATE)] } }),
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);

    const mockStep = createMockStep();
    const result = await handler({ step: mockStep });

    expect(result).toEqual({ status: 'done', stalledIssues: [7], stalledPRs: [5] });
    expect(vi.mocked(inngest.send)).toHaveBeenCalledTimes(2);
  });
});
