/**
 * Analytics query commands — read-only queries on verification results
 */

import {
  loadConfig,
  readResults,
  diffResults,
  getStatus,
  getTrend,
  computeAutoBaseline,
  getBaseline,
  writeConfigBaseline,
} from '@canductor/core';

/**
 * Show pipeline health overview.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdStatus(args: string[], repoRoot: string): void {
  const jsonMode = args.includes('--json');
  const s = getStatus(repoRoot);

  if (s.total === 0) {
    if (jsonMode) {
      console.log(JSON.stringify(s));
    } else {
      console.log('No results yet. Run: canductor verify');
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(s));
    return;
  }

  console.log('Canductor Status');
  console.log('================');
  console.log(`Results:     ${s.total} total (${s.merged} merged, ${s.rejected} rejected, ${s.pending} pending)`);
  console.log(`Baseline:    ${s.baseline}/100`);

  if (s.lastScore !== null) {
    console.log(`Last score:  ${s.lastScore}/100 (${s.lastRef}, ${s.lastStatus})`);
  }

  if (s.trendDirection !== null && s.trendOld !== null && s.trendNew !== null) {
    const arrow = s.trendDirection === 'improving' ? '↑' : s.trendDirection === 'declining' ? '↓' : '→';
    console.log(`Trend:       ${arrow} ${s.trendDirection} (last 5 avg: ${s.trendOld} → ${s.trendNew})`);
  }

  if (s.recurringIssues.length > 0) {
    const label = s.recurringIssues.length === 1 ? 'issue' : 'issues';
    console.log(`Recurring:   ${s.recurringIssues.length} ${label} (${s.recurringIssues[0]})`);
  } else {
    console.log('Recurring:   none');
  }

  if (s.stalls.length > 0) {
    const stallSummary = s.stalls.map(
      st => `ref ${st.ref}, ${st.attempts} attempts at score ${st.scoreRange.min}-${st.scoreRange.max}`
    ).join('; ');
    console.log(`Stalls:      ${s.stalls.length} ref(s) stuck (${stallSummary})`);
  }
}

/**
 * Show quality trend over last N results.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdTrend(args: string[], repoRoot: string): void {
  const jsonMode = args.includes('--json');
  const lastIdx = args.indexOf('--last');
  const last = lastIdx !== -1 && args[lastIdx + 1] ? parseInt(args[lastIdx + 1], 10) : 10;

  const trend = getTrend(repoRoot, last);

  if (trend.entries.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify(trend));
    } else {
      console.log('No results yet. Run: canductor verify');
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(trend));
    return;
  }

  console.log(`Canductor Trend (last ${trend.entries.length} results)`);
  console.log('==================================');

  const BAR_WIDTH = 10;
  for (const entry of trend.entries) {
    const filled = Math.round(entry.score / 100 * BAR_WIDTH);
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const ref = entry.ref.padEnd(6);
    console.log(`${ref} ${entry.score}  ${bar}  ${entry.status}`);
  }

  console.log('');

  const bestRefs = trend.best.refs.join(', ');
  const worstRefs = trend.worst.refs.join(', ');
  console.log(`Avg: ${trend.avg} | Best: ${trend.best.score} (${bestRefs}) | Worst: ${trend.worst.score} (${worstRefs})`);

  if (trend.direction !== null && trend.delta !== null && trend.entries.length >= 2) {
    const arrow = trend.direction === 'improving' ? '↑' : trend.direction === 'declining' ? '↓' : '→';
    const sign = trend.delta >= 0 ? `+${trend.delta}` : `${trend.delta}`;
    console.log(`Direction: ${arrow} ${trend.direction} (${sign} over ${trend.entries.length} runs)`);
  }
}

/**
 * Compare quality scores between two refs.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdDiff(args: string[], repoRoot: string): void {
  const jsonMode = args.includes('--json');
  const ref1 = args[1];
  const ref2 = args[2];
  if (!ref1 || !ref2) {
    console.error('Usage: canductor diff <ref1> <ref2>');
    process.exit(1);
  }

  const diff = diffResults(repoRoot, ref1, ref2);
  if (!diff) {
    const results = readResults(repoRoot);
    const found = results.map(r => r.ref);
    if (!results.find(r => r.ref === ref1)) {
      console.error(`Ref not found in results log: ${ref1}`);
    }
    if (!results.find(r => r.ref === ref2)) {
      console.error(`Ref not found in results log: ${ref2}`);
    }
    if (found.length > 0) {
      console.error(`Available refs: ${found.join(', ')}`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify(diff));
    return;
  }

  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const deltaStr = sign(diff.delta);

  console.log(`\nDiff: ${diff.ref1} → ${diff.ref2}`);
  console.log(`Composite score: ${diff.composite1} → ${diff.composite2} (${deltaStr})\n`);
  console.log('Layer breakdown:');
  console.log('  Layer'.padEnd(24) + 'Before'.padEnd(10) + 'After'.padEnd(10) + 'Change');
  console.log('  ' + '-'.repeat(52));

  for (const layer of diff.layers) {
    const before = layer.score1 !== null ? String(layer.score1) : '—';
    const after  = layer.score2 !== null ? String(layer.score2) : '—';
    let changeLabel: string;
    if (layer.change === 'improved')  changeLabel = `▲ +${layer.delta}`;
    else if (layer.change === 'regressed') changeLabel = `▼ ${layer.delta}`;
    else if (layer.change === 'unchanged') changeLabel = '= no change';
    else if (layer.change === 'added')    changeLabel = '+ added';
    else                                  changeLabel = '- removed';

    console.log(
      `  ${layer.name.padEnd(22)}${before.padEnd(10)}${after.padEnd(10)}${changeLabel}`
    );
  }
  console.log('');
}

/**
 * Show or set current quality baseline.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdBaseline(args: string[], repoRoot: string): void {
  const setIdx = args.indexOf('--set');
  const autoMode = args.includes('--auto');

  if (setIdx !== -1) {
    const val = args[setIdx + 1];
    if (!val || isNaN(parseInt(val, 10))) {
      console.error('Usage: canductor baseline --set <number>');
      process.exit(1);
    }
    const score = parseInt(val, 10);
    if (score < 0 || score > 100) {
      console.error('Baseline must be between 0 and 100');
      process.exit(1);
    }
    writeConfigBaseline(repoRoot, score);
    console.log(`Baseline set to ${score}/100`);
    return;
  }

  if (autoMode) {
    const score = computeAutoBaseline(repoRoot);
    writeConfigBaseline(repoRoot, score);
    console.log(`Baseline set to ${score}/100 (computed from last 5 merged scores)`);
    return;
  }

  const jsonMode = args.includes('--json');
  let config = null;
  try {
    config = loadConfig(repoRoot);
  } catch {
    // no config file — that's fine, we'll compute from results
  }
  const baseline = getBaseline(repoRoot, config);

  if (jsonMode) {
    console.log(JSON.stringify({ baseline }));
    return;
  }

  const source = config?.baseline !== undefined ? 'config override' : 'computed from last 5 merged scores';
  console.log(`Current baseline: ${baseline}/100 (${source})`);
}

/**
 * Show results history table.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdHistory(args: string[], repoRoot: string): void {
  const jsonMode = args.includes('--json');
  const results = readResults(repoRoot);
  if (results.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify([]));
    } else {
      console.log('No results yet. Run: canductor verify');
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(results.slice(-20)));
    return;
  }

  console.log('ref\tscore\tdecision\tstatus\tdescription');
  console.log('---\t-----\t--------\t------\t-----------');
  for (const r of results.slice(-20)) {
    console.log(`${r.ref}\t${r.composite_score}\t${r.decision}\t${r.status}\t${r.description}`);
  }
}
