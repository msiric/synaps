// src/workspace-resolver.ts — Workspace discovery for monorepos
// Shared between CLI (init command) and import chain (alias resolution).
// Reads package.json workspaces or pnpm-workspace.yaml to find all workspace packages.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Discover workspace package directories from glob patterns.
 * Handles: "packages/*", "apps/*", "libs/**", literal paths.
 */
export function discoverWorkspacePackages(root: string, globs: string[]): string[] {
  const packages: string[] = [];
  const seen = new Set<string>();

  for (const glob of globs) {
    const cleanGlob = glob.replace(/\/+$/, "");

    const starIdx = cleanGlob.indexOf("*");
    if (starIdx === -1) {
      // No wildcard — literal directory
      const dir = resolve(root, cleanGlob);
      if (existsSync(join(dir, "package.json")) && !seen.has(dir)) {
        seen.add(dir);
        packages.push(dir);
      }
      continue;
    }

    const baseDir = resolve(root, cleanGlob.slice(0, starIdx).replace(/\/+$/, ""));
    if (!existsSync(baseDir)) continue;

    if (cleanGlob.includes("**")) {
      walkForPackages(baseDir, packages, seen);
    } else {
      // Single-level wildcard: immediate subdirectories
      try {
        for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          const dir = join(baseDir, entry.name);
          if (existsSync(join(dir, "package.json")) && !seen.has(dir)) {
            seen.add(dir);
            packages.push(dir);
          }
        }
      } catch {
        /* can't read directory */
      }
    }
  }

  return packages.sort();
}

/** Recursively find directories containing package.json (max depth 4). */
export function walkForPackages(dir: string, results: string[], seen: Set<string>, depth = 0): void {
  if (depth > 4) return;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const subdir = join(dir, entry.name);
      if (existsSync(join(subdir, "package.json")) && !seen.has(subdir)) {
        seen.add(subdir);
        results.push(subdir);
      }
      walkForPackages(subdir, results, seen, depth + 1);
    }
  } catch {
    /* can't read directory */
  }
}

/** Simple YAML parser for pnpm-workspace.yaml — only reads the `packages:` field. */
export function parsePnpmWorkspaceYaml(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const globs: string[] = [];
    let inPackages = false;

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (/^packages\s*:\s*$/.test(trimmed)) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (trimmed.startsWith("- ")) {
          const value = trimmed
            .slice(2)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          if (value && !value.startsWith("!")) {
            globs.push(value);
          }
        } else if (trimmed && !trimmed.startsWith("#")) {
          break;
        }
      }
    }

    return globs;
  } catch {
    return [];
  }
}

/**
 * Read workspace globs from the root package.json or pnpm-workspace.yaml.
 * Returns empty array if not a monorepo.
 */
export function readWorkspaceGlobs(rootDir: string): string[] {
  // Check package.json workspaces
  try {
    const pkgJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
    if (Array.isArray(pkgJson.workspaces)) return pkgJson.workspaces;
    if (pkgJson.workspaces?.packages && Array.isArray(pkgJson.workspaces.packages)) return pkgJson.workspaces.packages;
  } catch {
    /* no package.json */
  }

  // Check pnpm-workspace.yaml
  const pnpmPath = join(rootDir, "pnpm-workspace.yaml");
  if (existsSync(pnpmPath)) {
    const globs = parsePnpmWorkspaceYaml(pnpmPath);
    if (globs.length > 0) return globs;
  }

  return [];
}
