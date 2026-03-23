# Pattern: Extend the Results Log

When adding new data to the verification results (new fields in ResultRow, new analysis capabilities).

**Templates used:** `templates/module.md`, `templates/test.md`
**Rubrics applied:** `rubrics/canductor-code-quality.md`, `rubrics/test-quality.md`

## Files to modify (in order)

### 1. `packages/core/src/types.ts` — Add the field

Add new field(s) to `ResultRow`:
```typescript
export interface ResultRow {
  // ...existing fields...
  newField: string;  // or add as optional: newField?: string;
}
```

**Important:** If this is a breaking change to the TSV format, make the field optional (`?`) so existing rows without the field can still be parsed.

### 2. `packages/core/src/results.ts` — Update read/write

**In `readResults`** — add parsing for the new column:
```typescript
const [...existingFields, newField] = line.split('\t');
return { ...existingFields, newField };
```

**In `appendResult`** — add the new column to the row:
```typescript
const row = [...existingValues, newValue].join('\t');
```

**Update `HEADER`** — add the new column name:
```typescript
const HEADER = 'ref\t...\tnewField';
```

### 3. Consumers — Update anything that reads results

Check these functions for impact:
- `analyzeResults()` — if the new field affects quality context
- `generatePromptContext()` — if the new field should appear in agent prompts
- `getStatus()` — if the new field affects pipeline health summary
- `diffResults()` — if the new field should be compared across refs
- `getTrend()` — if the new field should appear in trend output

### 4. `packages/core/__tests__/results.test.ts` — Update tests

- Update factory function (`makeVerifyResult`) to include the new field
- Add tests for the new field's read/write round-trip
- Add edge case test for missing field (backward compat with old rows)
- Update any assertion that checks full row structure

### 5. Backward compatibility

The results log is append-only. Old rows will NOT have the new column. Handle this:
```typescript
// In readResults — provide default for missing field
return {
  ...parsedFields,
  newField: fields[N] ?? 'default',
};
```

### 6. Run checks

```bash
pnpm typecheck  # Catches all consumers that need updating
pnpm test       # Catches broken assertions on row structure
```

## Checklist

- [ ] Type added to `ResultRow` in `types.ts`
- [ ] `HEADER` updated in `results.ts`
- [ ] `readResults` parses new column
- [ ] `appendResult` writes new column
- [ ] Backward compat for old rows (default value)
- [ ] Consumer functions updated (analyzeResults, generatePromptContext, etc.)
- [ ] Tests updated with new field in factory and assertions
- [ ] Edge case test for missing field
- [ ] `pnpm typecheck && pnpm test` passes

<!-- canductor:pattern-version:1 -->
