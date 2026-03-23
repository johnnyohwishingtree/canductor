/**
 * Skill lint — discovers, parses, and validates SKILL.md files.
 *
 * SKILL.md files use YAML frontmatter (--- delimited) to declare metadata.
 * This module validates that required fields are present and well-formed.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { SkillFrontmatter, SkillLintResult } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a SKILL.md file's content.
 *
 * @param content - The raw file content
 * @returns Parsed frontmatter object, or null if no frontmatter found
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const raw = match[1];
  const result: SkillFrontmatter = {};

  for (const line of raw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'name') {
      result.name = unquote(value);
    } else if (key === 'description') {
      result.description = unquote(value);
    } else if (key === 'argument-hint') {
      result['argument-hint'] = unquote(value);
    } else if (key === 'tags') {
      result.tags = parseYamlArray(value);
    }
  }

  return result;
}

/**
 * Validate a parsed frontmatter object for required fields.
 *
 * @param frontmatter - Parsed frontmatter to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateSkillFrontmatter(frontmatter: SkillFrontmatter): string[] {
  const errors: string[] = [];

  if (!frontmatter.name || frontmatter.name.trim() === '') {
    errors.push('Missing required field: name');
  }
  if (!frontmatter.description || frontmatter.description.trim() === '') {
    errors.push('Missing required field: description');
  }

  return errors;
}

/**
 * Discover all SKILL.md files under .claude/skills/.
 *
 * @param rootDir - Repository root directory
 * @returns Array of absolute paths to SKILL.md files
 */
export function discoverSkills(rootDir: string): string[] {
  const skillsDir = join(rootDir, '.claude', 'skills');
  if (!existsSync(skillsDir)) return [];

  const results: string[] = [];
  walkDir(skillsDir, results);
  return results.sort();
}

/**
 * Lint all SKILL.md files in the repository.
 *
 * @param rootDir - Repository root directory
 * @returns Array of lint results, one per SKILL.md file
 */
export function lintSkills(rootDir: string): SkillLintResult[] {
  const paths = discoverSkills(rootDir);

  return paths.map(skillPath => {
    const content = readFileSync(skillPath, 'utf-8');
    const frontmatter = parseSkillFrontmatter(content);
    const relPath = relative(rootDir, skillPath);

    if (!frontmatter) {
      return {
        path: relPath,
        frontmatter: null,
        errors: ['No YAML frontmatter found'],
        valid: false,
      };
    }

    const errors = validateSkillFrontmatter(frontmatter);
    return {
      path: relPath,
      frontmatter,
      errors,
      valid: errors.length === 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function walkDir(dir: string, results: string[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, results);
    } else if (entry === 'SKILL.md') {
      results.push(fullPath);
    }
  }
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlArray(value: string): string[] {
  // Handle inline array: [a, b, c]
  const inlineMatch = value.match(/^\[(.*)\]$/);
  if (inlineMatch) {
    return inlineMatch[1].split(',').map(s => unquote(s.trim())).filter(s => s !== '');
  }
  // Single value fallback
  if (value.trim() !== '') {
    return [unquote(value)];
  }
  return [];
}
