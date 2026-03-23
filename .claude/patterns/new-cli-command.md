# Pattern: Add a New CLI Command

When adding a new subcommand to the `canductor` CLI.

**Templates used:** `templates/module.md` (if new core logic), `templates/test.md`
**Rubrics applied:** `rubrics/canductor-code-quality.md`, `rubrics/test-quality.md`

## Files to modify (in order)

### 1. Core logic first (if needed)

If the command needs new logic, add it to the appropriate `packages/core/src/` module (or create a new one following `templates/module.md`). Export from `packages/core/src/index.ts`.

Do NOT put business logic in `cli.ts` — it should only parse args and call core functions.

### 2. `packages/cli/src/cli.ts` — Add the command

**Update the usage banner** at the top of `printUsage()`:
```typescript
function printUsage(): void {
  console.log(`canductor — quality verification for agentic output

Usage:
  ...existing commands...
  canductor <new-cmd> [args]    <one-line description>
`);
}
```

**Add the command handler function:**
```typescript
function cmdNewCommand(): void {
  // Parse args specific to this command
  const arg1 = args[1];
  if (!arg1) {
    console.error('Usage: canductor <new-cmd> <required-arg>');
    process.exit(1);
  }

  // Call core logic
  const result = coreFunction(repoRoot, arg1);

  // Output result
  console.log(result);
}
```

**Add the case to `main()` switch:**
```typescript
case 'new-cmd':
  cmdNewCommand();
  break;
```

### 3. `packages/cli/__tests__/cli.test.ts` — Add tests

Add tests that invoke the CLI as a subprocess:
```typescript
describe('canductor <new-cmd>', () => {
  it('outputs expected result for valid input', () => {
    const result = execSync(
      `node ${CLI_PATH} new-cmd valid-arg`,
      { cwd: tempDir, encoding: 'utf-8' }
    );
    expect(result).toContain('expected output');
  });

  it('shows usage on missing args', () => {
    // expect non-zero exit and usage message
  });
});
```

### 4. Update the pipeline skill (if applicable)

If this command should run during the pipeline loop, update `.claude/skills/pipeline/SKILL.md` to include it at the appropriate step. Common places:
- **Step 2** (inject): commands that update context
- **Step 5** (verify): commands that check quality
- **Step 7** (plan): commands that analyze the codebase

### 5. Run checks

```bash
pnpm build      # CLI must compile
pnpm typecheck  # No type errors
pnpm test       # CLI tests pass
```

## Checklist

- [ ] Core logic in `packages/core/` (not in cli.ts)
- [ ] Core function exported from `index.ts`
- [ ] Usage banner updated in `printUsage()`
- [ ] Command handler function added
- [ ] Switch case added in `main()`
- [ ] CLI integration tests (happy + error path)
- [ ] Pipeline skill updated (if command belongs in the loop)
- [ ] `pnpm build && pnpm typecheck && pnpm test` passes

<!-- canductor:pattern-version:1 -->
