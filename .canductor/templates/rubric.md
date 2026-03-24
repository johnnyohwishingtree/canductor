# Rubric Template

Rubric files in `.canductor/rubrics/` follow this structure.

**Matching rubric:** Self — new rubrics are evaluated against this template.

## Structure

```markdown
# <Domain> Quality Rubric

Evaluate <what's being evaluated> against these criteria.

## <Category 1> (weight: N%)
- <Specific, observable criterion — not vague>
- <Another criterion>

## <Category 2> (weight: N%)
- <Criterion>
- <Criterion>

## <Category 3> (weight: N%)
- <Criterion>
```

## Rules

- **Weights must sum to 100%.** Each category has an explicit weight percentage.
- **2-5 categories.** Fewer than 2 is too coarse. More than 5 is too granular for a single evaluation pass.
- **Criteria are observable.** Each bullet describes something you can verify by reading the code or running a command. No subjective criteria like "code feels clean."
- **Criteria are specific.** `'No any types'` not `'Types are good'`. `'Functions under 30 lines'` not `'Functions are small'`.
- **Categories cover distinct concerns.** No overlap between categories. If a criterion could go in two categories, pick one and leave it there.
- **Name the matching template.** If this rubric evaluates artifacts created from a template, reference that template at the top (e.g., "Evaluates modules following `.canductor/templates/module.md`").
- **Rubric names use kebab-case.** File: `<domain>-quality.md`. Examples: `canductor-code-quality.md`, `skill-quality.md`, `test-quality.md`.

## Template-Rubric pairs

Every template should have a matching rubric, and every rubric should reference its template:

| Template | Rubric | What it covers |
|----------|--------|----------------|
| `templates/module.md` | `rubrics/canductor-code-quality.md` | TypeScript source modules |
| `templates/test.md` | `rubrics/test-quality.md` | Test files |
| `templates/skill.md` | `rubrics/skill-quality.md` | Skill definitions |
| `templates/epic.md` | — | Epic issues (no rubric needed) |
| `templates/story.md` | — | Story issues (no rubric needed) |
| `templates/rubric.md` | Self | Rubric files |

## Design Patterns

Patterns are multi-file change recipes. They reference templates and rubrics:

| Pattern | Templates used | When to follow |
|---------|---------------|----------------|
| `patterns/new-layer.md` | module, test | Adding a verification layer type |
| `patterns/new-cli-command.md` | module, test | Adding a CLI subcommand |
| `patterns/new-rubric.md` | rubric | Adding a quality dimension |
| `patterns/extend-results.md` | module, test | Adding fields to the results log |
| `patterns/new-core-module.md` | module, test | Adding a new domain module |

<!-- canductor:template-version:1 -->
