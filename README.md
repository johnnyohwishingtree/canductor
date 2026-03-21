# canductor

Quality verification for agentic output. Fine-tune your codebase so AI agents write better code for your project every sprint.

## The Problem

AI agents (Claude Code, Devin, Copilot, Codex) can write code. But how do you know the code is actually good — for your specific project, your design system, your standards?

Tests tell you it works. Canductor tells you it's good.

## How It Works

```
Agent writes code
  → Canductor runs verification layers (tests, visual regression, AI review)
  → Composite quality score (0-100)
  → Policy decision (auto-merge / human-review / block)
  → Result logged to .canductor/results.tsv
  → History feeds back into agent prompts
  → Agent output improves over time
```

Inspired by [autoresearch](https://github.com/karpathy/autoresearch): try → measure → keep/discard → learn. But for code quality instead of ML metrics.

## Quick Start

```bash
# Install
npm install -g @canductor/cli

# Initialize in your repo
canductor init

# Edit .canductor/config.yaml for your project, then:
canductor verify
```

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

  visual:
    name: visual
    type: screenshot-diff
    capture: "npx playwright test --project=screenshots"
    baseline: ".canductor/baselines/"
    threshold: 5
    weight: 0.8

  ux_review:
    name: ux_review
    type: agent-review
    model: claude-sonnet-4-6
    rubric: ".canductor/rubrics/ux.md"
    context: ["src/components/", "docs/design-system.md"]
    weight: 0.6

policy:
  auto_merge: "all_deterministic_pass AND composite_score >= baseline"
  human_review: "composite_score < baseline"
  block: "any_deterministic_fail"
```

## Verification Layer Types

### `deterministic` — Pass/fail shell commands
```yaml
tests:
  type: deterministic
  run: "npm test"
  weight: 1.0
```
Tests, typecheck, lint, security scans. Binary pass/fail, score is 0 or 100.

### `screenshot-diff` — Visual regression
```yaml
visual:
  type: screenshot-diff
  capture: "npx playwright test --project=screenshots"
  baseline: ".canductor/baselines/"
  threshold: 5      # max % pixel diff before flagging
  weight: 0.8
```
Captures screenshots, compares to baseline. Score based on similarity percentage.

### `agent-review` — AI-powered quality review
```yaml
ux_review:
  type: agent-review
  model: claude-sonnet-4-6
  rubric: ".canductor/rubrics/react-native-ux.md"
  context: ["e2e/screenshots/", "docs/design-system.md"]
  weight: 0.6
```
Sends context + rubric to an LLM, parses structured quality assessment. You define what "good" means in the rubric markdown file.

## The Learning Loop

Canductor logs every verification result to `.canductor/results.tsv`:

```
ref   score  decision      status   description
#501  85     auto_merge    merged   form engine refactor
#502  78     auto_merge    merged   accommodation autocomplete
#503  45     block         rejected settings screen (tests failed)
#504  91     auto_merge    merged   pipeline fixes
```

Run `canductor context` to generate a quality context block that you inject into agent prompts:

```markdown
## Canductor Quality Context

Current baseline quality score: 85/100

### Recurring issues (avoid these patterns):
- "visual" layer failed 3 times in the last 10 runs

### Recent verification results:
- #502: score=78 merged (accommodation autocomplete)
- #503: score=45 rejected (settings screen - tests failed)
- #504: score=91 merged (pipeline fixes)
```

The agent reads this context before starting work, learns what went wrong recently, and avoids repeating those patterns. No fine-tuning needed — just accumulated context.

## CLI Commands

```
canductor init              Create starter .canductor/config.yaml
canductor verify [ref]      Run all layers, log result, print decision
canductor score [ref]       Run layers, print composite score only
canductor history           Show results history table
canductor context           Generate quality context for agent prompts
```

## GitHub Action

```yaml
- uses: canductor/canductor-action@v1
  with:
    ref: ${{ github.event.pull_request.number }}
```

Outputs: `score` (0-100) and `decision` (auto_merge / human_review / block).

## Rubric Packs

| Pack | What it evaluates |
|---|---|
| `ci-basics` | Tests, typecheck, lint (free, built-in) |
| `security` | Semgrep, dependency audit, secret scanning |
| `react-native-ux` | Design system, accessibility, form flow, spacing |
| `web-frontend-ux` | Core Web Vitals, responsive, a11y, design tokens |
| `api-quality` | Contract testing, backwards compat |
| `content-quality` | Brand voice, readability, SEO |

## Philosophy

- **You define what "good" means.** Canductor provides primitives, you fill in the rubrics.
- **Scores, not just pass/fail.** A composite score tracks whether agent output is improving over time.
- **The repo is the database.** Results live in `.canductor/results.tsv`, committed to the repo. No external service required.
- **The agent learns from context, not training.** Past results are injected into prompts. The agent gets more informed, not retrained.

## License

Apache 2.0
