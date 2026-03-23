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
    const { stdout, exitCode } = runCli('init', initDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Created .canductor/config.yaml');
    expect(existsSync(join(initDir, '.canductor', 'config.yaml'))).toBe(true);
  });

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
