---
name: audit
description: Audit codebase for drift, dead code, and architecture violations — creates an epic with fix stories
argument-hint: "[--dry-run]"
---

# /audit — Codebase Health Audit

Analyzes the canductor codebase for drift from the intended architecture, dead code, unused modules, stale references, and quality issues. Logs findings to `.canductor/findings.tsv` and creates an epic with fix stories.

Run this regularly (e.g., 3x daily via scheduled task) to prevent drift from accumulating.

## Usage
```
/audit              # Full audit → log findings → create epic with stories
/audit --dry-run    # Audit only, print findings, don't create issues
```

## Setup

Initialize findings.tsv if it doesn't exist and set up variables:

```bash
REPO="johnnyohwishingtree/canductor"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
REF="audit-$DATE"

[ -f .canductor/findings.tsv ] || echo -e "category\ttemplate\tfinding\tref\ttimestamp" > .canductor/findings.tsv

# Track findings count
FOUND=0
```

Helper function — call this for every finding:
```bash
log_finding() {
  local CATEGORY="$1"
  local TEMPLATE="$2"
  local FINDING="$3"
  echo -e "${CATEGORY}\t${TEMPLATE}\t${FINDING}\t${REF}\t${TIMESTAMP}" >> .canductor/findings.tsv
  FOUND=$((FOUND + 1))
  echo "[$CATEGORY] $FINDING"
}
```

## Audit Checks

Run each check. For every issue found, call `log_finding` immediately.

### 1. Dead code

```bash
echo "=== Dead code ==="

# Exports that nothing imports
grep -oE "export \{ [^}]+ \}" packages/core/src/index.ts | tr ',' '\n' | sed 's/.*{ //; s/ }.*//' | while read -r EXPORT; do
  EXPORT=$(echo "$EXPORT" | tr -d ' ')
  [ -z "$EXPORT" ] && continue
  COUNT=$(grep -rl "$EXPORT" packages/cli/src/ packages/core/src/ --include="*.ts" | grep -v index.ts | grep -v types.ts | wc -l | tr -d ' ')
  if [ "$COUNT" -eq 0 ]; then
    log_finding "dead-code" ".canductor/templates/story.md" "dead export: $EXPORT exported from index.ts but never imported"
  fi
done

# Modules with no test file
for f in packages/core/src/*.ts; do
  NAME=$(basename "$f" .ts)
  [ "$NAME" = "index" ] || [ "$NAME" = "types" ] && continue
  if [ ! -f "packages/core/__tests__/${NAME}.test.ts" ]; then
    log_finding "untested" ".canductor/templates/story.md" "untested module: $NAME has no test file"
  fi
done
```

### 2. Architecture violations

```bash
echo "=== Architecture ==="

# Core importing from cli (wrong direction)
VIOLATIONS=$(grep -r "from.*@canductor/cli" packages/core/src/ --include="*.ts" 2>/dev/null || true)
if [ -n "$VIOLATIONS" ]; then
  log_finding "architecture" ".canductor/templates/story.md" "dependency violation: core imports from cli"
fi

# Oversized modules (> 500 lines)
for f in packages/core/src/*.ts packages/cli/src/*.ts; do
  [ -f "$f" ] || continue
  LINES=$(wc -l < "$f" | tr -d ' ')
  if [ "$LINES" -gt 500 ]; then
    log_finding "architecture" ".canductor/templates/story.md" "oversized module: $f ($LINES lines)"
  fi
done
```

### 3. Stale references

```bash
echo "=== Stale references ==="

# .claude/ paths where .canductor/ is intended
STALE=$(grep -rn "\.claude/templates\|\.claude/patterns\|\.claude/rubrics" --include="*.md" --include="*.ts" --include="*.yaml" 2>/dev/null | grep -v node_modules | grep -v dist || true)
if [ -n "$STALE" ]; then
  echo "$STALE" | while read -r LINE; do
    log_finding "stale-ref" ".canductor/templates/story.md" "stale path: $LINE"
  done
fi

# Files referenced in index.md that don't exist
grep -oE '`[^`]+\.md`' .claude/index.md | tr -d '`' | while read -r FILE; do
  if [ ! -f ".claude/$FILE" ] && [ ! -f ".canductor/$FILE" ] && [ ! -f "$FILE" ]; then
    log_finding "stale-ref" ".canductor/templates/story.md" "broken reference in index.md: $FILE does not exist"
  fi
done
```

### 4. Task type health

```bash
echo "=== Task types ==="

if [ -f .canductor/tasks.tsv ]; then
  # Missing pattern files
  awk -F'\t' 'NR>1 && $2 == "-" { print $1 }' .canductor/tasks.tsv | sort -u | while read -r TYPE; do
    log_finding "missing-pattern" ".canductor/templates/epic.md" "task type '$TYPE' has no .canductor/ pattern file"
  done

  # Broken guided_by references
  awk -F'\t' 'NR>1 && $2 != "-" && $2 != "none" { print $2 }' .canductor/tasks.tsv | sort -u | while read -r FILE; do
    if [ ! -f "$FILE" ]; then
      log_finding "stale-ref" ".canductor/templates/story.md" "tasks.tsv references $FILE but it doesn't exist"
    fi
  done
fi
```

### 5. Config consistency

```bash
echo "=== Config ==="

# Check rubric files exist
grep "rubric:" .canductor/config.yaml 2>/dev/null | awk '{print $2}' | tr -d '"' | while read -r RUBRIC; do
  if [ -n "$RUBRIC" ] && [ ! -f "$RUBRIC" ]; then
    log_finding "config" ".canductor/templates/story.md" "config.yaml references missing rubric: $RUBRIC"
  fi
done

# Check verify still works
pnpm build 2>/dev/null
if ! node packages/cli/dist/cli.js verify --self-review > /dev/null 2>&1; then
  log_finding "config" ".canductor/templates/story.md" "canductor verify --self-review fails"
fi
```

### 6. README accuracy

```bash
echo "=== README ==="

HELP=$(node packages/cli/dist/cli.js help 2>&1)
grep -oE "canductor [a-z-]+" README.md | sort -u | while read -r CMD; do
  SUBCMD=$(echo "$CMD" | awk '{print $2}')
  if ! echo "$HELP" | grep -q "$SUBCMD"; then
    log_finding "readme-drift" ".canductor/templates/story.md" "README mentions '$CMD' but not in CLI help"
  fi
done
```

## After all checks

```bash
echo ""
echo "=== Audit complete: $FOUND findings ==="
```

If `$FOUND` is 0, report "Codebase is clean" and stop.

If `--dry-run` was specified, stop here — findings are printed but no issues are created.

## Record findings as template gaps

For each finding, add a gap entry to the template that should have prevented it:

| Finding category | Template to update |
|---|---|
| `dead-code` | `.canductor/templates/story.md` |
| `stale-ref` | `.canductor/templates/story.md` |
| `untested` | `.canductor/templates/story.md` |
| `missing-pattern` | `.canductor/templates/epic.md` |
| `architecture` | `.canductor/templates/story.md` |
| `readme-drift` | `.canductor/templates/story.md` |
| `config` | `.canductor/templates/story.md` |

For each template that has findings, add to its `## Known gaps` section:
```markdown
## Known gaps
- audit: <finding summary> (audit-$DATE)
```

Also keep logging to findings.tsv for history (trend tracking across audits):
```bash
echo -e "<category>\t<template>\t<finding>\taudit-$DATE\t$TIMESTAMP" >> .canductor/findings.tsv
```

## Create epic and stories

If findings > 0 and not dry-run:

1. Commit template gaps + findings.tsv:
```bash
git add .canductor/templates/*.md .canductor/findings.tsv
git diff --cached --quiet || git commit -m "chore: log audit findings ($DATE)" && git push origin master
```

2. Group findings by category. For each category that has findings, create a story following `.canductor/templates/story.md`. The story's Tasks section should reference the specific files that need fixing.

3. Create an epic linking the stories:
```bash
gh label create "epic:audit-$DATE" --repo "$REPO" --color "D93F0B" --description "Audit: $DATE" 2>/dev/null || true

gh issue create --repo "$REPO" \
  --title "Epic: Codebase audit — $DATE" \
  --label "epic,epic:audit-$DATE" \
  --body "## Findings ($FOUND total)
<list each finding>

## Stories
- [ ] #N — <title>
"
```

4. Create stories per category:
```bash
gh issue create --repo "$REPO" \
  --title "Story: Fix <category> issues from $DATE audit" \
  --label "story,pending,epic:audit-$DATE" \
  --body "<follow .canductor/templates/story.md — include Tasks section with task types>"
```

## What NOT to flag

- Scores in results.tsv being 98-99 (expected with self-review)
- Empty tasks.tsv, findings.tsv, or learnings.md (accumulate over time)
- Screenshot module being unused (infrastructure for future use)
- Pending statuses in old results.tsv entries

## Scheduled Task Prompt

```
Read CLAUDE.md for project context.
Read .claude/skills/audit/SKILL.md and follow every step.
```
