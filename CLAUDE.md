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
├── cli/            # CLI tool (canductor init/verify/score/history/context/inject/suggest/diff/status/trend)
└── github-action/  # GitHub Action wrapper (optional, for CI-only use)

.canductor/ (read-write — pipeline creates and optimizes these)
├── config.yaml         # Verification layer definitions + policy
├── results.tsv         # Story-level verification scores
├── tasks.tsv           # Task-type attempt tracking (the learning signal)
├── learnings.md        # What went wrong and how it was fixed
├── templates/          # File structure definitions (task types)
├── patterns/           # Multi-file change recipes (task types)
└── rubrics/            # Quality evaluation criteria

.claude/ (read-only — pipeline never edits these)
├── skills/
│   ├── pipeline/              # /pipeline — the autonomous story loop
│   └── canductor-verify/      # /canductor-verify — manual quality scoring
├── rules/                     # Always-on constraints (auto-loaded every session)
├── hooks/                     # PostToolUse auto-typecheck, Stop session logging
└── settings.json              # Permissions + hook configuration
```

## Run Commands

```bash
pnpm install        # Install all dependencies
pnpm build          # Build all packages
pnpm test           # Run all tests
pnpm typecheck      # Type check all packages
```

## How the Self-Building Loop Works

Canductor is orchestrated by a **Claude Code scheduled task** — no GitHub Actions runners needed. The scheduled task runs hourly and follows `.claude/skills/pipeline/SKILL.md`:

1. **Merge open PRs** — ensures master is current before starting new work
2. **Inject context** — `canductor inject CLAUDE.md` updates quality context from past results
3. **Implement** — picks up the next `story,pending` issue, creates a branch, implements it
4. **Verify** — runs `canductor verify` (typecheck + tests + self-review against rubric)
5. **Merge** — creates PR, approves, squash merges
6. **Plan** — if no stories remain, analyzes the codebase and creates a new epic with stories
7. **Repeat** — next hourly run picks up the next story or the first story from the new epic

**To start work:** create a GitHub Issue with `story` and `pending` labels, or let the planner create them.

### Why Claude Code scheduled tasks, not GitHub Actions

The previous architecture used GitHub Actions (`pipeline.yml` + `agent.yml`) to orchestrate work. This had a critical cost problem: `claude-code-action` holds a GitHub runner for 10-30 minutes while Claude works. At $0.006/min for Linux runners, autonomous pipelines easily run up $250+/month in runner costs.

Claude Code scheduled tasks flip the model:
- **Claude runs on Anthropic's infrastructure** (included in subscription)
- **GitHub is just the data layer** — issues, branches, PRs via `gh` CLI
- **Zero runner cost** — no GitHub Actions minutes consumed
- **Same capabilities** — `gh` CLI, `git`, full shell access

| Old (GitHub Actions) | New (Claude Code) |
|---|---|
| `pipeline.yml` cron → `agent.yml` dispatch | Scheduled task reads `/pipeline` skill |
| Runner holds for 10-30 min per story | Claude cloud session, no runner |
| $250+/mo in runner costs | $0 runner cost |
| Separate verify.yml workflow | `canductor verify` runs inline |

### The scheduled task

One hourly scheduled task does everything. The prompt is minimal:

```
Read CLAUDE.md for project context.
Read .claude/skills/pipeline/SKILL.md and follow every step.
```

All instructions live in the repo (versioned, improvable by the pipeline itself). The scheduled task config just points to the skill file.

## Key Concepts

- **Verification Layer**: A single dimension of quality evaluation (tests, visual regression, agent review)
- **Composite Score**: Weighted average of all layer scores (0-100)
- **Policy**: Expression that maps scores to decisions (auto_merge / human_review / block)
- **Results Log**: .canductor/results.tsv — accumulated verification history, the "training data"
- **Quality Context**: Generated from results history, injected into agent prompts
- **Rubric**: Markdown file defining evaluation criteria for agent-review layers

## Rules

Rules in `.claude/rules/` are auto-loaded into every Claude session. See `.claude/index.md` for the full system map (rules, templates, patterns, rubrics, skills).

- `tdd.md` — Write a failing test before fixing any bug
- `commit-gate.md` — Run verification commands from CLAUDE.md before every commit
- `file-conventions.md` — Project structure, `.claude/` vs `.canductor/` layout, naming
- `update-index.md` — Update `.claude/index.md` when adding/removing `.claude/` files
- `quality-verification.md` — Run canductor verify before merging, log results after

## Architecture Decisions

- **Claude Code for orchestration**: Scheduled tasks replace GitHub Actions pipeline — zero runner cost
- **Skills as pipeline definitions**: `.claude/skills/pipeline/SKILL.md` is the single source of truth for the pipeline loop. Scheduled task just references it. This means the pipeline can improve itself by editing its own skill file.
- **TSV for results**: Committed to repo, no external database needed
- **Rubric-based evaluation**: Quality criteria defined in markdown, evaluated by the implementing Claude against the rubric (no separate API key needed)
- **Hooks for automation**: PostToolUse auto-typechecks, Stop logs sessions
- **GitHub as data layer**: Issues = task queue, PRs = code review, `gh` CLI = interface. No runner compute.

<!-- canductor:start -->
## Canductor Quality Context

Current baseline quality score: 99/100

### Task type performance:
- **module** (.canductor/templates/module.md): avg 1 cycles, 19 uses — converged
- **test** (.canductor/templates/test.md): avg 1 cycles, 17 uses — converged
- **update-exports** (.canductor/templates/module.md): avg 1 cycles, 2 uses — good
- **new-cli-command** (.canductor/patterns/new-cli-command.md): avg 1 cycles, 2 uses — good
- **refactor** (.canductor/patterns/refactor.md): avg 1 cycles, 5 uses — converged

### Recent verification results:
- 133: score=98 merged (Verified 133)
- 137: score=99 merged (Verified 137)
- 138: score=99 merged (Verified 138)
- 142: score=99 merged (Verified 142)
- 143: score=98 merged (Verified 143)
<!-- canductor:end -->
