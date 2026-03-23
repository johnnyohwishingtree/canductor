/**
 * Scaffold — project toolchain detection and starter rubric for canductor init.
 *
 * Reads the project's package.json and lock files to determine the correct
 * package manager, test command, typecheck command, and build command.
 * Also scaffolds a starter code-quality rubric.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectToolchain } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the project's toolchain by inspecting lock files and package.json.
 *
 * @param repoRoot - Absolute path to the repository root
 * @returns Detected toolchain with package manager and commands
 */
export function detectToolchain(repoRoot: string): ProjectToolchain {
  const packageManager = detectPackageManager(repoRoot);
  const scripts = readPackageScripts(repoRoot);

  const runPrefix = packageManager === 'npm' ? 'npm run' : packageManager;

  const testCmd = scripts.test
    ? `${runPrefix} test`
    : `npm test`;

  const typecheckCmd = scripts.typecheck
    ? `${runPrefix} typecheck`
    : 'npx tsc --noEmit';

  const buildCmd = scripts.build
    ? `${runPrefix} build`
    : null;

  return { packageManager, testCmd, typecheckCmd, buildCmd };
}

/**
 * Scaffold a starter code-quality rubric at .canductor/rubrics/code-quality.md.
 *
 * @param repoRoot - Absolute path to the repository root
 * @returns true if the rubric was created, false if it already exists
 */
export function scaffoldRubric(repoRoot: string): boolean {
  const rubricDir = join(repoRoot, '.canductor', 'rubrics');
  const rubricPath = join(rubricDir, 'code-quality.md');

  if (existsSync(rubricPath)) return false;

  if (!existsSync(rubricDir)) mkdirSync(rubricDir, { recursive: true });

  writeFileSync(rubricPath, STARTER_RUBRIC);
  return true;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STARTER_RUBRIC = `# Code Quality Rubric

Evaluate TypeScript source code against these criteria. Score each 0-100 and flag issues.

## Architecture (weight: 30%)
- Functions are small and single-purpose
- Dependencies flow in one direction (no circular imports)
- Types are precise (no \`any\`, no loose unions)
- Errors are handled explicitly, not swallowed

## Testing (weight: 30%)
- New functions have corresponding tests
- Tests cover the happy path AND at least one error path
- Mocks are minimal — prefer testing real logic
- No snapshot tests (use inline assertions)

## Code Style (weight: 20%)
- TypeScript strict mode passes
- No unused imports or variables
- Consistent naming conventions
- Comments explain WHY, not WHAT

## Error Handling (weight: 20%)
- External inputs are validated at system boundaries
- Errors include descriptive messages
- No silent failures (catch blocks that swallow errors)
- Async operations handle rejection paths
`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function detectPackageManager(repoRoot: string): ProjectToolchain['packageManager'] {
  if (existsSync(join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(repoRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

interface PackageScripts {
  test?: string;
  typecheck?: string;
  build?: string;
}

function readPackageScripts(repoRoot: string): PackageScripts {
  const pkgPath = join(repoRoot, 'package.json');
  if (!existsSync(pkgPath)) return {};

  try {
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg: { scripts?: Record<string, string> } = JSON.parse(content);
    return {
      test: pkg.scripts?.test,
      typecheck: pkg.scripts?.typecheck,
      build: pkg.scripts?.build,
    };
  } catch {
    return {};
  }
}
