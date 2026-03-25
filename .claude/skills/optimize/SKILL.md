---
name: optimize
description: Read reflections and audit findings, update .canductor/ templates and patterns to fill gaps
argument-hint: "[--dry-run]"
---

# /optimize — Improve Templates and Patterns from Data

Reads `.canductor/reflections.md` (from pipeline runs) and `.canductor/findings.tsv` (from audits), identifies which `.canductor/` files need improvement, and makes the edits.

This is the core self-improvement loop:
- Reflections tell you "what the template was missing" (from the agent's perspective)
- Findings tell you "what drifted despite the template" (from the audit's perspective)
- Optimize updates the templates to fill both gaps

## Usage
```
/optimize              # Read data, update templates, commit
/optimize --dry-run    # Show what would change without editing
```

## Data Sources

### `.canductor/reflections.md` (from /pipeline)

Written after each story's verify passes. One entry per task:

```markdown
## #160 — 2026-03-24T16:30:00Z

### [test] analytics-diagnostics.test.ts
**Followed:** .canductor/templates/test.md
**Covered:** test structure, describe blocks, happy path pattern
**Missing from template:** how to mock execFileSync for CLI commands
**Found elsewhere:** packages/core/__tests__/guardrail.test.ts line 15
**Issues during verify:** none
```

Key fields for optimization:
- **Missing from template** → what to ADD to the template
- **Found elsewhere** → WHERE to get the content to add (existing code example)

### `.canductor/findings.tsv` (from /audit)

```
category	template	finding	ref	timestamp
dead-code	.canductor/templates/story.md	dead export: X unused	audit-2026-03-24	...
stale-ref	.canductor/templates/story.md	broken reference in index.md	audit-2026-03-24	...
```

Key fields for optimization:
- **template** → which file to update
- **category** → what type of acceptance criteria to add

## Steps

### Step 1: Parse reflections

Read `.canductor/reflections.md` and extract all entries where **Missing from template** is NOT empty or "No gaps" or "none."

Group by the **Followed** field (which template was used). For each template, collect:
- All "Missing from template" entries
- All "Found elsewhere" references
- All "Issues during verify" entries

```
.canductor/templates/test.md:
  - Missing: "how to mock execFileSync" (from #160, found in guardrail.test.ts)
  - Missing: "error path for async functions" (from #165)

.canductor/templates/module.md:
  - Missing: "No gaps" ← skip this one
```

### Step 2: Parse findings

Read `.canductor/findings.tsv` for entries not yet addressed (no `resolved` column = `true`).

Group by the **template** field:

```
.canductor/templates/story.md:
  - dead-code: "dead export: X unused"
  - readme-drift: "README mentions Y but not in CLI"
```

### Step 3: Skip templates with no gaps

If a template has:
- Zero "Missing" entries from reflections
- Zero unresolved findings

Skip it — nothing to improve.

### Step 4: Plan and make edits

For each template with gaps, read it and determine what to add:

**From reflections ("Missing from template"):**

The agent told you exactly what was missing. Add it to the template:

1. Read the "Missing" text — e.g., "how to mock execFileSync for CLI commands"
2. Read the "Found elsewhere" reference — e.g., "guardrail.test.ts line 15"
3. Look at that reference to understand the pattern
4. Add the pattern to the template in the right section:
   - If it's about HOW to write code → add to the template's code example section
   - If it's about WHAT to include → add to the template's checklist/structure section
   - If it's a gotcha/warning → add a "Common mistakes" or "Watch out for" section

Example edit to `.canductor/templates/test.md`:
```markdown
## Mocking shell commands

When testing modules that call `execFileSync` (e.g., CLI commands that shell out to `gh`):

\`\`\`typescript
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const mockedExec = vi.mocked(execFileSync);
mockedExec.mockReturnValue('mock output');
\`\`\`

See `packages/core/__tests__/guardrail.test.ts` for a complete example.
```

**From findings ("Audit drift"):**

The audit found issues that no single story caused. Add acceptance criteria to the story or epic template:

| Finding category | Add to template |
|---|---|
| `dead-code` | Story acceptance criteria: "No dead exports — every new export is imported somewhere" |
| `stale-ref` | Story acceptance criteria: "All .md file references point to files that exist" |
| `untested` | Story tasks: always include a `[test]` task |
| `missing-pattern` | Epic template: "If stories use new task types, include a story to create the pattern" |
| `architecture` | Story acceptance criteria: "No module exceeds 500 lines" |
| `readme-drift` | Story acceptance criteria: "If CLI changed, README is updated" |

### Step 5: Be specific

Don't add vague guidance. The whole point is that vague guidance doesn't help — the agent had to figure things out on its own despite the template.

- Bad: "Remember to mock dependencies"
- Good: "Mock `execFileSync` with `vi.mock('node:child_process', ...)` — see guardrail.test.ts for pattern"

- Bad: "Update references"
- Good: "After renaming/moving files, grep for the old path in all .md and .yaml files"

### Step 6: Commit each update separately

```bash
git add .canductor/templates/<name>.md
git commit -m "optimize: <name> template — <what was added> (from reflections #N / audit finding)"
```

Separate commits per file so regressions can be reverted individually.

### Step 7: Push

```bash
git push origin master
```

## How to tell if optimization worked

After the next pipeline run:
- Read the reflections for stories that used the updated template
- If "Missing from template" is empty or "No gaps" → the optimization worked
- If the same gap appears again → the edit wasn't clear enough, refine it

After the next audit:
- If the same finding category doesn't appear → the acceptance criteria fix worked
- If it reappears → the check isn't specific enough

If a template update made things WORSE (reflections show MORE gaps after the update), revert:
```bash
git log --oneline .canductor/templates/<name>.md
git checkout <previous-good-commit> -- .canductor/templates/<name>.md
git commit -m "revert: <name> optimization made things worse"
git push origin master
```

## Template Maintenance

<!-- canductor:skill-template-version:2 -->
<!-- Last updated: 2026-03-24 -->
