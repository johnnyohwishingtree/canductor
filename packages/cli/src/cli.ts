#!/usr/bin/env node

/**
 * canductor CLI — quality verification for agentic output
 */

import { commands } from './commands/index.js';

const args = process.argv.slice(2);
const command = args[0];
const repoRoot = process.cwd();

function printUsage(): void {
  console.log(`canductor — quality verification for agentic output

Usage:
  canductor verify [ref]                     Run all layers, log result, print decision
  canductor verify [ref] --self-review       Output review prompt for agent-review layers (no API key needed)
  canductor verify [ref] --review-json <j>   Use pre-evaluated review JSON for agent-review layers
  canductor verify [ref] --verbose            Show full layer output during verification
  canductor verify [ref] --exit-code=N       Exit 1 if score < N (use "auto" for baseline)
  canductor score [ref]                      Run layers, print composite score only
  canductor status [--json]                   Show pipeline health overview
  canductor trend [--last N] [--json]        Show quality trend over last N results (default 10)
  canductor layer-trend <name> [--last N] [--json]  Show trend for a specific verification layer
  canductor history [--json]                 Show results history table
  canductor diff <ref1> <ref2> [--json]      Compare quality scores between two refs
  canductor baseline [--json]                Show current quality baseline
  canductor baseline --set N                 Set baseline override to N
  canductor baseline --auto                  Set baseline from last 5 merged scores
  canductor result-update <ref> <status>     Update result status (merged|rejected|pending)
  canductor context                          Generate quality context for agent prompts
  canductor inject <file>                    Inject quality context into a file (e.g. CLAUDE.md)
  canductor suggest                          Suggest rule improvements based on history
  canductor init                             Create starter config
  canductor report [ref] [--json]             Generate markdown quality summary
  canductor layers [--json]                   List configured verification layers
  canductor layer-test <name> [--json]        Run a single layer in isolation
  canductor config-check [--json]             Validate config file and policy expressions
  canductor clean [--force]                  Remove merged canductor branches
  canductor insights [--json]                 Show trajectory, correlations, and recommendations
  canductor tasks                             Show task type performance
  canductor health [--json]                   Show unified pipeline health view
  canductor reflections [--ref N] [--gaps-only] Show implementation reflections
  canductor resolve <index>                  Mark a finding as resolved (1-based index)
  canductor resolve --all                    Mark all findings as resolved
  canductor skill-lint                       Validate SKILL.md frontmatter
  canductor help                             Show this message
`);
}

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const handler = commands.get(command);
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  await handler(args, repoRoot);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
