// src/mcp/queries.ts — Data access layer over StructuredAnalysis
// Isolates tool handlers from analysis schema internals.
// When analysis types change, update here — not in every tool handler.

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

export function getWorkflowRules(analysis: StructuredAnalysis): WorkflowRule[] {
  return analysis.crossPackage?.workflowRules ?? [];
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

export function getConventions(
  analysis: StructuredAnalysis,
  packagePath?: string,
): { conventions: Convention[]; antiPatterns: AntiPattern[] } {
  const pkg = resolvePackage(analysis, packagePath);
  // Filter to non-style conventions (architecture patterns, not naming/formatting)
  const conventions = (pkg.conventions ?? []).filter(c =>
    c.category !== "file-naming" || (c.confidence.percentage >= 95),
  );
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

export { computeInferabilityScore } from "../inferability.js";
export type { InferabilityScore } from "../inferability.js";
