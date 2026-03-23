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

If no pending stories, skip to **Step 7** (plan next epic).

### Step 4: Implement

```bash
NUMBER=<issue number>
gh issue edit $NUMBER --repo johnnyohwishingtree/canductor --remove-label "pending" --add-label "in-progress"
git fetch origin master && git checkout -b canductor/issue-$NUMBER origin/master
```

Read the issue body and implement it. Follow CLAUDE.md rules:
- Run `pnpm typecheck` after every file change
- Run `pnpm test` before committing
- Never use `any` types — fix the root cause
- Keep functions small and single-purpose
- Every new module needs tests
- Dependencies flow: cli -> core. Never the reverse.

### Step 4b: Self-update check

After implementing, check if your changes affect the pipeline itself:
- **Did you add or change CLI flags?** Update the `canductor verify` invocations in this file (`.claude/skills/pipeline/SKILL.md`) to use them.
- **Did you add new CLI commands?** Consider if they should be part of the pipeline loop (e.g., a new `canductor lint` command might belong in the verify step).
- **Did you change CLAUDE.md structure?** Make sure the pipeline skill's references to CLAUDE.md sections still work.
- **Did you change the config.yaml schema?** Update any hardcoded references in this file.
- **Did you change the results.tsv format?** Update the results log commit step.

If any updates are needed, make them now — include the skill file changes in your commit. The pipeline improves itself by keeping its own instructions current with the codebase it builds.

If you created or modified any skill files (`.claude/skills/**/*.md`), also evaluate them against `.canductor/rubrics/skill-quality.md` before proceeding. Fix any issues the rubric identifies — skills are pipeline code, they need the same quality bar.

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

This outputs the rubric and code context for each agent-review layer. Read the output carefully and evaluate the code against the rubric criteria:
- **Architecture (30%)**: small functions, correct dependency direction, no `any`, explicit error handling
- **Verification Engine (25%)**: layers composable and independent, results log consistent
- **Testing (25%)**: new functions have tests, happy path + at least one error path
- **Code Style (20%)**: strict mode passes, no unused imports, barrel exports, camelCase/PascalCase

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
- **`block`** or **`human_review`**: read the error summary, fix the issues, and loop back to the top of Step 5. This counts as your next attempt.

**You have up to 6 attempts.** Each attempt: fix -> typecheck -> test -> self-review -> canductor verify with --review-json. Use the error output from each failed verify to guide your fixes.

### Step 5b: If verification fails after 6 attempts — discard

If after 6 attempts the decision is still not `auto_merge`:

1. Push the branch and create a PR anyway (so the work is visible), but do **NOT** merge:
   ```bash
   git add <specific files>
   git commit -m "WIP: #$NUMBER — failed verification after 6 attempts"
   git push -u origin canductor/issue-$NUMBER
   TITLE=$(gh issue view $NUMBER --repo johnnyohwishingtree/canductor --json title --jq .title)
   gh pr create --repo johnnyohwishingtree/canductor \
     --head canductor/issue-$NUMBER --base master \
     --title "WIP: $TITLE" \
     --body "Failed canductor verification after 6 attempts. Needs human review. Ref: #$NUMBER"
   ```
2. Reset the issue so a future run can retry:
   ```bash
   gh issue edit $NUMBER --repo johnnyohwishingtree/canductor --remove-label "in-progress" --add-label "pending"
   gh issue comment $NUMBER --repo johnnyohwishingtree/canductor \
     --body "Pipeline failed to meet quality threshold after 6 attempts. WIP PR created for visibility. Resetting to pending."
   ```
3. **Stop.** Do not proceed to Step 6 or Step 7.

### Step 6: Push, PR, merge, close (only if Step 5 passed)

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
  --body "Closes #$NUMBER — implemented autonomously by canductor pipeline."

PR_NUMBER=$(gh pr list --repo johnnyohwishingtree/canductor --head canductor/issue-$NUMBER --json number --jq '.[0].number')
gh pr review $PR_NUMBER --repo johnnyohwishingtree/canductor --approve --body "Self-verified: typecheck + tests pass."
gh pr merge $PR_NUMBER --repo johnnyohwishingtree/canductor --squash
```

Close the issue:
```bash
gh issue edit $NUMBER --repo johnnyohwishingtree/canductor --remove-label "in-progress" --add-label "completed"
gh issue close $NUMBER --repo johnnyohwishingtree/canductor
```

Commit the results log:
```bash
git checkout master && git pull origin master
git add .canductor/results.tsv
git diff --cached --quiet || git commit -m "chore: log canductor result for #$NUMBER" && git push origin master
```

### Step 7: Plan next epic (when queue is empty)

Only runs when there are no pending stories left.

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

Create an epic and stories:
```bash
# Create label
gh label create "epic:<slug>" --repo johnnyohwishingtree/canductor --color "0E8A16" --description "Epic: <title>" 2>/dev/null || true

# Create epic
gh issue create --repo johnnyohwishingtree/canductor \
  --title "Epic: <goal>" --label "epic" --label "epic:<slug>" \
  --body "<goal, story checklist with issue numbers, success criteria>"

# Create 2-4 stories (each completable in one session)
gh issue create --repo johnnyohwishingtree/canductor \
  --title "Story: <task>" --label "story" --label "pending" --label "epic:<slug>" \
  --body "<description, acceptance criteria, files to modify, dependencies>"

# Update epic body with actual issue numbers
gh issue edit <epic_number> --repo johnnyohwishingtree/canductor --body "..."
```

Story sizing rules:
- Each story produces a shippable, testable increment
- Combine tightly coupled small steps into one story
- Split steps that touch different layers (core vs cli)
- If a story has no acceptance criteria beyond "files exist," merge it with another

The next pipeline run will pick up the first new story.

## Token Optimization

- Don't read files you've already read in this session
- Use `pnpm typecheck` incrementally after each file
- Keep implementation focused — one story, one branch, one PR
