#!/usr/bin/env node
// CLI entry point for autodocs-engine

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseCliArgs, resolveConfig } from "../config.js";
import { diffAnalyses } from "../diff-analyzer.js";
import {
  analyze,
  ENGINE_VERSION,
  format,
  formatAsHierarchy,
  formatBudgetReport,
  formatDeterministic,
  formatHierarchicalDeterministic,
  mergeWithExisting,
  readExistingAgentsMd,
  validateBudget,
  wrapWithDelimiters,
} from "../index.js";
import type { StructuredAnalysis } from "../types.js";

const OUTPUT_FILENAMES: Record<string, string> = {
  json: "autodocs-analysis.json",
  "agents.md": "AGENTS.md",
  "claude.md": "CLAUDE.md",
  cursorrules: ".cursorrules",
};

const HELP_TEXT = `
autodocs-engine v${ENGINE_VERSION}

Usage:
  autodocs-engine init                   Auto-detect and generate AGENTS.md (zero-config)
  autodocs-engine check                  Check if AGENTS.md needs regeneration (for CI)
  autodocs-engine analyze [paths...]     Analyze specific packages (advanced)
  autodocs-engine serve [path]           Start MCP server for live codebase intelligence
  autodocs-engine benchmark [path]       Measure AGENTS.md effectiveness (A/B testing)

Arguments:
  paths                Package directories to analyze (default: current directory)

Options:
  --minimal            Focused output (<500 tokens, no API key needed — default for init)
  --full               Comprehensive output (requires ANTHROPIC_API_KEY)
  --format, -f         Output format: json, agents.md, claude.md, cursorrules
                       (default: json, or agents.md if ANTHROPIC_API_KEY is set)
  --output, -o         Output directory (default: current directory)
  --config, -c         Path to config file
  --root               Monorepo root directory (for root-level command extraction)
  --hierarchical       Produce root AGENTS.md + per-package detail files (default for multi-package)
  --flat               Force single-file output even for multi-package
  --merge              Preserve human-written sections in existing AGENTS.md (uses delimiters)
  --diff <path>        Compare against previous analysis JSON and output a diff report
  --quiet, -q          Suppress warnings
  --verbose, -v        Print detailed timing and budget validation
  --telemetry          Enable session telemetry (writes to ~/.autodocs/telemetry/)
  --dry-run            Print to stdout (no file writes)
  --help               Show this help text

Environment Variables:
  ANTHROPIC_API_KEY    Optional. Enables richer output (architecture + domain synthesis)

Examples:
  npx autodocs-engine init                              # Focused AGENTS.md, no API key
  npx autodocs-engine init --full                       # Comprehensive AGENTS.md (needs API key)
  npx autodocs-engine serve                             # Start MCP server
  npx autodocs-engine analyze . --minimal --dry-run     # Preview minimal output
  npx autodocs-engine check                             # CI staleness check
`.trim();

async function main() {
  const args = await parseCliArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    process.exit(0);
  }

  // Handle "init" subcommand — zero-config generation
  if (args.packages[0] === "init") {
    const { runInit } = await import("./init.js");
    await runInit({ full: args.full });
    process.exit(0);
  }

  // Handle "check" subcommand — staleness detection
  if (args.packages[0] === "check") {
    const { runCheck } = await import("./check.js");
    const isStale = await runCheck({
      saveBaseline: args.saveBaseline ?? false,
      quiet: args.quiet,
    });
    process.exit(isStale ? 1 : 0);
  }

  // Handle "benchmark" subcommand — AGENTS.md effectiveness measurement
  if (args.packages[0] === "benchmark") {
    const { runBenchmark } = await import("./benchmark.js");
    await runBenchmark({
      repoPath: args.packages[1],
      root: args.root,
      quick: !args.full,
      full: args.full,
      model: args.model,
      output: args.output,
      verbose: args.verbose,
      dryRun: args.dryRun,
      maxTasks: args.maxTasks,
      benchmarkMode: args.benchmarkMode,
    });
    process.exit(0);
  }

  // Handle "setup-hooks" subcommand — install Claude Code hooks
  if (args.packages[0] === "setup-hooks") {
    const { runSetupHooks } = await import("./setup-hooks.js");
    await runSetupHooks();
    process.exit(0);
  }

  // Handle "serve" subcommand — MCP server for live codebase intelligence
  // Supports multiple paths: autodocs-engine serve /repo1 /repo2
  if (args.packages[0] === "serve") {
    const { runServe } = await import("./serve.js");
    const servePaths = args.packages.slice(1);
    await runServe({
      paths: servePaths.length > 1 ? servePaths : undefined,
      path: servePaths.length === 1 ? servePaths[0] : undefined,
      verbose: args.verbose,
      telemetry: args.telemetry,
      typeChecking: args.typeChecking,
    });
    // Don't exit — server stays alive until client disconnects
    return;
  }

  // Handle "visualize" subcommand — generate HTML report
  if (args.packages[0] === "visualize") {
    const { runVisualize } = await import("./visualize.js");
    await runVisualize({ path: args.packages[1], verbose: args.verbose });
    process.exit(0);
  }

  // Strip "analyze" subcommand if present
  if (args.packages[0] === "analyze") {
    args.packages.shift();
  }

  const warnings: import("../types.js").Warning[] = [];
  const config = resolveConfig(args, warnings);

  const analysis = await analyze(config);

  // Merge config-time warnings with analysis warnings
  analysis.warnings.push(...warnings);

  // Print warnings to stderr
  if (!args.quiet) {
    for (const w of analysis.warnings) {
      process.stderr.write(`[${w.level}] ${w.module}: ${w.message}\n`);
    }
  }

  // Dry-run: print to stdout
  if (args.dryRun) {
    if (args.minimal) {
      const { generateMinimalAgentsMd } = await import("../deterministic-formatter.js");
      process.stdout.write(`${generateMinimalAgentsMd(analysis)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(analysis, mapReplacer, 2)}\n`);
    }
    process.exit(0);
  }

  // W2-4: Diff mode — compare against previous analysis
  if (args.diff) {
    const diffPath = resolve(args.diff);
    if (!existsSync(diffPath)) {
      process.stderr.write(`[error] Previous analysis file not found: ${diffPath}\n`);
      process.exit(1);
    }
    try {
      const previousJson = readFileSync(diffPath, "utf-8");
      const previous = JSON.parse(previousJson) as StructuredAnalysis;
      const diff = diffAnalyses(analysis, previous);
      process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
      if (!args.quiet) {
        process.stderr.write(`[INFO] ${diff.summary}\n`);
      }
      process.exit(diff.needsUpdate ? 1 : 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[error] Failed to read/parse previous analysis: ${msg}\n`);
      process.exit(1);
    }
  }

  // Format and write output
  if (config.output.format === "json") {
    const outputPath = resolve(config.output.dir, OUTPUT_FILENAMES[config.output.format]);
    writeFileSafe(outputPath, JSON.stringify(analysis, mapReplacer, 2));
    if (!args.quiet) process.stderr.write(`Written to ${outputPath}\n`);
  } else {
    // Determine if hierarchical output should be used
    const isMultiPackage = analysis.packages.length > 1;
    const isAgentsMd = config.output.format === "agents.md";
    const useHierarchical = isAgentsMd && isMultiPackage && !args.flat && args.hierarchical !== false;

    try {
      if (useHierarchical) {
        await writeHierarchicalOutput(analysis, config, args);
      } else {
        await writeFlatOutput(analysis, config, args);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`LLM formatting failed: ${msg}\n`);
      process.stderr.write("Falling back to JSON output.\n");
      const outputPath = resolve(config.output.dir, "autodocs-analysis.json");
      writeFileSafe(outputPath, JSON.stringify(analysis, mapReplacer, 2));
    }
  }

  process.exit(analysis.packages.length > 0 ? 0 : 1);
}

/**
 * Write flat (single-file) output.
 */
async function writeFlatOutput(
  analysis: import("../types.js").StructuredAnalysis,
  config: import("../types.js").ResolvedConfig,
  args: import("../config.js").ParsedArgs,
): Promise<void> {
  // Minimal mode: pure deterministic, no LLM, <500 tokens
  if (args.minimal) {
    const { generateMinimalAgentsMd } = await import("../deterministic-formatter.js");
    const minimalContent = generateMinimalAgentsMd(analysis);
    if (args.verbose)
      process.stderr.write(
        `[INFO] Minimal mode: ${minimalContent.split("\n").length} lines, ~${Math.round(minimalContent.length / 3.5)} tokens\n`,
      );
    if (args.dryRun) {
      process.stdout.write(`${minimalContent}\n`);
      return;
    }
    const filename = OUTPUT_FILENAMES[config.output.format] ?? "AGENTS.md";
    const outputPath = resolve(config.output.dir, filename);
    writeFileSafe(outputPath, minimalContent);
    if (!args.quiet) process.stderr.write(`Written to ${outputPath}\n`);
    return;
  }

  // Determine synthesis mode: default is "deterministic" for agents.md
  const synthesisMode = args.llmSynthesis ?? (config.output.format === "agents.md" ? "deterministic" : "full");

  if (args.verbose) process.stderr.write(`[INFO] Calling LLM (${config.llm.model}, ${synthesisMode} mode)...\n`);
  const llmStart = performance.now();

  const content =
    synthesisMode === "deterministic" && config.output.format === "agents.md"
      ? await formatDeterministic(analysis, config, config.rootDir)
      : await format(analysis, config);

  if (args.verbose) {
    const llmMs = Math.round(performance.now() - llmStart);
    const lineCount = content.split("\n").length;
    process.stderr.write(`[INFO]   Response: ${lineCount} lines in ${(llmMs / 1000).toFixed(1)}s\n`);
  }

  // Budget validation
  if (args.verbose) {
    const report = validateBudget(content);
    process.stderr.write(`${formatBudgetReport(report)}\n`);
  }

  let finalContent = content;

  // Improvement 4: Merge mode support
  if (args.merge && config.output.format === "agents.md") {
    const pkgDir = config.packages[0] ?? ".";
    const existing = readExistingAgentsMd(pkgDir);
    if (existing) {
      finalContent = mergeWithExisting(existing, content);
      if (!args.quiet) process.stderr.write(`[INFO] Merged with existing AGENTS.md (human content preserved)\n`);
    } else {
      // First generation — wrap in delimiters
      finalContent = wrapWithDelimiters(content);
    }
  }

  const filename = OUTPUT_FILENAMES[config.output.format];
  const outputPath = resolve(config.output.dir, filename);
  writeFileSafe(outputPath, finalContent);
  if (!args.quiet) process.stderr.write(`Written to ${outputPath}\n`);
}

/**
 * Write hierarchical output: root AGENTS.md + packages/ directory with per-package files.
 */
async function writeHierarchicalOutput(
  analysis: import("../types.js").StructuredAnalysis,
  config: import("../types.js").ResolvedConfig,
  args: import("../config.js").ParsedArgs,
): Promise<void> {
  const synthesisMode = args.llmSynthesis ?? "deterministic";

  if (args.verbose)
    process.stderr.write(
      `[INFO] Hierarchical mode (${synthesisMode}): generating root + ${analysis.packages.length} package files...\n`,
    );
  if (args.verbose) process.stderr.write(`[INFO] Calling LLM (${config.llm.model})...\n`);

  const llmStart = performance.now();
  const result =
    synthesisMode === "deterministic"
      ? await formatHierarchicalDeterministic(analysis, config)
      : await formatAsHierarchy(analysis, config);
  if (args.verbose) {
    const llmMs = Math.round(performance.now() - llmStart);
    process.stderr.write(`[INFO]   LLM calls completed in ${(llmMs / 1000).toFixed(1)}s\n`);
  }

  // Write root AGENTS.md
  const rootPath = resolve(config.output.dir, "AGENTS.md");
  writeFileSafe(rootPath, result.root);
  if (!args.quiet) process.stderr.write(`Written root: ${rootPath}\n`);

  // Budget validation for root
  if (args.verbose) {
    const rootReport = validateBudget(result.root);
    process.stderr.write(`Root ${formatBudgetReport(rootReport)}\n`);
  }

  // Write per-package detail files
  const packagesDir = resolve(config.output.dir, "packages");
  for (const pkg of result.packages) {
    const pkgPath = join(packagesDir, pkg.filename);
    writeFileSafe(pkgPath, pkg.content);
    if (!args.quiet) process.stderr.write(`Written package: ${pkgPath}\n`);

    if (args.verbose) {
      const pkgReport = validateBudget(pkg.content);
      process.stderr.write(`  ${pkg.filename}: ${pkgReport.lineCount} lines, ${pkgReport.ruleCount} rules\n`);
    }
  }
}

/** Fix 2: Auto-create output directory before writing. */
function writeFileSafe(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message ?? err}\n`);
  process.exit(1);
});
