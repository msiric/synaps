// src/benchmark/pr-scorer.ts — Score AI output against real commit ground truth
// Phase 0: File placement accuracy as the primary metric.
// Designed to be extended with naming, imports, exports in later phases.

import ts from "typescript";
import { dirname, basename, extname } from "node:path";
import type { GeneratedFile } from "./types.js";
import type { MinedTask } from "./pr-miner.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PRScoreResult {
  /** Overall score 0-100 (Phase 0: file placement only) */
  score: number;
  /** Individual dimension scores */
  dimensions: {
    filePlacement: DimensionScore;
    namingConvention: DimensionScore;
    barrelUpdate: DimensionScore;
  };
  /** Files the AI created */
  filesCreated: string[];
  /** Raw tokens used */
  tokensUsed: number;
  latencyMs: number;
  error?: string;
}

export interface DimensionScore {
  score: number;     // 0-100
  detail: string;
  passed: boolean;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Score AI-generated files against ground truth from a real commit.
 * Phase 0: primary metric is file placement accuracy.
 */
export function scorePROutput(
  files: GeneratedFile[],
  task: MinedTask,
  tokensUsed: number,
  latencyMs: number,
  error?: string,
): PRScoreResult {
  if (error || files.length === 0) {
    return {
      score: 0,
      dimensions: {
        filePlacement: { score: 0, detail: error ?? "No files generated", passed: false },
        namingConvention: { score: 0, detail: "No files generated", passed: false },
        barrelUpdate: { score: 0, detail: "No files generated", passed: false },
      },
      filesCreated: [],
      tokensUsed,
      latencyMs,
      error,
    };
  }

  // Filter to implementation files (not test, not barrel, not response wrapper)
  const implFiles = files.filter(f =>
    !f.path.includes(".test.") &&
    !f.path.includes(".spec.") &&
    !f.path.includes("__response__") &&
    !isBarrelFile(f.path)
  );

  const filePlacement = scoreFilePlacement(implFiles, task);
  const namingConvention = scoreNamingConvention(implFiles, task);
  const barrelUpdate = scoreBarrelUpdate(files, task);

  // Phase 0 headline: file placement is THE metric
  // Others tracked as secondary signals
  const score = filePlacement.score;

  return {
    score,
    dimensions: { filePlacement, namingConvention, barrelUpdate },
    filesCreated: files.map(f => f.path),
    tokensUsed,
    latencyMs,
  };
}

// ─── File Placement Scoring ─────────────────────────────────────────────────

/**
 * Score whether the AI placed its files in the correct directory.
 * Uses path distance: exact match = 100%, parent = 60%, shared prefix scaled.
 */
export function scoreFilePlacement(
  implFiles: GeneratedFile[],
  task: MinedTask,
): DimensionScore {
  if (implFiles.length === 0) {
    return { score: 0, detail: "No implementation files generated", passed: false };
  }

  const expectedDir = normalizeDir(task.groundTruth.directory);

  // Find the best-scoring file among the AI's output
  let bestScore = 0;
  let bestPath = "";

  for (const file of implFiles) {
    const fileDir = normalizeDir(dirname(file.path));
    const s = pathSimilarity(fileDir, expectedDir);
    if (s > bestScore) {
      bestScore = s;
      bestPath = file.path;
    }
  }

  const score = Math.round(bestScore * 100);
  const passed = bestScore >= 0.9; // Exact or near-exact match

  let detail: string;
  if (bestScore >= 1.0) {
    detail = `Correct: ${dirname(bestPath)} matches ${task.groundTruth.directory}`;
  } else if (bestScore >= 0.5) {
    detail = `Close: ${dirname(bestPath)} near ${task.groundTruth.directory} (${score}%)`;
  } else if (bestScore > 0) {
    detail = `Wrong: ${dirname(bestPath)}, expected ${task.groundTruth.directory} (${score}%)`;
  } else {
    detail = `Wrong: ${bestPath ? dirname(bestPath) : "unknown"}, expected ${task.groundTruth.directory}`;
  }

  return { score, detail, passed };
}

/**
 * Path similarity using common prefix and distance.
 * Exact dir match = 1.0, parent = 0.6, grandparent = 0.4, etc.
 */
export function pathSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;

  const aParts = a.split("/").filter(Boolean);
  const bParts = b.split("/").filter(Boolean);

  // Common prefix length
  let lcp = 0;
  while (lcp < aParts.length && lcp < bParts.length && aParts[lcp] === bParts[lcp]) {
    lcp++;
  }

  const distance = (aParts.length - lcp) + (bParts.length - lcp);
  if (distance === 0) return 1.0;

  // Exponential decay with distance
  const lambda = Math.log(2); // distance 1 ≈ 0.5
  let score = Math.exp(-lambda * distance);

  // Package mismatch penalty (monorepos)
  const aPkg = getPackage(aParts);
  const bPkg = getPackage(bParts);
  if (aPkg && bPkg && aPkg !== bPkg) {
    score *= 0.5;
  }

  return Math.max(0, Math.min(1, score));
}

function getPackage(parts: string[]): string | null {
  if ((parts[0] === "packages" || parts[0] === "apps") && parts.length >= 2) {
    return parts.slice(0, 2).join("/");
  }
  return null;
}

// ─── Naming Convention Scoring ──────────────────────────────────────────────

/**
 * Score whether the AI's filename follows the same naming convention
 * as the ground truth file.
 */
export function scoreNamingConvention(
  implFiles: GeneratedFile[],
  task: MinedTask,
): DimensionScore {
  if (implFiles.length === 0) {
    return { score: 0, detail: "No files", passed: false };
  }

  const gtName = basename(task.groundTruth.filename, extname(task.groundTruth.filename));
  const gtConvention = detectConvention(gtName);

  // Check if any AI file matches the naming convention
  let bestMatch = false;
  let bestFile = "";

  for (const file of implFiles) {
    const aiName = basename(file.path, extname(file.path));
    const aiConvention = detectConvention(aiName);
    if (aiConvention === gtConvention) {
      bestMatch = true;
      bestFile = file.path;
      break;
    }
  }

  if (bestMatch) {
    return {
      score: 100,
      detail: `Convention match: ${gtConvention} (${bestFile})`,
      passed: true,
    };
  }

  // Check for partial match (e.g., both use lowercase but different separators)
  const aiFile = implFiles[0];
  const aiName = basename(aiFile.path, extname(aiFile.path));
  const aiConvention = detectConvention(aiName);

  return {
    score: 0,
    detail: `Convention mismatch: AI used ${aiConvention}, expected ${gtConvention}`,
    passed: false,
  };
}

type NamingConvention = "kebab-case" | "camelCase" | "PascalCase" | "snake_case" | "unknown";

function detectConvention(name: string): NamingConvention {
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) return "kebab-case";
  if (/^[a-z][a-z0-9]*$/.test(name)) return "kebab-case"; // single word, treat as kebab
  if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) return "camelCase";
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return "PascalCase";
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) return "snake_case";
  return "unknown";
}

// ─── Barrel Update Scoring ──────────────────────────────────────────────────

/**
 * Score whether the AI updated the barrel/index file when one exists.
 * Binary: did the AI produce a modified barrel that includes a new export?
 */
export function scoreBarrelUpdate(
  allFiles: GeneratedFile[],
  task: MinedTask,
): DimensionScore {
  // Only score if the directory had a barrel file
  if (!task.context.barrelFile) {
    return { score: 100, detail: "No barrel file — N/A", passed: true };
  }

  // Find the AI's barrel file
  const barrelPath = task.context.barrelFile.path;
  const barrelName = basename(barrelPath);
  const aiBarrel = allFiles.find(f =>
    f.path === barrelPath ||
    f.path.endsWith("/" + barrelName) ||
    basename(f.path) === barrelName
  );

  if (!aiBarrel) {
    return { score: 0, detail: "Barrel file exists but AI did not update it", passed: false };
  }

  // Check if the AI added a new export
  const originalExports = extractReExports(task.context.barrelFile.content);
  const aiExports = extractReExports(aiBarrel.content);
  const newExports = aiExports.filter(e => !originalExports.includes(e));

  if (newExports.length > 0) {
    return {
      score: 100,
      detail: `Barrel updated: added ${newExports.join(", ")}`,
      passed: true,
    };
  }

  return {
    score: 0,
    detail: "Barrel file present but no new exports added",
    passed: false,
  };
}

function extractReExports(content: string): string[] {
  const exports: string[] = [];
  const regex = /export\s+(?:\*|\{[^}]+\})\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  return exports;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeDir(dir: string): string {
  return dir.replace(/^\.\//, "").replace(/\/$/, "");
}

function isBarrelFile(path: string): boolean {
  const name = basename(path);
  return name === "index.ts" || name === "index.tsx" || name === "mod.ts";
}
