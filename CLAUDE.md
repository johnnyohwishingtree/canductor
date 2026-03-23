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
│   └── __tests__/             # 92 tests
├── pipeline/       # Inngest-based pipeline runner
│   └── src/
│       ├── inngest.ts         # Inngest client
│       ├── github.ts          # GitHub API wrapper
│       └── functions/         # Pipeline functions
│           ├── implement.ts   # Issue → agent implementation
│           ├── verify-and-fix.ts  # Scoring loop with retries
│           ├── auto-merge.ts  # Merge gate
│           └── orchestrate.ts # Story chaining
├── cli/            # CLI tool (canductor init/verify/score/history/context/inject/suggest)
└── github-action/  # GitHub Action wrapper

apps/
└── api/            # Hono server: GitHub webhooks → Inngest events
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
2. `@canductor` comment triggers the pipeline
3. Inngest receives event → dispatches agent to implement
4. Agent reads this CLAUDE.md + .canductor/ context (past results, recurring issues)
5. Agent writes code, pushes to branch
6. `canductor verify` scores the output (tests + typecheck + code quality rubric)
7. If score >= baseline → merge. If not → fix loop (up to 6 attempts)
8. Result logged to .canductor/results.tsv
9. Next story picks up updated context
10. Repeat — canductor gets better at building canductor

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
- Dependencies flow: pipeline → core, cli → core. Never the reverse.
- Inngest steps must be idempotent (safe to retry)

## Architecture Decisions

- **Inngest for orchestration**: Durable step functions, event-driven, self-hostable
- **Hono for API**: Lightweight, works on Vercel/Cloudflare/Node
- **TSV for results**: Committed to repo, no external database needed
- **Rubric-based evaluation**: Quality criteria defined in markdown, evaluated by LLM
- **GitHub Actions only for agent execution**: claude-code-action requires GH Actions; everything else runs in Inngest

<!-- canductor:start -->
## Canductor Quality Context

Current baseline quality score: 0/100

<!-- canductor:end -->
