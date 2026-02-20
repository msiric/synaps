// src/import-chain.ts — Compute file-to-file import coupling and generate workflow rules
// Answers: "When I modify file X, what other files do I need to check?"
// Captures the SymbolGraph's import graph before it's discarded.

import { dirname, resolve } from "node:path";
import type { SymbolGraph, FileImportEdge, WorkflowRule, Warning } from "./types.js";
import { resolveModuleSpecifier } from "./symbol-graph.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MIN_SYMBOLS = 5;
const DEFAULT_MIN_DEPENDENTS = 3;
const DEFAULT_MAX_RULES = 5;
const MAX_DISPLAY_SYMBOLS = 5;
const MAX_DISPLAY_IMPORTERS = 3;

// ─── Import Chain Computation ────────────────────────────────────────────────

/**
 * Compute file-to-file import coupling from the SymbolGraph's import graph.
 * Returns edges where a file imports ≥minSymbols symbols from another file.
 * Must be called before the SymbolGraph is discarded.
 */
export function computeImportChain(
  symbolGraph: SymbolGraph,
  packageDir: string,
  warnings: Warning[],
  minSymbols: number = DEFAULT_MIN_SYMBOLS,
): FileImportEdge[] {
  const edges: FileImportEdge[] = [];

  for (const [importerFile, imports] of symbolGraph.importGraph) {
    // Group imported symbols by resolved source file
    const symbolsBySource = new Map<string, Set<string>>();

    for (const imp of imports) {
      if (!imp.moduleSpecifier.startsWith(".")) continue; // Skip external
      if (imp.importedNames.length === 0) continue; // Skip bare imports

      const sourceFile = resolveModuleSpecifier(
        imp.moduleSpecifier,
        dirname(resolve(packageDir, importerFile)),
        packageDir,
        warnings,
      );
      if (!sourceFile) continue;
      if (sourceFile === importerFile) continue; // Skip self-imports

      const symbols = symbolsBySource.get(sourceFile) ?? new Set();
      for (const name of imp.importedNames) {
        // Skip namespace imports (e.g., "* as foo")
        if (!name.startsWith("*")) symbols.add(name);
      }
      symbolsBySource.set(sourceFile, symbols);
    }

    // Keep only high-coupling pairs
    for (const [sourceFile, symbols] of symbolsBySource) {
      if (symbols.size >= minSymbols) {
        edges.push({
          importer: importerFile,
          source: sourceFile,
          symbolCount: symbols.size,
          symbols: [...symbols].slice(0, MAX_DISPLAY_SYMBOLS),
        });
      }
    }
  }

  return edges.sort((a, b) => b.symbolCount - a.symbolCount);
}

// ─── Workflow Rule Generation ────────────────────────────────────────────────

/**
 * Generate "when modifying X → check Y, Z, W" workflow rules from import chain data.
 * Groups by source file: if types.ts has 8 high-coupling importers, one rule covers all.
 */
export function generateImportChainRules(
  importChain: FileImportEdge[],
  minDependents: number = DEFAULT_MIN_DEPENDENTS,
  maxRules: number = DEFAULT_MAX_RULES,
): WorkflowRule[] {
  if (importChain.length === 0) return [];

  // Group edges by source file
  const bySource = new Map<string, FileImportEdge[]>();
  for (const edge of importChain) {
    const list = bySource.get(edge.source) ?? [];
    list.push(edge);
    bySource.set(edge.source, list);
  }

  // Sort source files by total number of high-coupling dependents
  const sorted = [...bySource.entries()]
    .filter(([, edges]) => edges.length >= minDependents)
    .sort((a, b) => b[1].length - a[1].length);

  const rules: WorkflowRule[] = [];

  for (const [sourceFile, edges] of sorted.slice(0, maxRules)) {
    // Sort importers by symbol count descending
    const sortedEdges = edges.sort((a, b) => b.symbolCount - a.symbolCount);
    const topImporters = sortedEdges.slice(0, MAX_DISPLAY_IMPORTERS);
    const remaining = sortedEdges.length - MAX_DISPLAY_IMPORTERS;

    const importerList = topImporters
      .map((e) => `\`${e.importer}\` (${e.symbolCount} symbols)`)
      .join(", ");

    const moreText = remaining > 0 ? `, and ${remaining} more` : "";

    rules.push({
      trigger: `When modifying \`${sourceFile}\``,
      action: `Also check: ${importerList}${moreText}`,
      source: `Import chain analysis — ${edges.length} files have high coupling to this module`,
      impact: "high",
    });
  }

  return rules;
}
