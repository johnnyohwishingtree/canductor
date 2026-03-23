# /pipeline — Autonomous Story Pipeline

Run the canductor self-building pipeline. Picks up pending stories, implements them, verifies with canductor scoring, and merges — all autonomously.

## Usage
```
/pipeline              # Process next pending story
/pipeline --loop       # Keep processing until no stories remain
/pipeline --issue N    # Process a specific issue
```

## How It Works

This skill orchestrates the full story lifecycle using Claude Code sub-agents:

1. **Find work** — query GitHub for `story,pending` issues
2. **Inject context** — run `canductor inject CLAUDE.md` to update quality context from past results
3. **Implement** — spawn a sub-agent to implement the story on a branch
4. **Verify** — run `canductor verify` to score the output
5. **Fix loop** — if score < baseline or tests fail, spawn fix sub-agent (up to 6 attempts)
6. **Create PR** — open a PR with the verified code
7. **Merge** — squash merge the PR
8. **Log** — append result to `.canductor/results.tsv`
9. **Chain** — if `--loop`, pick up next pending story

## Instructions

When this skill is invoked, follow these steps exactly:

### Step 1: Find the next story

```bash
# If --issue N was specified, use that issue
# Otherwise find the next pending story
gh issue list --repo "$REPO" --label "story,pending" --state open --json number,title --jq '.[0]'
```

If no pending stories, report "No pending stories" and stop.

### Step 2: Update quality context

```bash
cd /path/to/repo
node packages/cli/dist/cli.js inject CLAUDE.md
```

This updates CLAUDE.md with quality patterns from past verification results so you avoid repeating past mistakes.

### Step 3: Mark story as in-progress

```bash
gh issue edit $ISSUE_NUMBER --repo "$REPO" --remove-label "pending" --add-label "in-progress"
gh issue comment $ISSUE_NUMBER --repo "$REPO" --body "Pipeline picked up this story. Starting implementation."
```

### Step 4: Create branch and implement

Create a branch `canductor/issue-$ISSUE_NUMBER` from master.

```bash
git checkout -b canductor/issue-$ISSUE_NUMBER origin/master
```

Now read the issue body and implement it. Follow CLAUDE.md rules:
- Run `pnpm typecheck` after every file change
- Run `pnpm test` before committing
- Never use `any` types
- Keep functions small and single-purpose

Push the implementation:
```bash
git push -u origin canductor/issue-$ISSUE_NUMBER
```

### Step 5: Verify with canductor

```bash
pnpm build
node packages/cli/dist/cli.js verify "$ISSUE_NUMBER"
SCORE=$(node packages/cli/dist/cli.js score "$ISSUE_NUMBER")
```

Read the decision from the output.

### Step 6: Fix loop (if needed)

If the verification fails (decision = "block"):
- Read the error summary
- Fix the issues
- Run `pnpm typecheck && pnpm test` to confirm
- Push and re-verify
- Repeat up to 6 times

### Step 7: Create and merge PR

```bash
gh pr create --head "canductor/issue-$ISSUE_NUMBER" --base master \
  --title "$(gh issue view $ISSUE_NUMBER --json title --jq .title)" \
  --body "Closes #$ISSUE_NUMBER

Autonomously implemented by canductor pipeline.
Canductor score: $SCORE/100"

gh pr merge --squash --admin
```

### Step 8: Log result and clean up

```bash
node packages/cli/dist/cli.js history  # verify result was logged
gh issue edit $ISSUE_NUMBER --repo "$REPO" --remove-label "in-progress" --add-label "completed"
gh issue close $ISSUE_NUMBER --repo "$REPO"
```

### Step 9: Chain to next story (if --loop)

If `--loop` was specified, go back to Step 1.

## Token Optimization

- Use plan mode for orchestration decisions (reading issues, checking scores)
- Only switch to full mode for implementation
- Don't read files you've already read in this session
- Use `pnpm typecheck` incrementally (one file at a time)
- Keep the implementation focused — one story, one branch, one PR
