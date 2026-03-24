#!/usr/bin/env node

/**
 * canductor CLI
 *
 * Usage:
 *   canductor verify [ref]        — Run all verification layers, log result
 *   canductor score [ref]         — Run layers and print composite score
 *   canductor history             — Show results history
 *   canductor context             — Generate quality context for agent prompts
 *   canductor inject <target>     — Inject quality context into a file (e.g. CLAUDE.md)
 *   canductor suggest             — Suggest rule improvements based on history
 *   canductor init                — Create a starter .canductor/config.yaml
 */

import { cmdVerify, cmdScore, cmdLayerTest } from './commands/verify.js';
import {
  cmdStatus, cmdTrend, cmdDiff, cmdBaseline,
  cmdHistory, cmdInsights, cmdTasks, cmdReport,
} from './commands/analytics.js';
import {
  cmdInit, cmdInject, cmdSuggest, cmdContext,
  cmdResultUpdate, cmdConfigCheck, cmdClean,
  cmdSkillLint, cmdLayers,
} from './commands/utility.js';

const args = process.argv.slice(2);
const command = args[0];
const repoRoot = process.cwd();

function printUsage(): void {
  console.log(`canductor — quality verification for agentic output

Usage:
  canductor verify [ref]                     Run all layers, log result, print decision
  canductor verify [ref] --self-review       Output review prompt for agent-review layers (no API key needed)
  canductor verify [ref] --review-json <j>   Use pre-evaluated review JSON for agent-review layers
  canductor verify [ref] --exit-code=N       Exit 1 if score < N (use "auto" for baseline)
  canductor score [ref]                      Run layers, print composite score only
  canductor status [--json]                   Show pipeline health overview
  canductor trend [--last N] [--json]        Show quality trend over last N results (default 10)
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
  canductor skill-lint                       Validate SKILL.md frontmatter
  canductor help                             Show this message
`);
}

async function main(): Promise<void> {
  switch (command) {
    case 'verify':
      await cmdVerify(args, repoRoot);
      break;
    case 'score':
      await cmdScore(args, repoRoot);
      break;
    case 'status':
      cmdStatus(args, repoRoot);
      break;
    case 'trend':
      cmdTrend(args, repoRoot);
      break;
    case 'history':
      cmdHistory(args, repoRoot);
      break;
    case 'diff':
      cmdDiff(args, repoRoot);
      break;
    case 'baseline':
      cmdBaseline(args, repoRoot);
      break;
    case 'result-update':
      cmdResultUpdate(args, repoRoot);
      break;
    case 'context':
      cmdContext(args, repoRoot);
      break;
    case 'inject':
      cmdInject(args, repoRoot);
      break;
    case 'suggest':
      cmdSuggest(args, repoRoot);
      break;
    case 'init':
      await cmdInit(args, repoRoot);
      break;
    case 'report':
      cmdReport(args, repoRoot);
      break;
    case 'layer-test':
      await cmdLayerTest(args, repoRoot);
      break;
    case 'layers':
      cmdLayers(args, repoRoot);
      break;
    case 'config-check':
      cmdConfigCheck(args, repoRoot);
      break;
    case 'clean':
      cmdClean(args, repoRoot);
      break;
    case 'tasks':
      cmdTasks(args, repoRoot);
      break;
    case 'insights':
      cmdInsights(args, repoRoot);
      break;
    case 'skill-lint':
      cmdSkillLint(args, repoRoot);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
