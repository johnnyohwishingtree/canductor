import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/inngest.js', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, _trigger: unknown, handler: unknown) => handler),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockDispatchWorkflow = vi.fn();
const mockCreatePR = vi.fn();
const mockCommentOnIssue = vi.fn();

vi.mock('../src/github.js', () => ({
  dispatchWorkflow: mockDispatchWorkflow,
  createPR: mockCreatePR,
  commentOnIssue: mockCommentOnIssue,
}));

type StepRun = (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
type StepWait = (name: string, opts: unknown) => Promise<unknown>;

const createMockStep = () => ({
  run: vi.fn<Parameters<StepRun>, ReturnType<StepRun>>().mockImplementation((_name, fn) => fn()),
  waitForEvent: vi.fn<Parameters<StepWait>, ReturnType<StepWait>>(),
});

const BASE_EVENT = {
  data: { branch: 'canductor/issue-1', repo: 'acme/repo', issueNumber: 1 },
};

/** Helper: build a verify.completed event payload */
function verifyCompleted(
  decision: 'auto_merge' | 'human_review' | 'block',
  score = 95
) {
  return {
    data: {
      branch: 'canductor/issue-1',
      repo: 'acme/repo',
      score,
      decision,
      passed: decision !== 'block',
    },
  };
}

describe('verifyAndFix function', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: (ctx: { event: unknown; step: ReturnType<typeof createMockStep> }) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/functions/verify-and-fix.js');
    handler = mod.verifyAndFix as typeof handler;
    mockDispatchWorkflow.mockResolvedValue(undefined);
    mockCreatePR.mockResolvedValue(42);
    mockCommentOnIssue.mockResolvedValue(undefined);
  });

  it('returns verified on first attempt when decision is auto_merge', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(verifyCompleted('auto_merge', 97));

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'verified', branch: 'canductor/issue-1', attempt: 0, prNumber: 42 });
    expect(mockDispatchWorkflow).toHaveBeenCalledWith('acme/repo', 'verify.yml', {
      branch: 'canductor/issue-1',
      issue_number: '1',
      repo: 'acme/repo',
    });
    expect(mockCreatePR).toHaveBeenCalledWith(
      'acme/repo',
      'canductor/issue-1',
      'master',
      'Implement #1',
      'Closes #1\n\nAutonomously implemented by canductor.'
    );
  });

  it('returns verified when decision is human_review (creates PR, does not retry)', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(verifyCompleted('human_review', 78));

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'verified', branch: 'canductor/issue-1', attempt: 0, prNumber: 42 });
    expect(mockCreatePR).toHaveBeenCalled();
    // Should not dispatch a fix agent
    expect(mockDispatchWorkflow).toHaveBeenCalledTimes(1); // only the verify dispatch
  });

  it('retries on block decision and returns verified on second attempt', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent
      .mockResolvedValueOnce(verifyCompleted('block', 42))        // wait-ci-0
      .mockResolvedValueOnce({ data: { branch: 'canductor/issue-1', repo: 'acme/repo' } }) // wait-fix-1
      .mockResolvedValueOnce(verifyCompleted('auto_merge', 96));  // wait-ci-1

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'verified', branch: 'canductor/issue-1', attempt: 1, prNumber: 42 });
    expect(mockDispatchWorkflow).toHaveBeenCalledTimes(3); // verify-0, fix-1, verify-1
    expect(mockDispatchWorkflow).toHaveBeenNthCalledWith(2, 'acme/repo', 'agent.yml', {
      issue_number: '1',
      branch: 'canductor/issue-1',
      prompt: 'Fix attempt 1/6. Verification score: 42/100, decision: block. Fix the errors and push to the branch.',
    });
  });

  it('gives up after max attempts and posts failure comment', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockImplementation(async (name: string) => {
      if ((name as string).startsWith('wait-ci-')) {
        return verifyCompleted('block', 30);
      }
      // fix waits
      return { data: { branch: 'canductor/issue-1', repo: 'acme/repo' } };
    });

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'failed', branch: 'canductor/issue-1', attempts: 6 });
    expect(mockCommentOnIssue).toHaveBeenCalledWith(
      'acme/repo',
      1,
      'Verification failed after 6 attempts on branch `canductor/issue-1`.'
    );
  });

  it('breaks out and returns failed when verification times out (null result)', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(null);

    const result = await handler({ event: BASE_EVENT, step: mockStep });

    expect(result).toEqual({ status: 'failed', branch: 'canductor/issue-1', attempts: 0 });
  });

  it('includes score and decision in the fix prompt', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent
      .mockResolvedValueOnce(verifyCompleted('block', 55))
      .mockResolvedValueOnce({ data: { branch: 'canductor/issue-1', repo: 'acme/repo' } })
      .mockResolvedValueOnce(verifyCompleted('auto_merge', 90));

    await handler({ event: BASE_EVENT, step: mockStep });

    const fixCall = mockDispatchWorkflow.mock.calls.find(
      (c) => c[1] === 'agent.yml'
    );
    expect(fixCall).toBeDefined();
    expect(fixCall![2].prompt).toContain('score: 55/100');
    expect(fixCall![2].prompt).toContain('decision: block');
  });

  it('passes repo to verify.yml dispatch', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(verifyCompleted('auto_merge'));

    await handler({ event: BASE_EVENT, step: mockStep });

    expect(mockDispatchWorkflow).toHaveBeenCalledWith('acme/repo', 'verify.yml', {
      branch: 'canductor/issue-1',
      issue_number: '1',
      repo: 'acme/repo',
    });
  });
});
