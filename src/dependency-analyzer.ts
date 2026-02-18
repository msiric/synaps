// src/dependency-analyzer.ts — Improvement 2: Dependency Versioning
// Extracts dependency versions from package.json and maps key frameworks
// to version-aware guidance for AI coding agents.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DependencyInsights, Warning } from "./types.js";

/**
 * Analyze dependencies from package.json and produce version-aware insights.
 */
export function analyzeDependencies(
  packageDir: string,
  rootDir?: string,
  warnings: Warning[] = [],
  sourceImports?: Set<string>,
): DependencyInsights {
  const result: DependencyInsights = {
    runtime: [],
    frameworks: [],
  };

  // Read package.json dependencies
  const pkgJsonPath = join(packageDir, "package.json");
  if (!existsSync(pkgJsonPath)) return result;

  let pkgJson: any;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    warnings.push({
      level: "warn",
      module: "dependency-analyzer",
      message: `Failed to parse ${pkgJsonPath}`,
    });
    return result;
  }

  // Only use THIS package's own deps — do NOT merge root deps.
  // Root deps may include unrelated packages (e.g., React for a docs site
  // in a monorepo with a CLI tool). Root deps are only used for
  // cross-package analysis, not per-package analysis.
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

  // Detect runtime
  detectRuntime(pkgJson, packageDir, rootDir, result);

  // Detect frameworks with version guidance
  for (const [name, version] of Object.entries(deps)) {
    if (typeof version !== "string") continue;
    if (version.startsWith("workspace:")) continue; // Skip internal workspace deps
    const cleanVersion = cleanVersionRange(version);

    const guidance = getFrameworkGuidance(name, cleanVersion);
    if (guidance) {
      result.frameworks.push({
        name,
        version: cleanVersion,
        guidance: guidance.guidance,
      });
    }

    // Test framework
    if (isTestFramework(name) && !result.testFramework) {
      result.testFramework = { name, version: cleanVersion };
    }

    // Bundler
    if (isBundler(name) && !result.bundler) {
      result.bundler = { name, version: cleanVersion };
    }
  }

  // If sourceImports provided, filter frameworks to only those actually imported
  if (sourceImports && result.frameworks.length > 0) {
    const verified = result.frameworks.filter((f) => sourceImports.has(f.name));
    const unverified = result.frameworks.filter((f) => !sourceImports.has(f.name));

    if (unverified.length > 0) {
      warnings.push({
        level: "info",
        module: "dependency-analyzer",
        message: `Frameworks in package.json but not imported by source files: ${unverified.map((f) => f.name).join(", ")}`,
      });
    }

    result.frameworks = verified;
  }

  return result;
}

// ─── Runtime Detection ──────────────────────────────────────────────────────

function detectRuntime(
  pkgJson: any,
  packageDir: string,
  rootDir: string | undefined,
  result: DependencyInsights,
): void {
  // Check engines field
  const engines = pkgJson.engines;
  if (engines) {
    if (engines.node) {
      result.runtime.push({ name: "node", version: cleanVersionRange(engines.node) });
    }
    if (engines.bun) {
      result.runtime.push({ name: "bun", version: cleanVersionRange(engines.bun) });
    }
  }

  // Check packageManager field for runtime hints
  if (typeof pkgJson.packageManager === "string") {
    if (pkgJson.packageManager.startsWith("bun@")) {
      const version = pkgJson.packageManager.split("@")[1];
      if (!result.runtime.some((r) => r.name === "bun")) {
        result.runtime.push({ name: "bun", version });
      }
    }
  }

  // Detect Bun from bun.lockb in PACKAGE dir only (not root)
  if (!result.runtime.some((r) => r.name === "bun")) {
    if (existsSync(join(packageDir, "bun.lockb")) || existsSync(join(packageDir, "bun.lock"))) {
      result.runtime.push({ name: "bun", version: "detected" });
    }
  }

  // Detect Deno from deno.json in PACKAGE dir only (not root)
  if (existsSync(join(packageDir, "deno.json")) || existsSync(join(packageDir, "deno.jsonc"))) {
    if (!result.runtime.some((r) => r.name === "deno")) {
      result.runtime.push({ name: "deno", version: "detected" });
    }
  }

  // Only fall back to root runtime if the package has NO runtime signals at all
  if (result.runtime.length === 0 && rootDir) {
    const rootPkgPath = join(rootDir, "package.json");
    if (existsSync(rootPkgPath)) {
      try {
        const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
        if (rootPkg.engines?.node) {
          result.runtime.push({ name: "node", version: cleanVersionRange(rootPkg.engines.node) + " (monorepo root)" });
        }
        // Do NOT add Bun from root packageManager — it's likely the build tool, not the runtime
      } catch {
        // skip
      }
    }
  }
}

// ─── Framework Guidance ─────────────────────────────────────────────────────

interface FrameworkGuidanceEntry {
  guidance?: string;
}

function getFrameworkGuidance(name: string, version: string): FrameworkGuidanceEntry | null {
  const major = parseMajor(version);

  switch (name) {
    case "react":
    case "react-dom":
      if (name === "react-dom") return null; // Only report react once
      if (major >= 19) return { guidance: "React 19 — use() hook available, Server Components available, ref as prop (no forwardRef needed)" };
      if (major === 18) return { guidance: "React 18 — do NOT use use() hook, do NOT use React Server Components, useId available" };
      if (major === 17) return { guidance: "React 17 — no automatic JSX transform by default, no useId, no useSyncExternalStore" };
      return { guidance: undefined };

    case "typescript":
      if (major >= 5) {
        const minor = parseMinor(version);
        if (minor >= 5) return { guidance: `TypeScript ${major}.${minor} — satisfies keyword, const type parameters, inferred type predicates` };
        if (minor >= 4) return { guidance: `TypeScript ${major}.${minor} — satisfies keyword, const type parameters available` };
        return { guidance: `TypeScript ${major}.${minor} — satisfies keyword available, decorators stable` };
      }
      if (major === 4) return { guidance: "TypeScript 4.x — no satisfies keyword, no const type parameters" };
      return { guidance: undefined };

    case "next":
      if (major >= 16) return { guidance: `Next.js ${major} — App Router default, Turbopack stable, Server Actions stable, React Server Components` };
      if (major === 15) return { guidance: "Next.js 15 — App Router is default, Turbopack available, Server Actions stable" };
      if (major === 14) return { guidance: "Next.js 14 — App Router stable, Server Actions stable, Turbopack alpha" };
      if (major === 13) return { guidance: "Next.js 13 — App Router introduced (may use Pages Router), Server Components experimental" };
      return { guidance: undefined };

    case "vue":
      if (major >= 3) return { guidance: "Vue 3 — Composition API, script setup, Teleport, Suspense" };
      if (major === 2) return { guidance: "Vue 2 — Options API preferred, no script setup, no Composition API by default" };
      return { guidance: undefined };

    case "@angular/core":
      if (major >= 17) return { guidance: `Angular ${major} — signals, control flow syntax, standalone components default` };
      if (major >= 14) return { guidance: `Angular ${major} — standalone components available, inject() function` };
      return { guidance: undefined };

    case "svelte":
      if (major >= 5) return { guidance: "Svelte 5 — runes ($state, $derived, $effect), no more reactive declarations ($:)" };
      if (major >= 4) return { guidance: "Svelte 4 — reactive declarations ($:), stores, no runes" };
      return { guidance: undefined };

    case "hono":
      return { guidance: `Hono ${version} — lightweight web framework for edge runtimes` };

    case "express":
      if (major >= 5) return { guidance: "Express 5 — async error handling, path route matching changes" };
      return { guidance: `Express ${major} — callback-based error handling` };

    case "zod":
      return { guidance: `Zod ${version} — schema validation library` };

    case "@trpc/server":
      if (major >= 11) return { guidance: "tRPC 11 — new API" };
      if (major >= 10) return { guidance: "tRPC 10 — procedure builder pattern, input validation" };
      return { guidance: undefined };

    case "prisma":
    case "@prisma/client":
      return { guidance: `Prisma ${version} — ORM with schema-first approach` };

    case "drizzle-orm":
      return { guidance: `Drizzle ORM ${version} — schema-as-code SQL ORM, run db:generate after schema changes` };

    default:
      return null;
  }
}

function isTestFramework(name: string): boolean {
  return ["jest", "vitest", "mocha", "@jest/core", "ava", "tap"].includes(name);
}

function isBundler(name: string): boolean {
  return [
    "webpack", "vite", "esbuild", "rollup", "turbopack",
    "rspack", "@rspack/core", "parcel", "tsup", "unbuild",
  ].includes(name);
}

// ─── Version Parsing ────────────────────────────────────────────────────────

/**
 * Clean a version range to extract the version number.
 * "^18.2.0" → "18.2.0", "~5.4" → "5.4", ">=16" → "16", "workspace:*" → "*"
 */
function cleanVersionRange(range: string): string {
  return range.replace(/^[\^~>=<]*\s*/, "").replace(/^workspace:\*?/, "").trim() || range;
}

function parseMajor(version: string): number {
  const clean = cleanVersionRange(version);
  const num = parseInt(clean.split(".")[0], 10);
  return isNaN(num) ? 0 : num;
}

function parseMinor(version: string): number {
  const clean = cleanVersionRange(version);
  const parts = clean.split(".");
  if (parts.length < 2) return 0;
  const num = parseInt(parts[1], 10);
  return isNaN(num) ? 0 : num;
}
