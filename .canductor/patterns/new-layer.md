# Pattern: Add a New Verification Layer Type

When adding a new type of verification layer (beyond `deterministic`, `screenshot-diff`, `agent-review`).

**Templates used:** `templates/module.md`, `templates/test.md`
**Rubrics applied:** `rubrics/canductor-code-quality.md`, `rubrics/test-quality.md`

## Files to modify (in order)

### 1. `packages/core/src/types.ts` — Add the type

Add the new type to the `LayerConfig.type` union:
```typescript
type: 'deterministic' | 'screenshot-diff' | 'agent-review' | 'new-type';
```

Add any new fields `LayerConfig` needs for this layer type (with `/** JSDoc */` and `?` optional marker).

### 2. `packages/core/src/config.ts` — Update Zod schema

Add the new type to the `LayerSchema.type` enum:
```typescript
type: z.enum(['deterministic', 'screenshot-diff', 'agent-review', 'new-type']),
```

Add Zod validators for any new `LayerConfig` fields.

### 3. `packages/core/src/layers.ts` — Add the executor

Create a new exported function following the existing pattern:
```typescript
/** Run a <new-type> layer (<what it does>). */
export function runNewTypeLayer(layer: LayerConfig): LayerResult {
  const start = Date.now();
  // ... implementation ...
  return {
    name: layer.name,
    type: 'new-type',
    pass: true/false,
    score: 0-100,
    errors: '',
    duration_ms: Date.now() - start,
  };
}
```

Add the new case to the `runLayer` dispatcher switch:
```typescript
case 'new-type':
  return runNewTypeLayer(layer);
```

### 4. `packages/core/src/index.ts` — Export

Add the new executor to the barrel export:
```typescript
export { ..., runNewTypeLayer } from './layers.js';
```

### 5. `packages/core/__tests__/layers.test.ts` — Add tests

Add a new `describe('runNewTypeLayer', ...)` block with:
- Happy path (returns pass)
- Error path (returns fail with descriptive error)
- Edge case (missing config fields, empty input)

Update the `describe('runLayer', ...)` block:
- Add a dispatch test for the new type

### 6. `.canductor/config.yaml` — Document

Add a commented example in the init template (`cli.ts` `cmdInit` function):
```yaml
# new_layer:
#   name: new_layer
#   type: new-type
#   <new-type-specific-fields>
#   weight: 0.8
```

### 7. Run checks

```bash
pnpm typecheck  # Must pass — catches type union mismatches
pnpm test       # Must pass — catches missing switch cases
```

## Checklist

- [ ] Type union updated in `types.ts`
- [ ] Zod schema updated in `config.ts`
- [ ] Executor function created in `layers.ts`
- [ ] Switch case added in `runLayer`
- [ ] Barrel export added in `index.ts`
- [ ] Tests: happy path, error path, edge case
- [ ] Dispatch test in `runLayer` describe block
- [ ] Init template updated with commented example
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes

<!-- canductor:pattern-version:1 -->
