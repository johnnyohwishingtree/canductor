---
name: optimize
description: Read findings and task data, update .canductor/ templates and patterns to prevent recurring issues
argument-hint: "[--dry-run]"
---

# /optimize — Improve Templates and Patterns from Data

Reads `.canductor/findings.tsv` (from audits) and `.canductor/tasks.tsv` (from pipeline runs), identifies which `.canductor/` files need improvement, and makes the edits.

This is the core self-improvement loop. Templates and patterns get better → agents follow better instructions → fewer failures → fewer audit findings.

## Usage
```
/optimize              # Read data, update templates, commit
/optimize --dry-run    # Show what would change without editing
```

## Data Sources

### `.canductor/findings.tsv` (from /audit)

```
category	template	finding	ref	timestamp
dead-code	.canductor/templates/story.md	dead export: agent-review API mode unused	audit-2026-03-24	2026-03-24T...
stale-ref	.canductor/templates/story.md	update-exports guided_by is wrong path	audit-2026-03-24	2026-03-24T...
missing-pattern	.canductor/templates/epic.md	refactor has no .canductor/ file	audit-2026-03-24	2026-03-24T...
```

Columns:
- **category**: dead-code, stale-ref, untested, missing-pattern, architecture, readme-drift, config
- **template**: which `.canductor/` file should have prevented this
- **finding**: what was found
- **ref**: which audit run (audit-YYYY-MM-DD)
- **timestamp**: when

### `.canductor/tasks.tsv` (from /pipeline)

```
task_type	guided_by	ref	attempt	failure	timestamp
test	.canductor/templates/test.md	#42	1	vague assertions	2026-03-24T...
test	.canductor/templates/test.md	#42	2	none	2026-03-24T...
```

Pipeline failures mean "the template instructions were unclear." Audit findings mean "the template didn't require checking for this."

## Steps

### Step 1: Collect optimization targets

Read both files and group by template file:

```bash
# Findings by template
if [ -f .canductor/findings.tsv ]; then
  echo "=== Audit findings ==="
  awk -F'\t' 'NR>1 { print $2 "\t" $1 ": " $3 }' .canductor/findings.tsv | sort
fi

# Task failures by guided_by
if [ -f .canductor/tasks.tsv ]; then
  echo "=== Pipeline failures ==="
  awk -F'\t' 'NR>1 && $5 != "none" && $5 != "" { print $2 "\t" $1 ": " $5 }' .canductor/tasks.tsv | sort
fi
```

For each template file, collect all its failures and findings into one list.

### Step 2: Skip converged templates

A template is converged if:
- It has 3+ pipeline uses with 0 failures AND
- It has 0 audit findings in the most recent audit

Skip these — they're working well.

### Step 3: Read the template and plan edits

For each non-converged template, read it and the list of failures/findings. Determine what's missing:

**Audit findings → missing acceptance criteria or tasks**

| Finding category | What to add to the template |
|---|---|
| `dead-code` | Acceptance criteria: "No dead exports — every new export in index.ts is imported somewhere" |
| `stale-ref` | Acceptance criteria: "All references updated — no stale paths in .claude/index.md, README, or other .md files" |
| `untested` | Tasks section: ensure every story includes a `[test]` task |
| `missing-pattern` | Epic template: "If story introduces new task type, include a final story to create the pattern" |
| `architecture` | Acceptance criteria: "No module exceeds 500 lines. Dependencies flow cli → core only." |
| `readme-drift` | Acceptance criteria: "If CLI commands changed, README.md Usage section is updated" |
| `config` | Acceptance criteria: "If config schema changed, config.yaml and config.ts are in sync" |

**Pipeline failures → unclear or incomplete instructions**

Look at the specific failure text:
- "vague assertions" → add example assertions to the test template
- "wrong import path" → add the correct import convention to the module template
- "no error path tested" → add "must test at least one error case" to the test template
- "forgot barrel export" → add explicit "update index.ts" reminder

### Step 4: Make the edits

For each template that needs changes:

1. Read the current template file
2. Find the right section to edit:
   - **Acceptance criteria gaps** → add new `- [ ]` items to the Acceptance Criteria section
   - **Task guidance gaps** → add notes to the Tasks section or the task type guidance
   - **Missing examples** → add a concrete example right after the instruction that was unclear
3. Be specific. Not "check exports" but "verify every new export in index.ts is imported by at least one file"
4. Don't duplicate — if the template already has the check, make it more specific instead of adding a second copy

If `--dry-run` was specified, print what would change and stop here.

### Step 5: Commit each update separately

```bash
git add .canductor/templates/<name>.md
git commit -m "optimize: <name> template — <what was added> (from <source>)"
```

Separate commits per file so regressions can be reverted individually.

### Step 6: Mark findings as addressed

After updating a template, mark the corresponding findings as addressed so the next audit doesn't re-process them:

```bash
# Add an "addressed" column or move to a separate file
# For now, the next audit will re-check and if the issue is fixed, it won't appear
```

The findings.tsv is append-only. Old findings stay for history. The audit will simply not find the same issues if the template fix worked.

### Step 7: Push

```bash
git push origin master
```

## How to tell if optimization worked

After the next pipeline run AND next audit:
- Pipeline: does the task type's avg attempts decrease? (tasks.tsv)
- Audit: does the same finding category appear again? (findings.tsv)

If a template update made things WORSE (more attempts or more findings), revert it:
```bash
git log --oneline .canductor/templates/<name>.md
git checkout <previous-good-commit> -- .canductor/templates/<name>.md
git commit -m "revert: <name> optimization made things worse"
git push origin master
```

## Template Maintenance

<!-- canductor:skill-template-version:1 -->
<!-- Last updated: 2026-03-24 -->
