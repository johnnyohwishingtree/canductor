import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock inngest so createFunction returns the raw handler
vi.mock('../src/inngest.js', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, _trigger: unknown, handler: unknown) => handler),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockGetIssue = vi.fn();
const mockGetDefaultBranchSha = vi.fn();
const mockCreateBranch = vi.fn();
const mockDispatchWorkflow = vi.fn();
const mockCommentOnIssue = vi.fn();

vi.mock('../src/github.js', () => ({
  getIssue: mockGetIssue,
  getDefaultBranchSha: mockGetDefaultBranchSha,
  createBranch: mockCreateBranch,
  dispatchWorkflow: mockDispatchWorkflow,
  commentOnIssue: mockCommentOnIssue,
}));

type StepRun = (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
type StepWait = (name: string, opts: unknown) => Promise<unknown>;

const createMockStep = () => ({
  run: vi.fn<Parameters<StepRun>, ReturnType<StepRun>>().mockImplementation((_name, fn) => fn()),
  waitForEvent: vi.fn<Parameters<StepWait>, ReturnType<StepWait>>(),
});

describe('implement function', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: (ctx: { event: unknown; step: ReturnType<typeof createMockStep> }) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/functions/implement.js');
    handler = mod.implement as typeof handler;
    mockGetIssue.mockResolvedValue({ title: 'Fix thing', body: 'Do the thing' });
    mockGetDefaultBranchSha.mockResolvedValue('abc123');
    mockCreateBranch.mockResolvedValue(undefined);
    mockDispatchWorkflow.mockResolvedValue(undefined);
    mockCommentOnIssue.mockResolvedValue(undefined);
  });

  it('dispatches agent, waits for verify event, returns implemented status', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue({
      data: { branch: 'canductor/issue-7', repo: 'acme/repo' },
    });

    const result = await handler({
      event: { data: { issueNumber: 7, repo: 'acme/repo', agent: 'claude-code' } },
      step: mockStep,
    });

    expect(result).toEqual({ status: 'implemented', branch: 'canductor/issue-7', issueNumber: 7 });

    expect(mockGetIssue).toHaveBeenCalledWith('acme/repo', 7);
    expect(mockGetDefaultBranchSha).toHaveBeenCalledWith('acme/repo');
    expect(mockCreateBranch).toHaveBeenCalledWith('acme/repo', 'canductor/issue-7', 'abc123');
    expect(mockDispatchWorkflow).toHaveBeenCalledWith('acme/repo', 'agent.yml', {
      issue_number: '7',
      branch: 'canductor/issue-7',
      prompt: 'Implement this issue:\n\nTitle: Fix thing\n\nDo the thing',
    });
    expect(mockCommentOnIssue).toHaveBeenCalledWith(
      'acme/repo',
      7,
      'Implementation started on branch `canductor/issue-7`. Agent: claude-code'
    );
    expect(mockStep.waitForEvent).toHaveBeenCalledWith('wait-for-agent', {
      event: 'canductor/verify.requested',
      match: 'data.branch',
      timeout: '90m',
    });
  });

  it('handles timeout: comments and returns timeout status', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue(null);

    const result = await handler({
      event: { data: { issueNumber: 7, repo: 'acme/repo' } },
      step: mockStep,
    });

    expect(result).toEqual({ status: 'timeout', branch: 'canductor/issue-7' });
    expect(mockCommentOnIssue).toHaveBeenLastCalledWith(
      'acme/repo',
      7,
      'Agent timed out after 90 minutes on branch `canductor/issue-7`.'
    );
  });

  it('uses default agent name when agent not provided', async () => {
    const mockStep = createMockStep();
    mockStep.waitForEvent.mockResolvedValue({ data: {} });

    await handler({
      event: { data: { issueNumber: 3, repo: 'acme/repo' } },
      step: mockStep,
    });

    expect(mockCommentOnIssue).toHaveBeenCalledWith(
      'acme/repo',
      3,
      'Implementation started on branch `canductor/issue-3`. Agent: claude-code'
    );
  });
});
