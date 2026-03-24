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
  type: 'deterministic' | 'screenshot-diff' | 'agent-review' | 'guardrail';
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
  /** File globs to scan (guardrail layers). */
  include?: string[];
  /** File globs to exclude (guardrail layers). */
  exclude?: string[];
  /** Forbidden patterns to match (guardrail layers). */
  patterns?: GuardrailPattern[];
  /** Weight for composite scoring (0-1). */
  weight: number;
  /** Whether this layer can run in parallel with others. Defaults to true for deterministic/guardrail. */
  parallel?: boolean;
  /** Max execution time in milliseconds. Defaults vary by layer type. */
  timeout_ms?: number;
}

/** A pattern to match in guardrail scanning. */
export interface GuardrailPattern {
  pattern: string;
  message: string;
}

/** A single guardrail violation found in a file. */
export interface GuardrailViolation {
  file: string;
  line: number;
  pattern: string;
  message: string;
  match: string;
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

/** Summary info for a configured verification layer. */
export interface LayerInfo {
  name: string;
  type: LayerConfig['type'];
  weight: number;
  detail: string;
}

/** Result of running a single verification layer. */
export interface LayerResult {
  name: string;
  type: LayerConfig['type'];
  pass: boolean;
  score: number;       // 0-100
  errors: string;
  duration_ms: number;
  /** Whether this layer was killed due to exceeding timeout_ms. */
  timed_out?: boolean;
}

/** Options for the verify() function. */
export interface VerifyOptions {
  /** When true, log full layer output instead of truncating. */
  verbose?: boolean;
  /** Custom logger function. Defaults to console.log when verbose is true. */
  logger?: (msg: string) => void;
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
  /** Wall-clock time for the entire verification run in milliseconds. */
  wall_clock_ms: number;
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

/** Detected project toolchain from package.json and lock files. */
export interface ProjectToolchain {
  packageManager: 'pnpm' | 'npm' | 'yarn';
  testCmd: string;
  typecheckCmd: string;
  buildCmd: string | null;
}

/** Parsed YAML frontmatter from a SKILL.md file. */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
  tags?: string[];
}

/** Result of linting a single SKILL.md file. */
export interface SkillLintResult {
  path: string;
  frontmatter: SkillFrontmatter | null;
  errors: string[];
  valid: boolean;
}

/** A detected stall — same ref attempted multiple times with no score improvement. */
export interface StallDetection {
  ref: string;
  attempts: number;
  scores: number[];
  scoreRange: { min: number; max: number };
  suggestion: string;
}

/** Co-failure correlation between two verification layers. */
export interface LayerCorrelation {
  layer1: string;
  layer2: string;
  coFailures: number;
  eitherFailed: number;
  ratio: number;
}

/** Score trajectory for a single verification layer over time. */
export interface LayerTrajectory {
  layer: string;
  direction: 'improving' | 'declining' | 'stable';
  slope: number;
  recentScores: number[];
}

/** Trajectory analysis across all layers and overall composite score. */
export interface TrajectoryAnalysis {
  overall: LayerTrajectory;
  layers: LayerTrajectory[];
}

/** A single issue found during config validation. */
export interface ConfigValidationIssue {
  level: 'error' | 'warning';
  message: string;
  path?: string;
}

/** Result of validating a canductor config file. */
export interface ConfigValidation {
  valid: boolean;
  errors: ConfigValidationIssue[];
  warnings: ConfigValidationIssue[];
}

/** Combined insights from trajectory analysis and layer failure correlations. */
export interface InsightsResult {
  trajectory: TrajectoryAnalysis;
  correlations: LayerCorrelation[];
  recommendations: string[];
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
  /** Detected stalls — refs with 3+ attempts and no score improvement. */
  stalls: StallDetection[];
}
