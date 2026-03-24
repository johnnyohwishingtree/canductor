---
name: audit
description: Audit codebase for drift, dead code, and architecture violations — creates an epic with fix stories
argument-hint: "[--dry-run]"
---

# /audit — Codebase Health Audit

Analyzes the canductor codebase for drift from the intended architecture, dead code, unused modules, stale references, and quality issues. Creates an epic with stories to fix everything found.

Run this regularly (e.g., 3x daily via scheduled task) to prevent drift from accumulating.

## Usage
```
/audit              # Full audit → create epic with stories
/audit --dry-run    # Audit only, print findings, don't create issues
```

## Audit Checks

### 1. Dead code detection

Find exports that nothing imports:

```bash
# For each export in packages/core/src/index.ts, check if it's imported anywhere
grep -oE "export \{ [^}]+ \}" packages/core/src/index.ts | tr ',' '\n' | sed 's/.*{ //; s/ }.*//' | while read -r EXPORT; do
  EXPORT=$(echo "$EXPORT" | tr -d ' ')
  [ -z "$EXPORT" ] && continue
  # Check if used outside of index.ts
  COUNT=$(grep -rl "$EXPORT" packages/cli/src/ packages/core/src/ --include="*.ts" | grep -v index.ts | grep -v types.ts | wc -l | tr -d ' ')
  if [ "$COUNT" -eq 0 ]; then
    echo "DEAD EXPORT: $EXPORT — exported from index.ts but never imported"
  fi
done
```

Also check for modules that have no test file:
```bash
for f in packages/core/src/*.ts; do
  NAME=$(basename "$f" .ts)
  [ "$NAME" = "index" ] || [ "$NAME" = "types" ] && continue
  if [ ! -f "packages/core/__tests__/${NAME}.test.ts" ]; then
    echo "UNTESTED MODULE: $NAME — has no test file"
  fi
done
```

### 2. Architecture violations

Check dependency direction (cli → core, never reverse):
```bash
# Core should never import from cli
grep -r "from.*@canductor/cli" packages/core/src/ --include="*.ts" && echo "VIOLATION: core imports from cli"
```

Check for oversized modules (> 500 lines):
```bash
for f in packages/core/src/*.ts packages/cli/src/*.ts; do
  LINES=$(wc -l < "$f" | tr -d ' ')
  if [ "$LINES" -gt 500 ]; then
    echo "OVERSIZED: $f ($LINES lines) — consider splitting"
  fi
done
```

### 3. Stale references

Check for references to old paths or removed features:
```bash
# .claude/ references where .canductor/ is intended (templates, patterns, rubrics)
grep -rn "\.claude/templates\|\.claude/patterns\|\.claude/rubrics" --include="*.md" --include="*.ts" --include="*.yaml" | grep -v node_modules | grep -v dist
```

Check that all files referenced in `.claude/index.md` actually exist:
```bash
grep -oE '`[^`]+\.md`' .claude/index.md | tr -d '`' | while read -r FILE; do
  # Try both .claude/ and .canductor/ prefixes
  if [ ! -f ".claude/$FILE" ] && [ ! -f ".canductor/$FILE" ] && [ ! -f "$FILE" ]; then
    echo "STALE REFERENCE in index.md: $FILE does not exist"
  fi
done
```

### 4. Task type health

Check `.canductor/tasks.tsv` for issues:
```bash
if [ -f .canductor/tasks.tsv ]; then
  # Task types with guided_by = "-" (missing pattern file)
  awk -F'\t' 'NR>1 && $2 == "-" { print "MISSING PATTERN: " $1 " has no .canductor/ file" }' .canductor/tasks.tsv

  # Task types referencing files that don't exist
  awk -F'\t' 'NR>1 && $2 != "-" && $2 != "none" { print $2 }' .canductor/tasks.tsv | sort -u | while read -r FILE; do
    [ ! -f "$FILE" ] && echo "BROKEN REFERENCE: tasks.tsv references $FILE but it doesn't exist"
  done
fi
```

### 5. Config consistency

Check that `.canductor/config.yaml` layers reference valid commands:
```bash
pnpm build 2>/dev/null
node packages/cli/dist/cli.js verify --self-review > /dev/null 2>&1 || echo "VERIFY BROKEN: canductor verify --self-review fails"
```

Check that all rubric files referenced in config exist:
```bash
grep "rubric:" .canductor/config.yaml | awk '{print $2}' | tr -d '"' | while read -r RUBRIC; do
  [ ! -f "$RUBRIC" ] && echo "MISSING RUBRIC: config.yaml references $RUBRIC but it doesn't exist"
done
```

### 6. README accuracy

Check that CLI commands listed in README match actual CLI:
```bash
pnpm build 2>/dev/null
HELP=$(node packages/cli/dist/cli.js help 2>&1)
# Check each command mentioned in README exists in help
grep -oE "canductor [a-z-]+" README.md | sort -u | while read -r CMD; do
  SUBCMD=$(echo "$CMD" | awk '{print $2}')
  echo "$HELP" | grep -q "$SUBCMD" || echo "README DRIFT: $CMD mentioned in README but not in CLI help"
done
```

## Creating the Epic

After running all checks, if any issues were found and `--dry-run` was NOT specified:

1. Group findings by category (dead code, architecture, stale references, etc.)
2. Create stories for each group following `.canductor/templates/story.md`
3. Create an epic linking the stories

```bash
REPO="johnnyohwishingtree/canductor"
DATE=$(date +%Y-%m-%d)

gh label create "epic:audit-$DATE" --repo "$REPO" --color "D93F0B" --description "Audit: $DATE" 2>/dev/null || true

gh issue create --repo "$REPO" \
  --title "Epic: Codebase audit — $DATE" \
  --label "epic,epic:audit-$DATE" \
  --body "## Codebase Audit — $DATE

Automated audit found the following issues:

<checklist of findings grouped by category>

## Stories
- [ ] #N — <story title>
- [ ] #N — <story title>
"
```

For each category with findings, create a story:
```bash
gh issue create --repo "$REPO" \
  --title "Story: Fix <category> issues from $DATE audit" \
  --label "story,pending,epic:audit-$DATE" \
  --body "<follow .canductor/templates/story.md with Tasks section>"
```

## Attribute findings to planning task types

Audit findings are symptoms of stories/epics that didn't account for something. Log each finding to `.canductor/tasks.tsv` attributed to the task type that should have prevented it:

```bash
[ -f .canductor/tasks.tsv ] || echo -e "task_type\tguided_by\tref\tverify_cycle\tfailure\ttimestamp" > .canductor/tasks.tsv
```

| Finding type | Attributed to | Why |
|---|---|---|
| Dead exports | `story` (.canductor/templates/story.md) | Story didn't include cleanup task |
| Stale references | `story` (.canductor/templates/story.md) | Story didn't require updating references |
| Untested modules | `story` (.canductor/templates/story.md) | Story didn't include test task |
| Missing patterns | `epic` (.canductor/templates/epic.md) | Epic introduced new task types without patterns |
| Architecture violations | `story` (.canductor/templates/story.md) | Story allowed wrong dependency direction |
| README drift | `story` (.canductor/templates/story.md) | Story changed CLI without updating README |

For each finding, log it:
```bash
echo -e "story\t.canductor/templates/story.md\taudit-$DATE\t1\t<finding summary>\t$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .canductor/tasks.tsv
```

This means the `story` and `epic` task types will accumulate failures from audits. When the pipeline's optimization step (Step 7) runs, it will see:

```
story: avg 1.3 cycles, 15 uses — 4 audit failures
  → Failures: "dead exports", "stale references", "missing tests", "README drift"
  → Optimization: update .canductor/templates/story.md acceptance criteria
    to require reference checks, export verification, README updates
```

The planning templates get better, future stories prevent the issues the audit found.

Commit the updated tasks.tsv along with the audit epic:
```bash
git add .canductor/tasks.tsv
git diff --cached --quiet || git commit -m "chore: log audit findings to task tracking" && git push origin master
```

## What NOT to flag

- Scores in results.tsv being 98-99 (that's expected with self-review)
- Pending statuses in old results.tsv entries (pipeline handles new ones correctly)
- Empty tasks.tsv or learnings.md (these accumulate over time)
- Screenshot module being unused (infrastructure for future use)

## Scheduled Task Prompt

For the 3x daily scheduled task:
```
Read CLAUDE.md for project context.
Read .claude/skills/audit/SKILL.md and follow every step.
```
