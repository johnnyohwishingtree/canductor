# canductor

A quality harness that fine-tunes your codebase so AI agents write better code every sprint.

## The Problem

AI agents can write code. But how do you know the code is actually good — for your specific project, your patterns, your standards?

Tests tell you it works. Canductor tells you it's *good* — and gets better at telling you over time.

## How It Works

Canductor sits beside your repo as a quality harness. It scores agent output, logs results, and feeds patterns back into agent prompts. The codebase accumulates "context-level fine-tuning" — not model weights, but the rules, rubrics, and history that shape how agents behave in your project.

```
Agent writes code
  -> Canductor scores it (tests, visual diff, rubric review)
  -> Composite quality score (0-100)
  -> Policy decision (auto-merge / human-review / block)
  -> Result logged to .canductor/results.tsv
  -> History injected into agent prompts next run
  -> Agent avoids past mistakes, output improves over time
```

Inspired by [autoresearch](https://github.com/karpathy/autoresearch) — try, measure, keep/discard, learn. But for code quality instead of ML metrics.

## The Self-Building Pipeline

Canductor builds itself using canductor. A **Claude Code scheduled task** runs hourly and follows the pipeline skill (`.claude/skills/pipeline/SKILL.md`):

1. **Merge open PRs** — keeps master current
2. **Inject context** — `canductor inject CLAUDE.md` feeds past results into the prompt
3. **Implement** — picks up a `story,pending` issue, creates branch, writes code
4. **Verify** — runs `canductor verify` (typecheck + tests + rubric self-review)
5. **Merge** — creates PR, approves, squash merges
6. **Plan** — if queue is empty, analyzes the codebase and creates a new epic with stories

**To start work:** create a GitHub Issue with `story` and `pending` labels.

### Why Claude Code, not GitHub Actions

The previous version used GitHub Actions to orchestrate work (`pipeline.yml` dispatching `agent.yml`). This had a critical cost problem: `claude-code-action` holds a GitHub runner for 10-30 minutes while Claude works. Autonomous pipelines easily hit $250+/month in runner costs alone.

Claude Code scheduled tasks flip the model — Claude runs on Anthropic's infrastructure (included in subscription) and uses `gh` CLI to interact with GitHub. Zero runner cost. The scheduled task prompt is just two lines:

```
Read CLAUDE.md for project context.
Read .claude/skills/pipeline/SKILL.md and follow every step.
```

All pipeline logic lives in the repo as a skill file — versioned, testable, and improvable by the pipeline itself.

## Quick Start

### Use canductor on your own repo

```bash
# Install
npm install -g @canductor/cli

# Initialize config
canductor init

# Edit .canductor/config.yaml for your project, then:
canductor verify
```

### Set up the autonomous pipeline

1. Create a Claude Code scheduled task (hourly) with this prompt:
   ```
   Read CLAUDE.md for project context.
   Read .claude/skills/pipeline/SKILL.md and follow every step.
   ```
2. Connect the GitHub repo in the scheduled task config
3. Create labels: `story`, `pending`, `in-progress`, `completed`, `epic`
4. Create an issue with `story` + `pending` labels
5. The pipeline picks it up on the next hourly run

Optional: keep `.github/workflows/` for CI-only checks (typecheck, tests) on PRs. These are lightweight and don't hold runners for long.

## Configuration

```yaml
# .canductor/config.yaml
version: 1

layers:
  tests:
    name: tests
    type: deterministic
    run: "npm test"
    weight: 1.0

  typecheck:
    name: typecheck
    type: deterministic
    run: "npx tsc --noEmit"
    weight: 1.0

  # Visual regression (screenshot comparison)
  # visual:
  #   name: visual
  #   type: screenshot-diff
  #   capture: "npx playwright test --project=screenshots"
  #   baseline: ".canductor/baselines/"
  #   threshold: 5
  #   weight: 0.8

  # AI-powered rubric review
  # code_quality:
  #   name: code_quality
  #   type: agent-review
  #   model: claude-sonnet-4-6
  #   rubric: ".claude/rubrics/code-quality.md"
  #   context: ["src/"]
  #   weight: 0.6

policy:
  auto_merge: "all_deterministic_pass AND composite_score >= baseline"
  human_review: "composite_score < baseline"
  block: "any_deterministic_fail"
```

## Verification Layer Types

### `deterministic` — Pass/fail shell commands
Tests, typecheck, lint, security scans. Score is 0 or 100.

### `screenshot-diff` — Visual regression
Captures screenshots with Playwright, compares pixel-by-pixel to baseline using pixelmatch. Score based on similarity percentage.

### `agent-review` — AI-powered quality review
Sends code context + a rubric markdown file to Claude. The rubric defines what "good" means for your domain. Returns a structured score with issues. When running inside a Claude Code session, the implementing Claude reviews against the rubric directly (no separate API key needed).

## The Learning Loop

Every verification result is logged to `.canductor/results.tsv`:

```
ref    score  decision      status    description
#3     77     auto_merge    merged    pipeline function tests
#4     77     auto_merge    merged    review relay
#5     82     auto_merge    merged    watcher function
#6     85     auto_merge    merged    canductor diff command
```

Run `canductor context` to generate a quality summary, or `canductor inject CLAUDE.md` to automatically update your project instructions with patterns from past results:

```markdown
## Canductor Quality Context

Current baseline quality score: 80/100

### Recurring issues (avoid these patterns):
- "visual" layer failed 3 times in the last 10 runs

### Recent verification results:
- #5: score=82 merged (watcher function)
- #6: score=85 merged (canductor diff command)
```

The agent reads this before starting work. No fine-tuning — just accumulated context that gets richer with every PR.

## CLI Commands

```
canductor init                Create starter .canductor/config.yaml
canductor verify [ref]        Run all layers, log result, print decision
canductor score [ref]         Print composite score only
canductor status              Show pipeline health overview
canductor trend [--last N]    Show quality trend over last N results
canductor history             Show results history table
canductor diff <ref1> <ref2>  Compare quality scores between two refs
canductor context             Generate quality context for agent prompts
canductor inject <file>       Inject quality context into a file (e.g., CLAUDE.md)
canductor suggest             Suggest rule improvements based on history
```

## Architecture

```
.canductor/
├── config.yaml         # What "good" means (layers + policy)
├── results.tsv         # Verification history (the "training data")
└── baselines/          # Screenshot baselines

.claude/
├── skills/
│   ├── pipeline/       # /pipeline — the autonomous loop (scheduled task reads this)
│   └── canductor-verify/  # /canductor-verify — manual quality scoring
├── templates/          # Artifact structure definitions (epic, story, module, test, etc.)
├── rubrics/            # Quality evaluation criteria (code, test, skill quality)
├── patterns/           # Multi-file change recipes (new layer, CLI command, rubric, etc.)
├── hooks/              # PostToolUse auto-typecheck, Stop session logging
└── settings.json       # Hook configuration

packages/
├── core/               # Scoring engine, verification layers, results log
├── cli/                # CLI tool
└── github-action/      # GitHub Action wrapper (optional, for CI-only use)
```

**No external infrastructure.** GitHub Issues are the task queue. Claude Code is the compute. `.canductor/results.tsv` is the database. Everything lives in the repo.

## Philosophy

- **You define what "good" means.** Canductor provides primitives (deterministic, visual, AI review). You fill in the rubrics.
- **Scores, not just pass/fail.** A composite score tracks whether agent output is improving.
- **The repo is the database.** Results committed to the repo. No external service needed.
- **The agent learns from context, not training.** Past results are injected into prompts. The agent gets more informed, not retrained.
- **The harness improves itself.** This repo uses canductor to evaluate its own code. The pipeline builds the pipeline.
- **Skills as pipeline definitions.** Pipeline logic lives in `.claude/skills/pipeline/SKILL.md` — versioned, testable, and improvable by the pipeline itself.

## License

Apache 2.0
