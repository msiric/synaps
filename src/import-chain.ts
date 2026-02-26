// src/import-chain.ts — Compute file-to-file import coupling and generate workflow rules
// Answers: "When I modify file X, what other files do I need to check?"
// Captures the SymbolGraph's import graph before it's discarded.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { resolveModuleSpecifier } from "./symbol-graph.js";
import type { FileImportEdge, SymbolGraph, Warning, WorkflowRule } from "./types.js";
import { discoverWorkspacePackages, readWorkspaceGlobs } from "./workspace-resolver.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MIN_SYMBOLS = 1; // Track all import edges for MCP tools (analyze_impact, plan_change)
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
  const relativeCache = new Map<string, string | undefined>(); // Keyed on specifier+fromDir
  const aliasCache = new Map<string, string | undefined>(); // Keyed on specifier only (dir-independent)
  const workspaceEntries = buildWorkspaceMap(packageDir);

  for (const [importerFile, imports] of symbolGraph.importGraph) {
    // Group imported symbols by resolved source file
    const symbolsBySource = new Map<string, Set<string>>();
    const fromDir = dirname(resolve(packageDir, importerFile));

    for (const imp of imports) {
      if (imp.importedNames.length === 0) continue; // Skip bare imports

      let sourceFile: string | undefined;
      if (imp.moduleSpecifier.startsWith(".")) {
        // Relative imports: resolution depends on fromDir
        const cacheKey = `${imp.moduleSpecifier}\0${fromDir}`;
        sourceFile = relativeCache.get(cacheKey);
        if (sourceFile === undefined && !relativeCache.has(cacheKey)) {
          sourceFile = resolveModuleSpecifier(imp.moduleSpecifier, fromDir, packageDir, warnings);
          relativeCache.set(cacheKey, sourceFile);
        }
      } else if (workspaceEntries.length > 0) {
        // Workspace aliases: resolution is dir-independent
        sourceFile = aliasCache.get(imp.moduleSpecifier);
        if (sourceFile === undefined && !aliasCache.has(imp.moduleSpecifier)) {
          sourceFile = resolveWorkspaceAlias(imp.moduleSpecifier, workspaceEntries, packageDir);
          aliasCache.set(imp.moduleSpecifier, sourceFile);
        }
      }
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

// ─── Workspace Alias Resolution ──────────────────────────────────────────────

interface WorkspacePackageInfo {
  dir: string; // Relative to packageDir
  main?: string; // main/module entry point from package.json
  exports?: Record<string, string>; // Simple subpath exports (string values only)
}

/** Pre-sorted workspace entries (longest name first) for efficient alias matching. */
type SortedWorkspaceEntries = [string, WorkspacePackageInfo][];

/**
 * Build a sorted list of workspace packages from actual workspace globs.
 * Returns entries sorted by name length descending (longest match first).
 */
function buildWorkspaceMap(packageDir: string): SortedWorkspaceEntries {
  const globs = readWorkspaceGlobs(packageDir);
  if (globs.length === 0) return [];

  const entries: [string, WorkspacePackageInfo][] = [];
  const dirs = discoverWorkspacePackages(packageDir, globs);

  for (const dir of dirs) {
    try {
      const pkgJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      if (typeof pkgJson.name !== "string") continue;

      // Extract simple string exports (skip conditional objects for v1)
      let exports: Record<string, string> | undefined;
      if (pkgJson.exports && typeof pkgJson.exports === "object" && !Array.isArray(pkgJson.exports)) {
        const simple: Record<string, string> = {};
        for (const [key, value] of Object.entries(pkgJson.exports)) {
          if (typeof value === "string") simple[key] = value;
        }
        if (Object.keys(simple).length > 0) exports = simple;
      }

      // Extract main/module entry point for package root imports
      const main =
        typeof pkgJson.main === "string"
          ? pkgJson.main
          : typeof pkgJson.module === "string"
            ? pkgJson.module
            : undefined;

      entries.push([pkgJson.name, { dir: relative(packageDir, dir), main, exports }]);
    } catch {
      /* invalid package.json */
    }
  }

  // Sort once: longest name first (so "@calcom/features/ee" matches before "@calcom/features")
  return entries.sort((a, b) => b[0].length - a[0].length);
}

/**
 * Resolve a workspace alias to a repo-relative file path.
 * Handles: exports field, main/module, .js→.ts mapping, /index.ts fallback.
 */
function resolveWorkspaceAlias(
  specifier: string,
  sortedEntries: SortedWorkspaceEntries,
  packageDir: string,
): string | undefined {
  // Entries are pre-sorted longest first — first match is most specific
  for (const [pkgName, pkg] of sortedEntries) {
    if (specifier !== pkgName && !specifier.startsWith(`${pkgName}/`)) continue;

    const subpath = specifier === pkgName ? "" : specifier.slice(pkgName.length + 1);
    const exportKey = subpath ? `./${subpath}` : ".";

    // 1. Try exports field first
    if (pkg.exports?.[exportKey]) {
      const target = pkg.exports[exportKey].replace(/^\.\//, "");
      const candidate = join(pkg.dir, target);
      if (existsSync(join(packageDir, candidate))) return candidate;
    }

    // 2. For package root imports, try main/module field
    if (!subpath && pkg.main) {
      const mainPath = join(pkg.dir, pkg.main.replace(/^\.\//, ""));
      const resolved = resolveFileWithExtensions(mainPath, packageDir);
      if (resolved) return resolved;
    }

    // 3. Resolve via filesystem with full extension logic
    const basePath = subpath ? join(pkg.dir, subpath) : pkg.dir;
    const resolved = resolveFileWithExtensions(basePath, packageDir);
    if (resolved) return resolved;
  }

  return undefined;
}

/**
 * Try to resolve a base path to an actual file, matching resolveModuleSpecifier's logic.
 * Handles: .js→.ts, .jsx→.tsx, extensionless→.ts/.tsx/index.ts/index.tsx.
 */
function resolveFileWithExtensions(basePath: string, packageDir: string): string | undefined {
  const candidates: string[] = [];

  if (basePath.endsWith(".js")) {
    candidates.push(basePath.replace(/\.js$/, ".ts"), basePath.replace(/\.js$/, ".tsx"), basePath);
  } else if (basePath.endsWith(".jsx")) {
    candidates.push(basePath.replace(/\.jsx$/, ".tsx"), basePath);
  } else if (basePath.endsWith(".ts") || basePath.endsWith(".tsx")) {
    candidates.push(basePath);
  } else {
    // Extensionless — try all
    candidates.push(
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}/index.ts`,
      `${basePath}/index.tsx`,
      `${basePath}.js`,
      `${basePath}.jsx`,
    );
  }

  for (const candidate of candidates) {
    if (existsSync(join(packageDir, candidate))) return candidate;
  }
  return undefined;
}

// ─── Workflow Rule Generation ────────────────────────────────────────────────

/**
 * Generate "when modifying X → check Y, Z, W" workflow rules from import chain data.
 * Groups by source file: if types.ts has 8 high-coupling importers, one rule covers all.
 */
const HIGH_COUPLING_SYMBOLS = 5; // Only high-coupling edges generate workflow rules

export function generateImportChainRules(
  importChain: FileImportEdge[],
  minDependents: number = DEFAULT_MIN_DEPENDENTS,
  maxRules: number = DEFAULT_MAX_RULES,
): WorkflowRule[] {
  if (importChain.length === 0) return [];

  // Filter to high-coupling edges for rule generation (≥5 symbols)
  const highCoupling = importChain.filter((e) => e.symbolCount >= HIGH_COUPLING_SYMBOLS);

  // Group edges by source file
  const bySource = new Map<string, FileImportEdge[]>();
  for (const edge of highCoupling) {
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

    const importerList = topImporters.map((e) => `\`${e.importer}\` (${e.symbolCount} symbols)`).join(", ");

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
