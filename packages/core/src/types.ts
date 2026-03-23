/**
 * Canductor core types.
 *
 * A verification layer evaluates one dimension of agent output quality.
 * Layers compose into a verification config. Results accumulate in a
 * results log (TSV) that feeds back into agent prompts.
 */

/** A single verification layer definition. */
export interface LayerConfig {
  name: string;
  type: 'deterministic' | 'screenshot-diff' | 'agent-review';
  /** Shell command to run (deterministic layers). */
  run?: string;
  /** Command to capture screenshots (screenshot-diff layers). */
  capture?: string;
  /** Directory containing baseline screenshots. */
  baseline?: string;
  /** Max allowed pixel diff percentage (screenshot-diff layers). */
  threshold?: number;
  /** LLM model to use (agent-review layers). */
  model?: string;
  /** Path to rubric markdown file (agent-review layers). */
  rubric?: string;
  /** Paths to include as context for agent-review. */
  context?: string[];
  /** Weight for composite scoring (0-1). */
  weight: number;
}

/** Policy for auto-merge / human-review / block decisions. */
export interface PolicyConfig {
  auto_merge: string;
  human_review: string;
  block: string;
}

/** Top-level canductor configuration (.canductor/config.yaml). */
export interface CanductorConfig {
  version: 1;
  layers: Record<string, LayerConfig>;
  policy: PolicyConfig;
  /** Optional baseline override. When set, takes precedence over computed baseline. */
  baseline?: number;
}

/** Result of running a single verification layer. */
export interface LayerResult {
  name: string;
  type: LayerConfig['type'];
  pass: boolean;
  score: number;       // 0-100
  errors: string;
  duration_ms: number;
}

/** Result of a full verification run (all layers). */
export interface VerifyResult {
  /** Git ref (PR number, branch, or commit). */
  ref: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Individual layer results. */
  layers: LayerResult[];
  /** Weighted composite score (0-100). */
  composite_score: number;
  /** Policy decision. */
  decision: 'auto_merge' | 'human_review' | 'block';
  /** Human-readable summary. */
  summary: string;
}

/** A row in the results log (.canductor/results.tsv). */
export interface ResultRow {
  ref: string;
  timestamp: string;
  composite_score: number;
  decision: string;
  layer_scores: string;   // "tests:100,visual:95,ux:78"
  status: 'merged' | 'rejected' | 'pending';
  description: string;
}

/** Result of an agent review (LLM-evaluated). */
export interface AgentReviewResult {
  pass: boolean;
  score: number;        // 0-100
  issues: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; description: string }>;
  summary: string;
}

/** Structured prompt for self-review mode (no API key). */
export interface SelfReviewPrompt {
  systemPrompt: string;
  userPrompt: string;
  rubricContent: string;
  contextFileCount: number;
}

/** A suggested improvement to quality rules based on results history. */
export interface RuleImprovement {
  type: 'add_rule' | 'add_rubric_check' | 'update_baseline';
  description: string;
  content: string;  // The actual rule/check content to add
  confidence: number; // 0-1, based on how many times the pattern was seen
}

/** Context injected into agent prompts based on results history. */
export interface QualityContext {
  /** Recent results summary. */
  recent_results: ResultRow[];
  /** Recurring issues detected from history. */
  recurring_issues: string[];
  /** Suggested prompt additions based on patterns. */
  suggested_rules: string[];
  /** Current baseline composite score. */
  baseline_score: number;
}
