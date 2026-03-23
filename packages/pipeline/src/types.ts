export type CanductorEvents = {
  'canductor/issue.assigned': {
    data: { issueNumber: number; repo: string; agent?: string };
  };
  'canductor/pr.opened': {
    data: { prNumber: number; branch: string; repo: string };
  };
  'canductor/pr.reviewed': {
    data: {
      prNumber: number;
      branch: string;
      repo: string;
      approved: boolean;
      feedback?: string;
      reviewRound?: number;
    };
  };
  'canductor/ci.completed': {
    data: {
      prNumber: number;
      branch: string;
      repo: string;
      passed: boolean;
    };
  };
  'canductor/story.completed': {
    data: { issueNumber: number; repo: string };
  };
  'canductor/verify.requested': {
    data: { branch: string; repo: string; issueNumber?: number };
  };
  'canductor/verify.completed': {
    data: {
      branch: string;
      repo: string;
      issueNumber?: number;
      score: number;
      decision: 'auto_merge' | 'human_review' | 'block';
      passed: boolean;
    };
  };
};
