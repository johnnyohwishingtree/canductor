# Pattern: Refactor Existing Code

When restructuring, extracting, or reorganizing existing code without changing behavior.

**Templates used:** `templates/module.md` (for any new files)
**Rubrics applied:** `rubrics/canductor-code-quality.md`, `rubrics/test-quality.md`

## Steps (in order)

### 1. Understand the existing code

Read all files that will be affected. Identify:
- Public API surface (exports used by other modules)
- Internal helpers (can be moved/renamed freely)
- Test coverage (which tests exercise the code being moved)

### 2. Create new modules (if extracting)

If splitting a large file into smaller ones:
- Follow `templates/module.md` for each new file
- Keep the same public API — callers should not need changes
- Move related functions together (one concern per module)

Run `pnpm typecheck` after creating each file.

### 3. Update imports in consumers

After moving code, update all `import` statements in files that consumed the old location:
- Search for imports of the old module
- Update to the new module path
- Use `.js` extensions for local imports (ESM resolution)

### 4. Update barrel exports

Update `packages/core/src/index.ts` or `packages/cli/src/index.ts`:
- Re-export from the new module locations
- Remove exports from old locations (if the old file was deleted or emptied)
- Ensure no exports are lost

Run `pnpm typecheck` — catches any broken import paths.

### 5. Verify existing tests still pass

```bash
pnpm test
```

All existing tests must pass unchanged. If tests break, the refactor changed behavior — fix it.

### 6. Add tests for new modules (if any)

If new files were created, add test files following `templates/test.md`. Existing test coverage may already exercise the code — add tests only for logic that isn't covered.

### 7. Run checks

```bash
pnpm build && pnpm typecheck && pnpm test
```

## Key principles

- **No behavior changes.** Refactoring reorganizes code, it does not add features or fix bugs.
- **All existing tests must pass unchanged.** If a test needs modification, the refactor likely changed behavior.
- **Preserve the public API.** External consumers should not notice the change.
- **One concern per module.** The goal of most refactors is to improve separation of concerns.

## Checklist

- [ ] Existing tests pass before starting
- [ ] Public API preserved (no exports lost)
- [ ] All imports updated to new paths
- [ ] Barrel exports updated in `index.ts`
- [ ] New modules follow `templates/module.md`
- [ ] No `any` types introduced
- [ ] `pnpm build && pnpm typecheck && pnpm test` passes
- [ ] No behavior changes — only structural reorganization

<!-- canductor:pattern-version:1 -->
