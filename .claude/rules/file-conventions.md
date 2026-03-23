# File Conventions

## The `.claude/` directory

All Claude Code pipeline artifacts live under `.claude/`. This is the universal namespace:

```
.claude/
├── skills/        # Autonomous workflows (pipeline, canductor-verify)
├── rules/         # Always-on constraints (this directory)
├── templates/     # Single-file structure definitions
├── rubrics/       # Quality evaluation criteria
├── patterns/      # Multi-file change recipes
└── index.md       # System manifest — read this first
```

## The `.canductor/` directory

Only canductor-the-tool's **runtime data** lives here — not templates, rubrics, or patterns:

```
.canductor/
├── config.yaml    # Verification layer definitions + policy
└── results.tsv    # Verification history log
```

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
