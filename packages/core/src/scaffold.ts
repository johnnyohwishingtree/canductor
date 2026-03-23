/**
 * Scaffold — project toolchain detection for canductor init.
 *
 * Reads the project's package.json and lock files to determine the correct
 * package manager, test command, typecheck command, and build command.
 */

import { existsSync, readFileSync } from 'node:fs';
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
