// src/mermaid-generator.ts — W5-C3: Mermaid Diagram Generator
// Generates Mermaid graph TD diagrams from dependency graphs.
// Color-coded by package type. Included in cross-package analysis output.

import type { PackageAnalysis, PackageDependency } from "./types.js";

/**
 * Generate a Mermaid dependency diagram from packages and their dependency graph.
 * Only generates for multi-package analysis (>1 package).
 */
export function generateDependencyDiagram(
  packages: PackageAnalysis[],
  dependencyGraph: PackageDependency[],
): string {
  if (dependencyGraph.length === 0 || packages.length < 2) {
    return "";
  }

  const lines: string[] = ["```mermaid", "graph TD"];

  // Emit edges
  for (const edge of dependencyGraph) {
    const from = sanitizeId(edge.from);
    const to = sanitizeId(edge.to);
    lines.push(`  ${from}["${shortName(edge.from)}"] --> ${to}["${shortName(edge.to)}"]`);
  }

  // Color-code by package type
  for (const pkg of packages) {
    const id = sanitizeId(pkg.name);
    const color = packageTypeColor(pkg.architecture.packageType);
    if (color) {
      lines.push(`  style ${id} fill:${color}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Sanitize a package name into a valid Mermaid node ID.
 */
function sanitizeId(name: string): string {
  return name
    .replace(/^@[^/]+\//, "") // Strip scope
    .replace(/[^a-zA-Z0-9]/g, "_"); // Replace non-alphanum with underscore
}

/**
 * Shorten a package name for display (strip scope).
 */
function shortName(name: string): string {
  return name.replace(/^@[^/]+\//, "");
}

/**
 * Map package type to a Mermaid fill color.
 */
function packageTypeColor(
  packageType: string,
): string | null {
  switch (packageType) {
    case "hooks": return "#e1f5fe";
    case "react-components": return "#f3e5f5";
    case "api-server": return "#e8f5e9";
    case "web-application": return "#fff3e0";
    case "library": return "#f5f5f5";
    case "cli": return "#e0f2f1";
    case "server": return "#e8f5e9";
    default: return null;
  }
}
