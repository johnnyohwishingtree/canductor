# Test Template

Test files in `packages/core/__tests__/` or `packages/cli/__tests__/` follow this structure.

**Matching rubric:** `.canductor/rubrics/test-quality.md`

## Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { functionUnderTest } from '../src/<module>.js';
import type { RelevantType } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'canductor-<module>-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Factory for test data — keeps individual tests focused on the scenario. */
function makeTestData(overrides?: Partial<RelevantType>): RelevantType {
  return {
    field: 'default',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// <functionUnderTest>
// ---------------------------------------------------------------------------
describe('<functionUnderTest>', () => {
  it('<happy path — describes the expected behavior>', () => {
    const result = functionUnderTest(validInput);

    expect(result.field).toBe(expectedValue);
  });

  it('<error path — describes what happens with bad input>', () => {
    const result = functionUnderTest(invalidInput);

    expect(result.pass).toBe(false);
    expect(result.errors).toContain('descriptive message');
  });

  it('<edge case — boundary value, empty input, etc.>', () => {
    const result = functionUnderTest(edgeCaseInput);

    expect(result).toEqual(expectedEdgeCaseResult);
  });
});

// ---------------------------------------------------------------------------
// <secondFunction>
// ---------------------------------------------------------------------------
describe('<secondFunction>', () => {
  // Same pattern: happy path, error path, edge cases
});
```

## Rules

- **File naming.** Test file mirrors source: `src/feedback.ts` → `__tests__/feedback.test.ts`.
- **One describe per exported function.** Each public function gets its own `describe` block with a section separator comment.
- **Happy path first.** First `it()` in each describe tests the normal/expected behavior.
- **At least one error path.** Every describe block must test at least one failure scenario (bad input, missing file, command failure).
- **Use factories, not inline data.** Repeated test data uses a `make*()` factory function. Individual tests pass only the fields that matter for their scenario.
- **Temp directories for filesystem tests.** Use `mkdtempSync` in `beforeEach` and `rmSync` in `afterEach`. Never write to the real repo or shared paths.
- **No snapshot files.** Use `expect(value).toBe()` or `expect(value).toContain()`. If comparing objects, use `toEqual()` or `toMatchObject()`.
- **No mocking unless unavoidable.** Test real logic. Only mock external APIs (network calls, `ANTHROPIC_API_KEY`-gated paths). When mocking, use `vi.spyOn` and restore in `afterEach`.
- **Test names describe behavior, not implementation.** `'returns pass when command exits 0'` not `'calls execSync and checks status'`.
- **Assert specific values.** `expect(result.score).toBe(100)` not `expect(result.score).toBeDefined()`.

## Coverage expectations

| Scenario | Required |
|----------|----------|
| Happy path | Always |
| Error/failure path | Always (at least one) |
| Edge cases (empty, boundary, null) | When applicable |
| Async behavior | When function is async |

## Testing markdown/text parsers

When testing modules that parse structured text files (markdown, TSV):

- **Define fixtures as inline string constants** — write the full sample content in the test file, not in external fixture files. This makes tests self-contained and the expected format obvious.
- **Use `writeFileSync` in temp directories** — write the fixture to a temp file, then call the parser:
  ```typescript
  const SAMPLE = `## #160 — 2026-03-24T16:30:00Z

  ### [test] analytics.test.ts
  **Followed:** .canductor/templates/test.md
  **Missing from template:** how to mock execFileSync
  `;

  function writeFixture(content: string): void {
    const dir = join(tempDir, '.canductor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'reflections.md'), content);
  }
  ```
- **Test the empty/missing file case** — parser should return `[]` not throw
- **Test malformed entries** — headers without fields, fields without values
- **See `reflections.test.ts` and `learnings.test.ts`** for working examples

<!-- canductor:template-version:2 -->
