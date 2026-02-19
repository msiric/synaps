// src/symbol-graph.ts — Module 3: Symbol Graph Builder
// Errata applied: E-22 (exports field resolution), E-23 (cycle detection),
//                 E-24 (star re-export expansion), E-25 (aliased exports),
//                 E-9 (barrelFile field), E-20 (.js→.ts mapping), E-21 (path boundary)

import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, dirname, join } from "node:path";
import type {
  ParsedFile,
  ExportEntry,
  ImportEntry,
  SymbolGraph,
  ResolvedExport,
  CallGraphEdge,
  Warning,
} from "./types.js";

/**
 * Build a package-level symbol graph from parsed files.
 * Resolves barrel re-exports to their source definitions.
 */
export function buildSymbolGraph(
  parsedFiles: ParsedFile[],
  packageDir: string,
  warnings: Warning[] = [],
): SymbolGraph {
  const absPackageDir = resolve(packageDir);

  // Build lookups
  const fileMap = new Map<string, ParsedFile>();
  const allExports = new Map<string, ExportEntry[]>();
  const importGraph = new Map<string, import("./types.js").ImportEntry[]>();

  for (const pf of parsedFiles) {
    fileMap.set(pf.relativePath, pf);
    allExports.set(pf.relativePath, pf.exports);
    importGraph.set(pf.relativePath, pf.imports);
  }

  // Find barrel file (E-9, E-22)
  const barrelFile = findBarrelFile(absPackageDir, fileMap, warnings);

  if (!barrelFile) {
    // Fix A: Try bin entry files as alternative entry points for CLI packages
    const binExports = extractBinEntryExports(absPackageDir, fileMap, allExports, importGraph, warnings);
    if (binExports.length > 0) {
      const binSourceFiles = new Set<string>();
      for (const exp of binExports) {
        binSourceFiles.add(exp.definedIn);
      }
      return {
        barrelFile: undefined,
        barrelExports: binExports,
        allExports,
        importGraph,
        barrelSourceFiles: binSourceFiles,
        callGraph: buildCallGraph(parsedFiles, absPackageDir, warnings),
      };
    }

    warnings.push({
      level: "info",
      module: "symbol-graph",
      message: "No barrel file found — publicAPI will be empty.",
    });
    return {
      barrelFile: undefined,
      barrelExports: [],
      allExports,
      importGraph,
      barrelSourceFiles: new Set(),
      callGraph: buildCallGraph(parsedFiles, absPackageDir, warnings),
    };
  }

  const barrelParsed = fileMap.get(barrelFile);
  if (!barrelParsed) {
    warnings.push({
      level: "warn",
      module: "symbol-graph",
      message: `Barrel file ${barrelFile} found but not in parsed files.`,
    });
    return {
      barrelFile,
      barrelExports: [],
      allExports,
      importGraph,
      barrelSourceFiles: new Set(),
      callGraph: buildCallGraph(parsedFiles, absPackageDir, warnings),
    };
  }

  // Resolve barrel exports
  const barrelSourceFiles = new Set<string>();
  barrelSourceFiles.add(barrelFile);

  const barrelExports: ResolvedExport[] = [];

  for (const exp of barrelParsed.exports) {
    if (exp.name === "*" && exp.isReExport && exp.reExportSource) {
      // E-24: Star re-export expansion
      const targetRelPath = resolveModuleSpecifier(
        exp.reExportSource,
        dirname(resolve(absPackageDir, barrelFile)),
        absPackageDir,
        warnings,
      );
      if (targetRelPath) {
        barrelSourceFiles.add(targetRelPath);
        expandStarExport(
          targetRelPath,
          fileMap,
          absPackageDir,
          barrelExports,
          barrelSourceFiles,
          warnings,
          new Set([barrelFile]),
          exp.isTypeOnly,
        );
      } else {
        warnings.push({
          level: "warn",
          module: "symbol-graph",
          message: `Unresolved star re-export from "${exp.reExportSource}" in ${barrelFile}`,
          file: barrelFile,
        });
      }
    } else if (exp.isReExport && exp.reExportSource) {
      // Named re-export
      const resolved = resolveReExportChain(
        exp,
        barrelFile,
        fileMap,
        absPackageDir,
        barrelSourceFiles,
        warnings,
        new Set(),
      );
      barrelExports.push(resolved);
    } else {
      // Direct export from barrel
      barrelExports.push({ ...exp, definedIn: barrelFile });
    }
  }

  // Fix A: If barrel was found but exports nothing, try bin detection or barrel-as-script fallback
  if (barrelExports.length === 0) {
    // First try bin entry points
    const binExports = extractBinEntryExports(absPackageDir, fileMap, allExports, importGraph, warnings);
    if (binExports.length > 0) {
      for (const exp of binExports) {
        barrelSourceFiles.add(exp.definedIn);
      }
      return {
        barrelFile,
        barrelExports: binExports,
        allExports,
        importGraph,
        barrelSourceFiles,
        callGraph: buildCallGraph(parsedFiles, absPackageDir, warnings),
      };
    }

    // Fallback: barrel is a script (no exports) — extract from its imports one level deep
    const scriptExports = extractScriptEntryExports(barrelFile, fileMap, absPackageDir, warnings);
    if (scriptExports.length > 0) {
      for (const exp of scriptExports) {
        barrelSourceFiles.add(exp.definedIn);
      }
      return {
        barrelFile,
        barrelExports: scriptExports,
        allExports,
        importGraph,
        barrelSourceFiles,
        callGraph: buildCallGraph(parsedFiles, absPackageDir, warnings),
      };
    }
  }

  return {
    barrelFile,
    barrelExports,
    allExports,
    importGraph,
    barrelSourceFiles,
    callGraph: buildCallGraph(parsedFiles, absPackageDir, warnings),
  };
}

/**
 * Find the barrel file. Search order per E-22:
 * 1. index.ts at package root
 * 2. index.tsx at package root
 * 3. package.json exports field (E-22)
 * 4. package.json main field
 * 5. package.json module field
 * 6. src/index.ts
 * 7. src/index.tsx
 */
function findBarrelFile(
  packageDir: string,
  fileMap: Map<string, ParsedFile>,
  warnings: Warning[],
): string | undefined {
  // 1-2: index.ts/tsx at root
  if (fileMap.has("index.ts")) return "index.ts";
  if (fileMap.has("index.tsx")) return "index.tsx";

  // 3-5: package.json fields
  const pkgJsonPath = join(packageDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

      // E-22: exports field resolution
      const exportsEntry = resolveExportsField(pkgJson.exports, packageDir);
      if (exportsEntry) {
        const rel = relative(packageDir, exportsEntry);
        if (fileMap.has(rel)) return rel;
      }

      // main field
      if (pkgJson.main) {
        const mainRel = resolveToSource(pkgJson.main, packageDir);
        if (mainRel && fileMap.has(mainRel)) return mainRel;
      }

      // module field
      if (pkgJson.module) {
        const moduleRel = resolveToSource(pkgJson.module, packageDir);
        if (moduleRel && fileMap.has(moduleRel)) return moduleRel;
      }
    } catch {
      // Invalid package.json — skip
    }
  }

  // 6-7: src/index.ts/tsx
  if (fileMap.has("src/index.ts")) return "src/index.ts";
  if (fileMap.has("src/index.tsx")) return "src/index.tsx";

  return undefined;
}

/**
 * E-22: Resolve package.json exports field to a source file path.
 */
function resolveExportsField(
  exports: unknown,
  packageDir: string,
): string | undefined {
  if (!exports) return undefined;

  // String shorthand: "exports": "./src/index.ts"
  if (typeof exports === "string") {
    return resolveExportPath(exports, packageDir);
  }

  if (typeof exports !== "object" || exports === null) return undefined;

  const exportsObj = exports as Record<string, unknown>;

  // Subpath "." entry
  const dotEntry = exportsObj["."];
  if (dotEntry) {
    if (typeof dotEntry === "string") {
      return resolveExportPath(dotEntry, packageDir);
    }
    // Conditional map
    if (typeof dotEntry === "object" && dotEntry !== null) {
      const conditions = dotEntry as Record<string, unknown>;
      // Prefer types, then import, then require
      for (const key of ["types", "import", "require", "default"]) {
        if (typeof conditions[key] === "string") {
          return resolveExportPath(conditions[key] as string, packageDir);
        }
      }
    }
  }

  return undefined;
}

function resolveExportPath(
  exportPath: string,
  packageDir: string,
): string | undefined {
  const absPath = resolve(packageDir, exportPath);
  // E-20: If it points to .js, try .ts/.tsx
  if (existsSync(absPath)) return absPath;
  if (exportPath.endsWith(".js")) {
    const tsPath = resolve(packageDir, exportPath.replace(/\.js$/, ".ts"));
    if (existsSync(tsPath)) return tsPath;
    const tsxPath = resolve(packageDir, exportPath.replace(/\.js$/, ".tsx"));
    if (existsSync(tsxPath)) return tsxPath;
  }
  if (exportPath.endsWith(".jsx")) {
    const tsxPath = resolve(packageDir, exportPath.replace(/\.jsx$/, ".tsx"));
    if (existsSync(tsxPath)) return tsxPath;
  }
  return undefined;
}

/**
 * Resolve a relative source path (from main/module fields) to a real source file.
 */
function resolveToSource(
  filePath: string,
  packageDir: string,
): string | undefined {
  const resolved = resolveExportPath(filePath, packageDir);
  if (resolved) return relative(packageDir, resolved);

  // Try with extensions
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = resolve(packageDir, filePath.replace(/\.[jt]sx?$/, "") + ext);
    if (existsSync(candidate)) return relative(packageDir, candidate);
  }

  // Try extensionless
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = resolve(packageDir, filePath + ext);
    if (existsSync(candidate)) return relative(packageDir, candidate);
  }

  return undefined;
}

/**
 * Resolve a module specifier (relative path) to a relative file path within the package.
 * E-20: Handles .js→.ts mapping. E-21: Checks path boundary.
 */
export function resolveModuleSpecifier(
  specifier: string,
  fromDir: string,
  packageDir: string,
  warnings: Warning[],
): string | undefined {
  if (!specifier.startsWith(".")) return undefined; // External module

  // E-20: .js → .ts mapping
  const candidates: string[] = [];

  if (specifier.endsWith(".js")) {
    candidates.push(specifier.replace(/\.js$/, ".ts"));
    candidates.push(specifier.replace(/\.js$/, ".tsx"));
    candidates.push(specifier); // try original .js
  } else if (specifier.endsWith(".jsx")) {
    candidates.push(specifier.replace(/\.jsx$/, ".tsx"));
    candidates.push(specifier); // try original .jsx
  } else if (specifier.endsWith(".ts") || specifier.endsWith(".tsx")) {
    candidates.push(specifier);
  } else {
    // Extensionless — try adding extensions
    candidates.push(specifier + ".ts");
    candidates.push(specifier + ".tsx");
    candidates.push(specifier + "/index.ts");
    candidates.push(specifier + "/index.tsx");
    candidates.push(specifier + ".js");
    candidates.push(specifier + ".jsx");
  }

  for (const candidate of candidates) {
    const absPath = resolve(fromDir, candidate);

    // E-21: Path traversal boundary check — use relative() to avoid prefix collision
    // (startsWith("/foo/bar") would wrongly match "/foo/barroom/baz")
    const relToPackage = relative(resolve(packageDir), absPath);
    if (relToPackage.startsWith("..")) {
      warnings.push({
        level: "warn",
        module: "symbol-graph",
        message: `Import "${specifier}" resolves outside package boundary — skipped`,
      });
      return undefined;
    }

    if (existsSync(absPath)) {
      return relative(packageDir, absPath);
    }
  }

  return undefined;
}

/**
 * E-24: Expand a star re-export by enumerating all named exports from target file.
 */
function expandStarExport(
  targetRelPath: string,
  fileMap: Map<string, ParsedFile>,
  packageDir: string,
  results: ResolvedExport[],
  barrelSourceFiles: Set<string>,
  warnings: Warning[],
  visited: Set<string>,
  isTypeOnly: boolean,
): void {
  if (visited.has(targetRelPath)) {
    warnings.push({
      level: "warn",
      module: "symbol-graph",
      message: `Circular re-export detected involving ${targetRelPath}`,
      file: targetRelPath,
    });
    return;
  }
  visited.add(targetRelPath);

  const targetParsed = fileMap.get(targetRelPath);
  if (!targetParsed) return;

  for (const exp of targetParsed.exports) {
    if (exp.name === "default") continue; // Star re-export excludes default

    if (exp.name === "*" && exp.isReExport && exp.reExportSource) {
      // Nested star re-export — recurse
      const nestedTarget = resolveModuleSpecifier(
        exp.reExportSource,
        dirname(resolve(packageDir, targetRelPath)),
        packageDir,
        warnings,
      );
      if (nestedTarget) {
        barrelSourceFiles.add(nestedTarget);
        expandStarExport(
          nestedTarget,
          fileMap,
          packageDir,
          results,
          barrelSourceFiles,
          warnings,
          visited,
          isTypeOnly || exp.isTypeOnly,
        );
      }
    } else if (exp.isReExport && exp.reExportSource) {
      // Named re-export from target — resolve further
      const resolved = resolveReExportChain(
        exp,
        targetRelPath,
        fileMap,
        packageDir,
        barrelSourceFiles,
        warnings,
        new Set(visited),
      );
      results.push({
        ...resolved,
        isTypeOnly: isTypeOnly || resolved.isTypeOnly,
      });
    } else {
      // Direct export from target file
      results.push({
        ...exp,
        isTypeOnly: isTypeOnly || exp.isTypeOnly,
        definedIn: targetRelPath,
      });
    }
  }
}

/**
 * E-23: Resolve a named re-export chain with cycle detection.
 * E-25: Handles aliased exports (localName).
 */
function resolveReExportChain(
  exp: ExportEntry,
  fromFile: string,
  fileMap: Map<string, ParsedFile>,
  packageDir: string,
  barrelSourceFiles: Set<string>,
  warnings: Warning[],
  visited: Set<string>,
): ResolvedExport {
  if (!exp.reExportSource) {
    return { ...exp, definedIn: fromFile };
  }

  // E-23: Cycle detection
  const key = `${fromFile}::${exp.name}`;
  if (visited.has(key)) {
    warnings.push({
      level: "warn",
      module: "symbol-graph",
      message: `Circular re-export chain detected for "${exp.name}" at ${fromFile}`,
      file: fromFile,
    });
    return { ...exp, definedIn: "circular", kind: "unknown" };
  }
  visited.add(key);

  const fromDir = dirname(resolve(packageDir, fromFile));
  const targetRelPath = resolveModuleSpecifier(
    exp.reExportSource,
    fromDir,
    packageDir,
    warnings,
  );

  if (!targetRelPath) {
    warnings.push({
      level: "warn",
      module: "symbol-graph",
      message: `Unresolved re-export "${exp.name}" from "${exp.reExportSource}" in ${fromFile}`,
      file: fromFile,
    });
    return { ...exp, definedIn: "unresolved", kind: "unknown" };
  }

  barrelSourceFiles.add(targetRelPath);
  const targetParsed = fileMap.get(targetRelPath);

  if (!targetParsed) {
    return { ...exp, definedIn: "unresolved", kind: "unknown" };
  }

  // E-25: Look up using localName if available (aliased export)
  const lookupName = exp.localName ?? exp.name;

  // Find matching export in target file
  const targetExport = targetParsed.exports.find(
    (e) => e.name === lookupName || e.name === exp.name,
  );

  if (!targetExport) {
    // Maybe the target re-exports it further — check star exports
    const starReExport = targetParsed.exports.find(
      (e) => e.name === "*" && e.isReExport,
    );
    if (starReExport && starReExport.reExportSource) {
      // Follow the star re-export
      return resolveReExportChain(
        { ...exp, reExportSource: starReExport.reExportSource },
        targetRelPath,
        fileMap,
        packageDir,
        barrelSourceFiles,
        warnings,
        visited,
      );
    }

    return { ...exp, definedIn: targetRelPath, kind: "unknown" };
  }

  // If target also re-exports, follow the chain
  if (targetExport.isReExport && targetExport.reExportSource) {
    return resolveReExportChain(
      { ...exp, ...targetExport, name: exp.name, localName: exp.localName },
      targetRelPath,
      fileMap,
      packageDir,
      barrelSourceFiles,
      warnings,
      visited,
    );
  }

  // Found the definition — merge kind, signature, JSDoc
  return {
    name: exp.name,
    localName: exp.localName,
    kind: targetExport.kind,
    isReExport: true,
    isTypeOnly: exp.isTypeOnly || targetExport.isTypeOnly,
    signature: targetExport.signature,
    jsDocComment: targetExport.jsDocComment,
    definedIn: targetRelPath,
  };
}

/**
 * Fix A: Extract exports from a script-style entry point (barrel with no exports).
 * Follows the script's internal imports one level deep to find the real API.
 */
function extractScriptEntryExports(
  entryFile: string,
  fileMap: Map<string, ParsedFile>,
  packageDir: string,
  warnings: Warning[],
): ResolvedExport[] {
  const entryParsed = fileMap.get(entryFile);
  if (!entryParsed) return [];

  const results: ResolvedExport[] = [];
  const seen = new Set<string>();

  for (const imp of entryParsed.imports) {
    if (!imp.moduleSpecifier.startsWith(".")) continue;

    const targetRelPath = resolveModuleSpecifier(
      imp.moduleSpecifier,
      dirname(resolve(packageDir, entryFile)),
      packageDir,
      warnings,
    );
    if (!targetRelPath) continue;

    const targetFile = fileMap.get(targetRelPath);
    if (!targetFile) continue;

    for (const exp of targetFile.exports) {
      if (exp.name === "*" || exp.name === "default" || seen.has(exp.name)) continue;
      if (exp.isTypeOnly) continue;
      seen.add(exp.name);
      results.push({ ...exp, definedIn: targetRelPath });
    }
  }

  if (results.length > 0) {
    warnings.push({
      level: "info",
      module: "symbol-graph",
      message: `Barrel file has no exports — extracted ${results.length} API symbols from its internal imports.`,
    });
  }

  return results;
}

/**
 * Fix A: Extract exports from bin entry files when no barrel exists.
 * For CLI packages, the bin field in package.json points to the real entry point(s).
 * We collect exports from the bin file AND functions it imports from internal modules (one level deep).
 */
function extractBinEntryExports(
  packageDir: string,
  fileMap: Map<string, ParsedFile>,
  allExports: Map<string, ExportEntry[]>,
  importGraph: Map<string, ImportEntry[]>,
  warnings: Warning[],
): ResolvedExport[] {
  const pkgJsonPath = join(packageDir, "package.json");
  if (!existsSync(pkgJsonPath)) return [];

  let pkgJson: any;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return [];
  }

  if (!pkgJson.bin) return [];

  // Collect bin entry file paths
  const binPaths: string[] = [];
  if (typeof pkgJson.bin === "string") {
    binPaths.push(pkgJson.bin);
  } else if (typeof pkgJson.bin === "object") {
    for (const val of Object.values(pkgJson.bin)) {
      if (typeof val === "string") binPaths.push(val);
    }
  }

  const results: ResolvedExport[] = [];
  const seen = new Set<string>();

  for (const binPath of binPaths) {
    // Resolve bin path to a source file in the parsed file map
    const binRelPath = resolveBinToSource(binPath, packageDir, fileMap, warnings);
    if (!binRelPath) continue;

    const binFile = fileMap.get(binRelPath);
    if (!binFile) continue;

    // Collect direct exports from the bin file
    for (const exp of binFile.exports) {
      if (exp.name === "*" || seen.has(exp.name)) continue;
      seen.add(exp.name);
      results.push({ ...exp, definedIn: binRelPath });
    }

    // One level deep: collect exports from internal modules the bin file imports
    for (const imp of binFile.imports) {
      if (!imp.moduleSpecifier.startsWith(".")) continue; // only relative imports

      const targetRelPath = resolveModuleSpecifier(
        imp.moduleSpecifier,
        dirname(resolve(packageDir, binRelPath)),
        packageDir,
        warnings,
      );
      if (!targetRelPath) continue;

      const targetFile = fileMap.get(targetRelPath);
      if (!targetFile) continue;

      for (const exp of targetFile.exports) {
        if (exp.name === "*" || exp.name === "default" || seen.has(exp.name)) continue;
        if (exp.isTypeOnly) continue; // Skip types for CLI API
        seen.add(exp.name);
        results.push({ ...exp, definedIn: targetRelPath });
      }
    }
  }

  if (results.length > 0) {
    warnings.push({
      level: "info",
      module: "symbol-graph",
      message: `No barrel file — used bin entry point(s) to extract ${results.length} API symbols.`,
    });
  }

  return results;
}

/**
 * Resolve a bin path (possibly pointing to dist/) to a source file.
 */
function resolveBinToSource(
  binPath: string,
  packageDir: string,
  fileMap: Map<string, ParsedFile>,
  warnings: Warning[],
): string | undefined {
  // Try direct resolution first
  const rel = relative(packageDir, resolve(packageDir, binPath));
  if (fileMap.has(rel)) return rel;

  // Common pattern: bin points to dist/bin/cli.js — map to src/bin/cli.ts
  const srcPath = rel
    .replace(/^dist\//, "src/")
    .replace(/^lib\//, "src/")
    .replace(/^build\//, "src/");

  // Try .js → .ts
  for (const candidate of [
    srcPath.replace(/\.js$/, ".ts"),
    srcPath.replace(/\.js$/, ".tsx"),
    srcPath,
  ]) {
    if (fileMap.has(candidate)) return candidate;
  }

  // Try without extension
  const noExt = srcPath.replace(/\.[jt]sx?$/, "");
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    if (fileMap.has(noExt + ext)) return noExt + ext;
  }

  return undefined;
}

// ─── Call Graph Builder (Improvement 3) ─────────────────────────────────────

/**
 * Build a cross-file call graph from per-file call references.
 * Resolves internal module specifiers to actual file paths within the package.
 */
function buildCallGraph(
  parsedFiles: ParsedFile[],
  packageDir: string,
  _warnings: Warning[],
): CallGraphEdge[] {
  const edges: CallGraphEdge[] = [];
  const seen = new Set<string>();

  // Build a map: exported name → file path (for resolving call targets)
  const exportNameToFile = new Map<string, string>();
  for (const pf of parsedFiles) {
    for (const exp of pf.exports) {
      if (!exp.isTypeOnly && exp.name !== "*" && exp.name !== "default") {
        // First definition wins (closest to barrel)
        if (!exportNameToFile.has(exp.name)) {
          exportNameToFile.set(exp.name, pf.relativePath);
        }
      }
    }
  }

  for (const pf of parsedFiles) {
    for (const ref of pf.callReferences) {
      if (!ref.isInternal) continue; // Only track internal calls

      // Resolve the callee to a file
      const toFile = exportNameToFile.get(ref.calleeName);
      if (!toFile || toFile === pf.relativePath) continue; // Skip self-references

      const key = `${ref.callerName}:${pf.relativePath}->${ref.calleeName}:${toFile}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        from: ref.callerName,
        to: ref.calleeName,
        fromFile: pf.relativePath,
        toFile,
      });
    }
  }

  return edges;
}
