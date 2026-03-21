/**
 * Agent review — sends code + rubric to the Anthropic Claude API
 * and parses a structured quality verdict.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { AgentReviewResult } from './types.js';

const SYSTEM_PROMPT = `You are a code quality reviewer. Evaluate the provided code against the rubric criteria.
Respond with ONLY a JSON object matching this schema:
{
  "pass": boolean,
  "score": number (0-100),
  "issues": [{"severity": "critical"|"high"|"medium"|"low", "description": "string"}],
  "summary": "string"
}
A score of 80+ means pass. Critical or high severity issues mean fail regardless of score.`;

const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.yaml', '.yml']);
const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 100 * 1024; // 100KB

/**
 * Recursively collect file paths from a directory, filtering by extension.
 * Respects MAX_FILES limit.
 */
function collectFiles(dir: string, collected: string[] = []): string[] {
  if (collected.length >= MAX_FILES) return collected;
  if (!existsSync(dir)) return collected;

  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    if (ALLOWED_EXTENSIONS.has(extname(dir))) {
      collected.push(dir);
    }
    return collected;
  }

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (collected.length >= MAX_FILES) break;
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;

    const full = join(dir, entry);
    const entryStat = statSync(full);
    if (entryStat.isDirectory()) {
      collectFiles(full, collected);
    } else if (ALLOWED_EXTENSIONS.has(extname(entry))) {
      collected.push(full);
    }
  }

  return collected;
}

/**
 * Read files respecting the total byte limit.
 * Returns an array of { path, content } objects.
 */
function readFilesWithLimit(
  paths: string[]
): Array<{ path: string; content: string }> {
  const result: Array<{ path: string; content: string }> = [];
  let totalBytes = 0;

  for (const p of paths) {
    if (totalBytes >= MAX_TOTAL_BYTES) break;
    try {
      const content = readFileSync(p, 'utf-8');
      const bytes = Buffer.byteLength(content, 'utf-8');
      if (totalBytes + bytes > MAX_TOTAL_BYTES) {
        // Include a truncated version
        const remaining = MAX_TOTAL_BYTES - totalBytes;
        result.push({ path: p, content: content.slice(0, remaining) + '\n[...truncated]' });
        totalBytes = MAX_TOTAL_BYTES;
      } else {
        result.push({ path: p, content });
        totalBytes += bytes;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return result;
}

/**
 * Run an agent review by calling the Anthropic Claude API.
 *
 * @param rubric  - Path to the rubric markdown file
 * @param context - Paths to files or directories to include as review context
 * @param model   - The Claude model to use (e.g. "claude-sonnet-4-6")
 */
export async function runAgentReview(
  rubric: string,
  context: string[],
  model: string
): Promise<AgentReviewResult> {
  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      pass: true,
      score: 0,
      issues: [],
      summary: 'Skipped: ANTHROPIC_API_KEY not set. Set the environment variable to enable agent review.',
    };
  }

  // Read the rubric
  let rubricContent: string;
  try {
    rubricContent = readFileSync(rubric, 'utf-8');
  } catch {
    return {
      pass: true,
      score: 0,
      issues: [],
      summary: `Skipped: Could not read rubric file: ${rubric}`,
    };
  }

  // Collect and read context files
  const allPaths: string[] = [];
  for (const ctx of context) {
    if (!existsSync(ctx)) continue;
    const stat = statSync(ctx);
    if (stat.isDirectory()) {
      collectFiles(ctx, allPaths);
    } else {
      allPaths.push(ctx);
    }
  }

  const contextFiles = readFilesWithLimit(allPaths);

  // Build the user prompt
  const contextBlock = contextFiles
    .map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const userPrompt = `## Rubric\n\n${rubricContent}\n\n## Code to Review\n\n${contextBlock}`;

  // Call the Anthropic API
  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract text from response
    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return {
        pass: false,
        score: 0,
        issues: [{ severity: 'critical', description: 'No text response from agent' }],
        summary: 'Agent review failed: no text in response',
      };
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = textBlock.text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as AgentReviewResult;

    // Validate and normalize the result
    return {
      pass: typeof parsed.pass === 'boolean' ? parsed.pass : parsed.score >= 80,
      score: Math.max(0, Math.min(100, typeof parsed.score === 'number' ? parsed.score : 0)),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Agent review complete',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      pass: false,
      score: 0,
      issues: [{ severity: 'critical', description: `API call failed: ${message}` }],
      summary: `Agent review error: ${message}`,
    };
  }
}
