import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, writeConfigBaseline, validateConfig, listLayers } from '../src/config.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-config-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeConfig(content: string): void {
  const dir = join(tempDir, '.canductor');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.yaml'), content);
}

const minimalConfig = `version: 1
layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 1.0
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`;

describe('writeConfigBaseline', () => {
  it('adds baseline to existing config', () => {
    writeConfig(minimalConfig);
    writeConfigBaseline(tempDir, 80);

    const config = loadConfig(tempDir);
    expect(config.baseline).toBe(80);
  });

  it('updates existing baseline value', () => {
    writeConfig(minimalConfig + 'baseline: 50\n');
    writeConfigBaseline(tempDir, 90);

    const config = loadConfig(tempDir);
    expect(config.baseline).toBe(90);
  });

  it('throws when no config file exists', () => {
    expect(() => writeConfigBaseline(tempDir, 80)).toThrow('No canductor config found');
  });
});

describe('loadConfig with baseline', () => {
  it('loads config without baseline field', () => {
    writeConfig(minimalConfig);
    const config = loadConfig(tempDir);
    expect(config.baseline).toBeUndefined();
  });

  it('loads config with baseline field', () => {
    writeConfig(minimalConfig + 'baseline: 75\n');
    const config = loadConfig(tempDir);
    expect(config.baseline).toBe(75);
  });
});

describe('loadConfig validation', () => {
  it('loads a valid config successfully', () => {
    writeConfig(minimalConfig);
    const config = loadConfig(tempDir);
    expect(config.version).toBe(1);
    expect(config.layers.tests.name).toBe('tests');
    expect(config.layers.tests.type).toBe('deterministic');
    expect(config.layers.tests.weight).toBe(1.0);
  });

  it('throws when version is missing', () => {
    writeConfig(`layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 1.0
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    expect(() => loadConfig(tempDir)).toThrow();
  });

  it('throws when version is not 1', () => {
    writeConfig(minimalConfig.replace('version: 1', 'version: 2'));
    expect(() => loadConfig(tempDir)).toThrow();
  });

  it('throws when layer weight is missing', () => {
    writeConfig(`version: 1
layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    expect(() => loadConfig(tempDir)).toThrow();
  });

  it('throws when layer weight is a string', () => {
    writeConfig(minimalConfig.replace('weight: 1.0', 'weight: "high"'));
    expect(() => loadConfig(tempDir)).toThrow();
  });

  it('throws when layer type is unknown', () => {
    writeConfig(minimalConfig.replace('type: deterministic', 'type: magic'));
    expect(() => loadConfig(tempDir)).toThrow();
  });

  it('throws when policy is missing', () => {
    writeConfig(`version: 1
layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 1.0
`);
    expect(() => loadConfig(tempDir)).toThrow();
  });

  it('throws when no config file exists', () => {
    expect(() => loadConfig(tempDir)).toThrow('No canductor config found');
  });

  it('accepts all optional layer fields', () => {
    writeConfig(`version: 1
layers:
  review:
    name: review
    type: agent-review
    model: claude-sonnet-4-20250514
    rubric: rubrics/quality.md
    context:
      - src/
    weight: 0.5
  visual:
    name: visual
    type: screenshot-diff
    capture: "npm run screenshot"
    baseline: screenshots/
    threshold: 0.01
    weight: 0.5
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const config = loadConfig(tempDir);
    expect(config.layers.review.model).toBe('claude-sonnet-4-20250514');
    expect(config.layers.review.rubric).toBe('rubrics/quality.md');
    expect(config.layers.review.context).toEqual(['src/']);
    expect(config.layers.visual.capture).toBe('npm run screenshot');
    expect(config.layers.visual.baseline).toBe('screenshots/');
    expect(config.layers.visual.threshold).toBe(0.01);
  });

  it('includes field path in validation error message', () => {
    writeConfig(minimalConfig.replace('weight: 1.0', 'weight: "bad"'));
    try {
      loadConfig(tempDir);
      expect.fail('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('weight');
    }
  });
});

describe('loadConfig guardrail layer', () => {
  it('accepts a guardrail layer with include, exclude, and patterns', () => {
    writeConfig(`version: 1
layers:
  security:
    name: security
    type: guardrail
    include:
      - "src/**/*.ts"
    exclude:
      - "**/*.test.ts"
    patterns:
      - pattern: "eval\\\\("
        message: "Do not use eval()"
      - pattern: "console\\\\.log"
        message: "Remove console.log"
    weight: 0.3
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const config = loadConfig(tempDir);
    expect(config.layers.security.type).toBe('guardrail');
    expect(config.layers.security.include).toEqual(['src/**/*.ts']);
    expect(config.layers.security.exclude).toEqual(['**/*.test.ts']);
    expect(config.layers.security.patterns).toEqual([
      { pattern: 'eval\\(', message: 'Do not use eval()' },
      { pattern: 'console\\.log', message: 'Remove console.log' },
    ]);
  });

  it('accepts a guardrail layer with only patterns (no include/exclude)', () => {
    writeConfig(`version: 1
layers:
  lint:
    name: lint
    type: guardrail
    patterns:
      - pattern: "TODO"
        message: "Resolve TODOs before merging"
    weight: 0.5
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const config = loadConfig(tempDir);
    expect(config.layers.lint.type).toBe('guardrail');
    expect(config.layers.lint.include).toBeUndefined();
    expect(config.layers.lint.exclude).toBeUndefined();
    expect(config.layers.lint.patterns).toHaveLength(1);
  });

  it('accepts a guardrail layer with no optional fields', () => {
    writeConfig(`version: 1
layers:
  guard:
    name: guard
    type: guardrail
    weight: 0.2
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const config = loadConfig(tempDir);
    expect(config.layers.guard.type).toBe('guardrail');
    expect(config.layers.guard.patterns).toBeUndefined();
  });

  it('rejects guardrail pattern missing message field', () => {
    writeConfig(`version: 1
layers:
  guard:
    name: guard
    type: guardrail
    patterns:
      - pattern: "eval"
    weight: 0.2
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    expect(() => loadConfig(tempDir)).toThrow();
  });

  it('rejects guardrail pattern missing pattern field', () => {
    writeConfig(`version: 1
layers:
  guard:
    name: guard
    type: guardrail
    patterns:
      - message: "bad pattern"
    weight: 0.2
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    expect(() => loadConfig(tempDir)).toThrow();
  });

  it('works alongside deterministic layers', () => {
    writeConfig(`version: 1
layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 0.7
  guard:
    name: guard
    type: guardrail
    patterns:
      - pattern: "debugger"
        message: "Remove debugger statements"
    weight: 0.3
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const config = loadConfig(tempDir);
    expect(config.layers.tests.type).toBe('deterministic');
    expect(config.layers.guard.type).toBe('guardrail');
  });
});

describe('validateConfig', () => {
  it('returns valid for a correct config', () => {
    writeConfig(minimalConfig);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns error when no config file exists', () => {
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('No config file found');
  });

  it('returns error when YAML is invalid', () => {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.yaml'), ': : : bad yaml [[[');
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('parse'))).toBe(true);
  });

  it('returns error for invalid schema (missing version)', () => {
    writeConfig(`layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 1.0
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns error for missing rubric file on agent-review layer', () => {
    writeConfig(`version: 1
layers:
  review:
    name: review
    type: agent-review
    rubric: "nonexistent-rubric.md"
    weight: 0.5
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Rubric file not found'))).toBe(true);
    expect(result.errors.some(e => e.path === 'layers.review.rubric')).toBe(true);
  });

  it('returns error for invalid policy expression syntax', () => {
    writeConfig(`version: 1
layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 1.0
policy:
  auto_merge: "all_pass AND AND"
  human_review: "false"
  block: "any_fail"
`);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Invalid policy expression'))).toBe(true);
  });

  it('returns error for guardrail layer with no include and no patterns', () => {
    writeConfig(`version: 1
layers:
  guard:
    name: guard
    type: guardrail
    weight: 0.2
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('nothing to check'))).toBe(true);
  });

  it('returns error for guardrail layer with invalid regex pattern', () => {
    writeConfig(`version: 1
layers:
  guard:
    name: guard
    type: guardrail
    weight: 0.2
    include:
      - "src/**/*.ts"
    patterns:
      - pattern: "[invalid"
        message: "bad bracket regex"
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Invalid regex'))).toBe(true);
    expect(result.errors.some(e => e.message.includes('[invalid'))).toBe(true);
  });

  it('warns when all weights sum to zero', () => {
    writeConfig(`version: 1
layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 0
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.message.includes('weights sum to 0'))).toBe(true);
  });

  it('returns error for deterministic layer without run command', () => {
    writeConfig(`version: 1
layers:
  tests:
    name: tests
    type: deterministic
    weight: 1.0
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('no run command'))).toBe(true);
  });

  it('passes when rubric file exists', () => {
    const rubricDir = join(tempDir, 'rubrics');
    mkdirSync(rubricDir, { recursive: true });
    writeFileSync(join(rubricDir, 'quality.md'), '# Quality rubric');
    writeConfig(`version: 1
layers:
  review:
    name: review
    type: agent-review
    rubric: "rubrics/quality.md"
    weight: 0.5
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const result = validateConfig(tempDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('listLayers', () => {
  it('lists layers with correct type, weight, and detail', () => {
    writeConfig(`version: 1
layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 0.5
  review:
    name: review
    type: agent-review
    rubric: "quality.md"
    weight: 0.3
  guard:
    name: guard
    type: guardrail
    patterns:
      - pattern: "eval"
        message: "No eval"
      - pattern: "debugger"
        message: "No debugger"
    weight: 0.2
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const config = loadConfig(tempDir);
    const layers = listLayers(config);

    expect(layers).toHaveLength(3);

    expect(layers[0].name).toBe('tests');
    expect(layers[0].type).toBe('deterministic');
    expect(layers[0].weight).toBe(0.5);
    expect(layers[0].detail).toBe('run: npm test');

    expect(layers[1].name).toBe('review');
    expect(layers[1].type).toBe('agent-review');
    expect(layers[1].weight).toBe(0.3);
    expect(layers[1].detail).toBe('rubric: quality.md');

    expect(layers[2].name).toBe('guard');
    expect(layers[2].type).toBe('guardrail');
    expect(layers[2].weight).toBe(0.2);
    expect(layers[2].detail).toBe('2 pattern(s)');
  });

  it('returns empty array for config with no layers', () => {
    writeConfig(`version: 1
layers: {}
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const config = loadConfig(tempDir);
    const layers = listLayers(config);
    expect(layers).toHaveLength(0);
  });

  it('shows screenshot-diff baseline detail', () => {
    writeConfig(`version: 1
layers:
  visual:
    name: visual
    type: screenshot-diff
    capture: "npm run screenshot"
    baseline: "screenshots/"
    threshold: 5
    weight: 0.8
policy:
  auto_merge: "all_pass"
  human_review: "false"
  block: "any_fail"
`);
    const config = loadConfig(tempDir);
    const layers = listLayers(config);
    expect(layers[0].detail).toBe('baseline: screenshots/');
  });
});
