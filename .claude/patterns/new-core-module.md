# Pattern: Add a New Core Module

When adding a new module to `packages/core/src/` for a new domain concern.

**Templates used:** `templates/module.md`, `templates/test.md`
**Rubrics applied:** `rubrics/canductor-code-quality.md`, `rubrics/test-quality.md`

## Files to create/modify (in order)

### 1. Define types first

If the new module needs new types, add them to `packages/core/src/types.ts`:
```typescript
/** <What this type represents.> */
export interface NewThing {
  field: string;
}
```

Export types from `packages/core/src/index.ts`:
```typescript
export type { NewThing } from './types.js';
```

Run `pnpm typecheck` to verify type definitions compile.

### 2. `packages/core/src/<name>.ts` — Create the module

Follow `.claude/templates/module.md`:
- Module-level JSDoc comment explaining purpose
- Import order: Node builtins → external → local → types
- Every export has JSDoc with `@param` and `@returns`
- No side effects at module level
- No `any` types

### 3. `packages/core/src/index.ts` — Barrel export

Add all public exports:
```typescript
export { functionA, functionB } from './<name>.js';
```

Run `pnpm typecheck` again — catches consumers that can't resolve the export.

### 4. `packages/core/__tests__/<name>.test.ts` — Create tests

Follow `.claude/templates/test.md`:
- One `describe` per exported function
- Happy path + at least one error path per function
- Factory functions for test data
- Temp directories for filesystem operations

### 5. Wire into CLI (if needed)

If the new module provides functionality that should be CLI-accessible, follow the `patterns/new-cli-command.md` pattern.

### 6. Run checks

```bash
pnpm typecheck  # After each file
pnpm test       # After tests are written
pnpm build      # Final check — ensures dist/ is up to date
```

## Dependency rules

- New module in `core` must NOT import from `cli`
- New module in `core` CAN import from other `core` modules
- New module in `cli` CAN import from `core`
- New module must NOT import from `__tests__/`

## Checklist

- [ ] Types defined in `types.ts` (if new types needed)
- [ ] Module created following `templates/module.md`
- [ ] JSDoc on every export
- [ ] No `any` types
- [ ] Barrel export in `index.ts`
- [ ] Test file created following `templates/test.md`
- [ ] Happy path tested
- [ ] Error path tested
- [ ] `pnpm build && pnpm typecheck && pnpm test` passes

<!-- canductor:pattern-version:1 -->
