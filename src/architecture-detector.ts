// src/architecture-detector.ts — Module 7: Architecture Detector
// Errata applied: E-30 (remove org-specific name matching, content-based heuristics only)

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import type {
  ParsedFile,
  PublicAPIEntry,
  PackageArchitecture,
  DirectoryInfo,
  Warning,
} from "./types.js";

const DIRECTORY_PURPOSES: Record<string, string> = {
  hooks: "Custom hooks",
  components: "React components",
  graphql: "GraphQL operations",
  queries: "GraphQL queries",
  mutations: "GraphQL mutations",
  types: "Type definitions",
  interfaces: "Type definitions",
  utils: "Utilities",
  helpers: "Utilities",
  lib: "Utilities",
  contexts: "React context",
  providers: "React context",
  constants: "Constants",
  __tests__: "Tests",
  test: "Tests",
  tests: "Tests",
  models: "Data models",
  services: "Services",
  api: "API layer",
};

export function detectArchitecture(
  parsedFiles: ParsedFile[],
  packageDir: string,
  publicAPI: PublicAPIEntry[],
  barrelFile: string | undefined,
  warnings: Warning[] = [],
): PackageArchitecture {
  const absPackageDir = resolve(packageDir);

  const entryPoint = barrelFile ?? "none";
  const hasJSX = parsedFiles.some(
    (f) => f.hasJSX && !f.isTestFile && !f.isGeneratedFile,
  );
  const packageType = classifyPackageType(
    publicAPI,
    parsedFiles,
    absPackageDir,
  );
  const directories = detectDirectories(parsedFiles, absPackageDir, publicAPI);

  return { entryPoint, directories, packageType, hasJSX };
}

function classifyPackageType(
  publicAPI: PublicAPIEntry[],
  parsedFiles: ParsedFile[],
  packageDir: string,
): PackageArchitecture["packageType"] {
  const nonTypeExports = publicAPI.filter((e) => !e.isTypeOnly);
  if (nonTypeExports.length === 0) {
    // W3-3: Check package.json dependencies before defaulting to "unknown"
    // API servers and web apps often have no barrel exports
    const depClassification = classifyByDependencies(packageDir);
    if (depClassification) return depClassification;

    // Check file content for clues
    if (parsedFiles.some((f) => f.hasJSX)) return "mixed";
    return "unknown";
  }

  const hooks = nonTypeExports.filter((e) => e.kind === "hook").length;
  const components = nonTypeExports.filter((e) => e.kind === "component").length;
  const total = nonTypeExports.length;

  if (hooks > 0 && hooks / total > 0.5) return "hooks";
  if (components > 0 && components / total > 0.5) return "react-components";
  if (hooks > 0 || components > 0) return "mixed";

  // E-30: Content-based heuristics (not org-specific name matching)
  // Check for GraphQL files
  const hasGraphql = parsedFiles.some(
    (f) => f.isGeneratedFile && (
      f.relativePath.includes(".graphql.") ||
      f.relativePath.includes(".generated.")
    ),
  );
  if (hasGraphql) return "library"; // was "graphql", now generic per E-30

  // Check for bin field → CLI
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(packageDir, "package.json"), "utf-8"),
    );
    if (pkgJson.bin) return "cli";
  } catch {
    // No package.json
  }

  // W3-3: Check for app/HTTP framework dependencies
  const depClassification = classifyByDependencies(packageDir);
  if (depClassification) return depClassification;

  return "library";
}

/**
 * W3-3: Classify package type by checking dependencies for HTTP/app frameworks.
 */
function classifyByDependencies(packageDir: string): PackageArchitecture["packageType"] | undefined {
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(packageDir, "package.json"), "utf-8"),
    );
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
    };

    const appFrameworks = ["next", "nuxt", "remix", "astro", "@sveltejs/kit"];
    if (appFrameworks.some((fw) => fw in allDeps)) return "web-application";

    const httpFrameworks = ["hono", "express", "fastify", "koa", "hapi", "nest", "@hono/node-server"];
    if (httpFrameworks.some((fw) => fw in allDeps)) return "api-server";
  } catch {
    // No package.json
  }
  return undefined;
}

function detectDirectories(
  parsedFiles: ParsedFile[],
  packageDir: string,
  publicAPI: PublicAPIEntry[],
): DirectoryInfo[] {
  const dirs: DirectoryInfo[] = [];

  // Look for src/ directory first
  const srcDir = join(packageDir, "src");
  const baseDir = existsSync(srcDir) ? srcDir : packageDir;
  const baseDirRel = existsSync(srcDir) ? "src" : "";

  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const dirRelPath = baseDirRel
        ? `${baseDirRel}/${entry.name}`
        : entry.name;

      const filesInDir = parsedFiles.filter(
        (f) =>
          f.relativePath.startsWith(dirRelPath + "/") &&
          !f.isTestFile &&
          !f.isGeneratedFile,
      );

      if (filesInDir.length === 0) continue;

      const purpose =
        DIRECTORY_PURPOSES[entry.name] ?? `Feature: ${entry.name}`;

      // Enhancement 2: Map public exports to this directory
      const dirExports = publicAPI
        .filter((e) => e.sourceFile.startsWith(dirRelPath + "/"))
        .map((e) => e.name);

      // Enhancement 2: Detect file naming pattern
      const pattern = detectFilePattern(filesInDir.map((f) => {
        const parts = f.relativePath.split("/");
        return parts[parts.length - 1];
      }));

      dirs.push({
        path: dirRelPath,
        purpose,
        fileCount: filesInDir.length,
        exports: dirExports,
        pattern,
      });
    }
  } catch {
    // Can't read directory
  }

  return dirs.sort((a, b) => b.fileCount - a.fileCount);
}

/**
 * Enhancement 2: Detect file naming pattern from a set of filenames.
 * Finds the longest common prefix and suffix, with the variable part as {...}.
 */
export function detectFilePattern(filenames: string[]): string | undefined {
  // Filter out index files and non-source files
  const names = filenames.filter(
    (n) => !n.startsWith("index.") && /\.(ts|tsx|js|jsx)$/.test(n),
  );
  if (names.length < 3) return undefined;

  // Strip extension for pattern detection
  const stripped = names.map((n) => n.replace(/\.(ts|tsx|js|jsx)$/, ""));
  const commonExt = getMostCommonExtension(filenames);

  // Find longest common prefix
  let prefix = "";
  const first = stripped[0];
  for (let i = 0; i < first.length; i++) {
    const char = first[i];
    if (stripped.every((s) => s.length > i && s[i] === char)) {
      prefix += char;
    } else {
      break;
    }
  }

  // Find longest common suffix
  let suffix = "";
  const reversed = stripped.map((s) => [...s].reverse().join(""));
  const firstRev = reversed[0];
  for (let i = 0; i < firstRev.length; i++) {
    const char = firstRev[i];
    if (reversed.every((s) => s.length > i && s[i] === char)) {
      suffix = char + suffix;
    } else {
      break;
    }
  }

  // Check for overlap between prefix and suffix
  if (prefix.length + suffix.length >= first.length) {
    return undefined; // All files have the same name — no pattern
  }

  // Only return pattern if prefix or suffix is meaningful (>= 2 chars)
  if (prefix.length < 2 && suffix.length < 2) return undefined;

  const variable = prefix.length > 0 || suffix.length > 0
    ? `${prefix}{...}${suffix}${commonExt}`
    : undefined;

  return variable;
}

function getMostCommonExtension(filenames: string[]): string {
  const counts = new Map<string, number>();
  for (const name of filenames) {
    const match = name.match(/\.(tsx?|jsx?)$/);
    if (match) {
      const ext = "." + match[1];
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
    }
  }
  let maxExt = ".ts";
  let maxCount = 0;
  for (const [ext, count] of counts) {
    if (count > maxCount) {
      maxExt = ext;
      maxCount = count;
    }
  }
  return maxExt;
}
