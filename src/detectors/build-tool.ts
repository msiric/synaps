// src/detectors/build-tool.ts — W2-3: Build/Bundle Tool Pattern Detector
// Detects esbuild, webpack, rollup, vite, turbopack, swc from dependencies.

import type { Convention, ConventionDetector, DetectorContext } from "../types.js";
import { buildConfidence } from "../convention-extractor.js";

const BUNDLER_MAP: Record<string, { name: string; format: string }> = {
  webpack: { name: "Webpack", format: "CJS/ESM with loaders and plugins" },
  vite: { name: "Vite", format: "ESM-first, dev server with HMR" },
  esbuild: { name: "esbuild", format: "ESM/CJS, extremely fast Go-based bundler" },
  rollup: { name: "Rollup", format: "ESM-first, tree-shaking focused" },
  tsup: { name: "tsup", format: "ESM/CJS, zero-config TypeScript bundler (esbuild-based)" },
  unbuild: { name: "unbuild", format: "ESM/CJS, universal bundler (rollup-based)" },
  "@rspack/core": { name: "Rspack", format: "webpack-compatible, Rust-based fast bundler" },
  parcel: { name: "Parcel", format: "Zero-config bundler" },
  "@swc/core": { name: "SWC", format: "Rust-based compiler/bundler" },
};

export const buildToolDetector: ConventionDetector = (files, _tiers, _warnings, context) => {
  if (!context?.dependencies) return [];

  const conventions: Convention[] = [];
  const detected = new Set<string>();

  // Check dependency insights for bundler
  if (context.dependencies.bundler) {
    const b = context.dependencies.bundler;
    const bundler = BUNDLER_MAP[b.name];
    if (bundler && !detected.has(bundler.name)) {
      detected.add(bundler.name);
      conventions.push({
        category: "ecosystem",
        name: `${bundler.name} bundler`,
        description: `Built with ${bundler.name} (${b.version}): ${bundler.format}`,
        confidence: buildConfidence(1, 1),
        examples: [`${b.name}@${b.version}`],
      });
    }
  }

  // Check config for build orchestration tool
  if (context.config?.buildTool && context.config.buildTool.name !== "none") {
    const bt = context.config.buildTool;
    conventions.push({
      category: "ecosystem",
      name: `${bt.name} build orchestration`,
      description: `Build orchestration via ${bt.name} (${bt.configFile}). Tasks: ${bt.taskNames.join(", ")}.`,
      confidence: buildConfidence(1, 1),
      examples: [`Config: ${bt.configFile}`],
    });
  }

  // Fallback: check import patterns
  for (const [pkg, bundler] of Object.entries(BUNDLER_MAP)) {
    if (detected.has(bundler.name)) continue;
    const importCount = files.filter((f) =>
      f.imports.some((i) => i.moduleSpecifier === pkg || i.moduleSpecifier.startsWith(pkg + "/")),
    ).length;
    if (importCount > 0) {
      detected.add(bundler.name);
      conventions.push({
        category: "ecosystem",
        name: `${bundler.name} bundler`,
        description: `Uses ${bundler.name}: ${bundler.format}`,
        confidence: buildConfidence(importCount, importCount),
        examples: [`${importCount} files import from ${pkg}`],
      });
    }
  }

  return conventions;
};
