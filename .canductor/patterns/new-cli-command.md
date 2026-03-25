# Pattern: Add a New CLI Command

When adding a new subcommand to the `canductor` CLI.

**Templates used:** `templates/module.md` (if new core logic), `templates/test.md`
**Rubrics applied:** `rubrics/canductor-code-quality.md`, `rubrics/test-quality.md`

## Files to modify (in order)

### 1. Core logic first (if needed)

If the command needs new logic, add it to the appropriate `packages/core/src/` module (or create a new one following `templates/module.md`). Export from `packages/core/src/index.ts`.

Do NOT put business logic in `cli.ts` — it should only parse args and call core functions.

### 2. Add the command handler to the appropriate command module

Command handlers live in `packages/cli/src/commands/` grouped by concern:
- `verify.ts` — verification commands (verify, score, layer-test)
- `analytics-query.ts` — results querying (status, trend, diff, baseline, history)
- `analytics-diagnostics.ts` — analysis/diagnostics (insights, tasks, report, health)
- `utility.ts` — setup/maintenance (init, inject, suggest, context, result-update, config-check, clean, skill-lint, layers)

**Add the handler function to the correct module:**
```typescript
export function cmdNewCommand(args: string[], repoRoot: string): void {
  const arg1 = args[1];
  if (!arg1) {
    console.error('Usage: canductor <new-cmd> <required-arg>');
    process.exit(1);
  }

  const result = coreFunction(repoRoot, arg1);
  console.log(result);
}
```

**Extracting positional args when flags are present:**

When the command takes both positional args and flags (e.g., `canductor layer-trend tests --last 5 --json`), filter out flags to find the positional arg:

```typescript
const positionalArg = args.find(a => a !== 'command-name' && !a.startsWith('--'));
if (!positionalArg) {
  console.error('Usage: canductor <cmd> <required-arg> [--flag]');
  process.exit(1);
}
```

### 3. Register the command in the registry

**`packages/cli/src/commands/index.ts`** — add to the `commands` Map and re-export:
```typescript
import { cmdNewCommand } from './<module>.js';

export const commands = new Map<string, CommandFn>([
  // ...existing entries...
  ['new-cmd', cmdNewCommand],
]);

export { /* ...existing exports..., */ cmdNewCommand };
```

### 4. Update `packages/cli/src/cli.ts` usage banner

**Add the command to `printUsage()`:**
```typescript
  canductor <new-cmd> [args]    <one-line description>
```

### 5. `packages/cli/__tests__/cli.test.ts` — Add tests

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

### 6. Update the pipeline skill (if applicable)

If this command should run during the pipeline loop, update `.claude/skills/pipeline/SKILL.md` to include it at the appropriate step. Common places:
- **Step 2** (inject): commands that update context
- **Step 5** (verify): commands that check quality
- **Step 7** (plan): commands that analyze the codebase

### 7. Run checks

```bash
pnpm build      # CLI must compile
pnpm typecheck  # No type errors
pnpm test       # CLI tests pass
```

## Checklist

- [ ] Core logic in `packages/core/` (not in command modules)
- [ ] Core function exported from `packages/core/src/index.ts`
- [ ] Command handler in the correct `packages/cli/src/commands/` module
- [ ] Handler receives `(args: string[], repoRoot: string)` parameters
- [ ] Command registered in `packages/cli/src/commands/index.ts` Map
- [ ] Handler re-exported from `packages/cli/src/commands/index.ts`
- [ ] Usage banner updated in `printUsage()` in `packages/cli/src/cli.ts`
- [ ] CLI integration tests (happy + error path)
- [ ] Pipeline skill updated (if command belongs in the loop)
- [ ] `pnpm build && pnpm typecheck && pnpm test` passes

<!-- canductor:pattern-version:2 -->
