import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseSkillFrontmatter,
  validateSkillFrontmatter,
  discoverSkills,
  lintSkills,
} from '../src/skill-lint.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-skill-lint-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeSkill(relativePath: string, content: string): void {
  const fullPath = join(tempDir, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

// ---------------------------------------------------------------------------
// parseSkillFrontmatter
// ---------------------------------------------------------------------------
describe('parseSkillFrontmatter', () => {
  it('parses valid frontmatter with all fields', () => {
    const content = `---
name: pipeline
description: Autonomous story pipeline
argument-hint: "[--issue N]"
---

# Pipeline`;

    const result = parseSkillFrontmatter(content);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('pipeline');
    expect(result!.description).toBe('Autonomous story pipeline');
    expect(result!['argument-hint']).toBe('[--issue N]');
  });

  it('returns null when no frontmatter found', () => {
    const result = parseSkillFrontmatter('# No frontmatter here');

    expect(result).toBeNull();
  });

  it('parses tags as array', () => {
    const content = `---
name: test
description: Test skill
tags: [quality, lint]
---`;

    const result = parseSkillFrontmatter(content);

    expect(result!.tags).toEqual(['quality', 'lint']);
  });

  it('handles quoted values', () => {
    const content = `---
name: "my-skill"
description: 'A quoted description'
---`;

    const result = parseSkillFrontmatter(content);

    expect(result!.name).toBe('my-skill');
    expect(result!.description).toBe('A quoted description');
  });
});

// ---------------------------------------------------------------------------
// validateSkillFrontmatter
// ---------------------------------------------------------------------------
describe('validateSkillFrontmatter', () => {
  it('returns no errors for valid frontmatter', () => {
    const errors = validateSkillFrontmatter({
      name: 'pipeline',
      description: 'A skill',
    });

    expect(errors).toEqual([]);
  });

  it('returns error for missing name', () => {
    const errors = validateSkillFrontmatter({
      description: 'A skill',
    });

    expect(errors).toContain('Missing required field: name');
  });

  it('returns error for missing description', () => {
    const errors = validateSkillFrontmatter({
      name: 'pipeline',
    });

    expect(errors).toContain('Missing required field: description');
  });

  it('returns errors for both missing fields', () => {
    const errors = validateSkillFrontmatter({});

    expect(errors).toHaveLength(2);
  });

  it('returns error for empty name', () => {
    const errors = validateSkillFrontmatter({
      name: '  ',
      description: 'A skill',
    });

    expect(errors).toContain('Missing required field: name');
  });
});

// ---------------------------------------------------------------------------
// discoverSkills
// ---------------------------------------------------------------------------
describe('discoverSkills', () => {
  it('finds SKILL.md files under .claude/skills/', () => {
    writeSkill('.claude/skills/pipeline/SKILL.md', '---\nname: pipeline\n---');
    writeSkill('.claude/skills/verify/SKILL.md', '---\nname: verify\n---');

    const paths = discoverSkills(tempDir);

    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('pipeline');
    expect(paths[1]).toContain('verify');
  });

  it('returns empty array when .claude/skills/ does not exist', () => {
    const paths = discoverSkills(tempDir);

    expect(paths).toEqual([]);
  });

  it('ignores non-SKILL.md files', () => {
    writeSkill('.claude/skills/pipeline/SKILL.md', '---\nname: p\n---');
    writeSkill('.claude/skills/pipeline/README.md', '# readme');

    const paths = discoverSkills(tempDir);

    expect(paths).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// lintSkills
// ---------------------------------------------------------------------------
describe('lintSkills', () => {
  it('returns valid result for well-formed skills', () => {
    writeSkill('.claude/skills/pipeline/SKILL.md', `---
name: pipeline
description: Autonomous pipeline
---
# Pipeline`);

    const results = lintSkills(tempDir);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
    expect(results[0].errors).toEqual([]);
    expect(results[0].path).toBe('.claude/skills/pipeline/SKILL.md');
  });

  it('returns invalid result for missing frontmatter', () => {
    writeSkill('.claude/skills/bad/SKILL.md', '# No frontmatter');

    const results = lintSkills(tempDir);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
    expect(results[0].errors).toContain('No YAML frontmatter found');
  });

  it('returns invalid result for missing required fields', () => {
    writeSkill('.claude/skills/partial/SKILL.md', `---
name: partial
---
# Partial`);

    const results = lintSkills(tempDir);

    expect(results[0].valid).toBe(false);
    expect(results[0].errors).toContain('Missing required field: description');
  });

  it('returns empty array when no skills exist', () => {
    const results = lintSkills(tempDir);

    expect(results).toEqual([]);
  });
});
