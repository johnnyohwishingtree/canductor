**Parent Epic:** #<epic_number>

## Description

<What needs to be implemented. Be specific — name the functions, files, and behaviors. Avoid vague verbs like "handle", "process", "deal with".>

## Acceptance Criteria

- [ ] <Observable outcome, not just "implementation complete">
- [ ] <Another observable outcome>
- [ ] All new functions have tests (happy path + at least one error path)
- [ ] No source module exceeds 500 lines (including modules modified by this story) — split if needed
- [ ] All references in `.claude/index.md` and other `.md` files point to files that exist (check after any renames or deletions)
- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm test` passes with all tests green

## Tasks

Each task references a `.canductor/` file that guides its implementation by name.
The pipeline tracks verify attempts per task type to optimize these files over time.

1. [module] Create `<path/to/file.ts>` — <what it does>
2. [test] Create `<path/to/file.test.ts>` — <what to test>
3. [new-cli-command] Add command to `<path/to/cli.ts>` — <what it does>

Task type names map to `.canductor/patterns/<name>.md` or `.canductor/templates/<name>.md`.
If no matching file exists, the task type is new — the pipeline will create a pattern after the story ships.

**Task type guidelines:**
- Each task type should map to ONE `.canductor/` file. Don't create types like `[update-exports]` — barrel exports are already part of `[module]`.
- Use existing types when possible: `module`, `test`, `new-cli-command`, `new-layer`, `new-rubric`, `new-core-module`, `extend-results`.
- Only create a new type when the work genuinely follows a different pattern than existing types.
- Never use `.claude/` file names (rules, skills) as task types — those are read-only.

## Context (read these before implementing)

<List the minimum files/line-ranges the implementer needs to read. This prevents exploratory reading of the entire codebase.>

- `<path/to/file.ts>` — <why: "you're adding a function here" or "see the factory pattern on line 20">
- `<path/to/file.ts:N-M>` — <why: "see how existing commands are structured">

## Key Types

<Inline the type definitions the implementer needs. Avoids reading types.ts for 3 lines.>

```typescript
// From types.ts — only the types relevant to this story
interface ExampleType {
  field: string;
}
```

## Dependencies

<Does this story depend on another story being completed first? If so, list it.>
None / Depends on #<number>

## Verification Notes

<Any specific things canductor verify should check for this story. Leave blank if standard verification is sufficient.>

<!-- canductor:story-template-version:4 -->
