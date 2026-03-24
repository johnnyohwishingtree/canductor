# File Conventions

## The `.claude/` directory (read-only)

Instructions that control Claude's behavior. The pipeline reads these but never edits them autonomously. Changes require human approval.

```
.claude/
├── skills/        # Autonomous workflows (pipeline, canductor-verify)
├── rules/         # Always-on constraints (this directory)
├── settings.json  # Permissions + hook configuration
└── index.md       # System manifest — read this first
```

## The `.canductor/` directory (read-write)

Everything the pipeline can create and modify autonomously:

```
.canductor/
├── config.yaml    # Verification layer definitions + policy
├── results.tsv    # Story-level verification scores
├── tasks.tsv      # Task-type attempt tracking (the learning signal)
├── learnings.md   # What went wrong and how it was fixed
├── templates/     # Single-file structure definitions (task types live here)
├── patterns/      # Multi-file change recipes (task types live here)
├── rubrics/       # Quality evaluation criteria
└── baselines/     # Screenshot baselines
```

Task types in story bodies (e.g., `[module]`, `[new-cli-command]`) map to files in `.canductor/patterns/` or `.canductor/templates/` by name.

## Source file conventions

- **Monorepo structure.** `packages/core/` (engine) and `packages/cli/` (CLI tool). Dependencies flow: cli → core. Never the reverse.
- **One concern per module.** A module handles one domain (e.g., `feedback.ts` for context injection, `results.ts` for the results log).
- **Colocate tests.** Tests mirror source: `packages/core/src/foo.ts` → `packages/core/__tests__/foo.test.ts`.
- **Barrel exports.** Every new export must be added to `packages/core/src/index.ts` or `packages/cli/src/index.ts`.
- **No `any` types.** Fix the root cause instead.
- **ESM imports.** Use `.js` extensions for local imports (ESM resolution).

## Naming conventions

- `camelCase` for functions and variables
- `PascalCase` for types and interfaces
- `kebab-case` for file names
- `UPPER_SNAKE_CASE` for constants
