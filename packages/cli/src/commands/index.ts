/**
 * Command registry — maps command names to handler functions
 */

import { cmdVerify, cmdScore, cmdLayerTest } from './verify.js';
import {
  cmdStatus, cmdTrend, cmdDiff, cmdBaseline,
  cmdHistory, cmdInsights, cmdTasks, cmdReport,
} from './analytics.js';
import {
  cmdInit, cmdInject, cmdSuggest, cmdContext,
  cmdResultUpdate, cmdConfigCheck, cmdClean,
  cmdSkillLint, cmdLayers,
} from './utility.js';

/**
 * A command handler function that receives CLI arguments and the repository root.
 */
export type CommandFn = (args: string[], repoRoot: string) => void | Promise<void>;

/**
 * Registry mapping command names to their handler functions.
 */
export const commands = new Map<string, CommandFn>([
  ['verify', cmdVerify],
  ['score', cmdScore],
  ['layer-test', cmdLayerTest],
  ['status', cmdStatus],
  ['trend', cmdTrend],
  ['diff', cmdDiff],
  ['baseline', cmdBaseline],
  ['history', cmdHistory],
  ['insights', cmdInsights],
  ['tasks', cmdTasks],
  ['report', cmdReport],
  ['init', cmdInit],
  ['inject', cmdInject],
  ['suggest', cmdSuggest],
  ['context', cmdContext],
  ['result-update', cmdResultUpdate],
  ['config-check', cmdConfigCheck],
  ['clean', cmdClean],
  ['skill-lint', cmdSkillLint],
  ['layers', cmdLayers],
]);

export {
  cmdVerify, cmdScore, cmdLayerTest,
  cmdStatus, cmdTrend, cmdDiff, cmdBaseline,
  cmdHistory, cmdInsights, cmdTasks, cmdReport,
  cmdInit, cmdInject, cmdSuggest, cmdContext,
  cmdResultUpdate, cmdConfigCheck, cmdClean,
  cmdSkillLint, cmdLayers,
};
