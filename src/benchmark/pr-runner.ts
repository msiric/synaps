// src/benchmark/pr-runner.ts — Orchestrate PR-based benchmark runs
// Wires together: miner → task-gen → code-gen → scorer → stats → report

import { resolve, basename as pathBasename } from "node:path";
import { readFileSync } from "node:fs";
import type { ResolvedConfig } from "../types.js";
import { callLLMWithRetry } from "../llm/client.js";
import { parseCodeBlocks } from "./code-generator.js";
import { mineCommits, readFileAtCommit } from "./pr-miner.js";
import type { MinedTask, MinerOptions } from "./pr-miner.js";
import { generateTaskPrompt } from "./pr-task-gen.js";
import { scorePROutput } from "./pr-scorer.js";
import type { PRScoreResult } from "./pr-scorer.js";
import { wilcoxonSignedRank, bootstrapCI, cohensD } from "./statistics.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PRCondition = "treatment" | "realistic-control" | "impoverished-control";

export interface PRBenchmarkOptions {
  repoPath: string;
  mode: "quick" | "full";
  model?: string;
  maxTasks?: number;
  agentsMd: string;          // pre-generated AGENTS.md for this repo
  verbose?: boolean;
  dryRun?: boolean;
}

export interface PRBenchmarkResults {
  meta: {
    repoPath: string;
    model: string;
    mode: "quick" | "full";
    timestamp: string;
    conditions: PRCondition[];
    tasksRun: number;
    minerStats: import("./pr-miner.js").MinerStats;
  };
  summary: PRSummary;
  tasks: PRTaskResult[];
}

export interface PRSummary {
  headlineDelta: number;        // A - B on file placement
  upperBoundDelta: number;      // A - C on file placement
  aWinRate: number;             // % of tasks where A > B
  conditions: Record<PRCondition, {
    meanPlacement: number;
    meanNaming: number;
    meanBarrel: number;
    meanTokens: number;
  }>;
  stats: {
    pWilcoxon?: number;
    pPermutation?: number;
    effectSize?: number;
    ci95?: [number, number];
    n: number;
  };
}

export interface PRTaskResult {
  taskId: string;
  commitSha: string;
  commitMessage: string;
  groundTruthPath: string;
  results: Record<PRCondition, PRScoreResult>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONDITIONS: PRCondition[] = [
  "treatment",
  "realistic-control",
  "impoverished-control",
];

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the PR-based benchmark on a repository.
 */
export async function runPRBenchmark(
  options: PRBenchmarkOptions,
  llmConfig: ResolvedConfig["llm"],
): Promise<PRBenchmarkResults> {
  const {
    repoPath, mode, agentsMd, verbose, dryRun,
  } = options;
  const maxTasks = options.maxTasks ?? (mode === "quick" ? 30 : 50);

  // Phase 1: Mine commits
  if (verbose) console.error("[pr-benchmark] Mining commits...");
  const minerOpts: MinerOptions = {
    maxTasks,
    maxCommits: mode === "quick" ? 200 : 500,
    sinceDays: 365,
    verbose,
  };
  const { tasks: minedTasks, stats: minerStats } = mineCommits(repoPath, minerOpts);

  if (minedTasks.length === 0) {
    throw new Error(`No qualifying commits found in ${repoPath}. Need commits that added 20-500 line TS files with >= 3 siblings.`);
  }

  if (verbose) {
    console.error(`[pr-benchmark] Found ${minedTasks.length} tasks`);
  }

  // Detect package name from package.json
  const packageName = detectPackageName(repoPath);

  // Phase 2: Run A/B/C for each task
  const taskResults: PRTaskResult[] = [];

  for (let i = 0; i < minedTasks.length; i++) {
    const task = minedTasks[i];
    const prompt = generateTaskPrompt(task, packageName);

    if (verbose) {
      console.error(`[pr-benchmark] Task ${i + 1}/${minedTasks.length}: ${task.id}`);
    }

    const results: Record<string, PRScoreResult> = {};

    for (const condition of CONDITIONS) {
      if (dryRun) {
        results[condition] = makeDryRunResult();
        continue;
      }

      const systemPrompt = buildPRSystemPrompt(packageName);
      const userPrompt = buildPRUserPrompt(task, condition, agentsMd, prompt);

      const start = performance.now();
      try {
        const response = await callLLMWithRetry(systemPrompt, userPrompt, llmConfig);
        const latencyMs = Math.round(performance.now() - start);
        const files = parseCodeBlocks(response);
        const tokensUsed = Math.round(
          (systemPrompt.length + userPrompt.length + response.length) / 4,
        );

        results[condition] = scorePROutput(files, task, tokensUsed, latencyMs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const latencyMs = Math.round(performance.now() - start);
        results[condition] = scorePROutput([], task, 0, latencyMs, `LLM error: ${msg}`);
      }

      if (verbose) {
        const r = results[condition];
        const label = condition === "treatment" ? "A" : condition === "realistic-control" ? "B" : "C";
        console.error(`  ${label}: placement=${r.dimensions.filePlacement.score}%`);
      }
    }

    taskResults.push({
      taskId: task.id,
      commitSha: task.commitSha,
      commitMessage: task.commitMessage,
      groundTruthPath: task.groundTruth.path,
      results: results as Record<PRCondition, PRScoreResult>,
    });
  }

  // Phase 3: Compute statistics
  const summary = computeSummary(taskResults);

  return {
    meta: {
      repoPath: resolve(repoPath),
      model: llmConfig.model ?? "claude-sonnet-4-20250514",
      mode,
      timestamp: new Date().toISOString(),
      conditions: CONDITIONS,
      tasksRun: taskResults.length,
      minerStats,
    },
    summary,
    tasks: taskResults,
  };
}

// ─── Prompt Construction ────────────────────────────────────────────────────

function buildPRSystemPrompt(packageName: string): string {
  return [
    `You are an expert TypeScript developer working on the ${packageName} project.`,
    `Your task is to add new code to this codebase.`,
    `For each file you create or modify, output it in this format:`,
    "",
    "```filepath",
    "// file content here",
    "```",
    "",
    `If you modify an existing file, output the COMPLETE modified file (all existing code plus your changes).`,
    `Include ALL files needed: implementation, tests, and any existing files that need updates.`,
    `Do not add explanations outside the code blocks.`,
  ].join("\n");
}

function buildPRUserPrompt(
  task: MinedTask,
  condition: PRCondition,
  agentsMd: string,
  taskPrompt: string,
): string {
  const parts: string[] = [];

  // Barrel file (all conditions)
  if (task.context.barrelFile) {
    parts.push(`<file path="${task.context.barrelFile.path}">`);
    parts.push(task.context.barrelFile.content);
    parts.push(`</file>`);
    parts.push("");
  }

  // Condition-specific context
  switch (condition) {
    case "treatment":
      // A: AGENTS.md + sibling files + dir listing
      parts.push("<agents-md>");
      parts.push(agentsMd);
      parts.push("</agents-md>");
      parts.push("");
      for (const sibling of task.context.siblingFiles) {
        parts.push(`<file path="${sibling.path}">`);
        parts.push(sibling.content);
        parts.push(`</file>`);
        parts.push("");
      }
      break;

    case "realistic-control":
      // B: sibling files + dir listing (no AGENTS.md)
      for (const sibling of task.context.siblingFiles) {
        parts.push(`<file path="${sibling.path}">`);
        parts.push(sibling.content);
        parts.push(`</file>`);
        parts.push("");
      }
      break;

    case "impoverished-control":
      // C: dir listing only
      break;
  }

  // Directory listing (all conditions)
  if (task.context.directoryListing.length > 0) {
    const dir = task.groundTruth.directory;
    parts.push(`Directory listing of ${dir}:`);
    for (const file of task.context.directoryListing.slice(0, 30)) {
      parts.push(`  ${file}`);
    }
    parts.push("");
  }

  // Task prompt
  parts.push(`Task: ${taskPrompt}`);

  return parts.join("\n");
}

// ─── Statistics ─────────────────────────────────────────────────────────────

function computeSummary(tasks: PRTaskResult[]): PRSummary {
  const n = tasks.length;

  // Per-condition aggregates
  const conditionData: Record<string, {
    placements: number[];
    namings: number[];
    barrels: number[];
    tokens: number[];
  }> = {};

  for (const c of CONDITIONS) {
    conditionData[c] = { placements: [], namings: [], barrels: [], tokens: [] };
  }

  for (const task of tasks) {
    for (const c of CONDITIONS) {
      const r = task.results[c];
      conditionData[c].placements.push(r.dimensions.filePlacement.score);
      conditionData[c].namings.push(r.dimensions.namingConvention.score);
      conditionData[c].barrels.push(r.dimensions.barrelUpdate.score);
      conditionData[c].tokens.push(r.tokensUsed);
    }
  }

  const mean = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const conditions = {} as PRSummary["conditions"];
  for (const c of CONDITIONS) {
    conditions[c] = {
      meanPlacement: Math.round(mean(conditionData[c].placements) * 10) / 10,
      meanNaming: Math.round(mean(conditionData[c].namings) * 10) / 10,
      meanBarrel: Math.round(mean(conditionData[c].barrels) * 10) / 10,
      meanTokens: Math.round(mean(conditionData[c].tokens)),
    };
  }

  // Headline: A - B on file placement
  const aScores = conditionData["treatment"].placements;
  const bScores = conditionData["realistic-control"].placements;
  const cScores = conditionData["impoverished-control"].placements;

  const headlineDelta = Math.round((mean(aScores) - mean(bScores)) * 10) / 10;
  const upperBoundDelta = Math.round((mean(aScores) - mean(cScores)) * 10) / 10;

  // Win rate: % of tasks where A placement > B placement
  let aWins = 0;
  for (let i = 0; i < n; i++) {
    if (aScores[i] > bScores[i]) aWins++;
  }
  const aWinRate = n > 0 ? Math.round((aWins / n) * 1000) / 10 : 0;

  // Statistics (always compute if n >= 6)
  const stats: PRSummary["stats"] = { n };
  if (n >= 6) {
    try {
      const wilcoxon = wilcoxonSignedRank(aScores, bScores);
      stats.pWilcoxon = Math.round(wilcoxon.p * 10000) / 10000;
    } catch { /* not enough data */ }

    try {
      stats.effectSize = Math.round(cohensD(aScores, bScores) * 100) / 100;
    } catch { /* not enough data */ }

    try {
      const ci = bootstrapCI(aScores, bScores, 0.05, 10000);
      stats.ci95 = [Math.round(ci[0] * 10) / 10, Math.round(ci[1] * 10) / 10];
    } catch { /* not enough data */ }
  }

  return {
    headlineDelta,
    upperBoundDelta,
    aWinRate,
    conditions,
    stats,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectPackageName(repoPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(repoPath, "package.json"), "utf-8"));
    return pkg.name ?? pathBasename(resolve(repoPath));
  } catch {
    return pathBasename(resolve(repoPath));
  }
}

function makeDryRunResult(): PRScoreResult {
  return {
    score: 50,
    dimensions: {
      filePlacement: { score: 50, detail: "dry-run", passed: false },
      namingConvention: { score: 50, detail: "dry-run", passed: false },
      barrelUpdate: { score: 50, detail: "dry-run", passed: false },
    },
    filesCreated: [],
    tokensUsed: 0,
    latencyMs: 0,
  };
}

// ─── Report Generation ──────────────────────────────────────────────────────

/**
 * Generate a markdown report from PR benchmark results.
 */
export function generatePRReport(results: PRBenchmarkResults): string {
  const { meta, summary, tasks } = results;
  const lines: string[] = [];

  lines.push(`# PR-Based Benchmark Report: ${pathBasename(meta.repoPath)}`);
  lines.push(`Generated: ${meta.timestamp} | Model: ${meta.model} | Mode: ${meta.mode}`);
  lines.push("");
  lines.push("> **Ground truth:** Real developer commits. Scoring: file placement accuracy.");
  lines.push("> Tasks derived from git history, not engine-generated patterns.");
  lines.push("");

  // Headline
  lines.push("## Headline");
  lines.push("");
  lines.push(`**AGENTS.md Delta (A - B):** ${formatDelta(summary.headlineDelta)}%`);
  if (summary.stats.ci95) {
    lines.push(`**95% CI:** [${formatDelta(summary.stats.ci95[0])}%, ${formatDelta(summary.stats.ci95[1])}%]`);
  }
  if (summary.stats.effectSize != null) {
    lines.push(`**Effect size:** ${summary.stats.effectSize} (${effectLabel(summary.stats.effectSize)})`);
  }
  if (summary.stats.pWilcoxon != null) {
    lines.push(`**p (Wilcoxon):** ${summary.stats.pWilcoxon}`);
  }
  lines.push(`**A wins:** ${summary.aWinRate}% of tasks | **n =** ${summary.stats.n}`);
  lines.push("");

  // Per-condition summary
  lines.push("## Per-Condition Summary");
  lines.push("");
  lines.push("| Condition | Mean Placement | Mean Naming | Mean Barrel | Mean Tokens |");
  lines.push("|-----------|:---:|:---:|:---:|:---:|");
  for (const c of ["treatment", "realistic-control", "impoverished-control"] as const) {
    const label = c === "treatment" ? "A: AGENTS.md + source"
      : c === "realistic-control" ? "B: Source only"
      : "C: Dir listing only";
    const d = summary.conditions[c];
    lines.push(`| ${label} | ${d.meanPlacement}% | ${d.meanNaming}% | ${d.meanBarrel}% | ${d.meanTokens} |`);
  }
  lines.push("");

  // Per-task results
  lines.push("## Per-Task Results");
  lines.push("");
  lines.push("| # | Task | GT Path | A Placement | B Placement | C Placement | A-B |");
  lines.push("|---|------|---------|:---:|:---:|:---:|:---:|");

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const a = t.results["treatment"].dimensions.filePlacement.score;
    const b = t.results["realistic-control"].dimensions.filePlacement.score;
    const c = t.results["impoverished-control"].dimensions.filePlacement.score;
    const delta = a - b;
    const msg = t.commitMessage.slice(0, 40);
    lines.push(`| ${i + 1} | ${msg} | ${t.groundTruthPath} | ${a}% | ${b}% | ${c}% | ${formatDelta(delta)}% |`);
  }
  lines.push("");

  // Methodology
  lines.push("## Methodology");
  lines.push("");
  lines.push(`- Tasks: ${meta.tasksRun} real "add file" commits from git history`);
  lines.push(`- Commits scanned: ${meta.minerStats.totalCommits}`);
  lines.push(`- After quality filter: ${meta.minerStats.afterQualityFilter}`);
  lines.push(`- Ground truth: actual files committed by developers (read at commit SHA)`);
  lines.push(`- Context: sibling files and directory listings from parent commit`);
  lines.push(`- Scoring: file placement accuracy (continuous path distance)`);
  lines.push(`- Statistics: Wilcoxon signed-rank, bootstrap 95% CI, Cohen's d_z`);
  lines.push("");

  if (Object.keys(meta.minerStats.filterReasons).length > 0) {
    lines.push("### Filter Funnel");
    lines.push("");
    for (const [reason, count] of Object.entries(meta.minerStats.filterReasons).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${reason}: ${count}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function effectLabel(d: number): string {
  const abs = Math.abs(d);
  if (abs < 0.2) return "negligible";
  if (abs < 0.5) return "small";
  if (abs < 0.8) return "medium";
  return "large";
}
