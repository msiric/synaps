// src/analysis-builder.ts — Module 9: Structured Analysis Builder
// Errata applied: E-31 (publicAPI computed before arch detector),
//                 E-32 (importCount per public symbol), E-13 (cap publicAPI)

import { readFileSync, existsSync } from "node:fs";
import { resolve, join, basename, dirname, extname, relative } from "node:path";
import type {
  ParsedFile,
  SymbolGraph,
  TierInfo,
  Convention,
  CommandSet,
  PackageArchitecture,
  PackageAnalysis,
  PublicAPIEntry,
  FileInventory,
  DependencySummary,
  StructuredAnalysis,
  CrossPackageAnalysis,
  ResolvedConfig,
  PublicConfig,
  Warning,
  AnalysisMeta,
} from "./types.js";
import { ENGINE_VERSION } from "./types.js";

/**
 * E-31: Compute publicAPI from barrel exports. Called BEFORE Architecture Detector.
 */
export function buildPublicAPI(
  symbolGraph: SymbolGraph,
  parsedFiles: ParsedFile[],
  maxEntries: number,
  warnings: Warning[],
): PublicAPIEntry[] {
  // Fix B: Build a set of files that import from React (for hook classification)
  const fileMap = new Map<string, ParsedFile>();
  for (const pf of parsedFiles) {
    fileMap.set(pf.relativePath, pf);
  }
  const REACT_MODULES = new Set(["react", "react-dom", "preact", "preact/hooks", "preact/compat"]);

  const entries: PublicAPIEntry[] = symbolGraph.barrelExports.map((exp) => {
    let kind = exp.kind;
    // Ensure hook classification — Fix B: only if source file imports React
    if (
      (kind === "function" || kind === "unknown") &&
      exp.name.startsWith("use") &&
      exp.name.length > 3 &&
      exp.name[3] === exp.name[3].toUpperCase()
    ) {
      const sourceFile = fileMap.get(exp.definedIn);
      const hasReactImport = sourceFile?.imports.some(
        (imp) => REACT_MODULES.has(imp.moduleSpecifier),
      ) ?? false;
      kind = hasReactImport ? "hook" : "function";
    }

    return {
      name: exp.name,
      kind,
      sourceFile: exp.definedIn,
      signature: exp.signature,
      isTypeOnly: exp.isTypeOnly,
      description: exp.jsDocComment,
      importCount: 0, // E-32: will be computed below
    };
  });

  // E-32: Compute importCount per public symbol
  for (const entry of entries) {
    let count = 0;
    for (const pf of parsedFiles) {
      for (const imp of pf.imports) {
        if (imp.importedNames.includes(entry.name)) {
          count++;
        }
      }
    }
    entry.importCount = count;
  }

  // E-13 + Fix C: Cap publicAPI entries with multi-criteria ranking
  if (entries.length > maxEntries) {
    entries.sort(comparePublicAPIEntries);
    warnings.push({
      level: "info",
      module: "analysis-builder",
      message: `Public API truncated: showing top ${maxEntries} of ${entries.length} exports`,
    });
    return entries.slice(0, maxEntries);
  }

  return entries;
}

/**
 * Fix C: Kind priority for export cap ranking.
 * Higher priority kinds sort first.
 */
const KIND_PRIORITY: Record<string, number> = {
  hook: 0,
  function: 1,
  component: 2,
  class: 3,
  enum: 4,
  const: 5,
  type: 6,
  interface: 7,
  namespace: 8,
  unknown: 9,
};

function comparePublicAPIEntries(a: PublicAPIEntry, b: PublicAPIEntry): number {
  // (a) Kind priority: hooks first, types last
  const kindDiff = (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9);
  if (kindDiff !== 0) return kindDiff;
  // (b) Import count descending within same kind
  const importDiff = (b.importCount ?? 0) - (a.importCount ?? 0);
  if (importDiff !== 0) return importDiff;
  // (c) Alphabetical tiebreaker
  return a.name.localeCompare(b.name);
}

/**
 * Walk up from analysisDir to find nearest package.json with a name field.
 * Stops at rootDir boundary or filesystem root.
 */
function resolvePackageMetadata(
  analysisDir: string,
  rootDir?: string,
): { name: string; version: string; description: string } {
  const absDir = resolve(analysisDir);
  // Only walk up if rootDir is provided (monorepo context).
  // Without rootDir, we don't know the boundary and could pick up unrelated package.json.
  const stopAt = rootDir ? resolve(rootDir) : absDir;
  let dir = absDir;

  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name) {
          return {
            name: pkg.name,
            version: pkg.version ?? "0.0.0",
            description: pkg.description ?? "",
          };
        }
      } catch {
        // Skip unparseable
      }
    }

    // Stop at root dir boundary
    if (dir === stopAt) break;

    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Last resort: use the analysis directory name, but filter out meaningless names
  const dirName = basename(resolve(analysisDir));
  const MEANINGLESS_NAMES = new Set(["src", "lib", "dist", "app", "packages", "core", "main"]);
  if (MEANINGLESS_NAMES.has(dirName)) {
    const parentName = basename(dirname(resolve(analysisDir)));
    return { name: parentName, version: "0.0.0", description: "" };
  }

  return { name: dirName, version: "0.0.0", description: "" };
}

/**
 * Build a complete PackageAnalysis from all module outputs.
 */
export function buildPackageAnalysis(
  packageDir: string,
  rootDir: string | undefined,
  parsedFiles: ParsedFile[],
  symbolGraph: SymbolGraph,
  tiers: Map<string, TierInfo>,
  conventions: Convention[],
  commands: CommandSet,
  architecture: PackageArchitecture,
  publicAPI: PublicAPIEntry[],
  warnings: Warning[],
): PackageAnalysis {
  const absPackageDir = resolve(packageDir);
  const absRootDir = rootDir ? resolve(rootDir) : absPackageDir;

  // Resolve package metadata by walking up to nearest package.json with a name
  const meta = resolvePackageMetadata(packageDir, rootDir);
  let name = meta.name;
  let version = meta.version;
  let description = meta.description;

  // Build FileInventory
  const files = buildFileInventory(parsedFiles, tiers);

  // Build DependencySummary
  const dependencies = buildDependencies(parsedFiles, name);

  // Empty publicAPI warning
  if (publicAPI.length === 0) {
    warnings.push({
      level: "info",
      module: "analysis-builder",
      message: "No public API detected — package may not have a barrel file or may export nothing.",
    });
  }

  return {
    name,
    version,
    description,
    relativePath: relative(absRootDir, absPackageDir) || ".",
    files,
    publicAPI,
    conventions,
    commands,
    architecture,
    dependencies,
    role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
    antiPatterns: [],
    contributionPatterns: [],
  };
}

function buildFileInventory(
  parsedFiles: ParsedFile[],
  tiers: Map<string, TierInfo>,
): FileInventory {
  const tier1Files: string[] = [];
  const tier2Files: string[] = [];
  let t1Lines = 0, t2Lines = 0, t3Lines = 0, t3Count = 0;
  const byExtension: Record<string, number> = {};

  for (const pf of parsedFiles) {
    const tier = tiers.get(pf.relativePath);
    const ext = extname(pf.relativePath);
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;

    if (tier?.tier === 1) {
      tier1Files.push(pf.relativePath);
      t1Lines += pf.lineCount;
    } else if (tier?.tier === 2) {
      tier2Files.push(pf.relativePath);
      t2Lines += pf.lineCount;
    } else {
      t3Count++;
      t3Lines += pf.lineCount;
    }
  }

  return {
    total: parsedFiles.length,
    byTier: {
      tier1: { count: tier1Files.length, lines: t1Lines, files: tier1Files },
      tier2: { count: tier2Files.length, lines: t2Lines, files: tier2Files },
      tier3: { count: t3Count, lines: t3Lines },
    },
    byExtension,
  };
}

function buildDependencies(
  parsedFiles: ParsedFile[],
  packageName: string,
): DependencySummary {
  const internal = new Set<string>();
  const externalCounts = new Map<string, number>();

  // Detect org scope from package name
  const scope = packageName.startsWith("@")
    ? packageName.split("/")[0]
    : null;

  for (const pf of parsedFiles) {
    for (const imp of pf.imports) {
      if (imp.moduleSpecifier.startsWith(".")) continue; // relative
      if (imp.isDynamic) continue;

      if (scope && imp.moduleSpecifier.startsWith(scope + "/")) {
        internal.add(imp.moduleSpecifier);
      } else if (imp.moduleSpecifier.startsWith("@")) {
        const pkg = imp.moduleSpecifier.split("/").slice(0, 2).join("/");
        externalCounts.set(pkg, (externalCounts.get(pkg) ?? 0) + 1);
      } else {
        const pkg = imp.moduleSpecifier.split("/")[0];
        externalCounts.set(pkg, (externalCounts.get(pkg) ?? 0) + 1);
      }
    }
  }

  const external = [...externalCounts.entries()]
    .map(([name, importCount]) => ({ name, importCount }))
    .sort((a, b) => b.importCount - a.importCount);

  return {
    internal: [...internal].sort(),
    external,
    totalUniqueDependencies: internal.size + externalCounts.size,
  };
}

/**
 * Build the final StructuredAnalysis object.
 */
export function buildStructuredAnalysis(
  packages: PackageAnalysis[],
  crossPackage: CrossPackageAnalysis | undefined,
  config: ResolvedConfig,
  warnings: Warning[],
  startTime: number,
): StructuredAnalysis {
  const publicConfig: PublicConfig = {
    ...config,
    llm: {
      provider: config.llm.provider,
      model: config.llm.model,
      baseUrl: config.llm.baseUrl,
      maxOutputTokens: config.llm.maxOutputTokens,
    },
  };

  const meta: AnalysisMeta = {
    engineVersion: ENGINE_VERSION,
    analyzedAt: new Date().toISOString(),
    rootDir: config.rootDir ?? config.packages[0] ?? ".",
    config: publicConfig,
    timingMs: Math.round(performance.now() - startTime),
  };

  return {
    meta,
    packages,
    crossPackage,
    warnings,
  };
}
