/**
 * Results analysis — trajectory tracking, failure correlation, insights,
 * and prompt context generation from verification history.
 */

import type { ResultRow, QualityContext, StallDetection, LayerCorrelation, LayerTrajectory, TrajectoryAnalysis, InsightsResult } from './types.js';
import { readResults } from './results.js';
import { summarizeLearnings } from './learnings.js';
import { summarizeTaskPerformance } from './tasks.js';

/**
 * Analyze results history to generate quality context for agent prompts.
 * This is the "learning" loop — patterns from past results inform future runs.
 */
export function analyzeResults(repoRoot: string): QualityContext {
  const results = readResults(repoRoot);
  const recent = results.slice(-20);

  // Find the current baseline (moving average of last 5 merged scores)
  const mergedScores = results
    .filter(r => r.status === 'merged')
    .map(r => r.composite_score)
    .slice(-5);
  const baselineScore = mergedScores.length > 0
    ? Math.round(mergedScores.reduce((a, b) => a + b, 0) / mergedScores.length)
    : 0;

  // Detect recurring issues from layer scores
  const layerFailCounts = new Map<string, number>();
  for (const row of recent) {
    if (row.status === 'rejected' || row.decision === 'block') {
      const scores = row.layer_scores.split(',');
      for (const s of scores) {
        const [name, val] = s.split(':');
        if (parseInt(val) < 80) {
          layerFailCounts.set(name, (layerFailCounts.get(name) ?? 0) + 1);
        }
      }
    }
  }

  const recurringIssues: string[] = [];
  for (const [layer, count] of layerFailCounts) {
    if (count >= 2) {
      recurringIssues.push(
        `"${layer}" layer failed ${count} times in the last ${recent.length} runs`
      );
    }
  }

  // Generate suggested rules based on patterns
  const suggestedRules: string[] = [];
  if (recurringIssues.length > 0) {
    suggestedRules.push(
      'Consider adding specific instructions to CLAUDE.md addressing: ' +
      recurringIssues.join('; ')
    );
  }

  const rejectedRecent = recent.filter(r => r.status === 'rejected');
  if (rejectedRecent.length > 0) {
    suggestedRules.push(
      'Recent rejected PRs: ' +
      rejectedRecent.map(r => `${r.ref} (${r.description})`).join(', ')
    );
  }

  const stalls = detectStalls(results);

  if (stalls.length > 0) {
    for (const stall of stalls) {
      recurringIssues.push(
        `Ref "${stall.ref}" stalled: ${stall.attempts} attempts with scores ${stall.scoreRange.min}-${stall.scoreRange.max}`
      );
    }
  }

  return {
    recent_results: recent,
    recurring_issues: recurringIssues,
    suggested_rules: suggestedRules,
    baseline_score: baselineScore,
    stalls,
  };
}

/**
 * Detect refs that are stuck in a verify loop with no score improvement.
 *
 * A stall is detected when the same ref appears 3+ times in the results
 * log with all scores within a ±2 point range.
 *
 * @param results - All result rows to analyze
 * @returns Array of detected stalls
 */
export function detectStalls(results: ResultRow[]): StallDetection[] {
  const byRef = new Map<string, number[]>();

  for (const row of results) {
    const scores = byRef.get(row.ref) ?? [];
    scores.push(row.composite_score);
    byRef.set(row.ref, scores);
  }

  const stalls: StallDetection[] = [];

  for (const [ref, scores] of byRef) {
    if (scores.length < 3) continue;

    const min = Math.min(...scores);
    const max = Math.max(...scores);

    if (max - min <= 2) {
      stalls.push({
        ref,
        attempts: scores.length,
        scores,
        scoreRange: { min, max },
        suggestion: `Ref "${ref}" has been attempted ${scores.length} times with no meaningful improvement (scores: ${min}-${max}). Try a fundamentally different approach.`,
      });
    }
  }

  return stalls;
}

/**
 * Analyze which layer failures tend to co-occur across verification runs.
 * Returns pairs of layers sorted by correlation strength (highest first).
 */
export function correlateLayerFailures(results: ResultRow[]): LayerCorrelation[] {
  // Parse layer scores for each run, identifying which layers scored < 80
  const failureSets: Set<string>[] = [];

  for (const row of results) {
    if (!row.layer_scores || row.layer_scores.trim() === '') continue;

    const failed = new Set<string>();
    const scores = row.layer_scores.split(',');
    for (const s of scores) {
      const colonIdx = s.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const name = s.slice(0, colonIdx).trim();
      const val = parseFloat(s.slice(colonIdx + 1));
      if (!isNaN(val) && val < 80) {
        failed.add(name);
      }
    }
    if (failed.size > 0) {
      failureSets.push(failed);
    }
  }

  // Count co-failures and individual failures for each layer pair
  const allFailedLayers = new Set<string>();
  for (const fs of failureSets) {
    for (const l of fs) allFailedLayers.add(l);
  }

  const layers = [...allFailedLayers].sort();
  const correlations: LayerCorrelation[] = [];

  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      const l1 = layers[i];
      const l2 = layers[j];

      let coFailures = 0;
      let eitherFailed = 0;

      for (const fs of failureSets) {
        const has1 = fs.has(l1);
        const has2 = fs.has(l2);
        if (has1 || has2) eitherFailed++;
        if (has1 && has2) coFailures++;
      }

      if (coFailures >= 2) {
        correlations.push({
          layer1: l1,
          layer2: l2,
          coFailures,
          eitherFailed,
          ratio: eitherFailed > 0 ? coFailures / eitherFailed : 0,
        });
      }
    }
  }

  correlations.sort((a, b) => b.ratio - a.ratio);
  return correlations;
}

/**
 * Compute linear regression slope for a series of scores.
 * Returns the slope of the best-fit line (score change per result).
 */
function linearRegressionSlope(scores: number[]): number {
  const n = scores.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Classify a slope into a direction.
 * slope > 0.5 = improving, slope < -0.5 = declining, else stable.
 */
function classifyDirection(slope: number): 'improving' | 'declining' | 'stable' {
  if (slope > 0.5) return 'improving';
  if (slope < -0.5) return 'declining';
  return 'stable';
}

/**
 * Analyze score trajectories per layer over time.
 * Detects whether each layer's scores are improving, declining, or stable
 * using linear regression over the last `window` results (default 10).
 */
export function analyzeTrajectory(results: ResultRow[], window = 10): TrajectoryAnalysis {
  const recent = results.slice(-window);

  // Overall composite score trajectory
  const overallScores = recent.map(r => r.composite_score);
  const overallSlope = linearRegressionSlope(overallScores);
  const overall: LayerTrajectory = {
    layer: 'overall',
    direction: classifyDirection(overallSlope),
    slope: Math.round(overallSlope * 100) / 100,
    recentScores: overallScores,
  };

  // Per-layer trajectories
  const layerScoresMap = new Map<string, number[]>();

  for (const row of recent) {
    if (!row.layer_scores || row.layer_scores.trim() === '') continue;

    const scores = row.layer_scores.split(',');
    for (const s of scores) {
      const colonIdx = s.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const name = s.slice(0, colonIdx).trim();
      const val = parseFloat(s.slice(colonIdx + 1));
      if (isNaN(val)) continue;

      if (!layerScoresMap.has(name)) {
        layerScoresMap.set(name, []);
      }
      layerScoresMap.get(name)!.push(val);
    }
  }

  const layers: LayerTrajectory[] = [];
  for (const [name, scores] of layerScoresMap) {
    const slope = linearRegressionSlope(scores);
    layers.push({
      layer: name,
      direction: classifyDirection(slope),
      slope: Math.round(slope * 100) / 100,
      recentScores: scores,
    });
  }

  layers.sort((a, b) => a.layer.localeCompare(b.layer));

  return { overall, layers };
}

/**
 * Generate combined insights from trajectory analysis and layer failure correlations.
 * Produces actionable recommendations based on the data.
 */
export function generateInsights(repoRoot: string): InsightsResult {
  const results = readResults(repoRoot);
  const trajectory = analyzeTrajectory(results);
  const correlations = correlateLayerFailures(results);
  const recommendations: string[] = [];

  // Recommend based on declining layers
  const declining = trajectory.layers.filter(l => l.direction === 'declining');
  for (const layer of declining) {
    recommendations.push(
      `Layer "${layer.layer}" is declining (slope: ${layer.slope}). Review recent changes affecting this layer.`
    );
  }

  // Recommend based on overall trend
  if (trajectory.overall.direction === 'declining') {
    recommendations.push(
      'Overall quality is trending downward. Consider pausing new features to address technical debt.'
    );
  }

  // Recommend based on correlated failures
  for (const corr of correlations) {
    if (corr.ratio >= 0.7) {
      recommendations.push(
        `Layers "${corr.layer1}" and "${corr.layer2}" frequently fail together (${Math.round(corr.ratio * 100)}% co-failure rate). They may share a root cause.`
      );
    }
  }

  if (recommendations.length === 0 && results.length > 0) {
    recommendations.push('All layers are stable. No action needed.');
  }

  return { trajectory, correlations, recommendations };
}

/**
 * Generate a context block to inject into agent prompts.
 * This is what makes the agent "learn" from past results.
 */
export function generatePromptContext(repoRoot: string): string {
  const ctx = analyzeResults(repoRoot);

  const lines: string[] = [
    '## Canductor Quality Context',
    '',
    `Current baseline quality score: ${ctx.baseline_score}/100`,
    '',
  ];

  if (ctx.recurring_issues.length > 0) {
    lines.push('### Recurring issues (avoid these patterns):');
    for (const issue of ctx.recurring_issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  if (ctx.suggested_rules.length > 0) {
    lines.push('### Quality notes:');
    for (const rule of ctx.suggested_rules) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (ctx.stalls.length > 0) {
    lines.push('### Stalled refs:');
    for (const stall of ctx.stalls) {
      lines.push(`- ${stall.suggestion}`);
    }
    lines.push('');
  }

  // Include learnings from past failures
  const learningsSummary = summarizeLearnings(repoRoot);
  if (learningsSummary) {
    lines.push(learningsSummary);
    lines.push('');
  }

  // Include task type performance
  const taskSummary = summarizeTaskPerformance(repoRoot);
  if (taskSummary) {
    lines.push(taskSummary);
    lines.push('');
  }

  // Include trajectory warnings for declining layers
  const trajectory = analyzeTrajectory(readResults(repoRoot));
  const declining = trajectory.layers.filter(l => l.direction === 'declining');
  if (declining.length > 0) {
    lines.push('### Score trajectory warnings:');
    for (const layer of declining) {
      lines.push(`- "${layer.layer}" layer is declining (slope: ${layer.slope})`);
    }
    lines.push('');
  }
  if (trajectory.overall.direction === 'declining') {
    lines.push('### Overall score trend: DECLINING');
    lines.push(`Overall slope: ${trajectory.overall.slope} — quality is trending downward.`);
    lines.push('');
  }

  if (ctx.recent_results.length > 0) {
    lines.push('### Recent verification results:');
    for (const r of ctx.recent_results.slice(-5)) {
      lines.push(`- ${r.ref}: score=${r.composite_score} ${r.status} (${r.description})`);
    }
  }

  return lines.join('\n');
}
