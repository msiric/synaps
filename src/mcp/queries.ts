// src/mcp/queries.ts — Data access layer over StructuredAnalysis
// Isolates tool handlers from analysis schema internals.
// When analysis types change, update here — not in every tool handler.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
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

  // Find contribution pattern for this directory (most-specific match)
  const patterns = pkg.contributionPatterns ?? [];
  const pattern = findBestPattern(patterns, newFilePath);

  // For registration: if the most-specific pattern has no registrationFile,
  // walk up to the nearest parent that does (child may inherit parent's registration)
  const regPattern = pattern?.registrationFile ? pattern : patterns
    .filter(p => newFilePath.startsWith(p.directory) && p.registrationFile
      && (!pattern || p.directory.length < pattern.directory.length))
    .sort((a, b) => b.directory.length - a.directory.length)[0];

  // Infer export name from most-specific pattern's suffix
  const fileBase = newFilePath.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  const exportName = pattern?.exportSuffix
    ? kebabToCamel(fileBase) + pattern.exportSuffix
    : kebabToCamel(fileBase);

  // Registration file insertions (may come from parent pattern)
  let regResult: RegistrationInsertions["registrationFile"] = null;
  if (regPattern?.registrationFile) {
    const regPath = resolve(rootDir, regPattern.registrationFile);
    try {
      const content = readFileSync(regPath, "utf-8");
      const { lastImportLine, firstNonImportLine } = findImportBoundary(content);

      // Compute relative path from registration file to new file
      const regDir = regPattern.registrationFile.replace(/\/[^/]+$/, "");
      let relPath = newFilePath;
      if (newFilePath.startsWith(regDir + "/")) {
        relPath = "./" + newFilePath.slice(regDir.length + 1);
      } else {
        relPath = "./" + newFilePath;
      }
      relPath = relPath.replace(/\.tsx?$/, ".js"); // .ts → .js for imports

      regResult = {
        path: regPattern.registrationFile,
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

// ─── Pattern Matching Helper ────────────────────────────────────────────────

/**
 * Find the most-specific contribution pattern matching a file path.
 * Patterns are matched by directory prefix and sorted by specificity (longest first).
 * This avoids the array-order dependency of `.find()` when nested directories
 * both have patterns (e.g., src/adapters/ and src/adapters/llm/).
 */
export function findBestPattern(
  patterns: ContributionPattern[],
  filePath: string,
): ContributionPattern | undefined {
  return patterns
    .filter(p => filePath.startsWith(p.directory))
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

export interface ParsedError {
  files: string[];
  testFile: string | null;
  message: string | null;
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
  };
  callGraphBonus: boolean;
  reason: string;
}

/**
 * Extract file paths, test file, and error message from raw error/stack trace text.
 * Handles V8 stacks, TypeScript compiler errors, Vitest output, and generic patterns.
 */
export function parseErrorText(errorText: string, rootDir?: string): ParsedError {
  const fileSet = new Set<string>();
  let testFile: string | null = null;
  let message: string | null = null;

  const msgMatch = errorText.match(/(?:TypeError|ReferenceError|Error|SyntaxError):\s*(.+)/);
  if (msgMatch) message = msgMatch[1].trim();

  for (const line of errorText.split("\n")) {
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

    // Generic: any relative path with a directory separator, ending in .ts/.js:line
    // Covers app/, pages/, components/, packages/, server/, api/, etc.
    if ((m = line.match(/\b([a-zA-Z][^\s:]*\/[^\s:]+\.[jt]sx?):(\d+)/))) {
      addProjectFile(fileSet, m[1], rootDir);
    }
  }

  return { files: [...fileSet], testFile, message };
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
    const unstaged = execGit("git diff --name-only", rootDir);
    const staged = execGit("git diff --cached --name-only", rootDir);
    const uncommitted = new Set([...unstaged.split("\n"), ...staged.split("\n")].filter(Boolean));

    for (const file of uncommitted) {
      changes.push({ file, hoursAgo: 0, isUncommitted: true });
    }

    // Committed: last 50 commits within 7 days
    const log = execGit(
      'git log --pretty=format:"COMMIT:%H|%at|%s" --name-only -n 50 --since="7 days ago"',
      rootDir,
    );

    if (log) {
      const seen = new Set(uncommitted);
      let current: { timestamp: number; message: string } | null = null;

      for (const line of log.split("\n")) {
        if (line.startsWith("COMMIT:") || line.startsWith('"COMMIT:')) {
          const clean = line.replace(/^"?COMMIT:/, "");
          const sep1 = clean.indexOf("|");
          const sep2 = clean.indexOf("|", sep1 + 1);
          current = {
            timestamp: parseInt(clean.slice(sep1 + 1, sep2), 10),
            message: clean.slice(sep2 + 1).replace(/"$/, ""),
          };
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
 * Returns top 5 suspects sorted by score descending.
 */
export function buildSuspectList(
  analysis: StructuredAnalysis,
  errorFiles: string[],
  recentChanges: FileChange[],
  packagePath?: string,
): Suspect[] {
  const pkg = resolvePackage(analysis, packagePath);
  const errorSet = new Set(errorFiles);
  const chain = pkg.importChain ?? [];
  const coChangeEdges = pkg.gitHistory?.coChangeEdges ?? [];
  const callGraph = pkg.callGraph ?? [];
  const workflowRules = analysis.crossPackage?.workflowRules ?? [];

  // Index recent changes by file
  const changeMap = new Map<string, FileChange>();
  for (const c of recentChanges) {
    if (!changeMap.has(c.file)) changeMap.set(c.file, c);
  }
  const changedFiles = new Set(changeMap.keys());

  // 1. Collect candidates: import neighbors + co-change partners of error files
  const candidateSymbols = new Map<string, number>(); // file → max symbolCount
  const candidateCoupling = new Map<string, number>(); // file → max Jaccard

  for (const errorFile of errorFiles) {
    // Files the error file imports from (upstream — likely root cause)
    for (const edge of chain) {
      if (edge.importer === errorFile) {
        setMax(candidateSymbols, edge.source, edge.symbolCount);
      }
    }
    // Files that import from error file (downstream — may need updating)
    for (const edge of chain) {
      if (edge.source === errorFile) {
        setMax(candidateSymbols, edge.importer, edge.symbolCount);
      }
    }
    // Co-change partners
    for (const edge of coChangeEdges) {
      if (edge.file1 === errorFile) {
        setMax(candidateCoupling, edge.file2, edge.jaccard);
      } else if (edge.file2 === errorFile) {
        setMax(candidateCoupling, edge.file1, edge.jaccard);
      }
    }
  }

  // Include error files as candidates (they may have been recently changed)
  for (const f of errorFiles) {
    if (!candidateSymbols.has(f) && !candidateCoupling.has(f)) {
      candidateSymbols.set(f, 0);
    }
  }

  const allCandidates = new Set([...candidateSymbols.keys(), ...candidateCoupling.keys()]);

  // 2. Missing co-change: for each recently-changed relevant file,
  //    find high-coupling partners that weren't updated
  const missingCoChange = new Map<string, number>();
  const relevant = [...changedFiles].filter(f => errorSet.has(f) || allCandidates.has(f));

  for (const changedFile of relevant) {
    for (const edge of coChangeEdges) {
      const partner = edge.file1 === changedFile ? edge.file2 :
                      edge.file2 === changedFile ? edge.file1 : null;
      if (!partner) continue;
      if (edge.coChangeCount < 5 || edge.jaccard <= 0.4) continue;
      if (changedFiles.has(partner)) continue;

      setMax(missingCoChange, partner, edge.jaccard);
      allCandidates.add(partner);
    }
  }

  // 3. Dynamic weights
  const hasRecentChanges = recentChanges.some(c => c.hoursAgo < 24);
  const w = hasRecentChanges
    ? { missingCoChange: 35, recency: 25, coupling: 20, dependency: 10, workflow: 10 }
    : { missingCoChange: 0, recency: 0, coupling: 50, dependency: 35, workflow: 15 };

  // 4. Score each candidate
  const suspects: Suspect[] = [];

  for (const file of allCandidates) {
    const change = changeMap.get(file);

    const signals = {
      missingCoChange: missingCoChange.get(file) ?? 0,
      recency: change ? Math.max(0.05, Math.exp(-0.05 * change.hoursAgo)) : 0,
      coupling: candidateCoupling.get(file) ?? 0,
      dependency: Math.min((candidateSymbols.get(file) ?? 0) / 10, 1),
      workflow: workflowRules.some(r =>
        r.trigger.includes(file) || r.action.includes(file),
      ) ? 1.0 : 0,
    };

    let score =
      w.missingCoChange * signals.missingCoChange +
      w.recency * signals.recency +
      w.coupling * signals.coupling +
      w.dependency * signals.dependency +
      w.workflow * signals.workflow;

    // Call graph bonus: 1.5x if call edge exists, but NOT for the error site itself
    const callGraphBonus = !errorSet.has(file) && callGraph.some(e =>
      (e.fromFile === file && errorSet.has(e.toFile)) ||
      (e.toFile === file && errorSet.has(e.fromFile)),
    );
    if (callGraphBonus) score *= 1.5;

    // Build human-readable reason
    const reasons: string[] = [];
    if (signals.missingCoChange > 0) {
      reasons.push(`Missing co-change: expected to change (${Math.round(signals.missingCoChange * 100)}% coupling) but wasn't updated`);
    }
    if (signals.recency > 0.1 && change) {
      const ago = change.isUncommitted
        ? "uncommitted changes"
        : `changed ${formatHoursAgo(change.hoursAgo)}`;
      reasons.push(ago + (change.commitMessage ? `: "${change.commitMessage}"` : ""));
    }
    if (signals.coupling > 0) {
      reasons.push(`${Math.round(signals.coupling * 100)}% co-change coupling`);
    }
    if (signals.dependency > 0) {
      reasons.push(`${candidateSymbols.get(file) ?? 0} symbols shared with error site`);
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

  return suspects
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
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

function execGit(command: string, cwd: string): string {
  return execSync(command, { cwd, encoding: "utf-8", timeout: 5000 }).trim();
}

function setMax(map: Map<string, number>, key: string, value: number): void {
  if (value > (map.get(key) ?? -1)) map.set(key, value);
}

function formatHoursAgo(hours: number): string {
  if (hours < 1) return "minutes ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export { computeInferabilityScore } from "../inferability.js";
export type { InferabilityScore } from "../inferability.js";
