// src/meta-tool-detector.ts — Detect packages that support/analyze multiple frameworks
// Uses a 3-signal cascade: peerDependencies → dependency placement → family count fallback.
// Format-time reclassification: analysis runs ALL detectors; this module only informs formatting.

import type { ParsedFile, TierInfo, Warning } from "./types.js";

// ─── Framework Families ──────────────────────────────────────────────────────
// Related packages grouped so they count as one signal.
// Used by all 3 signals for family deduplication.

const FRAMEWORK_FAMILIES: Record<string, string[]> = {
  // UI frameworks
  react: ["react", "react-dom"],
  vue: ["vue"],
  angular: ["@angular/core", "@angular/common", "@angular/router", "@angular/platform-browser"],
  svelte: ["svelte"],
  solid: ["solid-js"],
  preact: ["preact"],
  // Meta-frameworks
  next: ["next"],
  nuxt: ["nuxt"],
  remix: ["@remix-run/react", "@remix-run/node"],
  astro: ["astro"],
  sveltekit: ["@sveltejs/kit"],
  // Server frameworks
  express: ["express"],
  fastify: ["fastify"],
  hono: ["hono"],
  koa: ["koa"],
  nestjs: ["@nestjs/core"],
  hapi: ["@hapi/hapi"],
  // Build tools
  webpack: ["webpack"],
  vite: ["vite"],
  esbuild: ["esbuild"],
  rollup: ["rollup"],
  rspack: ["@rspack/core"],
  parcel: ["parcel"],
  // ORMs / databases
  prisma: ["prisma", "@prisma/client"],
  drizzle: ["drizzle-orm"],
  typeorm: ["typeorm"],
  sequelize: ["sequelize"],
  knex: ["knex"],
  mongoose: ["mongoose"],
  // State management
  redux: ["redux", "@reduxjs/toolkit"],
  zustand: ["zustand"],
  mobx: ["mobx"],
  jotai: ["jotai"],
  recoil: ["recoil"],
};

/** Reverse map: package name → family name. */
export const PACKAGE_TO_FAMILY = new Map<string, string>();
for (const [family, packages] of Object.entries(FRAMEWORK_FAMILIES)) {
  for (const pkg of packages) {
    PACKAGE_TO_FAMILY.set(pkg, family);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MetaToolDetectionInput {
  parsedFiles: ParsedFile[];
  tiers: Map<string, TierInfo>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDeps: Record<string, string>;
  threshold?: number;
}

export type MetaToolSignal = "peer-dependencies" | "dep-placement" | "family-count" | "none";

export interface MetaToolResult {
  isMetaTool: boolean;
  signal: MetaToolSignal;
  supportedFamilies: string[];
  coreFamilies: string[];
}

// ─── Detection ───────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 5;
const PEER_FAMILY_THRESHOLD = 3;
const DEV_ONLY_FAMILY_THRESHOLD = 4;
const DOMINANT_MARGIN = 3;

/**
 * Detect if a package is a meta-tool (analyzer/plugin system) using a 3-signal cascade.
 * Returns which frameworks are "supported" vs "core" for format-time reclassification.
 */
export function detectMetaTool(
  input: MetaToolDetectionInput,
  warnings: Warning[] = [],
): MetaToolResult {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const sourceFamilyCounts = collectSourceFamilyCounts(input.parsedFiles, input.tiers);

  if (sourceFamilyCounts.size === 0) {
    return { isMetaTool: false, signal: "none", supportedFamilies: [], coreFamilies: [] };
  }

  // Signal 1: peerDependencies (≥3 peer families also imported in source)
  const peerFamilies = mapToFamilies(Object.keys(input.peerDeps));
  const peerFamiliesInSource = peerFamilies.filter(f => sourceFamilyCounts.has(f));
  if (peerFamiliesInSource.length >= PEER_FAMILY_THRESHOLD) {
    return buildResult("peer-dependencies", sourceFamilyCounts, input.dependencies, warnings);
  }

  // Signal 2: dependency placement (≥4 devDep-only families imported in source)
  const devOnlyFamilies = findDevOnlyFamilies(
    input.dependencies, input.devDependencies, sourceFamilyCounts,
  );
  if (devOnlyFamilies.length >= DEV_ONLY_FAMILY_THRESHOLD) {
    return buildResult("dep-placement", sourceFamilyCounts, input.dependencies, warnings);
  }

  // Signal 3: family count fallback (>threshold families in source)
  if (sourceFamilyCounts.size > threshold) {
    return buildResult("family-count", sourceFamilyCounts, input.dependencies, warnings);
  }

  return { isMetaTool: false, signal: "none", supportedFamilies: [], coreFamilies: [] };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Count distinct framework families from value imports in T1/T2 files. */
function collectSourceFamilyCounts(
  parsedFiles: ParsedFile[],
  tiers: Map<string, TierInfo>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pf of parsedFiles) {
    const tier = tiers.get(pf.relativePath);
    if (!tier || tier.tier === 3) continue;
    for (const imp of pf.imports) {
      if (imp.isTypeOnly) continue;
      const spec = imp.moduleSpecifier;
      if (spec.startsWith(".") || spec.startsWith("/")) continue;
      const parts = spec.split("/");
      const basePkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      const family = PACKAGE_TO_FAMILY.get(basePkg);
      if (family) {
        counts.set(family, (counts.get(family) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Map a list of package names to unique framework family names. */
function mapToFamilies(packageNames: string[]): string[] {
  const families = new Set<string>();
  for (const name of packageNames) {
    const family = PACKAGE_TO_FAMILY.get(name);
    if (family) families.add(family);
  }
  return [...families];
}

/**
 * Find framework families where at least one imported package is in devDeps
 * but none of the imported packages from that family are in deps.
 */
function findDevOnlyFamilies(
  deps: Record<string, string>,
  devDeps: Record<string, string>,
  sourceFamilyCounts: Map<string, number>,
): string[] {
  const devOnlyFamilies: string[] = [];

  for (const family of sourceFamilyCounts.keys()) {
    const memberPackages = FRAMEWORK_FAMILIES[family] ?? [];
    let anyInDevDeps = false;
    let anyInDeps = false;

    for (const pkg of memberPackages) {
      if (pkg in deps) anyInDeps = true;
      if (pkg in devDeps) anyInDevDeps = true;
    }

    if (anyInDevDeps && !anyInDeps) {
      devOnlyFamilies.push(family);
    }
  }

  return devOnlyFamilies;
}

/** Build the full MetaToolResult after any signal triggers. */
function buildResult(
  signal: MetaToolSignal,
  sourceFamilyCounts: Map<string, number>,
  dependencies: Record<string, string>,
  warnings: Warning[],
): MetaToolResult {
  // Completeness pass: ALL families from source imports
  const supportedFamilies = [...sourceFamilyCounts.keys()];

  // Dominant family detection (gated on production deps + margin)
  const coreFamilies = findCoreFamilies(sourceFamilyCounts, dependencies);

  warnings.push({
    level: "info",
    module: "meta-tool-detector",
    message: `Meta-tool detected via ${signal}: ${supportedFamilies.length} framework families. Core: ${coreFamilies.join(", ") || "none"}.`,
  });

  return { isMetaTool: true, signal, supportedFamilies, coreFamilies };
}

/**
 * Find framework families that are "core" (the host framework the tool is built with).
 * Must pass two gates: in production dependencies AND ≥3x the second-highest import count.
 */
function findCoreFamilies(
  sourceFamilyCounts: Map<string, number>,
  dependencies: Record<string, string>,
): string[] {
  const sorted = [...sourceFamilyCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length < 1) return [];

  const [topFamily, topCount] = sorted[0];
  const secondCount = sorted.length > 1 ? sorted[1][1] : 0;

  // Gate 1: at least one package from this family is in production dependencies
  const familyPackages = FRAMEWORK_FAMILIES[topFamily] ?? [];
  const inProductionDeps = familyPackages.some(pkg => pkg in dependencies);
  if (!inProductionDeps) return [];

  // Gate 2: import count ≥3x the second-highest family
  if (secondCount > 0 && topCount < secondCount * DOMINANT_MARGIN) return [];

  return [topFamily];
}
