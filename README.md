# canductor

A quality harness that fine-tunes your codebase so AI agents write better code every sprint.

## The Problem

AI agents can write code. But how do you know the code is actually good — for your specific project, your patterns, your standards?

Tests tell you it works. Canductor tells you it's *good* — and gets better at telling you over time.

## How It Works

Canductor sits beside your repo as a quality harness. It scores agent output, logs results, and feeds patterns back into agent prompts. The codebase accumulates "context-level fine-tuning" — not model weights, but the rules, rubrics, and history that shape how agents behave in your project.

```
Agent writes code
  → Canductor scores it (tests, visual diff, AI rubric review)
  → Composite quality score (0-100)
  → Policy decision (auto-merge / human-review / block)
  → Result logged to .canductor/results.tsv
  → History injected into agent prompts next run
  → Agent avoids past mistakes, output improves over time
```

Inspired by [autoresearch](https://github.com/karpathy/autoresearch) — try, measure, keep/discard, learn. But for code quality instead of ML metrics.

## The Self-Building Pipeline

Canductor builds itself using canductor. **Claude Code is the orchestration layer** — no external workflow engines, no event buses, no servers.

We evaluated Inngest, Temporal, and OpenClaw before landing here. Claude Code provides everything a pipeline needs natively: cloud sessions for background execution, sub-agents for parallel work, hooks for automation, and skills for reusable workflows. The model IS the orchestrator.

### How it runs

A GitHub Actions cron fires every 20 minutes:

1. **Find work** — queries GitHub Issues for `story,pending` labels
2. **Dispatch agent** — runs Claude via `claude-code-action` on a branch
3. **Verify** — runs `canductor verify` to score the output
4. **Merge or fix** — creates PR, merges if quality meets baseline
5. **Close and chain** — marks story complete, next cron picks up the next one

**To start work:** create a GitHub Issue with the `story` and `pending` labels. The pipeline picks it up within 20 minutes.

### Why Claude Code, not a workflow engine

| What we need | Claude Code feature |
|---|---|
| Background execution | Cloud sessions (`claude.ai/code`) |
| Parallel work | Sub-agents, Agent Teams |
| Automation hooks | 21 lifecycle events (PreToolUse, PostToolUse, Stop, etc.) |
| Retry on failure | Hooks can re-dispatch on Stop |
| Token optimization | Plan mode (53% cheaper), `.claudeignore`, skills on-demand |
| State persistence | `.canductor/results.tsv` committed to repo |

No external infrastructure. No databases, no servers, no event buses. GitHub Issues are the task queue. GitHub Actions is the compute. The repo is the database.

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

1. Copy `.github/workflows/pipeline.yml`, `agent.yml`, `verify.yml` to your repo
2. Add secrets: `CLAUDE_CODE_OAUTH_TOKEN`, `GH_PAT`
3. Create labels: `story`, `pending`, `in-progress`, `completed`
4. Create an issue with `story` + `pending` labels
5. Pipeline picks it up on the next cron cycle

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
  # ux_review:
  #   name: ux_review
  #   type: agent-review
  #   model: claude-sonnet-4-6
  #   rubric: ".canductor/rubrics/ux.md"
  #   context: ["src/components/"]
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
Sends code context + a rubric markdown file to Claude. The rubric defines what "good" means for your domain. Returns a structured score with issues.

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
canductor history             Show results history table
canductor context             Generate quality context for agent prompts
canductor inject <file>       Inject quality context into a file (e.g., CLAUDE.md)
canductor suggest             Suggest rule improvements based on history
canductor diff <ref1> <ref2>  Compare quality scores between two refs
```

## Architecture

```
.canductor/
├── config.yaml         # What "good" means (layers + policy)
├── results.tsv         # Verification history (the "training data")
├── baselines/          # Screenshot baselines
└── rubrics/            # AI review criteria (markdown)

.github/workflows/
├── pipeline.yml        # Cron: finds stories, dispatches work, merges results
├── agent.yml           # Runs claude-code-action on a branch
└── verify.yml          # Runs canductor verify and posts score

.claude/
├── skills/pipeline/    # /pipeline skill for manual invocation
└── hooks/              # PostToolUse auto-typecheck, Stop session logging
```

**No external infrastructure.** No databases, no servers, no event buses. GitHub Issues are the task queue. GitHub Actions is the compute. `.canductor/results.tsv` is the database. Everything lives in the repo.

## Philosophy

- **You define what "good" means.** Canductor provides primitives (deterministic, visual, AI review). You fill in the rubrics.
- **Scores, not just pass/fail.** A composite score tracks whether agent output is improving.
- **The repo is the database.** Results committed to the repo. No external service needed.
- **The agent learns from context, not training.** Past results are injected into prompts. The agent gets more informed, not retrained.
- **The harness improves itself.** This repo uses canductor to evaluate its own code. The pipeline builds the pipeline.

## License

Apache 2.0
