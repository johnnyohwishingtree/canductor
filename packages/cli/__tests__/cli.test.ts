import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_PATH = join(__dirname, '..', 'dist', 'cli.js');
const TEST_DIR = join(tmpdir(), `canductor-cli-test-${Date.now()}`);

const MINIMAL_CONFIG = `version: 1

layers:
  echo_test:
    name: echo_test
    type: deterministic
    run: "echo ok"
    weight: 1.0

policy:
  auto_merge: "all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`;

function runCli(
  args: string,
  cwd?: string
): { stdout: string; exitCode: number } {
  const opts: ExecSyncOptionsWithStringEncoding = {
    encoding: 'utf-8',
    cwd: cwd ?? TEST_DIR,
    env: { ...process.env, ANTHROPIC_API_KEY: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, opts);
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (error.stdout ?? '') + (error.stderr ?? ''),
      exitCode: error.status ?? 1,
    };
  }
}

function setupConfig(dir: string, config?: string): void {
  const canductorDir = join(dir, '.canductor');
  mkdirSync(canductorDir, { recursive: true });
  writeFileSync(join(canductorDir, 'config.yaml'), config ?? MINIMAL_CONFIG);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canductor help', () => {
  it('outputs usage text', () => {
    const { stdout, exitCode } = runCli('help');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('canductor');
    expect(stdout).toContain('verify');
    expect(stdout).toContain('init');
    expect(stdout).toContain('history');
  });

  it('outputs usage for --help flag', () => {
    const { stdout, exitCode } = runCli('--help');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('canductor');
  });
});

describe('canductor init', () => {
  let initDir: string;

  beforeEach(() => {
    initDir = join(TEST_DIR, `init-${Date.now()}`);
    mkdirSync(initDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(initDir, { recursive: true, force: true });
  });

  it('creates config file in target directory', () => {
    // Provide a package.json so init generates fast commands for first verification
    writeFileSync(join(initDir, 'package.json'), JSON.stringify({
      scripts: { test: 'echo ok', typecheck: 'echo ok' },
    }));
    const { stdout, exitCode } = runCli('init', initDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Created .canductor/config.yaml');
    expect(existsSync(join(initDir, '.canductor', 'config.yaml'))).toBe(true);
  }, 30000);

  it('reports existing config without overwriting', () => {
    setupConfig(initDir);
    const { stdout, exitCode } = runCli('init', initDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('already exists');
  });
});

describe('canductor verify', () => {
  let verifyDir: string;

  beforeEach(() => {
    verifyDir = join(TEST_DIR, `verify-${Date.now()}`);
    mkdirSync(verifyDir, { recursive: true });
    setupConfig(verifyDir);
  });

  afterEach(() => {
    rmSync(verifyDir, { recursive: true, force: true });
  });

  it('runs verification and outputs decision', () => {
    const { stdout, exitCode } = runCli('verify test-ref', verifyDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Composite score:');
    expect(stdout).toContain('Decision:');
    expect(stdout).toContain('Result logged to .canductor/results.tsv');
  });

  it('outputs valid JSON with --json flag', () => {
    const { stdout, exitCode } = runCli('verify test-ref --json', verifyDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('score');
    expect(parsed).toHaveProperty('decision');
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('passed');
    expect(typeof parsed.score).toBe('number');
  });

  it('outputs self-review prompt with --self-review flag', () => {
    // Config with an agent-review layer
    const configWithReview = `version: 1
layers:
  echo_test:
    name: echo_test
    type: deterministic
    run: "echo ok"
    weight: 1.0
  code_quality:
    name: code_quality
    type: agent-review
    rubric: "${join(verifyDir, 'rubric.md').replace(/\\/g, '/')}"
    context: []
    weight: 0.6
policy:
  auto_merge: "all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`;
    writeFileSync(join(verifyDir, 'rubric.md'), '# Test Rubric\n- Check things');
    setupConfig(verifyDir, configWithReview);

    const { stdout, exitCode } = runCli('verify --self-review', verifyDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('CANDUCTOR SELF-REVIEW');
    expect(stdout).toContain('Test Rubric');
  });

  it('accepts --review-json and uses it for scoring', () => {
    const reviewJson = '{"pass":true,"score":90,"issues":[],"summary":"Good"}';
    const { stdout, exitCode } = runCli(
      `verify test-ref --review-json '${reviewJson}'`,
      verifyDir
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Decision:');
  });
});

describe('canductor history', () => {
  let histDir: string;

  beforeEach(() => {
    histDir = join(TEST_DIR, `hist-${Date.now()}`);
    mkdirSync(histDir, { recursive: true });
    setupConfig(histDir);
  });

  afterEach(() => {
    rmSync(histDir, { recursive: true, force: true });
  });

  it('shows empty message when no results', () => {
    const { stdout, exitCode } = runCli('history', histDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No results yet');
  });

  it('shows results table after verification', () => {
    // First run a verify to create results
    runCli('verify hist-test', histDir);

    const { stdout, exitCode } = runCli('history', histDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('ref');
    expect(stdout).toContain('score');
    expect(stdout).toContain('hist-test');
  });
});

describe('canductor status', () => {
  let statusDir: string;

  beforeEach(() => {
    statusDir = join(TEST_DIR, `status-${Date.now()}`);
    mkdirSync(statusDir, { recursive: true });
    setupConfig(statusDir);
  });

  afterEach(() => {
    rmSync(statusDir, { recursive: true, force: true });
  });

  it('shows empty message when no results', () => {
    const { stdout, exitCode } = runCli('status', statusDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No results yet');
  });

  it('shows status overview after verification', () => {
    runCli('verify status-test', statusDir);

    const { stdout, exitCode } = runCli('status', statusDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Canductor Status');
    expect(stdout).toContain('Results:');
    expect(stdout).toContain('Baseline:');
  });
});

describe('canductor skill-lint', () => {
  let lintDir: string;

  beforeEach(() => {
    lintDir = join(TEST_DIR, `skill-lint-${Date.now()}`);
    mkdirSync(lintDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(lintDir, { recursive: true, force: true });
  });

  it('outputs PASS for valid SKILL.md files', () => {
    const skillDir = join(lintDir, '.claude', 'skills', 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: test-skill',
      'description: A test skill',
      '---',
      '',
      '# /test-skill',
      '',
      'This skill does testing.',
      '',
      '## Usage',
      '```',
      '/test-skill',
      '```',
      '',
    ].join('\n'));

    const { stdout, exitCode } = runCli('skill-lint', lintDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PASS');
  });

  it('outputs FAIL for invalid SKILL.md files', () => {
    const skillDir = join(lintDir, '.claude', 'skills', 'bad-skill');
    mkdirSync(skillDir, { recursive: true });
    // Missing frontmatter and required sections
    writeFileSync(join(skillDir, 'SKILL.md'), 'Just some text\n');

    const { stdout, exitCode } = runCli('skill-lint', lintDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('FAIL');
  });

  it('outputs no skills message when no skills directory', () => {
    const { stdout, exitCode } = runCli('skill-lint', lintDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No SKILL.md files found');
  });
});

describe('canductor verify with guardrail layer', () => {
  let guardDir: string;

  beforeEach(() => {
    guardDir = join(TEST_DIR, `guardrail-verify-${Date.now()}`);
    mkdirSync(guardDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(guardDir, { recursive: true, force: true });
  });

  it('detects guardrail violations in output', () => {
    const srcDir = join(guardDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'bad.ts'), 'const x = eval("code");\n');

    const guardrailConfig = `version: 1
layers:
  security:
    name: security
    type: guardrail
    include:
      - "src/**/*.ts"
    patterns:
      - pattern: "eval\\\\("
        message: "Do not use eval()"
    weight: 1.0
policy:
  auto_merge: "all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`;
    setupConfig(guardDir, guardrailConfig);

    const { stdout, exitCode } = runCli('verify guard-ref', guardDir);
    // Guardrails are treated as deterministic for policy — violation triggers block + exit 1
    expect(exitCode).toBe(1);
    expect(stdout).toContain('FAIL');
    expect(stdout).toContain('eval(');
  });

  it('passes with clean guardrail layer', () => {
    const srcDir = join(guardDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'clean.ts'), 'const x = 42;\n');

    const guardrailConfig = `version: 1
layers:
  security:
    name: security
    type: guardrail
    include:
      - "src/**/*.ts"
    patterns:
      - pattern: "eval\\\\("
        message: "Do not use eval()"
    weight: 1.0
policy:
  auto_merge: "all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`;
    setupConfig(guardDir, guardrailConfig);

    const { stdout, exitCode } = runCli('verify guard-ref', guardDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PASS');
    expect(stdout).toContain('auto_merge');
  });
});

// ---------------------------------------------------------------------------
// Score, Trend, Diff commands (#56)
// ---------------------------------------------------------------------------

describe('canductor score', () => {
  let scoreDir: string;

  beforeEach(() => {
    scoreDir = join(TEST_DIR, `score-${Date.now()}`);
    mkdirSync(scoreDir, { recursive: true });
    setupConfig(scoreDir);
  });

  afterEach(() => {
    rmSync(scoreDir, { recursive: true, force: true });
  });

  it('outputs a numeric score and exits 0', () => {
    const { stdout, exitCode } = runCli('score test-ref', scoreDir);
    expect(exitCode).toBe(0);
    const score = parseInt(stdout.trim(), 10);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('canductor trend', () => {
  let trendDir: string;

  beforeEach(() => {
    trendDir = join(TEST_DIR, `trend-${Date.now()}`);
    mkdirSync(trendDir, { recursive: true });
    setupConfig(trendDir);
  });

  afterEach(() => {
    rmSync(trendDir, { recursive: true, force: true });
  });

  it('shows empty message when no results', () => {
    const { stdout, exitCode } = runCli('trend', trendDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No results yet');
  });

  it('shows trend data with scores after verification', () => {
    // Populate results
    runCli('verify trend-ref-1', trendDir);
    runCli('verify trend-ref-2', trendDir);

    const { stdout, exitCode } = runCli('trend', trendDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Canductor Trend');
    expect(stdout).toContain('trend-ref-1');
    expect(stdout).toContain('trend-ref-2');
    expect(stdout).toContain('Avg:');
  });

  it('limits output with --last flag', () => {
    // Populate 3 results
    runCli('verify trend-a', trendDir);
    runCli('verify trend-b', trendDir);
    runCli('verify trend-c', trendDir);

    const { stdout, exitCode } = runCli('trend --last 2', trendDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Canductor Trend (last 2 results)');
    // Should show only 2 entries, not 3
    expect(stdout).not.toContain('trend-a');
    expect(stdout).toContain('trend-b');
    expect(stdout).toContain('trend-c');
  });

  it('shows direction indicator with multiple results', () => {
    runCli('verify trend-d1', trendDir);
    runCli('verify trend-d2', trendDir);

    const { stdout, exitCode } = runCli('trend', trendDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Direction:');
  });
});

describe('canductor diff', () => {
  let diffDir: string;

  beforeEach(() => {
    diffDir = join(TEST_DIR, `diff-${Date.now()}`);
    mkdirSync(diffDir, { recursive: true });
    setupConfig(diffDir);
  });

  afterEach(() => {
    rmSync(diffDir, { recursive: true, force: true });
  });

  it('outputs score comparison and layer breakdown', () => {
    runCli('verify diff-ref-1', diffDir);
    runCli('verify diff-ref-2', diffDir);

    const { stdout, exitCode } = runCli('diff diff-ref-1 diff-ref-2', diffDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Diff: diff-ref-1');
    expect(stdout).toContain('diff-ref-2');
    expect(stdout).toContain('Composite score:');
    expect(stdout).toContain('Layer breakdown:');
  });

  it('exits 1 with usage message when missing args', () => {
    const { stdout, exitCode } = runCli('diff', diffDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Usage: canductor diff');
  });

  it('exits 1 with one arg missing', () => {
    const { stdout, exitCode } = runCli('diff only-one', diffDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Usage: canductor diff');
  });

  it('exits 1 with error for unknown refs', () => {
    // Populate one result so results file exists
    runCli('verify known-ref', diffDir);

    const { stdout, exitCode } = runCli('diff unknown-1 unknown-2', diffDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Ref not found');
  });
});

describe('unknown command', () => {
  it('shows error and usage for unknown commands', () => {
    const { stdout, exitCode } = runCli('nonexistent');
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Unknown command: nonexistent');
    expect(stdout).toContain('canductor');
  });
});

// Cleanup top-level test dir
afterEach(() => {
  // Individual test suites clean their own dirs
});

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});
