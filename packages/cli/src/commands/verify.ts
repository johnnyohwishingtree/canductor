/**
 * Verify commands — verification, scoring, and layer testing
 */

import {
  loadConfig,
  verify,
  appendResult,
  getBaseline,
  getAgentReviewPrompt,
  parseReviewJson,
  runLayer,
} from '@canductor/core';
import type { AgentReviewResult, VerifyOptions } from '@canductor/core';

/**
 * Run all verification layers, log result, and print decision.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export async function cmdVerify(args: string[], repoRoot: string): Promise<void> {
  const ref = args[1] && !args[1].startsWith('--') ? args[1] : 'HEAD';
  const jsonMode = args.includes('--json');
  const selfReviewMode = args.includes('--self-review');
  const reviewJsonIdx = args.indexOf('--review-json');
  const exitCodeArg = args.find(a => a.startsWith('--exit-code='));
  const config = loadConfig(repoRoot);

  if (selfReviewMode) {
    let foundPrompt = false;
    for (const [name, layerConfig] of Object.entries(config.layers)) {
      if (layerConfig.type !== 'agent-review') continue;
      const prompt = getAgentReviewPrompt({ ...layerConfig, name });
      if (!prompt) {
        console.error(`Could not build review prompt for layer "${name}"`);
        continue;
      }
      foundPrompt = true;
      console.log(`=== CANDUCTOR SELF-REVIEW: ${name} ===`);
      console.log('Evaluate the following code against this rubric and respond with JSON:');
      console.log('{"pass": boolean, "score": 0-100, "issues": [...], "summary": "..."}');
      console.log('');
      console.log(prompt.userPrompt);
      console.log(`=== END SELF-REVIEW: ${name} ===`);
    }
    if (!foundPrompt) {
      console.log('No agent-review layers found in config.');
    }
    return;
  }

  let selfReviewResults: Record<string, AgentReviewResult> | undefined;
  if (reviewJsonIdx !== -1) {
    const rawJson = args[reviewJsonIdx + 1];
    if (!rawJson) {
      console.error('--review-json requires a JSON argument');
      process.exit(1);
    }
    const parsed = parseReviewJson(rawJson);
    selfReviewResults = {};
    for (const [name, layerConfig] of Object.entries(config.layers)) {
      if (layerConfig.type === 'agent-review') {
        selfReviewResults[name] = parsed;
      }
    }
  }

  const verboseMode = args.includes('--verbose');
  const verboseOutput: string[] = [];
  const options: VerifyOptions | undefined = verboseMode
    ? {
        verbose: true,
        logger: (msg: string) => {
          console.log(msg);
          verboseOutput.push(msg);
        },
      }
    : undefined;

  const result = await verify(ref, config, selfReviewResults, repoRoot, options);

  let threshold: number | null = null;
  if (exitCodeArg) {
    const value = exitCodeArg.split('=')[1];
    if (value === 'auto') {
      threshold = getBaseline(repoRoot, config);
    } else {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed)) {
        console.error(`Invalid --exit-code value: "${value}". Use a number or "auto".`);
        process.exit(1);
      }
      threshold = parsed;
    }
  }

  const thresholdPassed = threshold === null || result.composite_score >= threshold;

  if (jsonMode) {
    const sequentialMs = result.layers.reduce((sum, l) => sum + l.duration_ms, 0);
    const layersJson = result.layers.map(l => ({
      name: l.name,
      type: l.type,
      pass: l.pass,
      score: l.score,
      duration_ms: l.duration_ms,
      timed_out: l.timed_out ?? false,
      retries_attempted: l.retries_attempted ?? 0,
    }));
    const output: Record<string, unknown> = {
      score: result.composite_score,
      decision: result.decision,
      summary: result.summary,
      passed: result.decision !== 'block' && thresholdPassed,
      wall_clock_ms: result.wall_clock_ms,
      sequential_ms: sequentialMs,
      layers: layersJson,
    };
    if (threshold !== null) {
      output.threshold = threshold;
    }
    if (verboseMode) {
      output.verbose_output = verboseOutput;
    }
    console.log(JSON.stringify(output));
  } else {
    console.log(result.summary);
    console.log(`\nComposite score: ${result.composite_score}/100`);
    console.log(`Decision: ${result.decision}`);
  }

  appendResult(repoRoot, result, 'pending', `Verified ${ref}`);
  if (!jsonMode) {
    console.log('\nResult logged to .canductor/results.tsv');
  }

  if (!thresholdPassed) {
    if (!jsonMode) {
      console.log(`Score ${result.composite_score} below threshold ${threshold}`);
    }
    process.exit(1);
  }

  if (result.decision === 'block') {
    process.exit(1);
  }
}

/**
 * Run layers and print composite score only.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export async function cmdScore(args: string[], repoRoot: string): Promise<void> {
  const ref = args[1] ?? 'HEAD';
  const config = loadConfig(repoRoot);
  const result = await verify(ref, config);
  console.log(result.composite_score);
}

/**
 * Run a single verification layer in isolation.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export async function cmdLayerTest(args: string[], repoRoot: string): Promise<void> {
  const layerName = args[1];
  const jsonMode = args.includes('--json');

  if (!layerName || layerName.startsWith('--')) {
    console.error('Usage: canductor layer-test <layer-name>');
    process.exit(1);
  }

  const config = loadConfig(repoRoot);
  const layerConfig = config.layers[layerName];

  if (!layerConfig) {
    const available = Object.keys(config.layers).join(', ');
    console.error(`Layer not found: ${layerName}`);
    console.error(`Available layers: ${available}`);
    process.exit(1);
  }

  const result = await runLayer({ ...layerConfig, name: layerName }, undefined, repoRoot);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const status = result.pass ? 'PASS' : 'FAIL';
    console.log(`${status} ${result.name} (${result.type})`);
    console.log(`  Score: ${result.score}/100`);
    console.log(`  Duration: ${result.duration_ms}ms`);
    if (result.errors) {
      console.log(`  Errors: ${result.errors}`);
    }
  }

  if (!result.pass) {
    process.exit(1);
  }
}
