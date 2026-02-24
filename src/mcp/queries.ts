// src/mcp/queries.ts — Data access layer over StructuredAnalysis
// Isolates tool handlers from analysis schema internals.
// When analysis types change, update here — not in every tool handler.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  StructuredAnalysis,
  PackageAnalysis,
  CommandSet,
  PackageArchitecture,
  FileImportEdge,
  CallGraphEdge,
  CoChangeEdge,
  WorkflowRule,
  ContributionPattern,
  PublicAPIEntry,
  Convention,
  AntiPattern,
} from "../types.js";
import { ToolError } from "./errors.js";
import { computeImpactRadius } from "../impact-radius.js";

// ─── Package Resolution ──────────────────────────────────────────────────────

export function resolvePackage(
  analysis: StructuredAnalysis,
  packagePath?: string,
): PackageAnalysis {
  if (!packagePath) {
    if (analysis.packages.length === 1) return analysis.packages[0];
    throw new ToolError(
      "AMBIGUOUS_PACKAGE",
      `Multiple packages found. Specify packagePath.`,
      [
        "Call list_packages to see all packages",
        `Available: ${analysis.packages.map(p => p.name).join(", ")}`,
      ],
    );
  }
  const pkg = analysis.packages.find(
    p => p.relativePath === packagePath || p.name === packagePath,
  );
  if (!pkg) {
    throw new ToolError(
      "PACKAGE_NOT_FOUND",
      `Package '${packagePath}' not found.`,
      [
        `Available: ${analysis.packages.map(p => p.name).join(", ")}`,
        "Call list_packages for full details",
      ],
    );
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
  return chain
    .filter(e => e.source === filePath)
    .sort((a, b) => b.symbolCount - a.symbolCount);
}

export function getCallersForFunction(
  analysis: StructuredAnalysis,
  functionName: string,
  packagePath?: string,
): { directCallers: CallGraphEdge[]; transitiveCount: number } {
  const pkg = resolvePackage(analysis, packagePath);
  const callGraph = pkg.callGraph ?? [];

  const directCallers = callGraph.filter(e => e.to === functionName);

  // Compute transitive caller count via impact radius
  const impact = computeImpactRadius(callGraph);
  const entry = impact.highImpact.find(e => e.functionName === functionName)
    ?? impact.complex.find(e => e.functionName === functionName);

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
  return edges
    .filter(e => e.file1 === filePath || e.file2 === filePath)
    .sort((a, b) => b.jaccard - a.jaccard);
}

export function getWorkflowRules(
  analysis: StructuredAnalysis,
  filePath?: string,
): WorkflowRule[] {
  const rules = analysis.crossPackage?.workflowRules ?? [];
  if (!filePath) return rules;
  return rules.filter(r =>
    r.trigger.includes(filePath) || r.action.includes(filePath),
  );
}

export function getContributionPatterns(
  analysis: StructuredAnalysis,
  packagePath?: string,
  directory?: string,
): ContributionPattern[] {
  const pkg = resolvePackage(analysis, packagePath);
  const patterns = pkg.contributionPatterns ?? [];
  if (directory) {
    return patterns.filter(p => p.directory === directory || p.directory.includes(directory));
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
    exports = exports.filter(e => e.name.toLowerCase().includes(q));
  }
  return exports.slice(0, limit);
}

export function getExampleForExport(
  analysis: StructuredAnalysis,
  exportName: string,
  packagePath?: string,
): { snippet: string; testFile: string } | null {
  const pkg = resolvePackage(analysis, packagePath);
  const example = (pkg.examples ?? []).find(e => e.exportName === exportName);
  if (!example) return null;
  return { snippet: example.snippet, testFile: example.testFile };
}

export function getFingerprintForExport(
  analysis: StructuredAnalysis,
  exportName: string,
  packagePath?: string,
): { parameterShape: string; returnShape: string } | null {
  const pkg = resolvePackage(analysis, packagePath);
  const fp = (pkg.patternFingerprints ?? []).find(f => f.exportName === exportName);
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
  let conventions = (pkg.conventions ?? []).filter(c =>
    c.category !== "file-naming" || (c.confidence.percentage >= 95),
  );
  if (category) {
    conventions = conventions.filter(c => c.category === category);
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
  return analysis.packages.map(p => ({
    name: p.name,
    path: p.relativePath,
    type: p.architecture.packageType,
    entryPoint: p.architecture.entryPoint,
    fileCount: p.files.total,
  }));
}

export function getTechStackSummary(
  analysis: StructuredAnalysis,
  packagePath?: string,
): string {
  const pkg = resolvePackage(analysis, packagePath);
  const parts: string[] = [];
  const insights = pkg.dependencyInsights;
  if (insights) {
    if (insights.runtime.length > 0) {
      parts.push(insights.runtime.map(r => `${r.name} ${r.version}`).join(", "));
    }
    if (insights.frameworks.length > 0) {
      parts.push(insights.frameworks.map(f => `${f.name} ${f.version}`).join(", "));
    }
    if (insights.testFramework) {
      parts.push(`${insights.testFramework.name} ${insights.testFramework.version}`);
    }
  }
  return parts.join(" | ") || "TypeScript";
}

// ─── Plan Change / Test Info Queries ────────────────────────────────────────

export function getBarrelFile(
  analysis: StructuredAnalysis,
  directory: string,
  packagePath?: string,
): string | null {
  const pkg = resolvePackage(analysis, packagePath);
  const dir = directory.replace(/\/$/, "");
  const rootDir = analysis.meta?.rootDir;
  // Check if index.ts or index.tsx exists AND actually contains re-exports
  // (index.ts files that are entry points, not barrels, should be skipped)
  const allFiles = [
    ...pkg.files.byTier.tier1.files,
    ...pkg.files.byTier.tier2.files,
  ];
  for (const barrelPath of [`${dir}/index.ts`, `${dir}/index.tsx`]) {
    if (!allFiles.includes(barrelPath)) continue;
    // Verify it has re-export statements
    if (rootDir) {
      try {
        const content = readFileSync(resolve(rootDir, barrelPath), "utf-8");
        if (/export\s+(?:\*|\{[^}]+\})\s+from\s+["']/.test(content)) {
          return barrelPath;
        }
      } catch { /* can't read — skip */ }
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

  // Find contribution pattern for export suffix
  const patterns = pkg.contributionPatterns ?? [];
  const pattern = patterns.find(p =>
    sourceFilePath.startsWith(p.directory) || dir.includes(p.directory),
  );

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
    const suffix = pattern.exportSuffix.replace(/^[A-Z]/, c => c.toLowerCase());
    candidates.push(
      `test/${fileBase}-${suffix}.test${ext}`,
      `test/${fileBase}-${suffix}.spec${ext}`,
    );
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
    testFile = sourceFilePath.startsWith("src/")
      ? `test/${strippedBase}.test${ext}`
      : `${dir}/${fileBase}.test${ext}`;
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

  // Find contribution pattern for this directory
  const patterns = pkg.contributionPatterns ?? [];
  const pattern = patterns.find(p =>
    newFilePath.startsWith(p.directory) || dir.includes(p.directory),
  );

  // Infer export name from filename + pattern suffix
  const fileBase = newFilePath.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  const exportName = pattern?.exportSuffix
    ? kebabToCamel(fileBase) + pattern.exportSuffix
    : kebabToCamel(fileBase);

  // Registration file insertions
  let regResult: RegistrationInsertions["registrationFile"] = null;
  if (pattern?.registrationFile) {
    const regPath = resolve(rootDir, pattern.registrationFile);
    try {
      const content = readFileSync(regPath, "utf-8");
      const { lastImportLine, firstNonImportLine } = findImportBoundary(content);

      // Compute relative path from registration file to new file
      const regDir = pattern.registrationFile.replace(/\/[^/]+$/, "");
      let relPath = newFilePath;
      if (newFilePath.startsWith(regDir + "/")) {
        relPath = "./" + newFilePath.slice(regDir.length + 1);
      } else {
        relPath = "./" + newFilePath;
      }
      relPath = relPath.replace(/\.tsx?$/, ".js"); // .ts → .js for imports

      regResult = {
        path: pattern.registrationFile,
        lastImportLine,
        importStatement: `import { ${exportName} } from "${relPath}";`,
        registryHintLine: firstNonImportLine,
      };
    } catch { /* registration file not readable */ }
  }

  // Barrel file insertions
  let barrelResult: RegistrationInsertions["barrelFile"] = null;
  const barrelPath = getBarrelFile(analysis, dir, packagePath);
  if (barrelPath) {
    try {
      const content = readFileSync(resolve(rootDir, barrelPath), "utf-8");
      const lastExportLine = findLastExportFromLine(content);
      // Use .ts extension if barrel uses .ts imports (e.g., nitro), else .js
      const useTsExtension = content.includes('.ts"') || content.includes(".ts'");
      const moduleRef = "./" + fileBase + (useTsExtension ? ".ts" : ".js");

      barrelResult = {
        path: barrelPath,
        lastExportLine: lastExportLine || content.split("\n").length, // Append at end if no prior exports
        exportStatement: `export * from "${moduleRef}";`,
      };
    } catch { /* barrel file not readable */ }
  }

  return { registrationFile: regResult, barrelFile: barrelResult, exportName };
}

// ─── Auto-Register Helpers ──────────────────────────────────────────────────

function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function findImportBoundary(content: string): { lastImportLine: number; firstNonImportLine: number } {
  const ts = require("typescript") as typeof import("typescript");
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

export { computeInferabilityScore } from "../inferability.js";
export type { InferabilityScore } from "../inferability.js";
