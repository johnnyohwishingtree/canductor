import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectToolchain, scaffoldRubric, runFirstVerification } from '../src/scaffold.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-scaffold-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writePackageJson(scripts: Record<string, string>): void {
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ scripts }));
}

function writeLockFile(name: string): void {
  writeFileSync(join(tempDir, name), '');
}

// ---------------------------------------------------------------------------
// detectToolchain
// ---------------------------------------------------------------------------
describe('detectToolchain', () => {
  it('detects pnpm project with all scripts', () => {
    writeLockFile('pnpm-lock.yaml');
    writePackageJson({ test: 'vitest', typecheck: 'tsc --noEmit', build: 'tsc' });

    const result = detectToolchain(tempDir);

    expect(result.packageManager).toBe('pnpm');
    expect(result.testCmd).toBe('pnpm test');
    expect(result.typecheckCmd).toBe('pnpm typecheck');
    expect(result.buildCmd).toBe('pnpm build');
  });

  it('detects yarn project', () => {
    writeLockFile('yarn.lock');
    writePackageJson({ test: 'jest' });

    const result = detectToolchain(tempDir);

    expect(result.packageManager).toBe('yarn');
    expect(result.testCmd).toBe('yarn test');
  });

  it('detects npm project when no lock file exists', () => {
    writePackageJson({ test: 'jest' });

    const result = detectToolchain(tempDir);

    expect(result.packageManager).toBe('npm');
    expect(result.testCmd).toBe('npm run test');
  });

  it('falls back to defaults when scripts are missing', () => {
    writeLockFile('pnpm-lock.yaml');
    writePackageJson({});

    const result = detectToolchain(tempDir);

    expect(result.packageManager).toBe('pnpm');
    expect(result.testCmd).toBe('npm test');
    expect(result.typecheckCmd).toBe('npx tsc --noEmit');
    expect(result.buildCmd).toBeNull();
  });

  it('handles missing package.json', () => {
    const result = detectToolchain(tempDir);

    expect(result.packageManager).toBe('npm');
    expect(result.testCmd).toBe('npm test');
    expect(result.typecheckCmd).toBe('npx tsc --noEmit');
    expect(result.buildCmd).toBeNull();
  });

  it('handles malformed package.json', () => {
    writeFileSync(join(tempDir, 'package.json'), 'not valid json');

    const result = detectToolchain(tempDir);

    expect(result.packageManager).toBe('npm');
    expect(result.testCmd).toBe('npm test');
    expect(result.typecheckCmd).toBe('npx tsc --noEmit');
    expect(result.buildCmd).toBeNull();
  });

  it('prefers pnpm over yarn when both lock files exist', () => {
    writeLockFile('pnpm-lock.yaml');
    writeLockFile('yarn.lock');
    writePackageJson({ test: 'vitest' });

    const result = detectToolchain(tempDir);

    expect(result.packageManager).toBe('pnpm');
  });

  it('returns null buildCmd when no build script exists', () => {
    writePackageJson({ test: 'vitest', typecheck: 'tsc' });

    const result = detectToolchain(tempDir);

    expect(result.buildCmd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scaffoldRubric
// ---------------------------------------------------------------------------
describe('scaffoldRubric', () => {
  it('creates rubric file and returns true', () => {
    const result = scaffoldRubric(tempDir);

    expect(result).toBe(true);
    const rubricPath = join(tempDir, '.canductor', 'rubrics', 'code-quality.md');
    expect(existsSync(rubricPath)).toBe(true);
  });

  it('rubric content follows template structure with weighted categories', () => {
    scaffoldRubric(tempDir);

    const content = readFileSync(
      join(tempDir, '.canductor', 'rubrics', 'code-quality.md'),
      'utf-8',
    );
    expect(content).toContain('# Code Quality Rubric');
    expect(content).toContain('weight: 30%');
    expect(content).toContain('weight: 20%');

    // Verify weights sum to 100%
    const weights = [...content.matchAll(/weight:\s*(\d+)%/g)].map(m => Number(m[1]));
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('does not overwrite existing rubric and returns false', () => {
    const rubricDir = join(tempDir, '.canductor', 'rubrics');
    mkdirSync(rubricDir, { recursive: true });
    const rubricPath = join(rubricDir, 'code-quality.md');
    writeFileSync(rubricPath, '# Custom rubric');

    const result = scaffoldRubric(tempDir);

    expect(result).toBe(false);
    expect(readFileSync(rubricPath, 'utf-8')).toBe('# Custom rubric');
  });

  it('creates nested directories if they do not exist', () => {
    scaffoldRubric(tempDir);

    expect(existsSync(join(tempDir, '.canductor', 'rubrics'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runFirstVerification
// ---------------------------------------------------------------------------

function writeConfig(dir: string, content: string): void {
  const configDir = join(dir, '.canductor');
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), content);
}

describe('runFirstVerification', () => {
  it('runs verification and returns result with score', async () => {
    writeConfig(tempDir, `version: 1
layers:
  check:
    name: check
    type: deterministic
    run: "echo ok"
    weight: 1.0
policy:
  auto_merge: "all_deterministic_pass"
  human_review: "false"
  block: "any_deterministic_fail"
`);

    const result = await runFirstVerification(tempDir);

    expect(result).not.toBeNull();
    expect(result!.composite_score).toBe(100);
    expect(result!.ref).toBe('init');
  });

  it('appends result to results.tsv', async () => {
    writeConfig(tempDir, `version: 1
layers:
  check:
    name: check
    type: deterministic
    run: "echo ok"
    weight: 1.0
policy:
  auto_merge: "all_deterministic_pass"
  human_review: "false"
  block: "any_deterministic_fail"
`);

    await runFirstVerification(tempDir);

    const resultsPath = join(tempDir, '.canductor', 'results.tsv');
    expect(existsSync(resultsPath)).toBe(true);
    const content = readFileSync(resultsPath, 'utf-8');
    expect(content).toContain('init');
    expect(content).toContain('Initial setup');
  });

  it('sets baseline in config', async () => {
    writeConfig(tempDir, `version: 1
layers:
  check:
    name: check
    type: deterministic
    run: "echo ok"
    weight: 1.0
policy:
  auto_merge: "all_deterministic_pass"
  human_review: "false"
  block: "any_deterministic_fail"
`);

    await runFirstVerification(tempDir);

    const configContent = readFileSync(join(tempDir, '.canductor', 'config.yaml'), 'utf-8');
    expect(configContent).toContain('baseline: 100');
  });

  it('returns null when config does not exist', async () => {
    const result = await runFirstVerification(tempDir);

    expect(result).toBeNull();
  });
});
