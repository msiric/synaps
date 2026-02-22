// src/bin/benchmark.ts — CLI entry point for the benchmark command
// Usage: autodocs-engine benchmark [repo-path] [options]

import { resolve } from "node:path";
import type { ResolvedConfig } from "../types.js";
import { orchestrateBenchmark } from "../benchmark/runner.js";
import type { BenchmarkOptions } from "../benchmark/types.js";

interface BenchmarkArgs {
  repoPath?: string;
  root?: string;
  quick?: boolean;
  full?: boolean;
  model?: string;
  output?: string;
  verbose?: boolean;
  dryRun?: boolean;
  maxTasks?: number;
}

export async function runBenchmark(args: BenchmarkArgs): Promise<void> {
  const repoPath = resolve(args.repoPath ?? ".");

  const options: BenchmarkOptions = {
    repoPath,
    rootDir: args.root ? resolve(args.root) : undefined,
    mode: args.full ? "full" : "quick",
    model: args.model,
    outputDir: args.output ? resolve(args.output) : undefined,
    verbose: args.verbose,
    dryRun: args.dryRun,
    maxTasks: args.maxTasks,
  };

  // Build LLM config
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey && !args.dryRun) {
    process.stderr.write(
      "Error: ANTHROPIC_API_KEY is required for benchmark (LLM generates code for scoring).\n"
      + "Set it: export ANTHROPIC_API_KEY=sk-...\n"
      + "Or use --dry-run to preview tasks without LLM calls.\n"
    );
    process.exit(1);
  }

  const llmConfig: ResolvedConfig["llm"] = {
    provider: "anthropic",
    model: args.model ?? process.env.AUTODOCS_LLM_MODEL ?? "claude-sonnet-4-20250514",
    apiKey: apiKey ?? "",
    maxOutputTokens: 4096,
  };

  try {
    const results = await orchestrateBenchmark(options, llmConfig);

    if (args.dryRun) {
      process.stderr.write(`\nDry run complete. ${results.summary.tasksRun === 0 ? "Tasks shown above." : ""}\n`);
      return;
    }

    // Print summary table to stderr
    const s = results.summary;
    const outputDir = options.outputDir ?? "./benchmark-results";
    const modeLabel = options.mode === "quick" ? "quick — directional only" : "full — statistical analysis";

    process.stderr.write(`\n`);
    process.stderr.write(`Benchmark: ${repoPath.split("/").pop()} (${modeLabel})\n`);
    process.stderr.write(`Model: ${llmConfig.model} | Tasks: ${s.tasksRun}\n`);
    process.stderr.write(`\n`);
    process.stderr.write(`  Condition              Mean Score  Pass Rate\n`);
    process.stderr.write(`  ─────────────────────  ──────────  ─────────\n`);

    const condLabels: Record<string, string> = {
      "treatment": "A: AGENTS.md + source",
      "realistic-control": "B: Source only",
      "impoverished-control": "C: Dir listing only",
      "negative-control": "N: Shuffled AGENTS.md",
    };

    for (const cond of results.meta.conditions) {
      const data = s.conditions[cond];
      if (!data) continue;
      const label = (condLabels[cond] ?? cond).padEnd(23);
      const score = (data.meanScore.toFixed(1) + "%").padStart(10);
      const pass = `${Math.round(data.passRate * s.tasksRun)}/${s.tasksRun}`.padStart(9);
      process.stderr.write(`  ${label}${score}${pass}\n`);
    }

    process.stderr.write(`\n`);
    process.stderr.write(`  Headline (A-B): ${s.headlineDelta >= 0 ? "+" : ""}${s.headlineDelta.toFixed(1)}%\n`);

    if (s.pValue !== undefined) {
      process.stderr.write(`  p-value: ${s.pValue.toFixed(4)} | Cohen's d: ${s.effectSize?.toFixed(2)}\n`);
    }

    process.stderr.write(`\n`);
    process.stderr.write(`  Results: ${outputDir}/results.json\n`);
    process.stderr.write(`  Report:  ${outputDir}/REPORT.md\n`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Benchmark failed: ${msg}\n`);
    process.exit(1);
  }
}
