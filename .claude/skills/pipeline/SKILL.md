---
name: pipeline
description: Autonomous story pipeline — implement, verify, merge, plan
argument-hint: "[--issue N]"
---

# /pipeline — Autonomous Story Pipeline

The canductor self-building loop. Merges open PRs, implements pending stories, verifies with canductor scoring, and plans new work when the queue is empty.

This file is the single source of truth for the pipeline. Claude Code scheduled tasks reference it directly:
```
Read .claude/skills/pipeline/SKILL.md and follow every step.
```

## Usage
```
/pipeline              # Run one full cycle
/pipeline --issue N    # Implement a specific issue
```

## Full Cycle

### Step 1: Merge open PRs

Ensure master is current before starting new work.

```bash
gh pr list --repo johnnyohwishingtree/canductor --state open --json number,title,headRefName --jq '.[]'
```

For each open PR:
1. Read the diff: `gh pr diff $NUMBER --repo johnnyohwishingtree/canductor`
2. Review against `.canductor/rubrics/canductor-code-quality.md`
3. If clean: approve and squash merge
4. If issues: checkout the branch, fix them, run `pnpm build && pnpm typecheck && pnpm test`, push, then approve and squash merge

After merging all PRs:
```bash
git checkout master && git pull origin master
```

### Step 2: Inject quality context

Update CLAUDE.md with patterns learned from past verification results.

```bash
pnpm install && pnpm build
node packages/cli/dist/cli.js inject CLAUDE.md
```

If CLAUDE.md changed, commit and push:
```bash
git add CLAUDE.md
git diff --cached --quiet || git commit -m "chore: inject canductor quality context" && git push origin master
```

**Re-read the updated CLAUDE.md** — the quality context section at the bottom tells you recurring issues to avoid.

### Step 3: Find next story

```bash
# If --issue N was specified, use that issue number
# Otherwise find the next pending story (lowest number first)
gh issue list --repo johnnyohwishingtree/canductor --label "story" --label "pending" --state open --json number,title --jq '.[0]'
```

If no pending stories, skip to **Step 7** (optimize patterns).

### Step 4: Implement

```bash
NUMBER=<issue number>
gh issue edit $NUMBER --repo johnnyohwishingtree/canductor --remove-label "pending" --add-label "in-progress"
git fetch origin master && git checkout -b canductor/issue-$NUMBER origin/master
```

Read the issue body and implement it. The story body is your primary guide — it tells you exactly what to read and what to follow.

**Parse the Tasks section** from the story body. Each task has a type in brackets like `[module]`, `[test]`, `[new-cli-command]`. These types map to `.canductor/patterns/<type>.md` or `.canductor/templates/<type>.md`. Track which tasks this story involves — you'll need this in Step 5 for failure attribution.

**Token-efficient implementation order:**
1. Read the story's **Tasks** section — note each task type and what it asks you to do.
2. For each task type, read the corresponding `.canductor/` file (e.g., `[module]` → read `.canductor/templates/module.md`).
3. Read the story's **Context** section — these are the ONLY additional files you need to read. Do NOT explore the codebase beyond what's listed.
4. Read the story's **Key Types** section — use these inline types instead of reading `types.ts`.
5. If the story doesn't have a Tasks section (older stories), fall back to reading the files listed in "Files to Create/Modify" plus the templates/patterns below.

**Templates** (structure for individual files):
- **New source modules** → `.canductor/templates/module.md`
- **New test files** → `.canductor/templates/test.md`
- **New rubrics** → `.canductor/templates/rubric.md`
- **New skills** → `.canductor/templates/skill.md`

**Patterns** (multi-file change recipes):
- **Adding a verification layer type** → `.canductor/patterns/new-layer.md`
- **Adding a CLI command** → `.canductor/patterns/new-cli-command.md`
- **Adding a quality rubric** → `.canductor/patterns/new-rubric.md`
- **Extending the results log** → `.canductor/patterns/extend-results.md`
- **Adding a core module** → `.canductor/patterns/new-core-module.md`

Only read a pattern/template if the story references it or if you're doing that type of change.

**Always:**
- Run `pnpm typecheck` after every file change
- Run `pnpm test` before committing
- Never use `any` types — fix the root cause
- Keep functions small and single-purpose
- Every new module needs tests
- Dependencies flow: cli -> core. Never the reverse.

### Step 4b: Check if pipeline changes are needed

After implementing, check if your changes affect the pipeline itself:
- **Did you add or change CLI flags?** Note it.
- **Did you change the config.yaml schema?** Note it.
- **Did you change the results.tsv or tasks.tsv format?** Note it.

If any `.claude/` files (skills, rules) need updating, **do NOT edit them.** Instead, create a GitHub issue:
```bash
gh issue create --repo johnnyohwishingtree/canductor \
  --title "Pipeline update needed: <what changed>" \
  --label "pipeline-update" \
  --body "Changes in #$NUMBER affect the pipeline. Suggested updates: <details>"
```

`.claude/` files are read-only for the pipeline. Only humans edit skills and rules.

You CAN edit `.canductor/` files (templates, patterns, rubrics, index) — those are pipeline-optimizable.

### Step 5: Verify and fix loop

This is the core quality gate. Keep iterating until verification passes or you exhaust all attempts.

**Attempt 1 of 6:**

Run deterministic checks:
```bash
pnpm build && pnpm typecheck && pnpm test
```

If any fail, read the errors, fix them, and re-run. Do not proceed until both pass.

Then run the self-review. First, get the review prompt:
```bash
node packages/cli/dist/cli.js verify --self-review
```

This outputs the rubric and code context for each agent-review layer. Read the output carefully and evaluate the code against:

**Code quality** (`.canductor/rubrics/canductor-code-quality.md`):
- **Architecture (30%)**: small functions, correct dependency direction, no `any`, explicit error handling
- **Verification Engine (25%)**: layers composable and independent, results log consistent
- **Testing (25%)**: new functions have tests, happy path + at least one error path
- **Code Style (20%)**: strict mode passes, no unused imports, barrel exports, camelCase/PascalCase

**Test quality** (`.canductor/rubrics/test-quality.md`):
- **Coverage (35%)**: every export has a describe, happy + error paths tested
- **Assertions (25%)**: specific values, not just existence checks
- **Isolation (20%)**: temp dirs, no order dependency, minimal mocks
- **Clarity (20%)**: behavior-describing names, factories, one concern per test

Produce a JSON result:
```json
{"pass": true/false, "score": 0-100, "issues": [{"severity": "critical|high|medium|low", "description": "..."}], "summary": "..."}
```

A score of 80+ means pass. If below 80, fix the issues first, then re-score.

Once the code is ready, run the full verification with your review result injected:
```bash
node packages/cli/dist/cli.js verify "$NUMBER" --review-json '{"pass":true,"score":85,"issues":[],"summary":"Clean implementation"}'
```

This runs all layers (typecheck, tests, code_quality) with your self-review score included in the composite. The `code_quality` layer gets a real score instead of "Skipped."

Read the decision:
- **`auto_merge`**: proceed to Step 6.
- **`block`** or **`human_review`**: **log what failed**, fix the issues, and loop back to the top of Step 5. This counts as your next attempt.

**When verification fails, log the failure with task attribution:**

1. Look at the error output — which file caused the failure?
2. Map that file back to the task (from the Tasks section) that produced it.
3. Log both the learnings and the task result:

```bash
# Log to learnings (narrative — what went wrong and why)
cat >> .canductor/learnings.md << LEARNING

### #$NUMBER, attempt $ATTEMPT ($(date -u +"%Y-%m-%dT%H:%M:%SZ"))
**Failed:** <one-line summary of what the error said>
LEARNING

# Log to tasks.tsv (structured — which task type caused the failure)
# task_type is from the [brackets] in the Tasks section
# guided_by is the .canductor/ file that task type maps to
echo -e "<task_type>\t<guided_by>\t#$NUMBER\t$ATTEMPT\t<failure summary>\t$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .canductor/tasks.tsv
```

After fixing and re-verifying successfully:
```bash
# Record the fix in learnings
cat >> .canductor/learnings.md << FIX
**Fix:** <one-line summary of what you changed>
FIX

# Log successful task results for ALL tasks in this story
# (each task at the passing verify cycle with failure=none)
echo -e "<task_type>\t<guided_by>\t#$NUMBER\t$ATTEMPT\tnone\t$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> .canductor/tasks.tsv
```

If `.canductor/tasks.tsv` doesn't exist yet, create it with the header first:
```bash
[ -f .canductor/tasks.tsv ] || echo -e "task_type\tguided_by\tref\tverify_cycle\tfailure\ttimestamp" > .canductor/tasks.tsv
```

Commit both files along with your code changes.

**You have up to 6 attempts.** Each attempt: fix -> typecheck -> test -> self-review -> canductor verify with --review-json. Use the error output from each failed verify to guide your fixes.

### Step 5b: If verification fails after 6 attempts — discard

If after 6 attempts the decision is still not `auto_merge`:

1. Resolve the session URL (see [Session URL Resolution](#session-url-resolution)).
2. Push the branch and create a PR anyway (so the work is visible), but do **NOT** merge:
   ```bash
   git add <specific files>
   git commit -m "WIP: #$NUMBER — failed verification after 6 attempts"
   git push -u origin canductor/issue-$NUMBER
   TITLE=$(gh issue view $NUMBER --repo johnnyohwishingtree/canductor --json title --jq .title)
   gh pr create --repo johnnyohwishingtree/canductor \
     --head canductor/issue-$NUMBER --base master \
     --title "WIP: $TITLE" \
     --body "Failed canductor verification after 6 attempts. Needs human review. Ref: #$NUMBER

Session: $SESSION_URL"
   ```
3. Update the result status to rejected:
   ```bash
   node packages/cli/dist/cli.js result-update $NUMBER rejected
   ```
4. Reset the issue so a future run can retry:
   ```bash
   gh issue edit $NUMBER --repo johnnyohwishingtree/canductor --remove-label "in-progress" --add-label "pending"
   gh issue comment $NUMBER --repo johnnyohwishingtree/canductor \
     --body "Pipeline failed to meet quality threshold after 6 attempts. WIP PR created for visibility. Resetting to pending.

Session: $SESSION_URL"
   ```
4. Commit the updated results log:
   ```bash
   git add .canductor/results.tsv
   git diff --cached --quiet || git commit -m "chore: log rejected result for #$NUMBER" && git push -u origin canductor/issue-$NUMBER
   ```
5. **Stop.** Do not proceed to Step 6 or beyond.

### Step 6: Push, PR, merge, close (only if Step 5 passed)

Resolve the session URL (see [Session URL Resolution](#session-url-resolution)).

```bash
git add <specific files> # never git add -A
git commit -m "<descriptive message>

Closes #$NUMBER"
git push -u origin canductor/issue-$NUMBER
```

Create and merge the PR:
```bash
TITLE=$(gh issue view $NUMBER --repo johnnyohwishingtree/canductor --json title --jq .title)
gh pr create --repo johnnyohwishingtree/canductor \
  --head canductor/issue-$NUMBER --base master \
  --title "$TITLE" \
  --body "Closes #$NUMBER — implemented autonomously by canductor pipeline.

Session: $SESSION_URL"

PR_NUMBER=$(gh pr list --repo johnnyohwishingtree/canductor --head canductor/issue-$NUMBER --json number --jq '.[0].number')
gh pr review $PR_NUMBER --repo johnnyohwishingtree/canductor --approve --body "Self-verified: typecheck + tests pass."
gh pr merge $PR_NUMBER --repo johnnyohwishingtree/canductor --squash
```

Close the issue with a session-linked comment:
```bash
gh issue comment $NUMBER --repo johnnyohwishingtree/canductor \
  --body "Story complete — implemented and verified by canductor pipeline.

Session: $SESSION_URL"
gh issue edit $NUMBER --repo johnnyohwishingtree/canductor --remove-label "in-progress" --add-label "completed"
gh issue close $NUMBER --repo johnnyohwishingtree/canductor
```

Update the result status to merged and commit the results log:
```bash
git checkout master && git pull origin master
node packages/cli/dist/cli.js result-update $NUMBER merged
git add .canductor/results.tsv
git diff --cached --quiet || git commit -m "chore: log canductor result for #$NUMBER" && git push origin master
```

Check if the story's epic is now complete — if all stories in the epic are closed, close the epic:
```bash
EPIC_LABEL=$(gh issue view $NUMBER --repo johnnyohwishingtree/canductor --json labels --jq '[.labels[].name | select(startswith("epic:"))] | .[0]' 2>/dev/null)
if [ -n "$EPIC_LABEL" ] && [ "$EPIC_LABEL" != "null" ]; then
  OPEN_STORIES=$(gh issue list --repo johnnyohwishingtree/canductor --label "story" --state open --json labels --jq "[.[] | select(.labels | map(.name) | any(. == \"$EPIC_LABEL\"))] | length")
  if [ "$OPEN_STORIES" -eq 0 ]; then
    EPIC_NUMBER=$(gh issue list --repo johnnyohwishingtree/canductor --label "epic,$EPIC_LABEL" --state open --json number --jq '.[0].number' 2>/dev/null)
    if [ -n "$EPIC_NUMBER" ] && [ "$EPIC_NUMBER" != "null" ]; then
      gh issue close "$EPIC_NUMBER" --repo johnnyohwishingtree/canductor \
        --comment "All stories completed. Epic closed automatically by pipeline."
    fi
  fi
fi
```

### Step 7: Optimize templates and patterns (when queue is empty)

Only runs when there are no pending stories left.

```bash
PENDING=$(gh issue list --repo johnnyohwishingtree/canductor --label "story" --label "pending" --state open --json number --jq 'length')
if [ "$PENDING" -gt 0 ]; then
  echo "Stories still pending — skip optimization"
  # Jump to next story instead
fi
```

If no pending stories, read and follow `.claude/skills/optimize/SKILL.md`. This skill reads `.canductor/findings.tsv` (from audits) and `.canductor/tasks.tsv` (from pipeline runs) and updates the templates/patterns that need improvement.

### Step 8: Plan next epic (when queue is empty)

Only runs when there are no pending stories left and optimization is done.

```bash
# Check there's truly nothing queued
PENDING=$(gh issue list --repo johnnyohwishingtree/canductor --label "story" --label "pending" --state open --json number --jq 'length')
if [ "$PENDING" -gt 0 ]; then exit 0; fi
```

Analyze the project to identify the highest-impact improvement:
1. Read the codebase (`packages/core/src/`, `packages/cli/src/`)
2. Read `.canductor/results.tsv` for past work patterns
3. Check recently closed issues to avoid duplicates:
   ```bash
   gh issue list --repo johnnyohwishingtree/canductor --state closed --limit 10 --json number,title
   ```
4. Look for: missing features mentioned in CLAUDE.md, test coverage gaps, CLI commands listed but not implemented, error handling improvements

Read `.claude/index.md` to see available templates and patterns, then read the specific ones you need:
- `.canductor/templates/epic.md` — structure for epic bodies
- `.canductor/templates/story.md` — structure for story bodies

Create an epic and stories following the templates:
```bash
# Create label
gh label create "epic:<slug>" --repo johnnyohwishingtree/canductor --color "0E8A16" --description "Epic: <title>" 2>/dev/null || true

# Create epic (body follows .canductor/templates/epic.md structure)
gh issue create --repo johnnyohwishingtree/canductor \
  --title "Epic: <goal>" --label "epic" --label "epic:<slug>" \
  --body "<follow epic template: goal, context, story checklist, success criteria, out of scope>"

# Create 2-4 stories (body follows .canductor/templates/story.md structure)
# IMPORTANT: populate ALL template sections to minimize token waste during implementation:
#   - Context: list the minimum files/line-ranges needed (prevents reading entire codebase)
#   - Patterns & Templates: which patterns apply (prevents reverse-engineering conventions)
#   - Key Types: inline the relevant type definitions (prevents reading types.ts for 3 lines)
gh issue create --repo johnnyohwishingtree/canductor \
  --title "Story: <task>" --label "story" --label "pending" --label "epic:<slug>" \
  --body "<follow story template — every section, especially Context, Patterns & Templates, and Key Types>"

# Update epic body with actual issue numbers
gh issue edit <epic_number> --repo johnnyohwishingtree/canductor --body "..."
```

Story sizing rules:
- Each story produces a shippable, testable increment
- Combine tightly coupled small steps into one story
- Split steps that touch different layers (core vs cli)
- If a story has no acceptance criteria beyond "files exist," merge it with another

If a story involves creating a new skill, read `.canductor/templates/skill.md` and use it as the starting structure. Evaluate the new skill against `.canductor/rubrics/skill-quality.md`.

The next pipeline run will pick up the first new story.

## Session URL Resolution

Before creating PRs or posting issue comments (Steps 5b and 6), resolve the Claude Code session URL so humans can trace back to the agent session:

```bash
# Attempt to find the current session ID from ~/.claude/projects/
SESSION_ID=$(ls -t ~/.claude/projects/*/sessions/ 2>/dev/null | head -1 | sed 's/\.json$//')
if [ -n "$SESSION_ID" ]; then
  SESSION_URL="https://claude.ai/code/session_$SESSION_ID"
else
  SESSION_URL="https://claude.ai/code"
fi
```

If the session ID cannot be determined, `SESSION_URL` falls back to the Claude Code dashboard. Use `$SESSION_URL` in PR bodies and issue comments.

## Token Optimization

- Don't read files you've already read in this session
- Use `pnpm typecheck` incrementally after each file
- Keep implementation focused — one story, one branch, one PR

## Template Maintenance

<!-- canductor:skill-template-version:2 -->
<!-- Last updated: 2026-03-24 -->
<!-- Update this skill when: new CLI flags are added, new verification layers exist, or the pipeline loop changes -->
