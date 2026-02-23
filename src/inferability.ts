// src/inferability.ts — Compute how "inferable" a repo's patterns are from source code alone
// High score = AI can figure it out from sibling files (AGENTS.md pattern sections redundant)
// Low score = AI needs AGENTS.md guidance (non-obvious patterns, unique conventions)

import type { PackageAnalysis } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InferabilityScore {
  score: number;                    // 0-100 (higher = more inferable)
  factors: {
    directoryObviousness: number;   // 0-100: % of dirs with standard names
    namingConsistency: number;      // 0-100: % files following dominant pattern
    patternUniqueness: number;      // 0-100: inverse of deep pattern signals
    registrationComplexity: number; // 0-100: inverse of registration file count
  };
  recommendation: "full" | "minimal" | "skip";
}

// ─── Standard Directory Names ────────────────────────────────────────────────

const OBVIOUS_DIR_NAMES = new Set([
  "src", "lib", "dist", "build", "out", "coverage",
  "components", "component", "utils", "util", "utilities", "helpers", "helper",
  "types", "typings", "interfaces", "models", "model",
  "hooks", "hook",
  "styles", "css", "assets", "images", "icons", "fonts",
  "public", "static",
  "pages", "page", "views", "view", "screens",
  "app", "apps",
  "api", "apis", "routes", "route", "controllers", "controller",
  "config", "configs", "configuration", "settings",
  "constants", "const",
  "test", "tests", "__tests__", "spec", "specs",
  "middleware", "middlewares",
  "services", "service",
  "store", "stores", "state",
  "context", "contexts", "providers",
  "actions", "reducers", "selectors",
  "layouts", "layout",
  "features", "modules",
  "common", "shared", "core",
  "server", "client",
  "bin", "cli", "cmd",
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute how inferable a package's patterns are from source code alone.
 * Used to decide which AGENTS.md sections to include.
 */
export function computeInferabilityScore(pkg: PackageAnalysis): InferabilityScore {
  const directoryObviousness = computeDirectoryObviousness(pkg);
  const namingConsistency = computeNamingConsistency(pkg);
  const patternUniqueness = computePatternUniqueness(pkg);
  const registrationComplexity = computeRegistrationComplexity(pkg);

  // Weighted average: directory and patterns matter most
  const score = Math.round(
    directoryObviousness * 0.30 +
    namingConsistency * 0.25 +
    patternUniqueness * 0.25 +
    registrationComplexity * 0.20
  );

  // Thresholds
  let recommendation: InferabilityScore["recommendation"];
  if (score <= 35) {
    recommendation = "full";     // Repo has non-obvious patterns → include all sections
  } else if (score <= 65) {
    recommendation = "minimal";  // Mixed → include architecture + commands, skip verbose patterns
  } else {
    recommendation = "skip";     // Standard patterns → omit pattern sections
  }

  return {
    score,
    factors: { directoryObviousness, namingConsistency, patternUniqueness, registrationComplexity },
    recommendation,
  };
}

// ─── Factor Computation ──────────────────────────────────────────────────────

/**
 * What fraction of directories have standard/obvious names?
 * High = all dirs are standard (src/, lib/, utils/) → AI can infer
 * Low = has unique dirs (integration-tests/, adapters/, protocols/) → needs guidance
 */
function computeDirectoryObviousness(pkg: PackageAnalysis): number {
  const dirs = pkg.architecture.directories;
  if (dirs.length === 0) return 100;

  let obvious = 0;
  for (const dir of dirs) {
    const name = dir.path.replace(/\/$/, "").split("/").pop()?.toLowerCase() ?? "";
    if (OBVIOUS_DIR_NAMES.has(name)) obvious++;
  }

  return Math.round((obvious / dirs.length) * 100);
}

/**
 * How consistent is the file naming pattern?
 * High = one dominant pattern (>90% kebab-case) → AI infers from siblings
 * Low = mixed patterns or non-standard naming → needs explicit guidance
 */
function computeNamingConsistency(pkg: PackageAnalysis): number {
  const namingConvention = pkg.conventions.find(c => c.category === "file-naming");
  if (!namingConvention) return 80; // No naming convention detected → assume standard

  return Math.min(100, namingConvention.confidence.percentage);
}

/**
 * Inverse of pattern uniqueness — how many deep pattern signals exist?
 * High = no deep signals (AI can infer everything from siblings)
 * Low = has commonImports, exportSuffix, registrationFile → needs AGENTS.md
 */
function computePatternUniqueness(pkg: PackageAnalysis): number {
  const patterns = pkg.contributionPatterns ?? [];
  if (patterns.length === 0) return 90; // No patterns detected → standard structure

  let deepSignals = 0;
  let totalPossible = 0;

  for (const p of patterns) {
    totalPossible += 3; // 3 possible deep signals per pattern
    if (p.commonImports && p.commonImports.length > 0) deepSignals++;
    if (p.exportSuffix) deepSignals++;
    if (p.registrationFile) deepSignals++;
  }

  if (totalPossible === 0) return 90;

  // More deep signals = lower inferability (patterns are non-obvious)
  const uniqueRatio = deepSignals / totalPossible;
  return Math.round((1 - uniqueRatio) * 100);
}

/**
 * Inverse of registration complexity.
 * High = no registration files → standard structure
 * Low = multiple registration files → complex wiring the AI would miss
 */
function computeRegistrationComplexity(pkg: PackageAnalysis): number {
  const patterns = pkg.contributionPatterns ?? [];
  const registrationFiles = patterns
    .filter(p => p.registrationFile)
    .map(p => p.registrationFile!);

  const uniqueRegistrations = new Set(registrationFiles).size;

  if (uniqueRegistrations === 0) return 100;
  if (uniqueRegistrations === 1) return 60;
  if (uniqueRegistrations === 2) return 30;
  return 10; // 3+ registration files = complex wiring
}
