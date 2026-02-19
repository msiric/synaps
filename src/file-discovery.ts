// src/file-discovery.ts — Module 1: File Discovery
// Errata applied: E-14 (gitignore via git ls-files), E-15 (picomatch), E-16 (symlink boundary)

import { readdirSync, statSync, realpathSync } from "node:fs";
import { resolve, relative, extname, join } from "node:path";
import { execSync } from "node:child_process";
import picomatch from "picomatch";
import {
  Warning,
  DEFAULT_EXCLUDE_DIRS,
  SOURCE_EXTENSIONS,
  DTS_EXTENSION,
} from "./types.js";

/**
 * Discover all analyzable source files in a package directory.
 * Uses git ls-files when available (E-14), falls back to filesystem walk.
 */
export function discoverFiles(
  packageDir: string,
  excludePatterns: string[],
  warnings: Warning[] = [],
): string[] {
  const absPackageDir = resolve(packageDir);

  // E-14: Try git ls-files first for .gitignore support
  const gitFiles = tryGitLsFiles(absPackageDir, warnings);
  if (gitFiles !== null) {
    return filterAndSort(gitFiles, absPackageDir, excludePatterns);
  }

  // Fallback: filesystem walk
  const visited = new Set<number>(); // inode set for symlink cycle detection
  const files: string[] = [];
  walkDirectory(absPackageDir, absPackageDir, files, visited, warnings);
  return filterAndSort(files, absPackageDir, excludePatterns);
}

/**
 * E-14: Use git ls-files to get non-ignored files.
 * Returns null if git is not available or packageDir is not in a git repo.
 */
function tryGitLsFiles(
  packageDir: string,
  warnings: Warning[],
): string[] | null {
  try {
    // Check if git is available and this is a git repo
    const output = execSync(
      "git ls-files --cached --others --exclude-standard",
      {
        cwd: packageDir,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const files: string[] = [];
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const absPath = resolve(packageDir, trimmed);
      if (SOURCE_EXTENSIONS.test(trimmed) && !DTS_EXTENSION.test(trimmed)) {
        files.push(absPath);
      }
    }
    return files;
  } catch {
    // git not available or not a git repo — fall back to filesystem walk
    return null;
  }
}

/**
 * Recursive directory walk with symlink cycle detection (E-16).
 */
function walkDirectory(
  dir: string,
  packageDir: string,
  results: string[],
  visitedInodes: Set<number>,
  warnings: Warning[],
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push({
      level: "warn",
      module: "file-discovery",
      message: `Cannot read directory: ${msg}`,
      file: dir,
    });
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if ((DEFAULT_EXCLUDE_DIRS as readonly string[]).includes(entry.name)) continue;
      walkDirectory(fullPath, packageDir, results, visitedInodes, warnings);
    } else if (entry.isSymbolicLink()) {
      // E-16: Symlink boundary check
      try {
        const realPath = realpathSync(fullPath);
        const stat = statSync(realPath);

        // Check if symlink points outside package directory
        if (!realPath.startsWith(packageDir)) {
          warnings.push({
            level: "info",
            module: "file-discovery",
            message: `Symlink ${relative(packageDir, fullPath)} points outside package directory — skipped`,
            file: fullPath,
          });
          continue;
        }

        if (stat.isDirectory()) {
          // Cycle detection via inode
          if (visitedInodes.has(stat.ino)) {
            warnings.push({
              level: "info",
              module: "file-discovery",
              message: `Symlink cycle detected at ${relative(packageDir, fullPath)} — skipped`,
              file: fullPath,
            });
            continue;
          }
          visitedInodes.add(stat.ino);
          if (!(DEFAULT_EXCLUDE_DIRS as readonly string[]).includes(entry.name)) {
            walkDirectory(
              fullPath,
              packageDir,
              results,
              visitedInodes,
              warnings,
            );
          }
        } else if (stat.isFile()) {
          if (
            SOURCE_EXTENSIONS.test(entry.name) &&
            !DTS_EXTENSION.test(entry.name)
          ) {
            results.push(fullPath);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({
          level: "warn",
          module: "file-discovery",
          message: `Cannot resolve symlink: ${msg}`,
          file: fullPath,
        });
      }
    } else if (entry.isFile()) {
      if (
        SOURCE_EXTENSIONS.test(entry.name) &&
        !DTS_EXTENSION.test(entry.name)
      ) {
        results.push(fullPath);
      }
    }
  }
}

/**
 * E-15: Filter by user exclude patterns using picomatch, then sort.
 */
function filterAndSort(
  files: string[],
  packageDir: string,
  excludePatterns: string[],
): string[] {
  if (excludePatterns.length === 0) {
    return files.sort();
  }

  const isExcluded = picomatch(excludePatterns, { dot: true });
  return files
    .filter((f) => {
      const rel = relative(packageDir, f);
      return !isExcluded(rel);
    })
    .sort();
}
