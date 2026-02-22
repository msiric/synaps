// src/benchmark/runner.ts — Benchmark orchestrator
// Coordinates: analyze → generate tasks → AGENTS.md → A/B/C/N → score → report

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, formatDeterministic } from "../index.js";
import type { ResolvedConfig } from "../types.js";
import { ENGINE_VERSION } from "../types.js";
import { generateTasksFromAnalysis } from "./task-generator.js";
import { generateCode } from "./code-generator.js";
import { scoreGeneratedOutput } from "./scorer.js";
import { shuffleAgentsMd } from "./shuffler.js";
import { pairedTTest, cohensD, bootstrapCI, wilcoxonSignedRank } from "./statistics.js";
import { generateMarkdownReport, generateJsonReport } from "./report.js";
import type {
  BenchmarkOptions,
  BenchmarkResults,
  BenchmarkCondition,
  TaskResult,
  ConditionSummary,
  RunResult,
} from "./types.js";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the full benchmark pipeline.
 */
export async function orchestrateBenchmark(
  options: BenchmarkOptions,
  llmConfig: ResolvedConfig["llm"],
): Promise<BenchmarkResults> {
  const conditions: BenchmarkCondition[] = [
    "treatment",
    "realistic-control",
    "impoverished-control",
    "negative-control",
  ];

  const log = (msg: string) => {
    if (options.verbose) process.stderr.write(`[BENCH] ${msg}\n`);
  };

  // Phase 1: Analyze the repo
  log("Phase 1: Analyzing repository...");
  const analysis = await analyze({
    packages: [options.repoPath],
    rootDir: options.rootDir,
  });

  // Phase 2: Generate tasks
  log("Phase 2: Generating benchmark tasks...");
  const maxTasks = options.mode === "quick"
    ? Math.min(options.maxTasks ?? 5, 5)
    : options.maxTasks ?? 20;

  const tasks = generateTasksFromAnalysis(analysis, options.repoPath, maxTasks);

  if (tasks.length === 0) {
    throw new Error(
      "No benchmark tasks could be generated. This repo may lack contribution patterns.\n"
      + "Try a repo with structured patterns (e.g., directories with 3+ similar files)."
    );
  }

  log(`  ${tasks.length} tasks generated (${tasks.filter(t => t.tier === "A").length} Tier A, ${tasks.filter(t => t.tier === "B").length} Tier B, ${tasks.filter(t => t.tier === "C").length} Tier C)`);

  // Dry run: show tasks and exit
  if (options.dryRun) {
    for (const task of tasks) {
      process.stderr.write(`\n--- Task: ${task.id} (Tier ${task.tier}) ---\n`);
      process.stderr.write(`Prompt: ${task.prompt}\n`);
      process.stderr.write(`Directory: ${task.expectedDirectory}\n`);
      process.stderr.write(`Pattern: ${task.expectedFilePattern}\n`);
      process.stderr.write(`Siblings: ${task.context.siblingFiles.map(s => s.path).join(", ")}\n`);
      process.stderr.write(`Registration: ${task.context.registrationFile?.path ?? "none"}\n`);
      process.stderr.write(`Barrel: ${task.context.barrelFile?.path ?? "none"}\n`);
      process.stderr.write(`Max points: ${task.maxScoringPoints}\n`);
    }
    // Return empty results for dry run
    return {
      meta: {
        engineVersion: ENGINE_VERSION,
        model: llmConfig.model,
        repoPath: options.repoPath,
        timestamp: new Date().toISOString(),
        mode: options.mode,
        conditions,
      },
      summary: emptySummary(conditions),
      tasks: [],
    };
  }

  // Phase 3: Generate AGENTS.md
  log("Phase 3: Generating AGENTS.md...");
  let agentsMd: string | null = null;
  try {
    const formatConfig = {
      output: { format: "agents.md" as const, dir: "." },
      llm: llmConfig,
    };
    agentsMd = await formatDeterministic(analysis, formatConfig);
  } catch {
    log("  Warning: AGENTS.md generation failed (LLM unavailable?). Using JSON analysis as fallback.");
  }

  // Generate shuffled AGENTS.md for negative control
  const shuffledAgentsMd = agentsMd ? shuffleAgentsMd(agentsMd) : null;

  // Phase 4: Run A/B/C/N for each task
  log(`Phase 4: Running ${tasks.length} tasks × ${conditions.length} conditions...`);
  const taskResults: TaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    log(`  Task ${i + 1}/${tasks.length}: ${task.id} (Tier ${task.tier})`);

    const results: Record<BenchmarkCondition, RunResult> = {} as Record<BenchmarkCondition, RunResult>;

    for (const condition of conditions) {
      log(`    Condition: ${condition}...`);
      const codeResult = await generateCode(
        task, condition, agentsMd, shuffledAgentsMd, llmConfig,
      );

      const runResult = scoreGeneratedOutput(
        codeResult.files,
        task,
        codeResult.tokensUsed,
        codeResult.latencyMs,
        codeResult.error,
      );

      results[condition] = runResult;
      log(`    → ${runResult.score}% (${runResult.rawScore}/${runResult.maxPoints}) ${runResult.passed ? "PASS" : "FAIL"}`);
    }

    taskResults.push({
      taskId: task.id,
      tier: task.tier,
      prompt: task.prompt,
      results,
    });
  }

  // Phase 5: Compute statistics and generate report
  log("Phase 5: Computing statistics and generating report...");
  const summary = computeSummary(taskResults, conditions, options.mode);

  const benchmarkResults: BenchmarkResults = {
    meta: {
      engineVersion: ENGINE_VERSION,
      model: llmConfig.model,
      repoPath: options.repoPath,
      timestamp: new Date().toISOString(),
      mode: options.mode,
      conditions,
    },
    summary,
    tasks: taskResults,
  };

  // Write reports
  const outputDir = options.outputDir ?? "./benchmark-results";
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "results.json"), generateJsonReport(benchmarkResults));
  writeFileSync(join(outputDir, "REPORT.md"), generateMarkdownReport(benchmarkResults));

  log(`Reports written to ${outputDir}/`);

  return benchmarkResults;
}

// ─── Summary Computation ─────────────────────────────────────────────────────

function computeSummary(
  tasks: TaskResult[],
  conditions: BenchmarkCondition[],
  mode: "quick" | "full",
): ConditionSummary {
  const n = tasks.length;
  const conditionData: ConditionSummary["conditions"] = {} as ConditionSummary["conditions"];

  for (const cond of conditions) {
    const scores = tasks.map(t => t.results[cond]?.score ?? 0);
    const tokens = tasks.map(t => t.results[cond]?.tokensUsed ?? 0);
    const passCount = tasks.filter(t => t.results[cond]?.passed).length;

    conditionData[cond] = {
      meanScore: scores.reduce((s, v) => s + v, 0) / n,
      passRate: passCount / n,
      scores,
      meanTokens: tokens.reduce((s, v) => s + v, 0) / n,
    };
  }

  const aScores = conditionData["treatment"]?.scores ?? [];
  const bScores = conditionData["realistic-control"]?.scores ?? [];
  const cScores = conditionData["impoverished-control"]?.scores ?? [];

  const headlineDelta = (conditionData["treatment"]?.meanScore ?? 0)
    - (conditionData["realistic-control"]?.meanScore ?? 0);
  const upperBoundDelta = (conditionData["treatment"]?.meanScore ?? 0)
    - (conditionData["impoverished-control"]?.meanScore ?? 0);

  const summary: ConditionSummary = {
    tasksRun: n,
    conditions: conditionData,
    headlineDelta,
    upperBoundDelta,
  };

  // Statistical analysis for full mode only (n >= 15)
  if (mode === "full" && n >= 10) {
    const tTest = pairedTTest(aScores, bScores);
    summary.pValue = tTest.p;
    summary.effectSize = cohensD(aScores, bScores);
    summary.ci95 = bootstrapCI(aScores, bScores);
  }

  return summary;
}

function emptySummary(conditions: BenchmarkCondition[]): ConditionSummary {
  const conditionData = {} as ConditionSummary["conditions"];
  for (const cond of conditions) {
    conditionData[cond] = { meanScore: 0, passRate: 0, scores: [], meanTokens: 0 };
  }
  return {
    tasksRun: 0,
    conditions: conditionData,
    headlineDelta: 0,
    upperBoundDelta: 0,
  };
}
