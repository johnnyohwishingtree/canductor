import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inngest } from '../src/inngest.js';

const mockListForRepo = vi.fn();

vi.mock('../src/inngest.js', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, _trigger: unknown, handler: unknown) => handler),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/github.js', () => ({
  getOctokit: vi.fn(() => ({
    issues: {
      listForRepo: mockListForRepo,
    },
  })),
  parseRepo: vi.fn((repo: string) => {
    const [owner, name] = repo.split('/');
    return { owner, repo: name };
  }),
}));

type StepRun = (name: string, fn: () => Promise<unknown>) => Promise<unknown>;

const createMockStep = () => ({
  run: vi.fn<Parameters<StepRun>, ReturnType<StepRun>>().mockImplementation((_name, fn) => fn()),
});

const BASE_EVENT = { data: { issueNumber: 5, repo: 'acme/repo' } };

describe('orchestrate function', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: (ctx: { event: unknown; step: ReturnType<typeof createMockStep> }) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/functions/orchestrate.js');
    handler = mod.orchestrate as typeof handler;
  });

  it('returns no_more_stories when no pending issues exist', async () => {
    mockListForRepo.mockResolvedValue({ data: [] });
    const mockStep = createMockStep();

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'no_more_stories' });
    expect(mockListForRepo).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'repo',
      labels: 'story,pending',
      state: 'open',
      sort: 'created',
      direction: 'asc',
      per_page: 1,
    });
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it('triggers implementation for the next pending story', async () => {
    mockListForRepo.mockResolvedValue({ data: [{ number: 42, title: 'Next story' }] });
    const mockStep = createMockStep();

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'triggered', nextIssue: 42 });
    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith({
      name: 'canductor/issue.assigned',
      data: { issueNumber: 42, repo: 'acme/repo' },
    });
  });

  it('queries oldest first to maintain story order', async () => {
    mockListForRepo.mockResolvedValue({ data: [] });
    const mockStep = createMockStep();

    await handler({ event: BASE_EVENT, step: mockStep });

    expect(mockListForRepo).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'created', direction: 'asc' })
    );
  });
});
