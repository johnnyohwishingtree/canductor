---
name: optimize
description: Read known gaps from templates/patterns, resolve them by adding guidance
argument-hint: "[--dry-run]"
---

# /optimize — Resolve Known Gaps in Templates and Patterns

Scans all `.canductor/templates/*.md` and `.canductor/patterns/*.md` for `## Known gaps` sections. For each gap, adds the missing guidance to the template and removes the gap entry.

Also reads `.canductor/findings.tsv` (from audits) to add acceptance criteria that prevent drift.

## Usage
```
/optimize              # Resolve gaps, update templates, commit
/optimize --dry-run    # Show what would change without editing
```

## Steps

### Step 1: Collect gaps from templates

Scan every `.canductor/templates/*.md` and `.canductor/patterns/*.md` for `## Known gaps` sections:

```bash
for f in .canductor/templates/*.md .canductor/patterns/*.md; do
  if grep -q "## Known gaps" "$f" 2>/dev/null; then
    echo "=== $f ==="
    sed -n '/## Known gaps/,/^## [^K]/p' "$f" | head -20
  fi
done
```

Parse each gap entry. A gap looks like:
```
- <what was missing> — found guidance in <where> (#story_number)
```

If no templates have gaps, skip to Step 3 (audit findings).

### Step 2: Resolve each gap

For each gap entry:

1. **Read the "found guidance in" reference** — this tells you where the agent found the answer. Read that file/line to understand the pattern.

2. **Add guidance to the template.** Find the right section:
   - If it's about HOW to write code → add a new section with a code example
   - If it's about WHAT to include → add to the checklist/rules section
   - If it's a gotcha → add to a "Watch out for" section

3. **Be specific.** Copy the actual pattern from the reference. Not "remember to mock dependencies" but the actual mock code with a reference to the example file.

4. **Remove the gap entry** from the `## Known gaps` section. If no gaps remain, remove the entire section.

5. **Bump the template version** in the `<!-- canductor:template-version:N -->` comment.

Example:

```markdown
# Before (test.md):
## Known gaps
- mocking execFileSync for CLI commands — found in guardrail.test.ts (#167)

# After (test.md):
## Mocking shell commands
When testing modules that call `execFileSync`:
\`\`\`typescript
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
\`\`\`
See `packages/core/__tests__/guardrail.test.ts` for complete example.

## Known gaps
(section removed — no remaining gaps)
```

### Step 3: Check audit findings

If `.canductor/findings.tsv` exists, read unresolved findings:

```bash
if [ -f .canductor/findings.tsv ]; then
  awk -F'\t' 'NR>1 && ($6 != "true" || $6 == "")' .canductor/findings.tsv
fi
```

For each unresolved finding, add acceptance criteria to the template listed in the `template` column. See the audit skill for the mapping of finding categories to template edits.

### Step 4: Commit each template separately

```bash
git add .canductor/templates/<name>.md
git commit -m "optimize: resolve gaps in <name> template (#story_numbers)"
```

Separate commits per file so regressions can be reverted.

### Step 5: Push

```bash
git push origin master
```

## How to tell if it worked

After the next pipeline run that uses the updated template:
- If the agent doesn't add a new gap for the same issue → resolved
- If the agent adds the same gap again → the guidance wasn't clear enough, refine it

## Template Maintenance

<!-- canductor:skill-template-version:3 -->
<!-- Last updated: 2026-03-24 -->
