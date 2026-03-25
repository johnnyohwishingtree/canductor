import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cmdInit,
  cmdInject,
  cmdSuggest,
  cmdContext,
  cmdResultUpdate,
  cmdConfigCheck,
  cmdClean,
  cmdSkillLint,
  cmdLayers,
  cmdResolve,
} from '../src/commands/utility.js';
import { appendResult } from '@canductor/core';
import * as scaffold from '@canductor/core';
import type { VerifyResult } from '@canductor/core';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

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

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-utility-'));
  mkdirSync(join(tempDir, '.canductor'), { recursive: true });
  writeFileSync(join(tempDir, '.canductor', 'config.yaml'), MINIMAL_CONFIG);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
});

function makeVerifyResult(ref: string, score: number, pass: boolean): VerifyResult {
  return {
    ref,
    timestamp: '2026-03-21T00:00:00Z',
    layers: [
      { name: 'echo_test', type: 'deterministic', pass, score: pass ? 100 : 0, errors: '', duration_ms: 100 },
    ],
    composite_score: score,
    decision: pass ? 'auto_merge' : 'block',
    summary: `Test result for ${ref}`,
  };
}

function seedResults(count: number): void {
  for (let i = 1; i <= count; i++) {
    const result = makeVerifyResult(`ref-${i}`, 90 + (i % 10), true);
    appendResult(tempDir, result, 'merged', `Verified ref-${i}`);
  }
}

// ---------------------------------------------------------------------------
// cmdInit
// ---------------------------------------------------------------------------
describe('cmdInit', () => {
  it('creates config file in empty directory', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'canductor-init-'));
    writeFileSync(join(emptyDir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', typecheck: 'tsc' } }));

    // Mock runFirstVerification to avoid running actual shell commands
    const spy = vi.spyOn(scaffold, 'runFirstVerification').mockResolvedValue(null);

    await cmdInit(['init'], emptyDir);

    expect(existsSync(join(emptyDir, '.canductor', 'config.yaml'))).toBe(true);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Created .canductor/config.yaml');

    spy.mockRestore();
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('reports existing config without overwriting', async () => {
    await cmdInit(['init'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('.canductor/config.yaml already exists');
  });
});

// ---------------------------------------------------------------------------
// cmdInject
// ---------------------------------------------------------------------------
describe('cmdInject', () => {
  it('injects context into target file', () => {
    seedResults(3);
    const targetPath = join(tempDir, 'README.md');
    writeFileSync(targetPath, '# Project\n');

    cmdInject(['inject', 'README.md'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('README.md');
  });

  it('exits 1 with no target file', () => {
    expect(() => cmdInject(['inject'], tempDir)).toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Usage: canductor inject <target-file>');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// cmdSuggest
// ---------------------------------------------------------------------------
describe('cmdSuggest', () => {
  it('handles no history gracefully', () => {
    cmdSuggest(['suggest'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No rule improvements suggested');
  });
});

// ---------------------------------------------------------------------------
// cmdContext
// ---------------------------------------------------------------------------
describe('cmdContext', () => {
  it('outputs prompt context string', () => {
    seedResults(3);

    cmdContext(['context'], tempDir);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(typeof output).toBe('string');
  });

  it('outputs context even with no results', () => {
    cmdContext(['context'], tempDir);

    expect(logSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cmdResultUpdate
// ---------------------------------------------------------------------------
describe('cmdResultUpdate', () => {
  it('updates result status', () => {
    seedResults(3);

    cmdResultUpdate(['result-update', 'ref-2', 'rejected'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Updated result for ref "ref-2" to status "rejected"');
  });

  it('exits 1 for missing arguments', () => {
    expect(() => cmdResultUpdate(['result-update'], tempDir)).toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Usage: canductor result-update <ref> <status>');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 for invalid status', () => {
    seedResults(1);

    expect(() => cmdResultUpdate(['result-update', 'ref-1', 'invalid'], tempDir)).toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Invalid status: invalid');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 for unknown ref', () => {
    seedResults(1);

    expect(() => cmdResultUpdate(['result-update', 'unknown', 'merged'], tempDir)).toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Ref not found in results log: unknown');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// cmdConfigCheck
// ---------------------------------------------------------------------------
describe('cmdConfigCheck', () => {
  it('valid config passes', () => {
    cmdConfigCheck(['config-check'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Config is valid');
  });

  it('invalid config fails with exit 1', () => {
    writeFileSync(join(tempDir, '.canductor', 'config.yaml'), 'invalid: yaml: content');

    expect(() => cmdConfigCheck(['config-check'], tempDir)).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('outputs JSON when --json flag is passed', () => {
    cmdConfigCheck(['config-check', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('valid');
    expect(parsed).toHaveProperty('errors');
    expect(parsed).toHaveProperty('warnings');
  });
});

// ---------------------------------------------------------------------------
// cmdClean
// ---------------------------------------------------------------------------
describe('cmdClean', () => {
  it('handles no stale branches case', () => {
    // listStaleBranches runs git commands — temp dir is not a git repo, so it returns []
    cmdClean(['clean'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No stale canductor branches found');
  });
});

// ---------------------------------------------------------------------------
// cmdSkillLint
// ---------------------------------------------------------------------------
describe('cmdSkillLint', () => {
  it('reports no SKILL.md files when none exist', () => {
    cmdSkillLint(['skill-lint'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No SKILL.md files found');
  });

  it('lints valid SKILL.md files', () => {
    const skillDir = join(tempDir, '.claude', 'skills', 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: test-skill
description: A test skill
---

# Test Skill
`);

    cmdSkillLint(['skill-lint'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('PASS');
    expect(output).toContain('skill(s) checked');
  });
});

// ---------------------------------------------------------------------------
// cmdLayers
// ---------------------------------------------------------------------------
describe('cmdLayers', () => {
  it('outputs layer configuration', () => {
    cmdLayers(['layers'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('echo_test');
    expect(output).toContain('deterministic');
  });

  it('outputs JSON when --json flag is passed', () => {
    cmdLayers(['layers', '--json'], tempDir);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('name', 'echo_test');
    expect(parsed[0]).toHaveProperty('type', 'deterministic');
  });

  it('handles no layers configured', () => {
    writeFileSync(join(tempDir, '.canductor', 'config.yaml'), `version: 1
layers: {}
policy:
  auto_merge: "all_pass"
  human_review: "any_agent_review_fail"
  block: "any_deterministic_fail"
`);

    cmdLayers(['layers'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No layers configured');
  });
});

// ---------------------------------------------------------------------------
// cmdResolve
// ---------------------------------------------------------------------------
describe('cmdResolve', () => {
  it('resolves a finding by index', () => {
    const findingsHeader = 'category\ttemplate\tfinding\tref\ttimestamp\tresolved';
    const findingsRows = [
      'drift\t-\tUnused export in foo.ts\t#100\t2026-03-20T00:00:00Z\tfalse',
      'drift\t-\tOld export in bar.ts\t#101\t2026-03-20T00:00:00Z\tfalse',
    ];
    writeFileSync(
      join(tempDir, '.canductor', 'findings.tsv'),
      [findingsHeader, ...findingsRows].join('\n') + '\n'
    );

    cmdResolve(['resolve', '1'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Resolved finding 1');
    expect(output).toContain('Unused export in foo.ts');
  });

  it('exits 1 with no arguments', () => {
    expect(() => cmdResolve(['resolve'], tempDir)).toThrow('process.exit called');

    expect(errorSpy).toHaveBeenCalledWith('Usage: canductor resolve <index> or canductor resolve --all');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('resolves all findings with --all flag', () => {
    const findingsHeader = 'category\ttemplate\tfinding\tref\ttimestamp\tresolved';
    const findingsRows = [
      'drift\t-\tUnused export in foo.ts\t#100\t2026-03-20T00:00:00Z\tfalse',
      'drift\t-\tOld export in bar.ts\t#101\t2026-03-20T00:00:00Z\tfalse',
    ];
    writeFileSync(
      join(tempDir, '.canductor', 'findings.tsv'),
      [findingsHeader, ...findingsRows].join('\n') + '\n'
    );

    cmdResolve(['resolve', '--all'], tempDir);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Resolved all 2 finding(s)');
  });
});
