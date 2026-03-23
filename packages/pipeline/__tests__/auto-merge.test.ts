import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inngest } from '../src/inngest.js';

const mockPullsGet = vi.fn();
const mockPullsListReviews = vi.fn();
const mockMergePR = vi.fn();

vi.mock('../src/inngest.js', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, _trigger: unknown, handler: unknown) => handler),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/github.js', () => ({
  getOctokit: vi.fn(() => ({
    pulls: {
      get: mockPullsGet,
      listReviews: mockPullsListReviews,
    },
  })),
  parseRepo: vi.fn((repo: string) => {
    const [owner, name] = repo.split('/');
    return { owner, repo: name };
  }),
  mergePR: mockMergePR,
}));

type StepRun = (name: string, fn: () => Promise<unknown>) => Promise<unknown>;

const createMockStep = () => ({
  run: vi.fn<Parameters<StepRun>, ReturnType<StepRun>>().mockImplementation((_name, fn) => fn()),
});

const BASE_EVENT = {
  data: { prNumber: 10, branch: 'canductor/issue-1', repo: 'acme/repo', passed: true },
};

describe('autoMerge function', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: (ctx: { event: unknown; step: ReturnType<typeof createMockStep> }) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/functions/auto-merge.js');
    handler = mod.autoMerge as typeof handler;
    mockMergePR.mockResolvedValue(undefined);
  });

  it('returns skipped when passed=false', async () => {
    const mockStep = createMockStep();
    const result = await handler({
      event: { data: { prNumber: 10, branch: 'canductor/issue-1', repo: 'acme/repo', passed: false } },
      step: mockStep,
    });

    expect(result).toEqual({ status: 'skipped' });
    expect(mockStep.run).not.toHaveBeenCalled();
  });

  it('returns skipped when prNumber is missing', async () => {
    const mockStep = createMockStep();
    const result = await handler({
      event: { data: { branch: 'canductor/issue-1', repo: 'acme/repo', passed: true } },
      step: mockStep,
    });

    expect(result).toEqual({ status: 'skipped' });
    expect(mockStep.run).not.toHaveBeenCalled();
  });

  it('returns not_ready when PR is not open', async () => {
    mockPullsGet.mockResolvedValue({ data: { state: 'closed', mergeable: null, user: { login: 'bot' } } });
    mockPullsListReviews.mockResolvedValue({ data: [] });
    const mockStep = createMockStep();

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'not_ready', prNumber: 10 });
    expect(mockMergePR).not.toHaveBeenCalled();
  });

  it('returns not_ready when PR is not mergeable', async () => {
    mockPullsGet.mockResolvedValue({ data: { state: 'open', mergeable: false, user: { login: 'bot' } } });
    mockPullsListReviews.mockResolvedValue({ data: [] });
    const mockStep = createMockStep();

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'not_ready', prNumber: 10 });
    expect(mockMergePR).not.toHaveBeenCalled();
  });

  it('returns not_ready when no approvals and PR is not from owner', async () => {
    mockPullsGet.mockResolvedValue({
      data: { state: 'open', mergeable: true, user: { login: 'contributor' } },
    });
    mockPullsListReviews.mockResolvedValue({ data: [] });
    const mockStep = createMockStep();

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'not_ready', prNumber: 10 });
  });

  it('merges PR when approved and triggers next story', async () => {
    mockPullsGet.mockResolvedValue({
      data: { state: 'open', mergeable: true, user: { login: 'bot' } },
    });
    mockPullsListReviews.mockResolvedValue({ data: [{ state: 'APPROVED' }] });
    const mockStep = createMockStep();

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'merged', prNumber: 10 });
    expect(mockMergePR).toHaveBeenCalledWith('acme/repo', 10, 'squash');
    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith({
      name: 'canductor/story.completed',
      data: { issueNumber: 0, repo: 'acme/repo' },
    });
  });
});
