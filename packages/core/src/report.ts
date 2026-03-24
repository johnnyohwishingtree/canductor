/**
 * Report generator — produces markdown-formatted quality summaries
 * from verification results.
 *
 * Suitable for posting as GitHub PR comments or CI output.
 */

import { readResults, getStatus, getTrend } from './results.js';
import type { PipelineStatus, TrendEntry } from './results.js';
import type { ResultRow } from './types.js';

/** Structured report output for --json mode. */
export interface ReportData {
  markdown: string;
  score: number;
  decision: string;
  ref: string;
}

/**
 * Get a score badge emoji based on the composite score.
 * @param score - The composite score (0-100)
 * @returns Emoji string representing score quality
 */
function scoreBadge(score: number): string {
  if (score >= 90) return '🟢';
  if (score >= 70) return '🟡';
  return '🔴';
}

/**
 * Format a trend sparkline from the last few scores.
 * @param entries - Trend entries to render
 * @returns Sparkline string like "▁▃▅▇█"
 */
function sparkline(entries: TrendEntry[]): string {
  if (entries.length === 0) return '';
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const scores = entries.map(e => e.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;

  return scores
    .map(s => {
      if (range === 0) return blocks[blocks.length - 1];
      const idx = Math.round(((s - min) / range) * (blocks.length - 1));
      return blocks[idx];
    })
    .join('');
}

/**
 * Parse layer scores string into name-score pairs.
 * @param layerScores - Comma-separated "name:score" string
 * @returns Array of {name, score} objects
 */
function parseLayerScores(layerScores: string): Array<{ name: string; score: number }> {
  if (!layerScores) return [];
  return layerScores.split(',').map(entry => {
    const [name, scoreStr] = entry.split(':');
    return { name, score: parseFloat(scoreStr) };
  });
}

/**
 * Generate a markdown-formatted quality report from verification history.
 *
 * @param repoRoot - Path to the repository root
 * @param ref - Optional ref to filter the report to a specific result
 * @returns ReportData with markdown string and metadata
 */
export function generateReport(repoRoot: string, ref?: string): ReportData {
  const results = readResults(repoRoot);

  if (results.length === 0) {
    return {
      markdown: '## Quality Report\n\nNo verification results found. Run `canductor verify` to generate results.',
      score: 0,
      decision: 'none',
      ref: '',
    };
  }

  let targetRow: ResultRow;

  if (ref) {
    const matching = results.filter(r => r.ref === ref);
    if (matching.length === 0) {
      return {
        markdown: `## Quality Report\n\nNo results found for ref \`${ref}\`.`,
        score: 0,
        decision: 'none',
        ref,
      };
    }
    targetRow = matching[matching.length - 1];
  } else {
    targetRow = results[results.length - 1];
  }

  const status = getStatus(repoRoot);
  const trend = getTrend(repoRoot, 5);

  const lines: string[] = [];

  // Header with badge
  const badge = scoreBadge(targetRow.composite_score);
  lines.push(`## Quality Report`);
  lines.push('');
  lines.push(`${badge} **Score: ${targetRow.composite_score}/100** — ${targetRow.decision}`);
  lines.push('');

  // Ref and timestamp
  lines.push(`- **Ref:** ${targetRow.ref}`);
  lines.push(`- **Status:** ${targetRow.status}`);
  lines.push(`- **Timestamp:** ${targetRow.timestamp}`);
  lines.push('');

  // Layer breakdown table
  const layers = parseLayerScores(targetRow.layer_scores);
  if (layers.length > 0) {
    lines.push('### Layer Breakdown');
    lines.push('');
    lines.push('| Layer | Score |');
    lines.push('|-------|-------|');
    for (const layer of layers) {
      const layerBadge = scoreBadge(layer.score);
      lines.push(`| ${layer.name} | ${layerBadge} ${layer.score} |`);
    }
    lines.push('');
  }

  // Trend
  if (trend.entries.length > 0) {
    lines.push('### Trend (last 5)');
    lines.push('');
    const spark = sparkline(trend.entries);
    lines.push(`${spark} avg: ${trend.avg}`);
    if (trend.direction) {
      lines.push(`Direction: ${trend.direction}`);
    }
    lines.push('');
  }

  // Recurring issues
  if (status.recurringIssues.length > 0) {
    lines.push('### Recurring Issues');
    lines.push('');
    for (const issue of status.recurringIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  const markdown = lines.join('\n').trimEnd();

  return {
    markdown,
    score: targetRow.composite_score,
    decision: targetRow.decision,
    ref: targetRow.ref,
  };
}
