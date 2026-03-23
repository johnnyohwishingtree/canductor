import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuardrailLayer } from '../src/guardrail.js';
import type { LayerConfig } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-guardrail-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(tempDir, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

function makeLayer(overrides?: Partial<LayerConfig>): LayerConfig {
  return {
    name: 'test_guardrail',
    type: 'guardrail',
    weight: 0.5,
    include: ['src/**/*.ts'],
    exclude: [],
    patterns: [
      { pattern: ': any', message: 'No any types' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// runGuardrailLayer
// ---------------------------------------------------------------------------
describe('runGuardrailLayer', () => {
  it('passes when no violations found', () => {
    writeFile('src/clean.ts', 'const x: string = "hello";\n');

    const result = runGuardrailLayer(makeLayer(), tempDir);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.errors).toBe('');
  });

  it('fails when violations found', () => {
    writeFile('src/dirty.ts', 'const x: any = "hello";\n');

    const result = runGuardrailLayer(makeLayer(), tempDir);

    expect(result.pass).toBe(false);
    expect(result.score).toBeLessThan(100);
    expect(result.errors).toContain('No any types');
    expect(result.errors).toContain('src/dirty.ts');
  });

  it('reports correct line numbers', () => {
    writeFile('src/multi.ts', 'const a: string = "";\nconst b: any = 1;\nconst c: string = "";\n');

    const result = runGuardrailLayer(makeLayer(), tempDir);

    expect(result.errors).toContain('src/multi.ts:2');
  });

  it('excludes files matching exclude globs', () => {
    writeFile('src/main.ts', 'const x: any = 1;\n');
    writeFile('src/__tests__/test.ts', 'const x: any = 1;\n');

    const result = runGuardrailLayer(makeLayer({
      exclude: ['**/__tests__/**'],
    }), tempDir);

    // Only main.ts should be flagged
    expect(result.errors).toContain('src/main.ts');
    expect(result.errors).not.toContain('__tests__');
  });

  it('handles multiple patterns', () => {
    writeFile('src/bad.ts', 'console.log("debug");\nconst x: any = 1;\n');

    const result = runGuardrailLayer(makeLayer({
      patterns: [
        { pattern: ': any', message: 'No any types' },
        { pattern: 'console\\.log', message: 'No console.log' },
      ],
    }), tempDir);

    expect(result.pass).toBe(false);
    expect(result.errors).toContain('No any types');
    expect(result.errors).toContain('No console.log');
  });

  it('returns pass when no patterns configured', () => {
    const result = runGuardrailLayer(makeLayer({ patterns: [] }), tempDir);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('returns pass when no include globs configured', () => {
    const result = runGuardrailLayer(makeLayer({ include: [] }), tempDir);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('handles empty files gracefully', () => {
    writeFile('src/empty.ts', '');

    const result = runGuardrailLayer(makeLayer(), tempDir);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('reduces score proportionally to violation count', () => {
    // 5 violations = score of 50
    writeFile('src/bad.ts', Array(5).fill('const x: any = 1;').join('\n') + '\n');

    const result = runGuardrailLayer(makeLayer(), tempDir);

    expect(result.score).toBe(50);
  });

  it('floors score at 0 for many violations', () => {
    writeFile('src/bad.ts', Array(15).fill('const x: any = 1;').join('\n') + '\n');

    const result = runGuardrailLayer(makeLayer(), tempDir);

    expect(result.score).toBe(0);
  });
});
