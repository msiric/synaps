// src/benchmark/report.ts — Generate benchmark reports (Markdown + JSON)

import type { BenchmarkResults, BenchmarkCondition, TaskResult } from "./types.js";
import { effectSizeLabel } from "./statistics.js";

// ─── Markdown Report ─────────────────────────────────────────────────────────

/**
 * Generate a human-readable markdown benchmark report.
 */
export function generateMarkdownReport(results: BenchmarkResults): string {
  const lines: string[] = [];
  const { meta, summary, tasks } = results;

  lines.push(`# Benchmark Report: ${meta.repoPath.split("/").pop()}`);
  lines.push(`Generated: ${meta.timestamp} | Model: ${meta.model} | Mode: ${meta.mode}`);
  lines.push("");

  // Claim scoping
  lines.push("> **Claim scope:** This benchmark measures whether AGENTS.md improves AI adherence");
  lines.push("> to contribution patterns (file placement, naming, imports, exports, registration)");
  lines.push("> beyond what an AI can infer from reading source code alone.");
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Condition | Mean Score | Pass Rate | Avg Tokens |");
  lines.push("|-----------|-----------|-----------|------------|");

  const conditionLabels: Record<BenchmarkCondition, string> = {
    "treatment": "A: AGENTS.md + source",
    "realistic-control": "B: Source only",
    "impoverished-control": "C: Dir listing only",
    "negative-control": "N: Shuffled AGENTS.md",
  };

  for (const cond of meta.conditions) {
    const data = summary.conditions[cond];
    if (!data) continue;
    const label = conditionLabels[cond];
    const score = data.meanScore.toFixed(1) + "%";
    const pass = `${Math.round(data.passRate * summary.tasksRun)}/${summary.tasksRun}`;
    const tokens = Math.round(data.meanTokens).toLocaleString();
    lines.push(`| ${label} | ${score} | ${pass} | ${tokens} |`);
  }

  lines.push("");
  lines.push(`**Headline (A - B):** ${summary.headlineDelta >= 0 ? "+" : ""}${summary.headlineDelta.toFixed(1)}%`);
  lines.push(`**Upper bound (A - C):** ${summary.upperBoundDelta >= 0 ? "+" : ""}${summary.upperBoundDelta.toFixed(1)}%`);

  // Statistical analysis (full mode only)
  if (meta.mode === "full" && summary.pValue !== undefined) {
    lines.push("");
    lines.push("## Statistical Analysis");
    lines.push("");
    lines.push(`- **Paired t-test:** p = ${summary.pValue.toFixed(4)}`);
    if (summary.effectSize !== undefined) {
      lines.push(`- **Cohen's d:** ${summary.effectSize.toFixed(2)} (${effectSizeLabel(summary.effectSize)})`);
    }
    if (summary.ci95) {
      lines.push(`- **95% Bootstrap CI:** [${summary.ci95[0].toFixed(1)}%, ${summary.ci95[1].toFixed(1)}%]`);
    }
  } else {
    lines.push("");
    lines.push("*Quick mode — directional results only, not statistically powered.*");
  }

  // Per-task breakdown
  lines.push("");
  lines.push("## Per-Task Results");

  for (const task of tasks) {
    lines.push("");
    lines.push(`### ${task.taskId} (Tier ${task.tier})`);
    lines.push("");
    lines.push(`> ${task.prompt}`);
    lines.push("");

    for (const cond of meta.conditions) {
      const run = task.results[cond];
      if (!run) continue;
      const label = conditionLabels[cond];
      const status = run.error ? "ERROR" : run.passed ? "PASS" : "FAIL";
      lines.push(`**${label}:** ${run.score}% (${run.rawScore}/${run.maxPoints} pts) — ${status}`);

      if (run.error) {
        lines.push(`  Error: ${run.error}`);
      } else {
        for (const check of run.checks) {
          const icon = check.passed ? "[x]" : "[ ]";
          lines.push(`  - ${icon} ${check.name} (${check.score}/${check.weight}) — ${check.detail}`);
        }
      }
      lines.push("");
    }
  }

  // Token counts (confound disclosure)
  lines.push("## Token Analysis");
  lines.push("");
  lines.push("| Condition | Mean Input Tokens | Notes |");
  lines.push("|-----------|------------------|-------|");
  for (const cond of meta.conditions) {
    const data = summary.conditions[cond];
    if (!data) continue;
    const note = cond === "treatment" ? "Includes AGENTS.md context" :
                 cond === "realistic-control" ? "Sibling files only" :
                 cond === "impoverished-control" ? "Minimal context" :
                 "Shuffled context";
    lines.push(`| ${conditionLabels[cond]} | ${Math.round(data.meanTokens).toLocaleString()} | ${note} |`);
  }
  lines.push("");
  lines.push("*Note: Token count asymmetry between conditions may contribute to score differences.*");

  return lines.join("\n");
}

// ─── JSON Report ─────────────────────────────────────────────────────────────

/**
 * Generate JSON benchmark results (for programmatic consumption).
 */
export function generateJsonReport(results: BenchmarkResults): string {
  return JSON.stringify(results, null, 2);
}
