# CLAUDE.md — Canductor

## What This Is

Canductor is a quality verification engine for agentic output. It scores AI agent code, learns from results history, and improves over time. Think "fine-tuning for codebases" — not model weights, but the context and rules that shape agent behavior.

This repo builds itself using canductor. The pipeline evaluates its own output.

## Project Structure

```
packages/
├── core/           # Scoring engine, verification layers, results log, feedback loop
│   ├── src/
│   │   ├── config.ts          # Config loader (.canductor/config.yaml)
│   │   ├── verify.ts          # Run all layers, compute composite score
│   │   ├── layers.ts          # Layer executors (deterministic, screenshot-diff, agent-review)
│   │   ├── policy.ts          # Policy expression parser (AND/OR/NOT, comparisons)
│   │   ├── screenshot.ts      # Pixel-level PNG comparison
│   │   ├── agent-review.ts    # Claude API integration for rubric-based review
│   │   ├── results.ts         # TSV results log (autoresearch-inspired)
│   │   ├── feedback.ts        # Context injection + rule suggestions
│   │   └── types.ts           # Shared types
│   └── __tests__/             # 92+ tests
├── cli/            # CLI tool (canductor init/verify/score/history/context/inject/suggest/diff)
└── github-action/  # GitHub Action wrapper

.claude/
├── skills/
│   ├── pipeline/              # /pipeline — autonomous story loop
│   └── canductor-verify/      # /canductor-verify — run quality scoring
├── hooks/                     # PostToolUse, Stop hooks
└── settings.json              # Hook configuration

.github/workflows/
├── agent.yml                  # Runs claude-code-action (agent compute)
└── verify.yml                 # Runs canductor verify (scoring)
```

## Run Commands

```bash
pnpm install        # Install all dependencies
pnpm build          # Build all packages
pnpm test           # Run all tests
pnpm typecheck      # Type check all packages
```

## How the Self-Building Loop Works

1. Issue created on this repo with `story` label
2. Pipeline dispatches `agent.yml` with the issue details
3. Agent reads this CLAUDE.md + .canductor/ context (past results, recurring issues)
4. Agent writes code, pushes to branch
5. `verify.yml` runs `canductor verify` and scores the output
6. If score >= baseline → create PR and merge. If not → fix loop (up to 6 attempts)
7. Result logged to .canductor/results.tsv
8. Next story picks up updated context via `canductor inject CLAUDE.md`
9. Repeat — canductor gets better at building canductor

## Key Concepts

- **Verification Layer**: A single dimension of quality evaluation (tests, visual regression, agent review)
- **Composite Score**: Weighted average of all layer scores (0-100)
- **Policy**: Expression that maps scores to decisions (auto_merge / human_review / block)
- **Results Log**: .canductor/results.tsv — accumulated verification history, the "training data"
- **Quality Context**: Generated from results history, injected into agent prompts
- **Rubric**: Markdown file defining evaluation criteria for agent-review layers

## Rules

- Run `pnpm typecheck` after every file change
- Run `pnpm test` before committing
- Never use `any` types — fix the root cause
- Keep functions small and single-purpose
- Every new module needs tests
- Dependencies flow: cli → core. Never the reverse.

## Architecture Decisions

- **Claude Code for orchestration**: Cloud sessions, sub-agents, hooks, skills — no external infra needed
- **GitHub Actions for agent compute**: claude-code-action requires GH Actions
- **TSV for results**: Committed to repo, no external database needed
- **Rubric-based evaluation**: Quality criteria defined in markdown, evaluated by LLM
- **Hooks for automation**: PostToolUse auto-typechecks, Stop logs sessions
