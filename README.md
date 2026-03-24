# canductor

A quality harness that fine-tunes your codebase so AI agents write better code every sprint.

## The Problem

AI agents can write code. But how do you know the code is actually good — for *your specific project*, your patterns, your standards?

Tests tell you it works. Canductor tells you it's *good* — and gets better at telling you over time.

## How It Works

Canductor tracks **what goes wrong** when agents implement code and **which instructions caused the problem**. Over time, it optimizes the instructions (templates, patterns, rules) so agents make fewer mistakes.

```
Story has tasks: [module], [test], [new-cli-command]
  → Each task type maps to a .claude/ file by name
  → Pipeline implements, tracks verify attempts per task type
  → Task types averaging > 1 attempt → optimize that .claude/ file
  → Task types at 1 attempt consistently → converged, leave alone
```

The metric is **average verify cycles per task type** — canductor's equivalent of [autoresearch](https://github.com/karpathy/autoresearch)'s val_bpb. Lower is better. 1.0 means the `.claude/` file perfectly guides the agent.

## The Self-Building Pipeline

Canductor builds itself using canductor. A **Claude Code scheduled task** runs hourly and follows `.claude/skills/pipeline/SKILL.md`:

1. **Merge open PRs** — keeps master current
2. **Inject context** — `canductor inject CLAUDE.md` feeds past learnings into the prompt
3. **Find story** — picks up the next `story,pending` issue
4. **Implement** — reads the story's Tasks section, follows the referenced `.claude/` files
5. **Verify & fix loop** — up to 6 attempts. On failure, attributes the error to the task type that caused it and logs to `tasks.tsv`
6. **Merge & close** — creates PR, merges, closes story. Auto-closes the epic if all stories are done.
7. **Optimize** — when the queue is empty, analyzes task tracking data. Updates `.claude/` files that have high avg attempts. Creates new patterns for new task types.
8. **Plan** — when queue is empty and optimization is done, creates a new epic with stories.

**To start work:** create a GitHub Issue with `story` and `pending` labels.

### Why Claude Code, not GitHub Actions

The previous version used GitHub Actions (`pipeline.yml` dispatching `agent.yml`). `claude-code-action` holds a runner for 10-30 min per story — easily $250+/month.

Claude Code scheduled tasks flip the model — Claude runs on Anthropic's infrastructure (included in subscription) and uses `gh` CLI to interact with GitHub. Zero runner cost. The prompt is two lines:

```
Read CLAUDE.md for project context.
Read .claude/skills/pipeline/SKILL.md and follow every step.
```

## The Learning Loop

The real learning doesn't come from scores — it comes from **failures and what caused them**.

### Task tracking (`.canductor/tasks.tsv`)

Every story is broken into tasks. Each task references a `.claude/` file by name:

```markdown
## Tasks
1. [module] Create packages/core/src/clean.ts
2. [test] Create packages/core/__tests__/clean.test.ts
3. [new-cli-command] Add clean command to cli.ts
```

When verification fails, the pipeline attributes the failure to the task that caused it:

```
task_type          guided_by                           ref   cycle  failure
test               .canductor/templates/test.md           #42   1      vague assertions
test               .canductor/templates/test.md           #42   2      none
new-cli-command    .canductor/patterns/new-cli-command.md  #42   1      none
test               .canductor/templates/test.md           #43   1      none
```

Over time, this reveals which `.claude/` files need improvement:

```
test:            avg 1.5 cycles → optimize .canductor/templates/test.md
new-cli-command: avg 1.0 cycles → converged, leave alone
```

The optimization step (Step 7) reads this data, identifies the failure patterns, and updates the `.claude/` files to address them. The next time that task type appears, the agent follows better instructions and gets it right on the first attempt.

### Learnings (`.canductor/learnings.md`)

Narrative log of what went wrong and how it was fixed. Surfaced in `canductor inject CLAUDE.md` so agents read past failures before starting new work.

### Results (`.canductor/results.tsv`)

Story-level verification scores for trend analysis, status tracking, and quality reporting.

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
2. Create labels: `story`, `pending`, `in-progress`, `completed`, `epic`
3. Create an issue with `story` + `pending` labels
4. The pipeline picks it up on the next hourly run

## Verification Layer Types

### `deterministic` — Pass/fail shell commands
Tests, typecheck, lint, security scans. Score is 0 or 100.

### `screenshot-diff` — Visual regression
Pixel-by-pixel comparison using pixelmatch. Score based on similarity percentage.

### `agent-review` — AI-powered quality review
Claude evaluates code against a rubric markdown file. When running inside a Claude Code session, the implementing Claude reviews its own code against the rubric (no separate API key needed).

### `guardrail` — Pattern-based code scanning
Scans files for required or prohibited patterns. Catches structural issues like missing exports, forbidden APIs, or convention violations.

## CLI Commands

```
canductor init                   Create starter config
canductor verify [ref]           Run all layers, log result, print decision
canductor verify --self-review   Output rubric prompt for agent self-evaluation
canductor score [ref]            Print composite score only
canductor status                 Pipeline health overview
canductor trend [--last N]       Quality trend over last N results
canductor history                Results history table
canductor diff <ref1> <ref2>     Compare quality between two refs
canductor baseline               Show/set quality baseline
canductor tasks                  Task type performance (avg cycles per type)
canductor insights               Combined trajectory + correlation analysis
canductor report                 Markdown quality summary
canductor context                Generate quality context for prompts
canductor inject <file>          Inject quality context into a file
canductor suggest                Suggest rule improvements
canductor clean                  Remove stale merged branches
canductor skill-lint             Validate SKILL.md frontmatter
```

## Architecture

```
.canductor/
├── config.yaml         # What "good" means (layers + policy)
├── results.tsv         # Story-level verification scores
├── tasks.tsv           # Task-type attempt tracking (the learning signal)
├── learnings.md        # What went wrong and how it was fixed
└── baselines/          # Screenshot baselines

.claude/
├── skills/
│   ├── pipeline/       # The autonomous loop (scheduled task reads this)
│   └── canductor-verify/  # Manual quality scoring
├── templates/          # File structure definitions (module, test, skill, epic, story)
├── rubrics/            # Quality criteria (code, test, skill quality)
├── patterns/           # Multi-file change recipes (new-cli-command, new-layer, etc.)
├── rules/              # Always-on constraints (tdd, commit-gate, etc.)
├── hooks/              # PostToolUse auto-typecheck, Stop session logging
└── settings.json       # Permissions + hook configuration

packages/
├── core/               # Scoring engine, task tracking, learnings, feedback
├── cli/                # CLI tool
└── github-action/      # GitHub Action wrapper (optional)
```

**No external infrastructure.** GitHub Issues are the task queue. Claude Code is the compute. The `.canductor/` directory is the database. Everything lives in the repo.

## Philosophy

- **You define what "good" means.** Templates, patterns, and rubrics in `.claude/` encode your project's standards.
- **The metric is attempts, not scores.** Average verify cycles per task type — objective, continuous, can't be gamed.
- **The repo is the database.** Results, tasks, and learnings committed to the repo. No external service needed.
- **The instructions improve themselves.** When a task type takes multiple attempts, the pipeline updates the `.claude/` file that guides it.
- **Converged types get left alone.** Once a task type consistently passes on the first attempt, optimization skips it.

## License

Apache 2.0
