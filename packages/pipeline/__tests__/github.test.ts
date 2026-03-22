import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { parseRepo } from '../src/github.js';

// Mock Octokit at the module level
const mockGet = vi.fn();
const mockCreateComment = vi.fn();
const mockCreateRef = vi.fn();
const mockReposGet = vi.fn();
const mockGetRef = vi.fn();
const mockPullsMerge = vi.fn();
const mockPullsCreate = vi.fn();
const mockCreateWorkflowDispatch = vi.fn();
const mockIssuesUpdate = vi.fn();
const mockAddLabels = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    issues: {
      get: mockGet,
      createComment: mockCreateComment,
      update: mockIssuesUpdate,
      addLabels: mockAddLabels,
    },
    git: {
      createRef: mockCreateRef,
      getRef: mockGetRef,
    },
    repos: {
      get: mockReposGet,
    },
    pulls: {
      merge: mockPullsMerge,
      create: mockPullsCreate,
    },
    actions: {
      createWorkflowDispatch: mockCreateWorkflowDispatch,
    },
  })),
}));

describe('parseRepo', () => {
  it('splits owner/repo correctly', () => {
    expect(parseRepo('acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('handles org with hyphens', () => {
    expect(parseRepo('my-org/my-repo')).toEqual({ owner: 'my-org', repo: 'my-repo' });
  });
});

describe('getOctokit', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws when no token is set', async () => {
    delete process.env.GH_PAT;
    delete process.env.GITHUB_TOKEN;
    const { getOctokit } = await import('../src/github.js');
    expect(() => getOctokit()).toThrow('GH_PAT or GITHUB_TOKEN required');
  });
});

describe('GitHub API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GH_PAT = 'test-token';
  });

  describe('getIssue', () => {
    it('calls octokit.issues.get with correct params', async () => {
      mockGet.mockResolvedValue({
        data: { title: 'Fix bug', body: 'Description here' },
      });

      const { getIssue } = await import('../src/github.js');
      const result = await getIssue('acme/widgets', 42);

      expect(mockGet).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        issue_number: 42,
      });
      expect(result).toEqual({ title: 'Fix bug', body: 'Description here' });
    });
  });

  describe('commentOnIssue', () => {
    it('calls octokit.issues.createComment with correct params', async () => {
      mockCreateComment.mockResolvedValue({ data: {} });

      const { commentOnIssue } = await import('../src/github.js');
      await commentOnIssue('acme/widgets', 42, 'Hello world');

      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        issue_number: 42,
        body: 'Hello world',
      });
    });
  });

  describe('createBranch', () => {
    it('calls octokit.git.createRef with correct ref format', async () => {
      mockCreateRef.mockResolvedValue({ data: {} });

      const { createBranch } = await import('../src/github.js');
      await createBranch('acme/widgets', 'canductor/issue-1', 'abc123');

      expect(mockCreateRef).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        ref: 'refs/heads/canductor/issue-1',
        sha: 'abc123',
      });
    });
  });

  describe('getDefaultBranchSha', () => {
    it('fetches default branch then gets its HEAD sha', async () => {
      mockReposGet.mockResolvedValue({
        data: { default_branch: 'main' },
      });
      mockGetRef.mockResolvedValue({
        data: { object: { sha: 'def456' } },
      });

      const { getDefaultBranchSha } = await import('../src/github.js');
      const sha = await getDefaultBranchSha('acme/widgets');

      expect(mockReposGet).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' });
      expect(mockGetRef).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        ref: 'heads/main',
      });
      expect(sha).toBe('def456');
    });
  });

  describe('mergePR', () => {
    it('calls octokit.pulls.merge with squash by default', async () => {
      mockPullsMerge.mockResolvedValue({ data: {} });

      const { mergePR } = await import('../src/github.js');
      await mergePR('acme/widgets', 10);

      expect(mockPullsMerge).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        pull_number: 10,
        merge_method: 'squash',
      });
    });

    it('respects custom merge method', async () => {
      mockPullsMerge.mockResolvedValue({ data: {} });

      const { mergePR } = await import('../src/github.js');
      await mergePR('acme/widgets', 10, 'rebase');

      expect(mockPullsMerge).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        pull_number: 10,
        merge_method: 'rebase',
      });
    });
  });

  describe('createPR', () => {
    it('calls octokit.pulls.create and returns PR number', async () => {
      mockPullsCreate.mockResolvedValue({
        data: { number: 99 },
      });

      const { createPR } = await import('../src/github.js');
      const prNumber = await createPR(
        'acme/widgets',
        'feature-branch',
        'main',
        'Add feature',
        'PR body'
      );

      expect(mockPullsCreate).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        head: 'feature-branch',
        base: 'main',
        title: 'Add feature',
        body: 'PR body',
      });
      expect(prNumber).toBe(99);
    });
  });

  describe('dispatchWorkflow', () => {
    it('calls octokit.actions.createWorkflowDispatch with correct params', async () => {
      mockReposGet.mockResolvedValue({
        data: { default_branch: 'main' },
      });
      mockCreateWorkflowDispatch.mockResolvedValue({ data: {} });

      const { dispatchWorkflow } = await import('../src/github.js');
      await dispatchWorkflow('acme/widgets', 'ci.yml', { branch: 'dev' });

      expect(mockCreateWorkflowDispatch).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        workflow_id: 'ci.yml',
        ref: 'main',
        inputs: { branch: 'dev' },
      });
    });
  });

  describe('closeIssue', () => {
    it('closes the issue', async () => {
      mockIssuesUpdate.mockResolvedValue({ data: {} });

      const { closeIssue } = await import('../src/github.js');
      await closeIssue('acme/widgets', 42);

      expect(mockIssuesUpdate).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        issue_number: 42,
        state: 'closed',
      });
    });

    it('adds labels when provided', async () => {
      mockIssuesUpdate.mockResolvedValue({ data: {} });
      mockAddLabels.mockResolvedValue({ data: {} });

      const { closeIssue } = await import('../src/github.js');
      await closeIssue('acme/widgets', 42, ['done', 'automated']);

      expect(mockAddLabels).toHaveBeenCalledWith({
        owner: 'acme',
        repo: 'widgets',
        issue_number: 42,
        labels: ['done', 'automated'],
      });
    });

    it('does not add labels when array is empty', async () => {
      mockIssuesUpdate.mockResolvedValue({ data: {} });

      const { closeIssue } = await import('../src/github.js');
      await closeIssue('acme/widgets', 42, []);

      expect(mockAddLabels).not.toHaveBeenCalled();
    });
  });
});
