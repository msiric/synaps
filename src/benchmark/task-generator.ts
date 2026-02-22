// src/benchmark/task-generator.ts — Generate benchmark tasks from ContributionPatterns
// Tasks are self-referential: the engine tests whether its own AGENTS.md helps AI follow
// the patterns the engine detected.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, dirname, relative } from "node:path";
import type { StructuredAnalysis, ContributionPattern, Convention, AntiPattern } from "../types.js";
import { SOURCE_EXTENSIONS } from "../types.js";
import type { BenchmarkTask, TaskContext, TaskTier } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SIBLING_LINES = 100;
const TASK_NAME_POOL = [
  "import-ordering", "error-boundary", "accessibility", "keyboard-navigation",
  "dark-mode", "internationalization", "pagination", "search-filter",
  "form-validation", "notification", "authentication", "rate-limiting",
  "caching", "retry-logic", "health-check", "metric-collection",
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate benchmark tasks from analysis results.
 * Returns tasks sorted by tier (A > B > C) with deterministic sibling selection.
 */
export function generateTasksFromAnalysis(
  analysis: StructuredAnalysis,
  repoPath: string,
  maxTasks: number = 20,
): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [];

  for (const pkg of analysis.packages) {
    const patterns = pkg.contributionPatterns ?? [];
    const conventions = pkg.conventions ?? [];
    const antiPatterns = pkg.antiPatterns ?? [];
    const pkgPath = join(repoPath, pkg.relativePath);

    for (const pattern of patterns) {
      const tier = classifyTier(pattern);
      const task = generateTaskFromPattern(
        pattern, pkg.name, pkgPath, tier, conventions, antiPatterns,
      );
      if (task) tasks.push(task);
    }
  }

  // Sort by tier quality (A first), then by maxScoringPoints descending
  tasks.sort((a, b) => {
    const tierOrder = { A: 0, B: 1, C: 2 };
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.maxScoringPoints - a.maxScoringPoints;
  });

  return tasks.slice(0, maxTasks);
}

/**
 * Classify a ContributionPattern into a tier based on deep signal richness.
 */
export function classifyTier(pattern: ContributionPattern): TaskTier {
  const hasCommonImports = (pattern.commonImports?.length ?? 0) > 0;
  const hasExportSuffix = !!pattern.exportSuffix;
  const hasRegistration = !!pattern.registrationFile;
  const signals = [hasCommonImports, hasExportSuffix, hasRegistration].filter(Boolean).length;

  if (signals === 3) return "A";
  if (signals >= 1) return "B";
  return "C";
}

// ─── Task Generation ─────────────────────────────────────────────────────────

function generateTaskFromPattern(
  pattern: ContributionPattern,
  packageName: string,
  pkgPath: string,
  tier: TaskTier,
  conventions: Convention[],
  antiPatterns: AntiPattern[],
): BenchmarkTask | null {
  const absDir = join(pkgPath, pattern.directory);

  // Derive a task name that doesn't collide with existing files
  const taskName = deriveTaskName(pattern, absDir);
  if (!taskName) return null;

  // Build the prompt (deliberately vague — AGENTS.md should fill in the details)
  const prompt = buildTaskPrompt(pattern, taskName, packageName);

  // Collect context files (siblings, registration, barrel)
  const context = collectContext(pattern, pkgPath, absDir);

  // Calculate max scoring points based on tier
  const maxPoints = tier === "A" ? 25 : tier === "B" ? 18 : 12;

  return {
    id: `${pattern.directory.replace(/\//g, "-")}-${taskName}`,
    repoPath: pkgPath,
    packageName,
    tier,
    prompt,
    contributionPattern: pattern,
    conventions,
    antiPatterns,
    expectedDirectory: pattern.directory,
    expectedFilePattern: pattern.filePattern,
    maxScoringPoints: maxPoints,
    context,
  };
}

/**
 * Derive a plausible task name that doesn't collide with existing exports.
 */
export function deriveTaskName(
  pattern: ContributionPattern,
  absDir: string,
): string | null {
  // List existing files in the directory
  let existingFiles: string[] = [];
  try {
    existingFiles = readdirSync(absDir)
      .filter(f => SOURCE_EXTENSIONS.test(f))
      .map(f => basename(f, f.slice(f.lastIndexOf("."))));
  } catch {
    return null;
  }

  const existing = new Set(existingFiles.map(f => f.toLowerCase()));

  // Try names from the pool, applying the pattern's naming convention
  for (const candidate of TASK_NAME_POOL) {
    const name = pattern.exportSuffix
      ? candidate  // Will get suffix applied later
      : candidate;

    if (!existing.has(name.toLowerCase())) {
      return name;
    }
  }

  return null;
}

function buildTaskPrompt(
  pattern: ContributionPattern,
  taskName: string,
  packageName: string,
): string {
  const typeLabel = pattern.type === "function" ? "utility function"
    : pattern.type === "hook" ? "React hook"
    : pattern.type === "component" ? "React component"
    : pattern.type;

  // Deliberately vague — doesn't mention imports, suffixes, or registration
  return `Add a new ${typeLabel} for "${taskName}" to the ${packageName} project. `
    + `It should handle ${taskName.replace(/-/g, " ")} functionality. `
    + `Include implementation, any necessary registration or re-exports, and a test file.`;
}

// ─── Context Collection ──────────────────────────────────────────────────────

/**
 * Collect context files for benchmark conditions.
 * Deterministic sibling selection: exampleFile + most recent + median-dated.
 */
export function collectContext(
  pattern: ContributionPattern,
  pkgPath: string,
  absDir: string,
): TaskContext {
  const siblingFiles = selectSiblings(pattern, pkgPath, absDir);
  const directoryListing = listDirectory(absDir);

  let registrationFile: TaskContext["registrationFile"];
  if (pattern.registrationFile) {
    const regPath = join(pkgPath, pattern.registrationFile);
    try {
      registrationFile = {
        path: pattern.registrationFile,
        content: readFileSync(regPath, "utf-8"),
      };
    } catch { /* file doesn't exist */ }
  }

  // Find barrel file (index.ts in directory or parent)
  let barrelFile: TaskContext["barrelFile"];
  for (const candidate of ["index.ts", "index.tsx", "../index.ts"]) {
    const barrelPath = join(absDir, candidate);
    try {
      const content = readFileSync(barrelPath, "utf-8");
      barrelFile = {
        path: relative(pkgPath, barrelPath),
        content,
      };
      break;
    } catch { /* try next */ }
  }

  return { siblingFiles, registrationFile, barrelFile, directoryListing };
}

/**
 * Deterministic sibling selection algorithm.
 * 1. Always include exampleFile
 * 2. Most recently modified non-example sibling
 * 3. If 5+ files, add median-dated file
 */
function selectSiblings(
  pattern: ContributionPattern,
  pkgPath: string,
  absDir: string,
): TaskContext["siblingFiles"] {
  const result: TaskContext["siblingFiles"] = [];

  // 1. Always include the example file
  const examplePath = join(pkgPath, pattern.exampleFile);
  try {
    result.push({
      path: pattern.exampleFile,
      content: truncateFile(readFileSync(examplePath, "utf-8")),
    });
  } catch { /* missing */ }

  // List all source files in directory, with modification times
  let filesWithMtime: { name: string; mtime: number }[] = [];
  try {
    filesWithMtime = readdirSync(absDir)
      .filter(f => SOURCE_EXTENSIONS.test(f) && !f.includes(".test.") && !f.includes(".spec.") && f !== "index.ts" && f !== "index.tsx")
      .map(f => {
        try {
          return { name: f, mtime: statSync(join(absDir, f)).mtimeMs };
        } catch {
          return { name: f, mtime: 0 };
        }
      })
      .filter(f => {
        const relPath = relative(pkgPath, join(absDir, f.name));
        return relPath !== pattern.exampleFile;
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { /* dir read error */ }

  // 2. Most recently modified non-example sibling
  if (filesWithMtime.length > 0) {
    const newest = filesWithMtime[0];
    const newestPath = join(absDir, newest.name);
    try {
      result.push({
        path: relative(pkgPath, newestPath),
        content: truncateFile(readFileSync(newestPath, "utf-8")),
      });
    } catch { /* read error */ }
  }

  // 3. If 5+ files, add median-dated file
  if (filesWithMtime.length >= 4) {
    const medianIdx = Math.floor(filesWithMtime.length / 2);
    const median = filesWithMtime[medianIdx];
    const medianPath = join(absDir, median.name);
    // Skip if same as newest
    if (median.name !== filesWithMtime[0]?.name) {
      try {
        result.push({
          path: relative(pkgPath, medianPath),
          content: truncateFile(readFileSync(medianPath, "utf-8")),
        });
      } catch { /* read error */ }
    }
  }

  return result;
}

function listDirectory(absDir: string): string[] {
  try {
    return readdirSync(absDir)
      .filter(f => SOURCE_EXTENSIONS.test(f))
      .sort();
  } catch {
    return [];
  }
}

function truncateFile(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= MAX_SIBLING_LINES) return content;
  return lines.slice(0, MAX_SIBLING_LINES).join("\n") + "\n// ... truncated";
}
