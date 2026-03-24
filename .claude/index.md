# .claude/ System Index

Read this file first. It maps every artifact in the pipeline system. Only read individual files when you need their full content.

## Rules (auto-loaded every session)

| File | Constraint |
|------|-----------|
| `rules/tdd.md` | Write a failing test before fixing any bug |
| `rules/commit-gate.md` | Run build + typecheck + tests before every commit |
| `rules/file-conventions.md` | Project structure, `.claude/` vs `.canductor/` layout, naming |
| `rules/update-index.md` | Update this index when `.claude/` files change |
| `rules/quality-verification.md` | Run canductor verify before merging, log results after |

## Templates + Rubric Pairs

| Template | Rubric | What it structures |
|----------|--------|--------------------|
| `.canductor/templates/module.md` | `.canductor/rubrics/canductor-code-quality.md` | TypeScript source modules |
| `.canductor/templates/test.md` | `.canductor/rubrics/test-quality.md` | Test files |
| `.canductor/templates/skill.md` | `.canductor/rubrics/skill-quality.md` | Skill definitions |
| `.canductor/templates/epic.md` | — | Epic issues |
| `.canductor/templates/story.md` | — | Story issues |
| `.canductor/templates/rubric.md` | Self | Rubric files |

## Patterns

| Pattern | Trigger | Templates Used |
|---------|---------|----------------|
| `.canductor/patterns/new-layer.md` | Adding a verification layer type | module, test |
| `.canductor/patterns/new-cli-command.md` | Adding a CLI subcommand | module, test |
| `.canductor/patterns/new-rubric.md` | Adding a quality dimension | rubric |
| `.canductor/patterns/extend-results.md` | Adding fields to the results log | module, test |
| `.canductor/patterns/new-core-module.md` | Adding a new domain module | module, test |

## Skills

| Skill | Purpose | Invocation |
|-------|---------|------------|
| `skills/pipeline/SKILL.md` | Autonomous story loop — merge, implement, verify, push, plan | `/pipeline` |
| `skills/canductor-verify/SKILL.md` | Run quality verification on the current branch | `/canductor-verify` |
| `skills/audit/SKILL.md` | Codebase health audit — finds drift, dead code, creates fix epic | `/audit` |

## Dependency Graph

```
Story body references → Patterns → Templates
                                        ↓
Rules (always on)              Rubrics evaluate output
```

Stories list which patterns and templates to follow. Patterns reference templates for individual file structure. Rubrics evaluate the result. Rules apply to everything.

## Runtime Data (not in .claude/)

| File | Purpose |
|------|---------|
| `.canductor/config.yaml` | Verification layer definitions + policy |
| `.canductor/results.tsv` | Verification history log (scores) |
| `.canductor/learnings.md` | What went wrong during verify and how it was fixed (narrative) |
| `.canductor/tasks.tsv` | Per-task-type attempt tracking (maps to .claude/ files) |

<!-- pipeline:index-version:3 -->
