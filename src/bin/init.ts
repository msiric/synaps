// src/bin/init.ts — Zero-config init command
// Auto-detects project structure and generates AGENTS.md on first try.

import { resolve, join, relative, dirname } from "node:path";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { analyze, formatDeterministic, formatHierarchicalDeterministic } from "../index.js";
import type { OutputFormat } from "../types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectStructure {
  isMonorepo: boolean;
  workspaceSource?: string;
  root: string;
  packages: string[];
  packageManager: string;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runInit(): Promise<void> {
  const cwd = process.cwd();

  // Step 1: Detect project structure
  const project = detectProjectStructure(cwd);

  stderr("");
  stderr(`  Detected: ${project.isMonorepo ? `monorepo (${project.workspaceSource})` : "single package"}`);
  if (project.isMonorepo) {
    const relPkgs = project.packages.map((p) => relative(cwd, p));
    stderr(`  Packages: ${relPkgs.join(", ")} (${project.packages.length} found)`);
  }
  stderr(`  Package manager: ${project.packageManager}`);

  // Step 2: Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const format: OutputFormat = apiKey ? "agents.md" : "json";
  stderr(`  API key: ${apiKey ? "set" : "not set (will generate JSON only)"}`);
  stderr("");

  // Step 3: Analyze
  stderr(`  Analyzing ${project.packages.length} package(s)...`);
  const analysisStart = performance.now();

  const analysis = await analyze({
    packages: project.packages,
    rootDir: project.root,
    output: { format, dir: "." },
    llm: {
      provider: "anthropic",
      model: process.env.AUTODOCS_LLM_MODEL ?? "claude-sonnet-4-20250514",
      maxOutputTokens: 4096,
      apiKey,
    },
  });

  const analysisMs = Math.round(performance.now() - analysisStart);
  stderr(`  Analysis complete (${(analysisMs / 1000).toFixed(1)}s)`);

  // Step 4: Generate and write output
  if (!apiKey) {
    const outPath = resolve(cwd, "autodocs-analysis.json");
    writeFileSafe(outPath, JSON.stringify(analysis, mapReplacer, 2));
    stderr(`\n  Written: ${relative(cwd, outPath)}`);
    stderr(`\n  To generate AGENTS.md, set ANTHROPIC_API_KEY and run again.`);
    return;
  }

  const llmConfig = {
    output: { format: "agents.md" as const, dir: "." },
    llm: {
      provider: "anthropic" as const,
      model: process.env.AUTODOCS_LLM_MODEL ?? "claude-sonnet-4-20250514",
      maxOutputTokens: 4096,
      apiKey,
    },
  };

  if (project.isMonorepo && project.packages.length > 1) {
    stderr(`  Generating AGENTS.md (hierarchical)...`);
    const genStart = performance.now();
    const result = await formatHierarchicalDeterministic(analysis, llmConfig);
    stderr(`  Generation complete (${((performance.now() - genStart) / 1000).toFixed(1)}s)`);

    const rootPath = resolve(cwd, "AGENTS.md");
    writeFileSafe(rootPath, result.root);
    stderr(`\n  Written:`);
    stderr(`    ./AGENTS.md (root, ${result.root.split("\n").length} lines)`);

    const pkgsDir = resolve(cwd, "packages");
    for (const pkg of result.packages) {
      const pkgPath = join(pkgsDir, pkg.filename);
      writeFileSafe(pkgPath, pkg.content);
      stderr(`    ./packages/${pkg.filename} (${pkg.content.split("\n").length} lines)`);
    }
  } else {
    stderr(`  Generating AGENTS.md...`);
    const genStart = performance.now();
    const content = await formatDeterministic(analysis, llmConfig, project.root);
    stderr(`  Generation complete (${((performance.now() - genStart) / 1000).toFixed(1)}s)`);

    const outPath = resolve(cwd, "AGENTS.md");
    writeFileSafe(outPath, content);
    stderr(`\n  Written: ./AGENTS.md (${content.split("\n").length} lines)`);
  }
}

// ─── Project Detection ───────────────────────────────────────────────────────

/** Exported for testing. */
export function detectProjectStructure(cwd: string): ProjectStructure {
  const absCwd = resolve(cwd);

  // Must have package.json
  const pkgJsonPath = join(absCwd, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(
      "No package.json found in current directory.\n" +
      "Run this command from your project root (where package.json is).",
    );
  }

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    throw new Error("Failed to parse package.json.");
  }

  // Detect package manager from lockfiles
  const packageManager = detectPM(absCwd);

  // Check for monorepo signals
  // Signal 1: package.json workspaces field
  if (Array.isArray(pkgJson.workspaces)) {
    const packages = discoverWorkspacePackages(absCwd, pkgJson.workspaces as string[]);
    if (packages.length > 0) {
      return { isMonorepo: true, workspaceSource: "npm/yarn workspaces", root: absCwd, packages, packageManager };
    }
  }

  // Signal 1b: yarn workspaces as object { packages: [...] }
  if (pkgJson.workspaces && typeof pkgJson.workspaces === "object" && !Array.isArray(pkgJson.workspaces)) {
    const ws = pkgJson.workspaces as Record<string, unknown>;
    if (Array.isArray(ws.packages)) {
      const packages = discoverWorkspacePackages(absCwd, ws.packages as string[]);
      if (packages.length > 0) {
        return { isMonorepo: true, workspaceSource: "yarn workspaces", root: absCwd, packages, packageManager };
      }
    }
  }

  // Signal 2: pnpm-workspace.yaml
  const pnpmWsPath = join(absCwd, "pnpm-workspace.yaml");
  if (existsSync(pnpmWsPath)) {
    const globs = parsePnpmWorkspaceYaml(pnpmWsPath);
    if (globs.length > 0) {
      const packages = discoverWorkspacePackages(absCwd, globs);
      if (packages.length > 0) {
        return { isMonorepo: true, workspaceSource: "pnpm workspaces", root: absCwd, packages, packageManager };
      }
    }
  }

  // Single package
  return { isMonorepo: false, root: absCwd, packages: [absCwd], packageManager };
}

// ─── Workspace Discovery ─────────────────────────────────────────────────────

/**
 * Discover workspace package directories from glob patterns.
 * Handles common patterns: "packages/*", "apps/*", "libs/**".
 */
function discoverWorkspacePackages(root: string, globs: string[]): string[] {
  const packages: string[] = [];
  const seen = new Set<string>();

  for (const glob of globs) {
    // Strip trailing / if present
    const cleanGlob = glob.replace(/\/+$/, "");

    // Common patterns: "packages/*", "apps/*", "libs/**"
    // Split into base directory and wildcard
    const starIdx = cleanGlob.indexOf("*");
    if (starIdx === -1) {
      // No wildcard — treat as literal directory
      const dir = resolve(root, cleanGlob);
      if (existsSync(join(dir, "package.json")) && !seen.has(dir)) {
        seen.add(dir);
        packages.push(dir);
      }
      continue;
    }

    const baseDir = resolve(root, cleanGlob.slice(0, starIdx).replace(/\/+$/, ""));
    if (!existsSync(baseDir)) continue;

    const isRecursive = cleanGlob.includes("**");

    if (isRecursive) {
      walkForPackages(baseDir, packages, seen);
    } else {
      // Single-level wildcard: list immediate subdirectories
      try {
        const entries = readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          const dir = join(baseDir, entry.name);
          if (existsSync(join(dir, "package.json")) && !seen.has(dir)) {
            seen.add(dir);
            packages.push(dir);
          }
        }
      } catch {
        // Can't read directory
      }
    }
  }

  return packages.sort();
}

/** Recursively find directories containing package.json. */
function walkForPackages(dir: string, results: string[], seen: Set<string>, depth = 0): void {
  if (depth > 4) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const subdir = join(dir, entry.name);
      if (existsSync(join(subdir, "package.json")) && !seen.has(subdir)) {
        seen.add(subdir);
        results.push(subdir);
      }
      walkForPackages(subdir, results, seen, depth + 1);
    }
  } catch {
    // Can't read directory
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simple YAML parser for pnpm-workspace.yaml — only reads the `packages:` field. */
function parsePnpmWorkspaceYaml(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const globs: string[] = [];
    let inPackages = false;

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "packages:" || trimmed === "packages: ") {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (trimmed.startsWith("- ")) {
          // Strip "- " prefix and optional quotes
          const value = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, "");
          if (value && !value.startsWith("!")) {
            globs.push(value);
          }
        } else if (trimmed && !trimmed.startsWith("#")) {
          // Non-list line — end of packages section
          break;
        }
      }
    }

    return globs;
  } catch {
    return [];
  }
}

/** Detect package manager from lockfiles. */
function detectPM(dir: string): string {
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  return "npm";
}

function stderr(msg: string): void {
  process.stderr.write(msg + "\n");
}

function writeFileSafe(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}
