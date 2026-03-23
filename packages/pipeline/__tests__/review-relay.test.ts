import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/inngest.js', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, _trigger: unknown, handler: unknown) => handler),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockDispatchWorkflow = vi.fn();
const mockCommentOnIssue = vi.fn();
const mockGetPRReviewComments = vi.fn();

vi.mock('../src/github.js', () => ({
  dispatchWorkflow: mockDispatchWorkflow,
  commentOnIssue: mockCommentOnIssue,
  getPRReviewComments: mockGetPRReviewComments,
}));

type StepRun = (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
type StepWait = (name: string, opts: unknown) => Promise<unknown>;

const createMockStep = () => ({
  run: vi.fn<Parameters<StepRun>, ReturnType<StepRun>>().mockImplementation((_name, fn) => fn()),
  waitForEvent: vi.fn<Parameters<StepWait>, ReturnType<StepWait>>(),
});

const BASE_EVENT = {
  data: {
    prNumber: 42,
    branch: 'canductor/issue-1',
    repo: 'acme/repo',
    approved: false,
    feedback: 'Please add error handling.',
  },
};

const VERIFY_REQUESTED = {
  data: { branch: 'canductor/issue-1', repo: 'acme/repo' },
};

describe('reviewRelay function', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: (ctx: { event: unknown; step: ReturnType<typeof createMockStep> }) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/functions/review-relay.js');
    handler = mod.reviewRelay as typeof handler;
    mockDispatchWorkflow.mockResolvedValue(undefined);
    mockCommentOnIssue.mockResolvedValue(undefined);
    mockGetPRReviewComments.mockResolvedValue('Fetched review comments.');
  });

  it('returns approved immediately when review is an approval', async () => {
    const mockStep = createMockStep();
    const result = await handler({
      event: { data: { ...BASE_EVENT.data, approved: true } },
      step: mockStep,
    });

    expect(result).toEqual({ status: 'approved', prNumber: 42, branch: 'canductor/issue-1' });
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();
  });

  it('dispatches fix agent with feedback from event and returns fixed', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(VERIFY_REQUESTED);

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'fixed', prNumber: 42, branch: 'canductor/issue-1', round: 1 });
    expect(mockDispatchWorkflow).toHaveBeenCalledWith('acme/repo', 'agent.yml', {
      issue_number: '42',
      branch: 'canductor/issue-1',
      prompt: expect.stringContaining('Please add error handling.'),
    });
    expect(mockGetPRReviewComments).not.toHaveBeenCalled();
  });

  it('fetches review comments from GitHub API when no feedback in event', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(VERIFY_REQUESTED);

    await handler({
      event: { data: { ...BASE_EVENT.data, feedback: undefined } },
      step: mockStep,
    });

    expect(mockGetPRReviewComments).toHaveBeenCalledWith('acme/repo', 42);
    expect(mockDispatchWorkflow).toHaveBeenCalledWith('acme/repo', 'agent.yml', {
      issue_number: '42',
      branch: 'canductor/issue-1',
      prompt: expect.stringContaining('Fetched review comments.'),
    });
  });

  it('includes round number in fix prompt', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(VERIFY_REQUESTED);

    await handler({
      event: { data: { ...BASE_EVENT.data, reviewRound: 1 } },
      step: mockStep,
    });

    const prompt = mockDispatchWorkflow.mock.calls[0][2].prompt as string;
    expect(prompt).toContain('round 2/3');
  });

  it('escalates to human after max rounds', async () => {
    const mockStep = createMockStep();

    const result = await handler({
      event: { data: { ...BASE_EVENT.data, reviewRound: 3 } },
      step: mockStep,
    });

    expect(result).toEqual({ status: 'escalated', prNumber: 42, branch: 'canductor/issue-1', rounds: 3 });
    expect(mockCommentOnIssue).toHaveBeenCalledWith(
      'acme/repo',
      42,
      expect.stringContaining('Human review required')
    );
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();
  });

  it('comments timeout and returns timeout status when agent does not push', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(null);

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'timeout', prNumber: 42, branch: 'canductor/issue-1' });
    expect(mockCommentOnIssue).toHaveBeenCalledWith(
      'acme/repo',
      42,
      expect.stringContaining('timed out')
    );
  });

  it('sends canductor/verify.requested after successful fix', async () => {
    const { inngest: mockInngest } = await import('../src/inngest.js');
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(VERIFY_REQUESTED);

    await handler({ event: BASE_EVENT, step: mockStep });

    expect(mockInngest.send).toHaveBeenCalledWith({
      name: 'canductor/verify.requested',
      data: { branch: 'canductor/issue-1', repo: 'acme/repo', prNumber: 42 },
    });
  });

  it('waits for verify.requested event on the correct branch', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(VERIFY_REQUESTED);

    await handler({ event: BASE_EVENT, step: mockStep });

    expect(mockStep.waitForEvent).toHaveBeenCalledWith('wait-for-fix', {
      event: 'canductor/verify.requested',
      match: 'data.branch',
      timeout: '60m',
    });
  });

  it('defaults reviewRound to 0 when not provided', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(VERIFY_REQUESTED);

    const result = await handler({
      event: { data: { prNumber: 42, branch: 'canductor/issue-1', repo: 'acme/repo', approved: false, feedback: 'fix this' } },
      step: mockStep,
    });

    expect(result).toEqual({ status: 'fixed', prNumber: 42, branch: 'canductor/issue-1', round: 1 });
  });
});
