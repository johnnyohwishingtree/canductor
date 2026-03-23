import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Must import after setting up mocks
const TEST_DIR = join(tmpdir(), `canductor-agent-review-test-${Date.now()}`);

describe('buildReviewPrompt', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('builds prompt from rubric and context files', async () => {
    const { buildReviewPrompt } = await import('../src/agent-review.js');
    const rubricPath = join(TEST_DIR, 'rubric.md');
    const codePath = join(TEST_DIR, 'code.ts');
    writeFileSync(rubricPath, '# Test Rubric\n- Check for errors');
    writeFileSync(codePath, 'export function hello() { return "world"; }');

    const prompt = buildReviewPrompt(rubricPath, [codePath]);

    expect(prompt).not.toBeNull();
    expect(prompt!.systemPrompt).toContain('code quality reviewer');
    expect(prompt!.userPrompt).toContain('# Test Rubric');
    expect(prompt!.userPrompt).toContain('hello');
    expect(prompt!.rubricContent).toBe('# Test Rubric\n- Check for errors');
    expect(prompt!.contextFileCount).toBe(1);
  });

  it('returns null when rubric file does not exist', async () => {
    const { buildReviewPrompt } = await import('../src/agent-review.js');

    const prompt = buildReviewPrompt('/nonexistent/rubric.md', []);

    expect(prompt).toBeNull();
  });

  it('collects files from directories', async () => {
    const { buildReviewPrompt } = await import('../src/agent-review.js');
    const rubricPath = join(TEST_DIR, 'rubric.md');
    const srcDir = join(TEST_DIR, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(rubricPath, '# Rubric');
    writeFileSync(join(srcDir, 'a.ts'), 'const a = 1;');
    writeFileSync(join(srcDir, 'b.ts'), 'const b = 2;');

    const prompt = buildReviewPrompt(rubricPath, [srcDir]);

    expect(prompt).not.toBeNull();
    expect(prompt!.contextFileCount).toBe(2);
    expect(prompt!.userPrompt).toContain('const a = 1');
    expect(prompt!.userPrompt).toContain('const b = 2');
  });
});

describe('parseReviewJson', () => {
  it('parses valid JSON', async () => {
    const { parseReviewJson } = await import('../src/agent-review.js');

    const result = parseReviewJson(JSON.stringify({
      pass: true,
      score: 85,
      issues: [{ severity: 'low', description: 'Minor style issue' }],
      summary: 'Good code',
    }));

    expect(result.pass).toBe(true);
    expect(result.score).toBe(85);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('low');
    expect(result.summary).toBe('Good code');
  });

  it('parses JSON wrapped in markdown code blocks', async () => {
    const { parseReviewJson } = await import('../src/agent-review.js');

    const result = parseReviewJson('```json\n{"pass": false, "score": 40, "issues": [], "summary": "Needs work"}\n```');

    expect(result.pass).toBe(false);
    expect(result.score).toBe(40);
    expect(result.summary).toBe('Needs work');
  });

  it('clamps score to 0-100 range', async () => {
    const { parseReviewJson } = await import('../src/agent-review.js');

    const over = parseReviewJson('{"pass": true, "score": 150, "issues": [], "summary": "ok"}');
    expect(over.score).toBe(100);

    const under = parseReviewJson('{"pass": true, "score": -10, "issues": [], "summary": "ok"}');
    expect(under.score).toBe(0);
  });

  it('infers pass from score when pass is not boolean', async () => {
    const { parseReviewJson } = await import('../src/agent-review.js');

    const result = parseReviewJson('{"pass": "yes", "score": 90, "issues": [], "summary": "ok"}');
    expect(result.pass).toBe(true); // score >= 80

    const failResult = parseReviewJson('{"pass": "yes", "score": 50, "issues": [], "summary": "ok"}');
    expect(failResult.pass).toBe(false); // score < 80
  });

  it('throws on invalid JSON', async () => {
    const { parseReviewJson } = await import('../src/agent-review.js');

    expect(() => parseReviewJson('not json')).toThrow();
  });
});

describe('runAgentReview', () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('returns skipped result when no API key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { runAgentReview } = await import('../src/agent-review.js');

    const result = await runAgentReview('/some/rubric.md', [], 'claude-sonnet-4-6');

    expect(result.score).toBe(0);
    expect(result.summary).toContain('Skipped');
    expect(result.summary).toContain('ANTHROPIC_API_KEY');
  });
});
