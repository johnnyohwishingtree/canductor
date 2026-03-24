/**
 * Analytics commands — complex analysis and reporting on verification history
 */

import {
  generateReport,
  generateInsights,
  analyzeTaskTypes,
  runHealthCheck,
} from '@canductor/core';

/**
 * Show trajectory, correlations, and recommendations.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdInsights(args: string[], repoRoot: string): void {
  const jsonMode = args.includes('--json');
  const insights = generateInsights(repoRoot);

  if (jsonMode) {
    console.log(JSON.stringify(insights, null, 2));
    return;
  }

  console.log('Canductor Insights');
  console.log('==================');
  console.log('');

  const { trajectory } = insights;
  const arrow = trajectory.overall.direction === 'improving' ? '↑' :
    trajectory.overall.direction === 'declining' ? '↓' : '→';
  console.log(`Overall: ${arrow} ${trajectory.overall.direction} (slope: ${trajectory.overall.slope})`);

  if (trajectory.layers.length > 0) {
    console.log('');
    console.log('Layer trajectories:');
    for (const layer of trajectory.layers) {
      const layerArrow = layer.direction === 'improving' ? '↑' :
        layer.direction === 'declining' ? '↓' : '→';
      console.log(`  ${layerArrow} ${layer.layer}: ${layer.direction} (slope: ${layer.slope})`);
    }
  }

  if (insights.correlations.length > 0) {
    console.log('');
    console.log('Layer failure correlations:');
    for (const corr of insights.correlations) {
      console.log(`  ${corr.layer1} + ${corr.layer2}: ${Math.round(corr.ratio * 100)}% co-failure rate (${corr.coFailures} co-failures)`);
    }
  }

  console.log('');
  console.log('Recommendations:');
  for (const rec of insights.recommendations) {
    console.log(`  • ${rec}`);
  }
}

/**
 * Show task type performance.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdTasks(args: string[], repoRoot: string): void {
  const analyses = analyzeTaskTypes(repoRoot);

  if (analyses.length === 0) {
    console.log('No task data yet.');
    return;
  }

  console.log('Task Type Performance');
  console.log('=====================');
  console.log('');

  const typeCol = 'Type'.padEnd(20);
  const usesCol = 'Uses'.padStart(5);
  const avgCol = 'Avg Cycles'.padStart(11);
  const statusCol = 'Status';
  console.log(`${typeCol} ${usesCol} ${avgCol}  ${statusCol}`);
  console.log('-'.repeat(50));

  for (const a of analyses) {
    const typeName = a.task_type.padEnd(20);
    const uses = String(a.total_uses).padStart(5);
    const avg = String(a.avg_cycles).padStart(11);
    let status: string;
    if (a.converged) {
      status = 'converged';
    } else if (a.avg_cycles > 1) {
      status = 'needs work';
    } else {
      status = 'good';
    }
    console.log(`${typeName} ${uses} ${avg}  ${status}`);
  }
}

/**
 * Generate markdown quality summary.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdReport(args: string[], repoRoot: string): void {
  const jsonFlag = args.includes('--json');
  const ref = args.slice(1).find(a => !a.startsWith('--'));

  const report = generateReport(repoRoot, ref);

  if (jsonFlag) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(report.markdown);
  }
}

/**
 * Show unified pipeline health view.
 *
 * @param args - CLI arguments
 * @param repoRoot - Repository root path
 */
export function cmdHealth(args: string[], repoRoot: string): void {
  const jsonMode = args.includes('--json');
  const report = runHealthCheck(repoRoot);

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const issueCount =
    report.configValidation.errors.length +
    report.staleBranches.length +
    report.findings.length;

  if (issueCount === 0) {
    console.log('Pipeline healthy');
  } else {
    const label = issueCount === 1 ? 'issue' : 'issues';
    console.log(`Pipeline has ${issueCount} ${label}`);
  }
  console.log('');

  // Results summary
  console.log('Results');
  console.log('-------');
  const s = report.status;
  if (s.total === 0) {
    console.log('  No results yet');
  } else {
    console.log(`  Total: ${s.total} (${s.merged} merged, ${s.rejected} rejected, ${s.pending} pending)`);
    console.log(`  Baseline: ${s.baseline}/100`);
    if (s.lastScore !== null) {
      console.log(`  Last: ${s.lastScore}/100 (${s.lastRef}, ${s.lastStatus})`);
    }
    if (s.trendDirection !== null && s.trendOld !== null && s.trendNew !== null) {
      const arrow = s.trendDirection === 'improving' ? '↑' : s.trendDirection === 'declining' ? '↓' : '→';
      console.log(`  Trend: ${arrow} ${s.trendDirection} (${s.trendOld} → ${s.trendNew})`);
    }
  }
  console.log('');

  // Task performance
  console.log('Tasks');
  console.log('-----');
  if (report.taskPerformance.length === 0) {
    console.log('  No task data');
  } else {
    for (const t of report.taskPerformance) {
      const label = t.converged ? 'converged' : 'needs-work';
      console.log(`  ${t.task_type}: avg ${t.avg_cycles} cycles, ${t.total_uses} uses — ${label}`);
    }
  }
  console.log('');

  // Config
  console.log('Config');
  console.log('------');
  if (report.configValidation.valid) {
    console.log('  Valid');
  } else {
    console.log(`  Invalid (${report.configValidation.errors.length} errors)`);
    for (const e of report.configValidation.errors) {
      console.log(`    - ${e.message}`);
    }
  }
  if (report.configValidation.warnings.length > 0) {
    console.log(`  ${report.configValidation.warnings.length} warning(s)`);
  }
  console.log('');

  // Stale branches
  console.log('Branches');
  console.log('--------');
  console.log(`  Stale: ${report.staleBranches.length}`);
  console.log('');

  // Findings
  console.log('Findings');
  console.log('--------');
  if (report.findings.length === 0) {
    console.log('  No audit findings');
  } else {
    console.log(`  ${report.findings.length} finding(s)`);
    for (const f of report.findings) {
      console.log(`    [${f.category}] ${f.finding}`);
    }
  }
}
