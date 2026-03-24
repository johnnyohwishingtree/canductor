import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
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

  it('exits 0 when score is above --exit-code threshold', () => {
    const { stdout, exitCode } = runCli('verify test-ref --exit-code=50', verifyDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Decision:');
  });

  it('exits 1 when score is below --exit-code threshold', () => {
    const { stdout, exitCode } = runCli('verify test-ref --exit-code=101', verifyDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('below threshold');
  });

  it('--exit-code=auto uses baseline as threshold', () => {
    const { exitCode } = runCli('verify test-ref --exit-code=auto', verifyDir);
    // echo_test scores 100, baseline defaults to 0 for first run, so should pass
    expect(exitCode).toBe(0);
  });

  it('--exit-code works with --json and includes threshold', () => {
    const { stdout, exitCode } = runCli('verify test-ref --exit-code=50 --json', verifyDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('threshold', 50);
    expect(parsed).toHaveProperty('passed', true);
  });

  it('--exit-code with --json shows passed=false when below threshold', () => {
    const { stdout, exitCode } = runCli('verify test-ref --exit-code=101 --json', verifyDir);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('threshold', 101);
    expect(parsed).toHaveProperty('passed', false);
  });

  it('--verbose shows layer output in stdout', () => {
    const { stdout, exitCode } = runCli('verify test-ref --verbose', verifyDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('[echo_test]');
    expect(stdout).toContain('ok');
  });

  it('--verbose --json includes verbose_output array', () => {
    const { stdout, exitCode } = runCli('verify test-ref --verbose --json', verifyDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim().split('\n').pop()!);
    expect(parsed).toHaveProperty('verbose_output');
    expect(Array.isArray(parsed.verbose_output)).toBe(true);
    expect(parsed.verbose_output.length).toBeGreaterThan(0);
    expect(parsed.verbose_output.some((m: string) => m.includes('ok'))).toBe(true);
  });

  it('without --verbose does not include verbose_output in JSON', () => {
    const { stdout, exitCode } = runCli('verify test-ref --json', verifyDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).not.toHaveProperty('verbose_output');
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

  it('outputs valid JSON array with --json flag when no results', () => {
    const { stdout, exitCode } = runCli('history --json', histDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
  });

  it('outputs valid JSON array with --json flag after verification', () => {
    runCli('verify hist-json', histDir);

    const { stdout, exitCode } = runCli('history --json', histDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('ref');
    expect(parsed[0]).toHaveProperty('composite_score');
    expect(parsed[0]).toHaveProperty('decision');
    expect(parsed[0]).toHaveProperty('status');
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

  it('outputs valid JSON with --json flag when no results', () => {
    const { stdout, exitCode } = runCli('status --json', statusDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('total', 0);
  });

  it('outputs valid JSON with --json flag after verification', () => {
    runCli('verify status-json', statusDir);

    const { stdout, exitCode } = runCli('status --json', statusDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('total');
    expect(parsed).toHaveProperty('merged');
    expect(parsed).toHaveProperty('baseline');
    expect(parsed).toHaveProperty('lastScore');
    expect(typeof parsed.total).toBe('number');
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

  it('outputs valid JSON with --json flag when no results', () => {
    const { stdout, exitCode } = runCli('trend --json', trendDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('entries');
    expect(Array.isArray(parsed.entries)).toBe(true);
  });

  it('outputs valid JSON with --json flag after verification', () => {
    runCli('verify trend-json-1', trendDir);
    runCli('verify trend-json-2', trendDir);

    const { stdout, exitCode } = runCli('trend --json', trendDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('entries');
    expect(parsed).toHaveProperty('avg');
    expect(parsed).toHaveProperty('best');
    expect(parsed).toHaveProperty('worst');
    expect(parsed.entries.length).toBeGreaterThan(0);
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

  it('outputs valid JSON with --json flag', () => {
    runCli('verify diff-j1', diffDir);
    runCli('verify diff-j2', diffDir);

    const { stdout, exitCode } = runCli('diff diff-j1 diff-j2 --json', diffDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('ref1', 'diff-j1');
    expect(parsed).toHaveProperty('ref2', 'diff-j2');
    expect(parsed).toHaveProperty('composite1');
    expect(parsed).toHaveProperty('composite2');
    expect(parsed).toHaveProperty('delta');
    expect(parsed).toHaveProperty('layers');
    expect(typeof parsed.delta).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Baseline, Result-update, Context, Inject, Suggest commands (#57)
// ---------------------------------------------------------------------------

describe('canductor baseline', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(TEST_DIR, `baseline-${Date.now()}`);
    mkdirSync(baseDir, { recursive: true });
    setupConfig(baseDir);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('shows current baseline', () => {
    const { stdout, exitCode } = runCli('baseline', baseDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Current baseline:');
    expect(stdout).toContain('/100');
  });

  it('sets baseline with --set flag', () => {
    const { stdout, exitCode } = runCli('baseline --set 85', baseDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Baseline set to 85/100');
  });

  it('exits 1 with error for --set with invalid value', () => {
    const { stdout, exitCode } = runCli('baseline --set invalid', baseDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Usage: canductor baseline --set');
  });

  it('computes and sets baseline with --auto', () => {
    // Populate some results first
    runCli('verify auto-base-1', baseDir);
    runCli('verify auto-base-2', baseDir);

    const { stdout, exitCode } = runCli('baseline --auto', baseDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Baseline set to');
    expect(stdout).toContain('computed from last 5 merged scores');
  });

  it('outputs valid JSON with --json flag', () => {
    const { stdout, exitCode } = runCli('baseline --json', baseDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('baseline');
    expect(typeof parsed.baseline).toBe('number');
  });
});

describe('canductor result-update', () => {
  let ruDir: string;

  beforeEach(() => {
    ruDir = join(TEST_DIR, `result-update-${Date.now()}`);
    mkdirSync(ruDir, { recursive: true });
    setupConfig(ruDir);
  });

  afterEach(() => {
    rmSync(ruDir, { recursive: true, force: true });
  });

  it('updates status and confirms', () => {
    runCli('verify ru-ref', ruDir);

    const { stdout, exitCode } = runCli('result-update ru-ref merged', ruDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Updated result for ref "ru-ref" to status "merged"');
  });

  it('exits 1 with usage when missing args', () => {
    const { stdout, exitCode } = runCli('result-update', ruDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Usage: canductor result-update');
  });

  it('exits 1 with error for invalid status', () => {
    runCli('verify ru-ref2', ruDir);

    const { stdout, exitCode } = runCli('result-update ru-ref2 invalid', ruDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Invalid status: invalid');
  });

  it('exits 1 with not-found error for unknown ref', () => {
    const { stdout, exitCode } = runCli('result-update unknown-ref merged', ruDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Ref not found');
  });
});

describe('canductor context', () => {
  let ctxDir: string;

  beforeEach(() => {
    ctxDir = join(TEST_DIR, `context-${Date.now()}`);
    mkdirSync(ctxDir, { recursive: true });
    setupConfig(ctxDir);
  });

  afterEach(() => {
    rmSync(ctxDir, { recursive: true, force: true });
  });

  it('outputs quality context text', () => {
    const { stdout, exitCode } = runCli('context', ctxDir);
    expect(exitCode).toBe(0);
    // Context should contain some quality-related output
    expect(typeof stdout).toBe('string');
    expect(stdout.length).toBeGreaterThan(0);
  });
});

describe('canductor inject', () => {
  let injectDir: string;

  beforeEach(() => {
    injectDir = join(TEST_DIR, `inject-${Date.now()}`);
    mkdirSync(injectDir, { recursive: true });
    setupConfig(injectDir);
  });

  afterEach(() => {
    rmSync(injectDir, { recursive: true, force: true });
  });

  it('injects context into a target file', () => {
    // Create a target file with canductor markers
    const targetFile = join(injectDir, 'TARGET.md');
    writeFileSync(targetFile, '# My File\n\n<!-- canductor:begin -->\n<!-- canductor:end -->\n');

    // Run a verify first to have some results
    runCli('verify inject-ref', injectDir);

    const { stdout, exitCode } = runCli('inject TARGET.md', injectDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Injected quality context into TARGET.md');

    // Verify the file was actually modified
    const content = readFileSync(targetFile, 'utf-8');
    expect(content).toContain('canductor');
  });

  it('exits 1 with usage when no args', () => {
    const { stdout, exitCode } = runCli('inject', injectDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Usage: canductor inject');
  });
});

describe('canductor suggest', () => {
  let suggestDir: string;

  beforeEach(() => {
    suggestDir = join(TEST_DIR, `suggest-${Date.now()}`);
    mkdirSync(suggestDir, { recursive: true });
    setupConfig(suggestDir);
  });

  afterEach(() => {
    rmSync(suggestDir, { recursive: true, force: true });
  });

  it('outputs suggestions or no-improvements message', () => {
    const { stdout, exitCode } = runCli('suggest', suggestDir);
    expect(exitCode).toBe(0);
    // Either shows suggestions or "no improvements" message
    expect(
      stdout.includes('No rule improvements suggested') ||
      stdout.includes('confidence')
    ).toBe(true);
  });
});

describe('canductor layer-test', () => {
  beforeEach(() => setupConfig(TEST_DIR));

  it('runs a passing layer and shows result', () => {
    const { stdout, exitCode } = runCli('layer-test echo_test');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PASS');
    expect(stdout).toContain('echo_test');
    expect(stdout).toContain('Score: 100/100');
  });

  it('outputs JSON with --json flag', () => {
    const { stdout, exitCode } = runCli('layer-test echo_test --json');
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.name).toBe('echo_test');
    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('shows error for unknown layer name', () => {
    const { stdout, exitCode } = runCli('layer-test nonexistent');
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Layer not found: nonexistent');
    expect(stdout).toContain('Available layers:');
  });

  it('shows usage when no layer name provided', () => {
    const { stdout, exitCode } = runCli('layer-test');
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Usage:');
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

describe('canductor tasks', () => {
  let tasksDir: string;

  beforeEach(() => {
    tasksDir = join(TEST_DIR, `tasks-${Date.now()}`);
    mkdirSync(tasksDir, { recursive: true });
    setupConfig(tasksDir);
  });

  afterEach(() => {
    rmSync(tasksDir, { recursive: true, force: true });
  });

  it('shows "No task data yet" when tasks.tsv does not exist', () => {
    const { stdout, exitCode } = runCli('tasks', tasksDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No task data yet');
  });

  it('shows task type table when tasks.tsv has data', () => {
    const canductorDir = join(tasksDir, '.canductor');
    const header = 'task_type\tguided_by\tref\tverify_cycle\tfailure\ttimestamp';
    const row1 = 'module\t.canductor/templates/module.md\t#1\t1\tnone\t2026-03-24T00:00:00Z';
    const row2 = 'module\t.canductor/templates/module.md\t#2\t2\ttype error\t2026-03-24T01:00:00Z';
    const row3 = 'module\t.canductor/templates/module.md\t#2\t2\tnone\t2026-03-24T01:01:00Z';
    const row4 = 'test\t.canductor/templates/test.md\t#1\t1\tnone\t2026-03-24T00:00:00Z';
    writeFileSync(join(canductorDir, 'tasks.tsv'), [header, row1, row2, row3, row4].join('\n'));

    const { stdout, exitCode } = runCli('tasks', tasksDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Task Type Performance');
    expect(stdout).toContain('module');
    expect(stdout).toContain('test');
  });
});

describe('canductor insights', () => {
  let insightsDir: string;

  beforeEach(() => {
    insightsDir = join(TEST_DIR, `insights-${Date.now()}`);
    mkdirSync(insightsDir, { recursive: true });
    setupConfig(insightsDir);
  });

  afterEach(() => {
    rmSync(insightsDir, { recursive: true, force: true });
  });

  it('shows insights with recommendations after verification', () => {
    runCli('verify ins-ref-1', insightsDir);
    runCli('verify ins-ref-2', insightsDir);

    const { stdout, exitCode } = runCli('insights', insightsDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Canductor Insights');
    expect(stdout).toContain('Overall:');
    expect(stdout).toContain('Recommendations:');
  });

  it('outputs valid JSON with --json flag', () => {
    runCli('verify ins-json-1', insightsDir);

    const { stdout, exitCode } = runCli('insights --json', insightsDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('trajectory');
    expect(parsed).toHaveProperty('correlations');
    expect(parsed).toHaveProperty('recommendations');
    expect(parsed.trajectory).toHaveProperty('overall');
    expect(parsed.trajectory).toHaveProperty('layers');
  });

  it('handles no results gracefully', () => {
    const { stdout, exitCode } = runCli('insights', insightsDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Canductor Insights');
    expect(stdout).toContain('Overall:');
  });
});

describe('canductor health', () => {
  let healthDir: string;

  beforeEach(() => {
    healthDir = join(TEST_DIR, `health-${Date.now()}`);
    mkdirSync(healthDir, { recursive: true });
    setupConfig(healthDir);
  });

  afterEach(() => {
    rmSync(healthDir, { recursive: true, force: true });
  });

  it('shows unified health view with section headers', () => {
    runCli('verify health-test', healthDir);

    const { stdout, exitCode } = runCli('health', healthDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Pipeline');
    expect(stdout).toContain('Results');
    expect(stdout).toContain('Tasks');
    expect(stdout).toContain('Config');
    expect(stdout).toContain('Branches');
    expect(stdout).toContain('Findings');
  });

  it('outputs valid JSON with --json flag', () => {
    runCli('verify health-json', healthDir);

    const { stdout, exitCode } = runCli('health --json', healthDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('status');
    expect(parsed).toHaveProperty('taskPerformance');
    expect(parsed).toHaveProperty('configValidation');
    expect(parsed).toHaveProperty('staleBranches');
    expect(parsed).toHaveProperty('findings');
  });

  it('shows healthy message when no issues', () => {
    runCli('verify health-ok', healthDir);

    const { stdout, exitCode } = runCli('health', healthDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Pipeline healthy');
  });

  it('shows no results message when repo has no data', () => {
    const { stdout, exitCode } = runCli('health', healthDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No results yet');
  });
});

describe('canductor config-check', () => {
  let configCheckDir: string;

  beforeEach(() => {
    configCheckDir = join(TEST_DIR, `config-check-${Date.now()}`);
    mkdirSync(configCheckDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(configCheckDir, { recursive: true, force: true });
  });

  it('reports valid config with exit 0', () => {
    setupConfig(configCheckDir);
    const { stdout, exitCode } = runCli('config-check', configCheckDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Config is valid');
  });

  it('reports invalid config with exit 1', () => {
    setupConfig(configCheckDir, 'version: 999\n');
    const { stdout, exitCode } = runCli('config-check', configCheckDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('ERROR');
  });

  it('outputs valid JSON with --json flag', () => {
    setupConfig(configCheckDir);
    const { stdout, exitCode } = runCli('config-check --json', configCheckDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('valid');
    expect(parsed).toHaveProperty('errors');
    expect(parsed).toHaveProperty('warnings');
  });
});

describe('canductor report', () => {
  let reportDir: string;

  beforeEach(() => {
    reportDir = join(TEST_DIR, `report-${Date.now()}`);
    mkdirSync(reportDir, { recursive: true });
    setupConfig(reportDir);
  });

  afterEach(() => {
    rmSync(reportDir, { recursive: true, force: true });
  });

  it('outputs markdown text after verification', () => {
    runCli('verify report-test', reportDir);
    const { stdout, exitCode } = runCli('report', reportDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('#');
  });

  it('outputs valid JSON with --json flag', () => {
    runCli('verify report-json', reportDir);
    const { stdout, exitCode } = runCli('report --json', reportDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty('markdown');
  });
});

// Cleanup top-level test dir
afterEach(() => {
  // Individual test suites clean their own dirs
});

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});
