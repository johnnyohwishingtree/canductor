import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, writeConfigBaseline } from '../src/config.js';

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
