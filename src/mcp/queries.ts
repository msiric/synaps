// src/mcp/queries.ts — Data access layer over StructuredAnalysis
// Isolates tool handlers from analysis schema internals.
// When analysis types change, update here — not in every tool handler.

import { existsSync } from "node:fs";
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
  // Check if index.ts or index.tsx exists in this directory
  const allFiles = [
    ...pkg.files.byTier.tier1.files,
    ...pkg.files.byTier.tier2.files,
  ];
  for (const barrel of [`${dir}/index.ts`, `${dir}/index.tsx`]) {
    if (allFiles.includes(barrel)) return barrel;
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
  const baseName = sourceFilePath.replace(/\.[^.]+$/, "");
  const ext = sourceFilePath.slice(sourceFilePath.lastIndexOf("."));

  // 1. Try contribution pattern's testPattern
  const patterns = pkg.contributionPatterns ?? [];
  const pattern = patterns.find(p =>
    sourceFilePath.startsWith(p.directory) || dir.includes(p.directory),
  );

  // 2. Candidate test paths (in priority order)
  const candidates = [
    `${baseName}.test${ext}`,                    // Co-located: foo.test.ts
    `${baseName}.spec${ext}`,                    // Co-located: foo.spec.ts
    `test/${sourceFilePath.replace(/^src\//, "")}`.replace(/\.[^.]+$/, `.test${ext}`), // test/ mirror
  ];

  // 3. Check which exists — test files are often in tier3 (no file list),
  // so fall back to existsSync against the repo root
  const rootDir = analysis.meta?.rootDir;
  let testFile: string | null = null;
  let exists = false;
  for (const candidate of candidates) {
    if (rootDir && existsSync(resolve(rootDir, candidate))) {
      testFile = candidate;
      exists = true;
      break;
    }
  }
  // If none found on disk, suggest the first candidate
  if (!testFile) testFile = candidates[0];

  // 4. Detect framework from test command + dependencies
  const testCmd = pkg.commands.test?.run ?? "";
  const testSource = pkg.commands.test?.source ?? "";
  const testFrameworkDep = pkg.dependencyInsights?.testFramework?.name ?? "";
  const frameworkSignal = `${testCmd} ${testSource} ${testFrameworkDep}`.toLowerCase();
  let framework = "unknown";
  if (/vitest/i.test(frameworkSignal)) framework = "vitest";
  else if (/jest/i.test(frameworkSignal)) framework = "jest";
  else if (/mocha/i.test(frameworkSignal)) framework = "mocha";
  else if (/ava/i.test(frameworkSignal)) framework = "ava";

  // 5. Construct per-file command
  const pm = pkg.commands.packageManager;
  let command: string;
  if (framework === "vitest") {
    command = `npx vitest run ${testFile}`;
  } else if (framework === "jest") {
    command = `npx jest ${testFile}`;
  } else if (testCmd) {
    command = `${testCmd} -- ${testFile}`;
  } else {
    command = `${pm} test -- ${testFile}`;
  }

  const patternDesc = pattern?.testPattern
    ? `Pattern: ${pattern.testPattern}`
    : exists
      ? "Co-located test file"
      : "No test pattern detected";

  return { testFile, exists, framework, command, pattern: patternDesc };
}

export { computeInferabilityScore } from "../inferability.js";
export type { InferabilityScore } from "../inferability.js";
