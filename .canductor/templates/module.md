# Module Template

New TypeScript source modules in `packages/core/src/` or `packages/cli/src/` follow this structure.

**Matching rubric:** `.canductor/rubrics/canductor-code-quality.md`

## Structure

```typescript
/**
 * <Module name> — <one-line purpose>
 *
 * <Optional second paragraph: why this module exists, what domain it covers.>
 */

import { <named imports> } from 'node:<builtin>';     // Node builtins first
import { <named imports> } from '<dependency>';        // External deps second
import { <named imports> } from './<sibling>.js';      // Local imports last
import type { <type imports> } from './types.js';      // Type-only imports separate

// ---------------------------------------------------------------------------
// Constants (if any)
// ---------------------------------------------------------------------------

const MY_CONSTANT = 'value';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * <What this function does — verb phrase.>
 *
 * @param paramName - <what it is>
 * @returns <what the caller gets back>
 */
export function doSomething(paramName: ParamType): ReturnType {
  // Implementation
}

/**
 * <Second exported function.>
 */
export function doSomethingElse(): void {
  // Implementation
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

function helperFunction(): void {
  // Keep private — only export what consumers need
}
```

## Rules

- **One concern per module.** A module handles one domain (e.g., `feedback.ts` handles context injection, `results.ts` handles the results log). If two exported functions don't share private state or helpers, they belong in separate modules.
- **Explicit types.** No `any`. Function signatures have explicit parameter and return types. Use types from `types.ts` — don't re-declare interfaces inline.
- **JSDoc on every export.** Each exported function has a `/** */` block with `@param` and `@returns`. Internal helpers can skip JSDoc if their name is self-explanatory.
- **Import order.** Node builtins → external packages → local modules → type-only imports. Use `.js` extensions for local imports (ESM resolution).
- **Barrel re-export.** Every new export must be added to `index.ts` in the same package. Types go in the `export type { }` block.
- **No side effects at module level.** Modules must not execute logic on import. All work happens inside exported functions.
- **Error handling.** Functions that can fail return a result type or throw with a descriptive message. Never swallow errors silently.
- **Dependency direction.** `cli` → `core`. Never `core` → `cli`.

## Matching test

Every module `src/<name>.ts` must have a corresponding `__tests__/<name>.test.ts`. See `.canductor/templates/test.md` for test structure.

<!-- canductor:template-version:1 -->
