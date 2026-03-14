// src/mcp/queries.ts — Data access layer over StructuredAnalysis
// Isolates tool handlers from analysis schema internals.
// When analysis types change, update here — not in every tool handler.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { computeImpactRadius } from "../impact-radius.js";
import type {
  AntiPattern,
  CallGraphEdge,
  CoChangeEdge,
  CommandSet,
  ContributionPattern,
  Convention,
  FileImportEdge,
  ImplicitCouplingEdge,
  PackageAnalysis,
  PackageArchitecture,
  PublicAPIEntry,
  StructuredAnalysis,
  WorkflowRule,
} from "../types.js";
import { ToolError } from "./errors.js";

// ─── Package Resolution ──────────────────────────────────────────────────────

export function resolvePackage(analysis: StructuredAnalysis, packagePath?: string): PackageAnalysis {
  if (!packagePath) {
    if (analysis.packages.length === 1) return analysis.packages[0];
    throw new ToolError("AMBIGUOUS_PACKAGE", `Multiple packages found. Specify packagePath.`, [
      "Call list_packages to see all packages",
      `Available: ${analysis.packages.map((p) => p.name).join(", ")}`,
    ]);
  }
  const pkg = analysis.packages.find((p) => p.relativePath === packagePath || p.name === packagePath);
  if (!pkg) {
    // Single-package monorepos: return the only package regardless of the path hint
    if (analysis.packages.length === 1) return analysis.packages[0];
    throw new ToolError("PACKAGE_NOT_FOUND", `Package '${packagePath}' not found.`, [
      `Available: ${analysis.packages.map((p) => p.name).join(", ")}`,
      analysis.packages.length === 1
        ? "This project is analyzed as a single package — omit packagePath"
        : "Call list_packages for full details",
    ]);
  }
  return pkg;
}

// ─── Query Functions ─────────────────────────────────────────────────────────

export function getCommands(analysis: StructuredAnalysis, packagePath?: string): CommandSet {
  return resolvePackage(analysis, packagePath).commands;
}

export function getArchitecture(analysis: StructuredAnalysis, packagePath?: string): PackageArchitecture {
  return resolvePackage(analysis, packagePath).architecture;
}

export function getImportersForFile(
  analysis: StructuredAnalysis,
  filePath: string,
  packagePath?: string,
): FileImportEdge[] {
  const pkg = resolvePackage(analysis, packagePath);
  const chain = pkg.importChain ?? [];
  return chain.filter((e) => e.source === filePath).sort((a, b) => b.symbolCount - a.symbolCount);
}

export function getCallersForFunction(
  analysis: StructuredAnalysis,
  functionName: string,
  packagePath?: string,
): { directCallers: CallGraphEdge[]; transitiveCount: number } {
  const pkg = resolvePackage(analysis, packagePath);
  const callGraph = pkg.callGraph ?? [];

  const directCallers = callGraph.filter((e) => e.to === functionName);

  // Compute transitive caller count via impact radius
  const impact = computeImpactRadius(callGraph);
  const entry =
    impact.highImpact.find((e) => e.functionName === functionName) ??
    impact.complex.find((e) => e.functionName === functionName);

  return {
    directCallers,
    transitiveCount: entry?.transitiveCallers ?? directCallers.length,
  };
}

export function getCoChangesForFile(
  analysis: StructuredAnalysis,
  filePath: string,
  packagePath?: string,
): CoChangeEdge[] {
  const pkg = resolvePackage(analysis, packagePath);
  const edges = pkg.gitHistory?.coChangeEdges ?? [];
  return edges.filter((e) => e.file1 === filePath || e.file2 === filePath).sort((a, b) => b.jaccard - a.jaccard);
}

export function getWorkflowRules(analysis: StructuredAnalysis, filePath?: string): WorkflowRule[] {
  const rules = analysis.crossPackage?.workflowRules ?? [];
  if (!filePath) return rules;
  return rules.filter((r) => r.trigger.includes(filePath) || r.action.includes(filePath));
}

export function getImplicitCouplingForFile(
  analysis: StructuredAnalysis,
  filePath: string,
  packagePath?: string,
): ImplicitCouplingEdge[] {
  const pkg = resolvePackage(analysis, packagePath);
  const edges = pkg.implicitCoupling ?? [];
  return edges.filter((e) => e.file1 === filePath || e.file2 === filePath).sort((a, b) => b.jaccard - a.jaccard);
}

export function getExportedNamesForFile(
  analysis: StructuredAnalysis,
  filePath: string,
  packagePath?: string,
): string[] {
  const pkg = resolvePackage(analysis, packagePath);
  return pkg.publicAPI.filter((e) => e.sourceFile === filePath && !e.isTypeOnly).map((e) => e.name);
}

export function getImportersOfSymbol(
  analysis: StructuredAnalysis,
  symbol: string,
  sourceFile: string,
  packagePath?: string,
): FileImportEdge[] {
  const pkg = resolvePackage(analysis, packagePath);
  return (pkg.importChain ?? []).filter((e) => e.source === sourceFile && e.symbols.includes(symbol));
}

export function getContributionPatterns(
  analysis: StructuredAnalysis,
  packagePath?: string,
  directory?: string,
): ContributionPattern[] {
  const pkg = resolvePackage(analysis, packagePath);
  const patterns = pkg.contributionPatterns ?? [];
  if (directory) {
    return patterns.filter((p) => p.directory === directory || p.directory.includes(directory));
  }
  return patterns;
}

export function getPublicAPI(
  analysis: StructuredAnalysis,
  packagePath?: string,
  query?: string,
  limit: number = 20,
): PublicAPIEntry[] {
  const pkg = resolvePackage(analysis, packagePath);
  let exports = pkg.publicAPI ?? [];
  if (query) {
    const q = query.toLowerCase();
    exports = exports.filter((e) => e.name.toLowerCase().includes(q));
  }
  return exports.slice(0, limit);
}

export function getExampleForExport(
  analysis: StructuredAnalysis,
  exportName: string,
  packagePath?: string,
): { snippet: string; testFile: string } | null {
  const pkg = resolvePackage(analysis, packagePath);
  const example = (pkg.examples ?? []).find((e) => e.exportName === exportName);
  if (!example) return null;
  return { snippet: example.snippet, testFile: example.testFile };
}

export function getFingerprintForExport(
  analysis: StructuredAnalysis,
  exportName: string,
  packagePath?: string,
): { parameterShape: string; returnShape: string } | null {
  const pkg = resolvePackage(analysis, packagePath);
  const fp = (pkg.patternFingerprints ?? []).find((f) => f.exportName === exportName);
  if (!fp) return null;
  return { parameterShape: fp.parameterShape, returnShape: fp.returnShape };
}

export function getConventions(
  analysis: StructuredAnalysis,
  packagePath?: string,
  category?: string,
): { conventions: Convention[]; antiPatterns: AntiPattern[] } {
  const pkg = resolvePackage(analysis, packagePath);
  // Filter to non-style conventions (architecture patterns, not naming/formatting)
  let conventions = (pkg.conventions ?? []).filter(
    (c) => c.category !== "file-naming" || c.confidence.percentage >= 95,
  );
  if (category) {
    conventions = conventions.filter((c) => c.category === category);
  }
  return {
    conventions,
    antiPatterns: pkg.antiPatterns ?? [],
  };
}

export function listPackages(analysis: StructuredAnalysis): {
  name: string;
  path: string;
  type: string;
  entryPoint: string;
  fileCount: number;
}[] {
  return analysis.packages.map((p) => ({
    name: p.name,
    path: p.relativePath,
    type: p.architecture.packageType,
    entryPoint: p.architecture.entryPoint,
    fileCount: p.files.total,
  }));
}

export function getTechStackSummary(analysis: StructuredAnalysis, packagePath?: string): string {
  const pkg = resolvePackage(analysis, packagePath);
  const parts: string[] = [];
  const insights = pkg.dependencyInsights;
  if (insights) {
    if (insights.runtime.length > 0) {
      parts.push(insights.runtime.map((r) => `${r.name} ${r.version}`).join(", "));
    }
    if (insights.frameworks.length > 0) {
      parts.push(insights.frameworks.map((f) => `${f.name} ${f.version}`).join(", "));
    }
    if (insights.testFramework) {
      parts.push(`${insights.testFramework.name} ${insights.testFramework.version}`);
    }
  }
  return parts.join(" | ") || "TypeScript";
}

// ─── Plan Change / Test Info Queries ────────────────────────────────────────

export function getBarrelFile(analysis: StructuredAnalysis, directory: string, packagePath?: string): string | null {
  const pkg = resolvePackage(analysis, packagePath);
  const dir = directory.replace(/\/$/, "");
  const rootDir = analysis.meta?.rootDir;
  // Check if index.ts or index.tsx exists AND actually contains re-exports
  // (index.ts files that are entry points, not barrels, should be skipped)
  const allFiles = new Set(pkg.files.byTier.tier1.files.concat(pkg.files.byTier.tier2.files));
  for (const barrelPath of [`${dir}/index.ts`, `${dir}/index.tsx`]) {
    if (!allFiles.has(barrelPath)) continue;
    if (rootDir) {
      const content = safeReadFile(rootDir, barrelPath);
      if (content && /export\s+(?:\*|\{[^}]+\})\s+from\s+["']/.test(content)) {
        return barrelPath;
      }
    } else {
      return barrelPath; // No rootDir to verify — trust the file list
    }
  }
  return null;
}

export interface TestFileInfo {
  testFile: string | null;
  exists: boolean;
  framework: string;
  command: string;
  pattern: string;
}

export function resolveTestFile(
  analysis: StructuredAnalysis,
  sourceFilePath: string,
  packagePath?: string,
): TestFileInfo {
  const pkg = resolvePackage(analysis, packagePath);
  const dir = sourceFilePath.replace(/\/[^/]+$/, "");
  const fileBase = sourceFilePath.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  const ext = sourceFilePath.slice(sourceFilePath.lastIndexOf("."));
  const rootDir = analysis.meta?.rootDir;

  // Find contribution pattern for export suffix (most-specific match)
  const patterns = pkg.contributionPatterns ?? [];
  const pattern = findBestPattern(patterns, sourceFilePath);

  // Build comprehensive candidate list covering all common test patterns:
  // 1. Co-located in same directory
  // 2. Separate test/ directory mirroring src/ structure
  // 3. Separate test/ directory flattened (no subdirs)
  // 4. Separate test/ with export-suffix naming
  // 5. __tests__/ subdirectory
  const strippedPath = sourceFilePath.replace(/^src\//, "");
  const strippedBase = strippedPath.replace(/\.[^.]+$/, "");

  const candidates: string[] = [
    // Co-located: src/foo.ts → src/foo.test.ts
    `${dir}/${fileBase}.test${ext}`,
    `${dir}/${fileBase}.spec${ext}`,

    // Separate test/ mirroring src/ subdirectories: src/mcp/tools.ts → test/mcp/tools.test.ts
    `test/${strippedBase}.test${ext}`,
    `test/${strippedBase}.spec${ext}`,

    // Separate test/ flattened: src/detectors/foo.ts → test/foo.test.ts
    `test/${fileBase}.test${ext}`,
    `test/${fileBase}.spec${ext}`,

    // __tests__ subdirectory: src/foo.ts → src/__tests__/foo.test.ts
    `${dir}/__tests__/${fileBase}.test${ext}`,
    `${dir}/__tests__/${fileBase}.spec${ext}`,

    // tests/ (plural) variants of all above
    `tests/${strippedBase}.test${ext}`,
    `tests/${fileBase}.test${ext}`,
  ];

  // If pattern has export suffix, also try test named with suffix
  // e.g., src/detectors/foo.ts with suffix "Detector" → test/foo-detector.test.ts
  if (pattern?.exportSuffix) {
    const suffix = pattern.exportSuffix.replace(/^[A-Z]/, (c) => c.toLowerCase());
    candidates.push(`test/${fileBase}-${suffix}.test${ext}`, `test/${fileBase}-${suffix}.spec${ext}`);
  }

  // Check which exists on disk (test files are in tier3, no file list)
  let testFile: string | null = null;
  let exists = false;
  for (const candidate of candidates) {
    if (rootDir && existsSync(resolve(rootDir, candidate))) {
      testFile = candidate;
      exists = true;
      break;
    }
  }
  // Suggest the most likely candidate: mirrored test/ dir if src/ file, else co-located
  if (!testFile) {
    testFile = sourceFilePath.startsWith("src/") ? `test/${strippedBase}.test${ext}` : `${dir}/${fileBase}.test${ext}`;
  }

  // Detect framework from test command + dependencies
  const testCmd = pkg.commands.test?.run ?? "";
  const testSource = pkg.commands.test?.source ?? "";
  const testFrameworkDep = pkg.dependencyInsights?.testFramework?.name ?? "";
  const frameworkSignal = `${testCmd} ${testSource} ${testFrameworkDep}`.toLowerCase();
  let framework = "unknown";
  if (/vitest/i.test(frameworkSignal)) framework = "vitest";
  else if (/jest/i.test(frameworkSignal)) framework = "jest";
  else if (/mocha/i.test(frameworkSignal)) framework = "mocha";
  else if (/ava/i.test(frameworkSignal)) framework = "ava";

  // Construct per-file command
  let command: string;
  if (framework === "vitest") {
    command = `npx vitest run ${testFile}`;
  } else if (framework === "jest") {
    command = `npx jest ${testFile}`;
  } else if (testCmd) {
    command = `${testCmd} -- ${testFile}`;
  } else {
    command = `${pkg.commands.packageManager} test -- ${testFile}`;
  }

  const patternDesc = exists
    ? `Test file found at ${testFile}`
    : pattern?.testPattern
      ? `Pattern: ${pattern.testPattern} (test file does not exist yet)`
      : "No test file found";

  return { testFile, exists, framework, command, pattern: patternDesc };
}

// ─── Auto-Register Queries ──────────────────────────────────────────────────

export interface RegistrationInsertions {
  registrationFile: {
    path: string;
    lastImportLine: number;
    importStatement: string;
    registryHintLine?: number;
  } | null;
  barrelFile: {
    path: string;
    lastExportLine: number;
    exportStatement: string;
  } | null;
  exportName: string;
}

export function getRegistrationInsertions(
  analysis: StructuredAnalysis,
  newFilePath: string,
  packagePath?: string,
): RegistrationInsertions {
  const pkg = resolvePackage(analysis, packagePath);
  const dir = newFilePath.replace(/\/[^/]+$/, "");
  const rootDir = analysis.meta?.rootDir ?? ".";

  // Find contribution pattern for this directory (most-specific match)
  const patterns = pkg.contributionPatterns ?? [];
  const pattern = findBestPattern(patterns, newFilePath);

  // For registration: if the most-specific pattern has no registrationFile,
  // walk up to the nearest parent that does (child may inherit parent's registration)
  const regPattern = pattern?.registrationFile
    ? pattern
    : patterns
        .filter(
          (p) =>
            newFilePath.startsWith(p.directory) &&
            p.registrationFile &&
            (!pattern || p.directory.length < pattern.directory.length),
        )
        .sort((a, b) => b.directory.length - a.directory.length)[0];

  // Infer export name from most-specific pattern's suffix
  const fileBase = newFilePath.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  const exportName = pattern?.exportSuffix ? kebabToCamel(fileBase) + pattern.exportSuffix : kebabToCamel(fileBase);

  // Registration file insertions (may come from parent pattern)
  let regResult: RegistrationInsertions["registrationFile"] = null;
  if (regPattern?.registrationFile) {
    const content = safeReadFile(rootDir, regPattern.registrationFile);
    if (content) {
      try {
        const boundary = findImportBoundary(content);
        // If file has no imports, insert at line 1 (top of file)
        const insertLine = boundary.lastImportLine || 1;

        // Compute relative path from registration file to new file
        const regDir = regPattern.registrationFile.replace(/\/[^/]+$/, "");
        let relPath = newFilePath;
        if (newFilePath.startsWith(`${regDir}/`)) {
          relPath = `./${newFilePath.slice(regDir.length + 1)}`;
        } else {
          relPath = `./${newFilePath}`;
        }
        relPath = relPath.replace(/\.tsx?$/, ".js"); // .ts → .js for imports

        regResult = {
          path: regPattern.registrationFile,
          lastImportLine: insertLine,
          importStatement: `import { ${exportName} } from "${relPath}";`,
          registryHintLine: boundary.firstNonImportLine || insertLine + 1,
        };
      } catch {
        /* findImportBoundary failed */
      }
    }
  }

  // Barrel file insertions
  let barrelResult: RegistrationInsertions["barrelFile"] = null;
  const barrelPath = getBarrelFile(analysis, dir, packagePath);
  if (barrelPath) {
    const barrelContent = safeReadFile(rootDir, barrelPath);
    if (barrelContent) {
      const lastExportLine = findLastExportFromLine(barrelContent);
      // Use .ts extension if barrel uses .ts imports (e.g., nitro), else .js
      const useTsExtension = barrelContent.includes('.ts"') || barrelContent.includes(".ts'");
      const moduleRef = `./${fileBase}${useTsExtension ? ".ts" : ".js"}`;

      barrelResult = {
        path: barrelPath,
        lastExportLine: lastExportLine || barrelContent.split("\n").length,
        exportStatement: `export * from "${moduleRef}";`,
      };
    }
  }

  return { registrationFile: regResult, barrelFile: barrelResult, exportName };
}

// ─── Pattern Matching Helper ────────────────────────────────────────────────

/**
 * Find the most-specific contribution pattern matching a file path.
 * Patterns are matched by directory prefix and sorted by specificity (longest first).
 * This avoids the array-order dependency of `.find()` when nested directories
 * both have patterns (e.g., src/adapters/ and src/adapters/llm/).
 */
export function findBestPattern(patterns: ContributionPattern[], filePath: string): ContributionPattern | undefined {
  return patterns
    .filter((p) => filePath.startsWith(p.directory))
    .sort((a, b) => b.directory.length - a.directory.length)[0];
}

// ─── Auto-Register Helpers ──────────────────────────────────────────────────

function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function findImportBoundary(content: string): { lastImportLine: number; firstNonImportLine: number } {
  const sf = ts.createSourceFile("file.ts", content, ts.ScriptTarget.Latest, true);
  let lastImportLine = 0;
  let firstNonImportLine = 0;

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const pos = sf.getLineAndCharacterOfPosition(stmt.getEnd());
      lastImportLine = pos.line + 1; // 1-based
    } else if (lastImportLine > 0 && firstNonImportLine === 0) {
      const pos = sf.getLineAndCharacterOfPosition(stmt.getStart());
      firstNonImportLine = pos.line + 1;
    }
  }

  return { lastImportLine, firstNonImportLine };
}

function findLastExportFromLine(content: string): number {
  const lines = content.split("\n");
  let lastLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/export\s+(?:\*|\{[^}]+\})\s+from\s+["']/.test(lines[i])) {
      lastLine = i + 1; // 1-based
    }
  }
  return lastLine;
}

// ─── Diagnose Queries ───────────────────────────────────────────────────────

// ─── Scoring Functions (Phase 4: continuous weights, bi-modal decay, sigmoid smoothing) ───

/** Bi-modal recency decay: fast initial + slow tail for weekend bugs. */
function recencyScore(hoursAgo: number): number {
  // At 1h: 0.94, 6h: 0.61, 14h: 0.39, 48h: 0.21, 72h: 0.19
  return 0.7 * Math.exp(-0.2 * hoursAgo) + 0.3 * Math.exp(-0.01 * hoursAgo);
}

/** Sigmoid with configurable steepness. k=5 gives a meaningfully smooth transition. */
function sigmoid(value: number, midpoint: number, k = 5): number {
  return 1 / (1 + Math.exp(-k * (value - midpoint)));
}

// Weight interpolation thresholds
const RECENT_RICHNESS_SATURATION = 10; // ≥10 recent files = full recent signal
const COCHANGE_RICHNESS_SATURATION = 20; // ≥20 co-change edges = full co-change signal

/**
 * Continuous weight interpolation based on data richness (replaces 3 discrete configs).
 * Weights sum to ~100 at any data richness level. When recent data is sparse,
 * coupling/dependency absorb the weight. When co-change data is sparse, recency dominates.
 */
function computeWeights(recentFilesCount: number, cochangeEdgesCount: number) {
  const rr = Math.min(recentFilesCount / RECENT_RICHNESS_SATURATION, 1); // 0-1
  const cr = Math.min(cochangeEdgesCount / COCHANGE_RICHNESS_SATURATION, 1); // 0-1
  return {
    missingCoChange: 30 * rr * cr, // only active with both recent changes AND co-change data
    recency: 20 * rr + 10 * (1 - cr) * rr, // absorbs co-change weight when co-change sparse
    coupling: 15 * cr + 20 * (1 - rr) * cr, // absorbs recency weight when recent data sparse
    dependency: 10 + 15 * (1 - rr) * (1 - cr), // baseline + absorbs when both signals sparse
    workflow: 10 + 5 * (1 - cr), // baseline + boost when co-change sparse
    testMapping: 15, // always active — test name convention is high-precision, 0-cost
    directoryLocality: 10, // always active — test/plugins/X → src/plugins/X
  };
}

/**
 * Test-to-source mapping using two complementary signals:
 * 1. Naming convention (high precision): test/foo.test.ts → src/foo.ts identifies test SUBJECT
 * 2. Import graph (broader recall): test imports this candidate — tiebreaker for imports
 *
 * Naming match returns 1.0 (strong), import match returns 0.5 (weaker — test may import many files).
 */
function testToSourceScore(
  testFile: string | null,
  candidateFile: string,
  importByImporter: Map<string, { source: string }[]>,
): number {
  if (!testFile) return 0;

  // Signal 1 (primary): naming convention — "this test is ABOUT this file"
  const stripped = testFile.replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, ".$2").replace(/^(test|__tests__)\//, "src/");
  if (candidateFile === stripped) return 1;

  // Signal 2 (tiebreaker): import graph — "the test uses this file"
  const testImports = importByImporter.get(testFile);
  if (testImports?.some((e) => e.source === candidateFile)) return 0.5;

  return 0;
}

/** Directory locality: test path shares a SPECIFIC component with candidate source path. */
const GENERIC_PATH_PARTS = new Set([
  "test",
  "tests",
  "__tests__",
  "src",
  "lib",
  "dist",
  "build",
  "fixtures",
  "plugins",
  "detectors",
  "handlers",
  "controllers",
  "routes",
  "utils",
  "helpers",
  "core",
  "common",
  "shared",
  "internal",
  "packages",
]);

function directoryLocalityScore(testFile: string | null, candidateFile: string): number {
  if (!testFile) return 0;
  // Extract the most specific non-generic path component from the test file
  // For "test/plugins/astro-sharp-image-service.test.ts" → "astro-sharp-image-service" → try "astro"
  const testBase = testFile.replace(/.*\//, "").replace(/\.(test|spec)\.[^.]+$/, "");
  const candParts = candidateFile.split("/").filter((p) => !p.includes("."));

  // Primary: test base name contains or is contained by a candidate directory
  // "astro-sharp-image-service" contains "astro" → matches src/plugins/astro/
  for (const cp of candParts) {
    if (GENERIC_PATH_PARTS.has(cp)) continue;
    if (testBase.includes(cp) || cp.includes(testBase)) return 1;
  }

  return 0;
}

export type ErrorType = "type" | "reference" | "assertion" | "syntax" | "runtime" | null;

export interface ParsedError {
  files: string[];
  testFile: string | null;
  message: string | null;
  errorType: ErrorType;
}

function classifyErrorType(typeName: string, message: string): ErrorType {
  if (typeName === "TypeError") return "type";
  if (typeName === "ReferenceError") return "reference";
  if (typeName === "SyntaxError") return "syntax";
  if (typeName === "AssertionError" || /assert|expect|toBe|toEqual|toMatch/i.test(message)) return "assertion";
  return "runtime";
}

export interface FileChange {
  file: string;
  hoursAgo: number;
  commitMessage?: string;
  isUncommitted: boolean;
}

export interface Suspect {
  file: string;
  score: number;
  signals: {
    missingCoChange: number;
    recency: number;
    coupling: number;
    dependency: number;
    workflow: number;
    testMapping: number;
    directoryLocality: number;
  };
  callGraphBonus: boolean;
  reason: string;
}

export type DiagnoseConfidence = "high" | "medium" | "low";

export interface DiagnoseResult {
  suspects: Suspect[];
  confidence: DiagnoseConfidence;
  confidenceReason: string;
}

/**
 * Extract file paths, test file, and error message from raw error/stack trace text.
 * Handles V8 stacks, TypeScript compiler errors, Vitest output, and generic patterns.
 */
export function parseErrorText(errorText: string, rootDir?: string): ParsedError {
  const fileSet = new Set<string>();
  let testFile: string | null = null;
  let message: string | null = null;

  // Cap input to prevent DoS from pathologically large error strings
  // Strip ANSI escape codes (terminal colors, bold, etc.)
  const capped = errorText.length > 100_000 ? errorText.slice(0, 100_000) : errorText;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping requires \x1B
  const text = capped.replace(/\x1B\[[0-9;]*m/g, "");

  let errorType: ErrorType = null;
  const msgMatch = text.match(/(TypeError|ReferenceError|AssertionError|SyntaxError|Error):\s*([^\n]+)/);
  if (msgMatch) {
    errorType = classifyErrorType(msgMatch[1], msgMatch[2]);
    message = msgMatch[2].trim();
  }

  for (const line of text.split("\n")) {
    let m: RegExpMatchArray | null;

    // Vitest FAIL header: "FAIL  test/foo.test.ts > ..."
    if ((m = line.match(/FAIL\s+([^\s>]+\.(?:test|spec)\.[jt]sx?)/))) {
      testFile = normalizePath(m[1], rootDir);
      continue;
    }

    // V8 stack: "    at func (file:line:col)" or "    at file:line:col"
    if ((m = line.match(/at\s+(?:.+?\s+\()?([^():\s]+\.[jt]sx?):(\d+):\d+\)?/))) {
      addProjectFile(fileSet, m[1], rootDir);
      continue;
    }

    // TypeScript compiler: "file(line,col): error TSxxxx"
    if ((m = line.match(/^([^\s(]+\.[jt]sx?)\(\d+,\d+\):\s*error\s+TS/))) {
      addProjectFile(fileSet, m[1], rootDir);
      continue;
    }

    // Vitest/Jest: "❯ file:line:col" or "› file:line:col"
    if ((m = line.match(/[❯›]\s+([^\s]+\.[jt]sx?):(\d+):\d+/))) {
      addProjectFile(fileSet, m[1], rootDir);
      continue;
    }

    // Webpack/Vite build error: "ERROR in ./src/foo.ts" or "[vite] Error: ... src/foo.ts"
    if ((m = line.match(/ERROR\s+in\s+\.?\/?([\w/.-]+\.[jt]sx?)/))) {
      addProjectFile(fileSet, m[1], rootDir);
      continue;
    }
    if ((m = line.match(/\[vite\]\s+.*?([\w/.-]+\.[jt]sx?)/))) {
      addProjectFile(fileSet, m[1], rootDir);
      continue;
    }

    // Nested stack trace: "Caused by: ... at file:line:col"
    if ((m = line.match(/[Cc]aused by:.*?([\w/.-]+\.[jt]sx?):(\d+)/))) {
      addProjectFile(fileSet, m[1], rootDir);
      continue;
    }

    // Generic: any relative path with a directory separator, ending in .ts/.js:line
    // Covers app/, pages/, components/, packages/, server/, api/, etc.
    if ((m = line.match(/\b([a-zA-Z][^\s:]*\/[^\s:]+\.[jt]sx?):(\d+)/))) {
      addProjectFile(fileSet, m[1], rootDir);
    }
  }

  return { files: [...fileSet], testFile, message, errorType };
}

/**
 * Query git for recently changed files: uncommitted (hoursAgo=0) + committed (last 7 days).
 * Returns empty array if git is unavailable (shallow clone, no .git, etc.).
 */
export function getRecentFileChanges(rootDir: string): FileChange[] {
  const changes: FileChange[] = [];
  const now = Date.now() / 1000;

  try {
    // Uncommitted: staged + unstaged
    const gitOpts = { cwd: rootDir, encoding: "utf-8" as const, timeout: 5000 };
    const unstaged = execFileSync("git", ["diff", "--name-only"], gitOpts).trim();
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], gitOpts).trim();
    const uncommitted = new Set([...unstaged.split("\n"), ...staged.split("\n")].filter(Boolean));

    for (const file of uncommitted) {
      changes.push({ file, hoursAgo: 0, isUncommitted: true });
    }

    // Committed: last 50 commits within 7 days
    const log = execFileSync(
      "git",
      ["log", "--pretty=format:COMMIT:%H|%at|%s", "--name-only", "-n", "50", "--since", "7 days ago"],
      gitOpts,
    ).trim();

    if (log) {
      const seen = new Set(uncommitted);
      let current: { timestamp: number; message: string } | null = null;

      for (const line of log.split("\n")) {
        if (line.startsWith("COMMIT:")) {
          const rest = line.slice(7); // Strip "COMMIT:" prefix
          const sep1 = rest.indexOf("|");
          const sep2 = rest.indexOf("|", sep1 + 1);
          if (sep1 === -1 || sep2 === -1) continue; // Malformed line
          const ts = Number.parseInt(rest.slice(sep1 + 1, sep2), 10);
          if (Number.isNaN(ts)) continue; // Invalid timestamp
          current = { timestamp: ts, message: rest.slice(sep2 + 1) };
        } else if (line.trim() && current) {
          const file = line.trim();
          if (!seen.has(file)) {
            seen.add(file);
            changes.push({
              file,
              hoursAgo: Math.max(0, (now - current.timestamp) / 3600),
              commitMessage: current.message,
              isUncommitted: false,
            });
          }
        }
      }
    }
  } catch {
    // Git unavailable — return empty (caller falls back to coupling-only)
  }

  return changes.sort((a, b) => a.hoursAgo - b.hoursAgo);
}

/**
 * BFS shortest path on the import graph between two files.
 * Returns path array or null if no path exists. Max depth 10.
 */
export function traceImportChain(
  analysis: StructuredAnalysis,
  from: string,
  to: string,
  packagePath?: string,
): string[] | null {
  const pkg = resolvePackage(analysis, packagePath);
  const chain = pkg.importChain ?? [];

  // Build bidirectional adjacency
  const adj = new Map<string, Set<string>>();
  for (const edge of chain) {
    if (!adj.has(edge.importer)) adj.set(edge.importer, new Set());
    if (!adj.has(edge.source)) adj.set(edge.source, new Set());
    adj.get(edge.importer)!.add(edge.source);
    adj.get(edge.source)!.add(edge.importer);
  }

  const queue: { node: string; path: string[] }[] = [{ node: from, path: [from] }];
  const visited = new Set<string>([from]);

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    if (path.length > 10) continue;

    for (const neighbor of adj.get(node) ?? []) {
      if (neighbor === to) return [...path, to];
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push({ node: neighbor, path: [...path, neighbor] });
    }
  }

  return null;
}

/**
 * Score candidate files using 5 signals with dynamic weights + call graph bonus.
 * Returns top 5 suspects with confidence assessment based on signal quality.
 */
export function buildSuspectList(
  analysis: StructuredAnalysis,
  errorFiles: string[],
  recentChanges: FileChange[],
  packagePath?: string,
  testFile?: string | null,
): DiagnoseResult {
  const pkg = resolvePackage(analysis, packagePath);
  const errorSet = new Set(errorFiles);
  const chain = pkg.importChain ?? [];
  const coChangeEdges = pkg.gitHistory?.coChangeEdges ?? [];
  const callGraph = pkg.callGraph ?? [];
  const workflowRules = analysis.crossPackage?.workflowRules ?? [];

  // Detect unselective imports: does the test file import the package entry point?
  // If so, the import graph floods with candidates — downweight dependency signal.
  const entryPoint = pkg.architecture.entryPoint;
  const testImportsEntryPoint =
    testFile && entryPoint ? chain.some((e) => e.importer === testFile && e.source === entryPoint) : false;

  // Index recent changes by file
  const changeMap = new Map<string, FileChange>();
  for (const c of recentChanges) {
    if (!changeMap.has(c.file)) changeMap.set(c.file, c);
  }
  const changedFiles = new Set(changeMap.keys());

  // 1. Collect candidates with directional awareness:
  //    Upstream (dependencies of error site) are more likely root causes.
  //    Downstream (consumers of error site) are more likely needing updates.
  const upstreamSymbols = new Map<string, number>(); // files error site depends on
  const downstreamSymbols = new Map<string, number>(); // files that depend on error site
  const candidateCoupling = new Map<string, number>(); // file → max Jaccard

  // Index import chain by both importer and source for O(1) lookup
  const importByImporter = new Map<string, typeof chain>();
  const importBySource = new Map<string, typeof chain>();
  for (const edge of chain) {
    let byImp = importByImporter.get(edge.importer);
    if (!byImp) {
      byImp = [];
      importByImporter.set(edge.importer, byImp);
    }
    byImp.push(edge);
    let bySrc = importBySource.get(edge.source);
    if (!bySrc) {
      bySrc = [];
      importBySource.set(edge.source, bySrc);
    }
    bySrc.push(edge);
  }

  // Index co-change edges by both files
  const coChangeByFile = new Map<string, typeof coChangeEdges>();
  for (const edge of coChangeEdges) {
    for (const f of [edge.file1, edge.file2]) {
      let arr = coChangeByFile.get(f);
      if (!arr) {
        arr = [];
        coChangeByFile.set(f, arr);
      }
      arr.push(edge);
    }
  }

  // Multi-hop upstream traversal: BFS through imports up to depth 2
  // Depth 1 = direct dependency (full score), depth 2 = transitive (half score)
  // Depth 3+ floods candidate pool on large repos — diminishing returns
  const MAX_CANDIDATE_DEPTH = 2;
  const visited = new Set(errorFiles);

  let frontier = new Set(errorFiles);
  for (let depth = 1; depth <= MAX_CANDIDATE_DEPTH; depth++) {
    const depthFactor = 1 / depth; // 1.0, 0.5, 0.33
    const nextFrontier = new Set<string>();

    for (const file of frontier) {
      // Upstream: files this node imports FROM
      for (const edge of importByImporter.get(file) ?? []) {
        if (!visited.has(edge.source)) {
          setMax(upstreamSymbols, edge.source, edge.symbolCount * depthFactor);
          nextFrontier.add(edge.source);
        }
      }
      // Downstream: only at depth 1 (direct consumers of error site)
      if (depth === 1) {
        for (const edge of importBySource.get(file) ?? []) {
          if (!visited.has(edge.importer)) {
            setMax(downstreamSymbols, edge.importer, edge.symbolCount);
          }
        }
      }
      // Co-change partners (only at depth 1)
      if (depth === 1) {
        for (const edge of coChangeByFile.get(file) ?? []) {
          const partner = edge.file1 === file ? edge.file2 : edge.file1;
          setMax(candidateCoupling, partner, edge.jaccard);
        }
      }
    }

    for (const f of nextFrontier) visited.add(f);
    frontier = nextFrontier;
  }

  for (const f of errorFiles) {
    if (!upstreamSymbols.has(f) && !downstreamSymbols.has(f) && !candidateCoupling.has(f)) {
      upstreamSymbols.set(f, 0);
    }
  }

  const allCandidates = new Set([...upstreamSymbols.keys(), ...downstreamSymbols.keys(), ...candidateCoupling.keys()]);

  // Directory locality candidate discovery: when test imports entry point (unselective),
  // scan all known files for directory-name matches with the test file.
  // This adds candidates that the import graph can't reach.
  if (testImportsEntryPoint && testFile) {
    const allKnownFiles = new Set<string>();
    for (const edge of chain) {
      allKnownFiles.add(edge.importer);
      allKnownFiles.add(edge.source);
    }
    for (const file of allKnownFiles) {
      if (allCandidates.has(file) || errorSet.has(file)) continue;
      if (directoryLocalityScore(testFile, file) > 0) {
        allCandidates.add(file);
      }
    }
  }

  // 2. Missing co-change: joint sigmoid on both Jaccard AND count
  const missingCoChange = new Map<string, number>();
  const relevant = [...changedFiles].filter((f) => errorSet.has(f) || allCandidates.has(f));

  for (const changedFile of relevant) {
    for (const edge of coChangeEdges) {
      const partner = edge.file1 === changedFile ? edge.file2 : edge.file2 === changedFile ? edge.file1 : null;
      if (!partner || changedFiles.has(partner)) continue;
      // Joint sigmoid: both Jaccard and count must be strong
      const score = sigmoid(edge.jaccard, 0.4, 5) * sigmoid(Math.log(edge.coChangeCount), Math.log(5), 3);
      if (score > 0.05) {
        setMax(missingCoChange, partner, score);
        allCandidates.add(partner);
      }
    }
  }

  // 3. Continuous weight interpolation
  const recentCount = recentChanges.filter((c) => c.hoursAgo < 48).length;
  const w = computeWeights(recentCount, coChangeEdges.length);

  // 4. Score each candidate
  const suspects: Suspect[] = [];

  for (const file of allCandidates) {
    const change = changeMap.get(file);
    const rawCoupling = candidateCoupling.get(file) ?? 0;

    // Directional dependency: upstream gets mild boost only when no recency data
    const upScore = Math.min((upstreamSymbols.get(file) ?? 0) / 10, 1);
    const downScore = Math.min((downstreamSymbols.get(file) ?? 0) / 10, 1);
    const upstreamBoost = recentChanges.length === 0 ? 1.3 : 1.0;
    // When test imports entry point, import graph is unselective — reduce dependency weight
    const selectivityFactor = testImportsEntryPoint ? 0.5 : 1.0;

    const signals = {
      missingCoChange: missingCoChange.get(file) ?? 0,
      recency: change ? recencyScore(change.hoursAgo) : 0,
      coupling: sigmoid(rawCoupling, 0.2, 5),
      dependency: Math.max(upScore * upstreamBoost, downScore) * selectivityFactor,
      workflow: workflowRules.some((r) => r.trigger.includes(file) || r.action.includes(file)) ? 1.0 : 0,
      testMapping: testToSourceScore(testFile ?? null, file, importByImporter),
      directoryLocality: directoryLocalityScore(testFile ?? null, file),
    };

    let score =
      w.missingCoChange * signals.missingCoChange +
      w.recency * signals.recency +
      w.coupling * signals.coupling +
      w.dependency * signals.dependency +
      w.workflow * signals.workflow +
      w.testMapping * signals.testMapping +
      w.directoryLocality * signals.directoryLocality;

    // Call graph bonus: 1.5x if call edge exists, but NOT for the error site itself
    const callGraphBonus =
      !errorSet.has(file) &&
      callGraph.some(
        (e) => (e.fromFile === file && errorSet.has(e.toFile)) || (e.toFile === file && errorSet.has(e.fromFile)),
      );
    if (callGraphBonus) score *= 1.5;

    // Build human-readable reason
    const reasons: string[] = [];
    if (signals.testMapping > 0) {
      reasons.push("directly imported by failing test");
    }
    if (signals.missingCoChange > 0) {
      reasons.push(`Missing co-change: expected to change but wasn't updated`);
    }
    if (signals.recency > 0.1 && change) {
      const ago = change.isUncommitted ? "uncommitted changes" : `changed ${formatHoursAgo(change.hoursAgo)}`;
      reasons.push(ago + (change.commitMessage ? `: "${change.commitMessage}"` : ""));
    }
    if (signals.coupling > 0.1) {
      reasons.push(`${Math.round(rawCoupling * 100)}% co-change coupling`);
    }
    if (signals.dependency > 0) {
      const isUpstream = (upstreamSymbols.get(file) ?? 0) > 0;
      const symCount = Math.max(upstreamSymbols.get(file) ?? 0, downstreamSymbols.get(file) ?? 0);
      reasons.push(`${symCount} symbols ${isUpstream ? "(dependency of" : "(depends on"} error site)`);
    }
    if (signals.directoryLocality > 0) {
      reasons.push("directory matches test name");
    }
    if (callGraphBonus) {
      reasons.push("call graph connection (1.5x)");
    }
    if (reasons.length === 0) reasons.push("related via import or co-change graph");

    suspects.push({
      file,
      score: Math.round(score),
      signals,
      callGraphBonus,
      reason: reasons.join("; "),
    });
  }

  const ranked = suspects
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return assessConfidence(ranked, {
    hasRecentChanges: recentChanges.length > 0,
    hasCoChangeData: coChangeEdges.length > 0,
    hasCallGraph: callGraph.length > 0,
    testHasDirectImport: testFile ? (importByImporter.get(testFile)?.length ?? 0) > 0 : false,
    testImportsEntryPoint,
    candidatePoolSize: allCandidates.size,
  });
}

/**
 * Assess confidence based on signal quality — not the suspects themselves.
 * High: multiple independent signals available, top suspect strongly differentiated.
 * Medium: some signals available, moderate differentiation.
 * Low: thin signal (no co-change, test doesn't import sources, large candidate pool).
 */
function assessConfidence(
  suspects: Suspect[],
  signals: {
    hasRecentChanges: boolean;
    hasCoChangeData: boolean;
    hasCallGraph: boolean;
    testHasDirectImport: boolean;
    testImportsEntryPoint: boolean;
    candidatePoolSize: number;
  },
): DiagnoseResult {
  if (suspects.length === 0) {
    return { suspects, confidence: "low", confidenceReason: "No suspects found" };
  }

  // Count how many independent signal sources are available
  let signalCount = 0;
  if (signals.hasRecentChanges) signalCount++;
  if (signals.hasCoChangeData) signalCount++;
  if (signals.hasCallGraph) signalCount++;
  if (signals.testHasDirectImport) signalCount++;

  // Score discrimination: how much does #1 stand out from #2?
  const topScore = suspects[0].score;
  const secondScore = suspects.length > 1 ? suspects[1].score : 0;
  const discrimination = secondScore > 0 ? topScore / secondScore : topScore > 0 ? 10 : 0;

  // Large candidate pool with low discrimination = noisy
  const isNoisy = signals.candidatePoolSize > 20 && discrimination < 1.5;

  let confidence: DiagnoseConfidence;
  let confidenceReason: string;

  if (signalCount >= 3 && discrimination >= 1.5 && !isNoisy) {
    confidence = "high";
    confidenceReason = `${signalCount} independent signals, clear top suspect`;
  } else if (signalCount >= 2 || (signalCount >= 1 && discrimination >= 2)) {
    confidence = "medium";
    confidenceReason = `${signalCount} signal${signalCount === 1 ? "" : "s"}, ${discrimination >= 1.5 ? "moderate" : "weak"} differentiation`;
  } else {
    confidence = "low";
    const reasons: string[] = [];
    if (signals.testImportsEntryPoint) reasons.push("test imports package entry point (integration test pattern)");
    else if (!signals.testHasDirectImport) reasons.push("test doesn't directly import source modules");
    if (!signals.hasCoChangeData) reasons.push("no co-change history available");
    if (isNoisy) reasons.push(`${signals.candidatePoolSize} candidates with similar scores`);
    confidenceReason = reasons.length > 0 ? reasons.join("; ") : "limited signal available";
  }

  return { suspects, confidence, confidenceReason };
}

// ─── Diagnose Helpers ───────────────────────────────────────────────────────

function normalizePath(raw: string, rootDir?: string): string {
  let p = raw.trim();
  if (rootDir && p.startsWith(rootDir)) {
    p = p.slice(rootDir.length).replace(/^\//, "");
  }
  return p.replace(/^\.\//, "");
}

function addProjectFile(files: Set<string>, raw: string, rootDir?: string): void {
  if (raw.includes("node_modules") || raw.startsWith("node:") || raw.startsWith("internal/")) return;
  const normalized = normalizePath(raw, rootDir);
  if (/\.[jt]sx?$/.test(normalized)) files.add(normalized);
}

/** Read a file only if it's within rootDir (prevents path traversal). */
function safeReadFile(rootDir: string, filePath: string): string | null {
  const absPath = resolve(rootDir, filePath);
  if (relative(rootDir, absPath).startsWith("..")) return null;
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

function setMax(map: Map<string, number>, key: string, value: number): void {
  if (value > (map.get(key) ?? -1)) map.set(key, value);
}

function formatHoursAgo(hours: number): string {
  if (hours < 1) return "minutes ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
