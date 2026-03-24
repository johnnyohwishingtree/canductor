/**
 * @canductor/cli — public API for programmatic use
 */

export { commands } from './commands/index.js';
export type { CommandFn } from './commands/index.js';
export {
  cmdVerify, cmdScore, cmdLayerTest,
  cmdStatus, cmdTrend, cmdDiff, cmdBaseline,
  cmdHistory, cmdInsights, cmdTasks, cmdReport,
  cmdInit, cmdInject, cmdSuggest, cmdContext,
  cmdResultUpdate, cmdConfigCheck, cmdClean,
  cmdSkillLint, cmdLayers, cmdHealth, cmdResolve,
} from './commands/index.js';
