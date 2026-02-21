// src/bin/check.ts — Staleness detection for AGENTS.md
// Compares current analysis against a stored baseline to detect drift.

import { resolve, relative } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { analyze } from "../index.js";
import { diffAnalyses } from "../diff-analyzer.js";
import type { StructuredAnalysis } from "../types.js";

const DEFAULT_BASELINE = ".autodocs-baseline.json";

interface CheckOptions {
  baseline?: string;
  saveBaseline?: boolean;
  packages?: string[];
  root?: string;
  quiet?: boolean;
}

function stderr(msg: string): void {
  process.stderr.write(msg + "\n");
}

function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

/**
 * Run staleness check: analyze current codebase and compare against baseline.
 * Returns true if AGENTS.md needs regeneration (for exit code).
 */
export async function runCheck(options: CheckOptions = {}): Promise<boolean> {
  const cwd = process.cwd();
  const baselinePath = resolve(cwd, options.baseline ?? DEFAULT_BASELINE);

  // Step 1: Analyze current codebase
  stderr("");
  stderr("  Analyzing current codebase...");
  const analysisStart = performance.now();

  const analysis = await analyze({
    packages: options.packages?.map((p) => resolve(p)) ?? [cwd],
    rootDir: options.root ? resolve(options.root) : undefined,
  });

  const analysisMs = Math.round(performance.now() - analysisStart);
  stderr(`  Analysis complete (${(analysisMs / 1000).toFixed(1)}s)`);

  // Step 2: Save baseline if requested
  if (options.saveBaseline) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify(analysis, mapReplacer, 2));
    stderr(`  Baseline saved: ${relative(cwd, baselinePath)}`);
    return false; // Not stale — we just saved
  }

  // Step 3: Load baseline
  if (!existsSync(baselinePath)) {
    stderr(`  No baseline found at ${relative(cwd, baselinePath)}`);
    stderr(`  Run with --save-baseline first to create one.`);
    return true; // Treat missing baseline as "stale"
  }

  let baseline: StructuredAnalysis;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
  } catch {
    stderr(`  Failed to parse baseline at ${relative(cwd, baselinePath)}`);
    return true;
  }

  // Step 4: Compare
  const diff = diffAnalyses(analysis, baseline);

  if (diff.needsUpdate) {
    stderr(`  AGENTS.md is stale: ${diff.summary}`);
    if (diff.newExports.length > 0) stderr(`    New exports: ${diff.newExports.join(", ")}`);
    if (diff.removedExports.length > 0) stderr(`    Removed exports: ${diff.removedExports.join(", ")}`);
    if (diff.commandsChanged) stderr(`    Commands changed`);
    if (diff.dependencyChanges.majorVersionChanged.length > 0) {
      stderr(`    Major version changes: ${diff.dependencyChanges.majorVersionChanged.join(", ")}`);
    }
    stderr("");
    stderr(`  Run \`npx autodocs-engine init\` to regenerate.`);
  } else {
    if (!options.quiet) stderr(`  AGENTS.md is up to date.`);
  }

  return diff.needsUpdate;
}
