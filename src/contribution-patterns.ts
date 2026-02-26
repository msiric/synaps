// src/contribution-patterns.ts — Contribution Pattern Detection
// Detects "how to add new code" patterns from existing directory structure.
// Deep patterns: analyzes common imports, export naming, and registration files.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ContributionPattern, DirectoryInfo, ParsedFile, PublicAPIEntry, TierInfo } from "./types.js";

const COMMON_IMPORT_THRESHOLD = 0.8; // ≥80% of siblings must share the import
const MAX_COMMON_IMPORT_SYMBOLS = 5;

/**
 * Detect contribution patterns from the analyzed package structure.
 * Examines T1 and T2 files (not just T1) to surface internal patterns like detectors.
 */
export function detectContributionPatterns(
  parsedFiles: ParsedFile[],
  publicAPI: PublicAPIEntry[],
  tiers: Map<string, TierInfo>,
  directories: DirectoryInfo[],
  barrelFile: string | undefined,
  packageDir?: string,
): ContributionPattern[] {
  const patterns: ContributionPattern[] = [];

  // Group T1 and T2 files by directory (skip T3: test/generated)
  const filesByDir = new Map<string, ParsedFile[]>();
  for (const pf of parsedFiles) {
    const tier = tiers.get(pf.relativePath);
    if (!tier || tier.tier === 3) continue;
    if (pf.isTestFile || pf.isGeneratedFile) continue;

    const dir = findParentDir(pf.relativePath, directories);
    if (!dir) continue;

    const existing = filesByDir.get(dir.path) ?? [];
    existing.push(pf);
    filesByDir.set(dir.path, existing);
  }

  for (const [dirPath, files] of filesByDir) {
    if (files.length < 3) continue;

    const dirInfo = directories.find((d) => d.path === dirPath);
    if (!dirInfo) continue;

    // Skip workspace-level directories that are containers for sub-packages,
    // not containers for source files. These produce useless patterns like
    // "add a function to packages/" which is nonsensical.
    // Exception: if the directory has its own package.json, it IS a package — not a container.
    const isOwnPackage = packageDir && existsSync(join(packageDir, dirPath, "package.json"));
    if (!isOwnPackage) {
      const dirDepth = dirPath.split("/").filter(Boolean).length;
      const deepFiles = files.filter((f) => {
        const fileDepth = f.relativePath.split("/").filter(Boolean).length;
        return fileDepth > dirDepth + 2;
      });
      if (deepFiles.length > files.length * 0.5) continue;
    }

    // Dominant export kind
    const kindCounts = new Map<string, number>();
    for (const pf of files) {
      for (const exp of pf.exports) {
        if (exp.isTypeOnly) continue;
        const kind = exp.kind === "unknown" ? "function" : exp.kind;
        kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
      }
    }
    let dominantKind = "function";
    let maxCount = 0;
    for (const [kind, count] of kindCounts) {
      if (count > maxCount) {
        dominantKind = kind;
        maxCount = count;
      }
    }

    const filePattern = dirInfo.pattern ?? detectSimplePattern(files, dominantKind);
    if (!filePattern) continue;

    // Co-located tests
    const testFiles = parsedFiles.filter((pf) => pf.isTestFile && pf.relativePath.startsWith(`${dirPath}/`));
    const hasCoLocatedTests = testFiles.length >= Math.floor(files.length / 2);
    let testPattern: string | undefined;
    if (hasCoLocatedTests && testFiles.length > 0) {
      testPattern = filePattern.replace(/(\.[a-z]+)$/, ".test$1");
    }

    // Best example file
    const dirExports = publicAPI.filter((e) => e.sourceFile.startsWith(`${dirPath}/`));
    const bestExport = dirExports.reduce(
      (best, exp) => ((exp.importCount ?? 0) > (best?.importCount ?? 0) ? exp : best),
      dirExports[0],
    );
    const exampleFile = bestExport?.sourceFile ?? files[0].relativePath;

    // ─── Deep pattern analysis ───────────────────────────────────────────

    // Common imports (≥80% of siblings share this import)
    const commonImports = detectCommonImports(files);

    // Export naming suffix (e.g., all exports end with "Detector")
    const exportSuffix = detectExportSuffix(files);

    // Registration file (external file that imports most exports from this directory)
    const registrationFile = detectRegistrationFile(files, dirPath, parsedFiles);

    // ─── Build steps ─────────────────────────────────────────────────────

    const steps: string[] = [];
    steps.push(`Create \`${filePattern}\` in \`${dirPath}/\``);

    // Deep: common imports
    for (const imp of commonImports) {
      const symbolList = imp.symbols.join(", ");
      steps.push(`Import \`${symbolList}\` from \`${imp.specifier}\` (${imp.coverage}/${files.length} siblings)`);
    }

    // Deep: export naming convention
    if (exportSuffix) {
      steps.push(`Export as \`{name}${exportSuffix}\` (naming convention)`);
    }

    // Deep: registration
    if (registrationFile) {
      steps.push(`Register in \`${registrationFile}\``);
    }

    if (testPattern) {
      steps.push(`Create co-located test file \`${testPattern}\``);
    }
    if (barrelFile) {
      steps.push(`Add re-export to \`${barrelFile}\``);
    }

    patterns.push({
      type: dominantKind,
      directory: `${dirPath}/`,
      filePattern,
      testPattern,
      exampleFile,
      steps,
      commonImports: commonImports.length > 0 ? commonImports : undefined,
      exportSuffix: exportSuffix || undefined,
      registrationFile: registrationFile || undefined,
    });
  }

  return patterns;
}

// ─── Deep Pattern Helpers ────────────────────────────────────────────────────

/**
 * Find relative imports that ≥80% of sibling files share.
 */
function detectCommonImports(files: ParsedFile[]): { specifier: string; symbols: string[]; coverage: number }[] {
  const importCounts = new Map<string, { count: number; names: Set<string> }>();

  for (const pf of files) {
    // Track which specifiers this file imports (deduplicate per file)
    const seenSpecifiers = new Set<string>();
    for (const imp of pf.imports) {
      if (!imp.moduleSpecifier.startsWith(".")) continue;
      const key = imp.moduleSpecifier;
      if (seenSpecifiers.has(key)) continue;
      seenSpecifiers.add(key);

      const entry = importCounts.get(key) ?? { count: 0, names: new Set() };
      entry.count++;
      for (const name of imp.importedNames) {
        if (!name.startsWith("*")) entry.names.add(name);
      }
      importCounts.set(key, entry);
    }
  }

  const threshold = Math.ceil(files.length * COMMON_IMPORT_THRESHOLD);
  return [...importCounts.entries()]
    .filter(([, v]) => v.count >= threshold)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([specifier, v]) => ({
      specifier,
      symbols: [...v.names].slice(0, MAX_COMMON_IMPORT_SYMBOLS),
      coverage: v.count,
    }));
}

/**
 * Find a common suffix in export names (e.g., "Detector", "Template").
 * Returns the suffix if ≥80% of non-type exports share it.
 */
function detectExportSuffix(files: ParsedFile[]): string | null {
  const exportNames = files.flatMap((f) =>
    f.exports.filter((e) => !e.isTypeOnly && e.name !== "default").map((e) => e.name),
  );
  if (exportNames.length < 3) return null;

  // Try common suffixes from longest to shortest
  const suffixCounts = new Map<string, number>();
  for (const name of exportNames) {
    // Extract potential suffixes (last capitalized word)
    const match = name.match(/[A-Z][a-z]+$/);
    if (match) {
      const suffix = match[0];
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    }
  }

  const threshold = Math.ceil(exportNames.length * COMMON_IMPORT_THRESHOLD);
  for (const [suffix, count] of [...suffixCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if (count >= threshold && suffix.length >= 3) {
      return suffix;
    }
  }

  return null;
}

/**
 * Find a file outside this directory that imports most of the directory's exports.
 * This is the "registration file" — where new items need to be added.
 */
function detectRegistrationFile(dirFiles: ParsedFile[], dirPath: string, allFiles: ParsedFile[]): string | null {
  // Collect all non-type export names from the directory
  const dirExportNames = new Set<string>();
  for (const pf of dirFiles) {
    for (const exp of pf.exports) {
      if (!exp.isTypeOnly && exp.name !== "default" && exp.name !== "*") {
        dirExportNames.add(exp.name);
      }
    }
  }
  if (dirExportNames.size < 3) return null;

  // Find external files that import from this directory
  let bestFile: string | null = null;
  let bestCount = 0;

  for (const pf of allFiles) {
    if (pf.relativePath.startsWith(`${dirPath}/`)) continue; // Skip files IN the directory
    if (pf.isTestFile || pf.isGeneratedFile) continue;

    let matchCount = 0;
    for (const imp of pf.imports) {
      for (const name of imp.importedNames) {
        if (dirExportNames.has(name)) matchCount++;
      }
    }

    if (matchCount > bestCount) {
      bestCount = matchCount;
      bestFile = pf.relativePath;
    }
  }

  // Only report if the registration file references ≥50% of exports
  if (bestFile && bestCount >= dirExportNames.size * 0.5) {
    return bestFile;
  }

  return null;
}

// ─── Basic Helpers ───────────────────────────────────────────────────────────

function findParentDir(filePath: string, directories: DirectoryInfo[]): DirectoryInfo | undefined {
  let best: DirectoryInfo | undefined;
  for (const dir of directories) {
    if (filePath.startsWith(`${dir.path}/`)) {
      if (!best || dir.path.length > best.path.length) {
        best = dir;
      }
    }
  }
  return best;
}

function detectSimplePattern(files: ParsedFile[], kind: string): string | undefined {
  const names = files
    .map((f) => {
      const parts = f.relativePath.split("/");
      return parts[parts.length - 1];
    })
    .filter((n) => !n.startsWith("index."));

  if (names.length < 3) return undefined;

  const extCounts = new Map<string, number>();
  for (const name of names) {
    const match = name.match(/\.(tsx?|jsx?)$/);
    if (match) {
      extCounts.set(`.${match[1]}`, (extCounts.get(`.${match[1]}`) ?? 0) + 1);
    }
  }
  let ext = ".ts";
  let maxExtCount = 0;
  for (const [e, c] of extCounts) {
    if (c > maxExtCount) {
      ext = e;
      maxExtCount = c;
    }
  }

  switch (kind) {
    case "hook":
      return `use-{feature}${ext}`;
    case "component":
      return `{ComponentName}${ext}`;
    default:
      return `{name}${ext}`;
  }
}
