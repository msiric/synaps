// src/detectors/test-framework-ecosystem.ts — W2-3: Ecosystem Test Framework Detector
// Detects specific test frameworks from dependencies and config, including Bun test.
// Fixes "Unknown test framework" in V3 benchmark for midday api-server.

import type { Convention, ConventionDetector, DetectorContext } from "../types.js";
import { buildConfidence } from "../convention-extractor.js";

const KNOWN_TEST_FRAMEWORKS = ["vitest", "jest", "@jest/core", "mocha", "ava", "tap"];

export const testFrameworkEcosystemDetector: ConventionDetector = (files, _tiers, _warnings, context) => {
  if (!context?.dependencies) return [];

  const conventions: Convention[] = [];
  const testFiles = files.filter((f) => f.isTestFile);
  if (testFiles.length === 0) return conventions;

  const fw = context.dependencies.testFramework;
  const runtime = context.dependencies.runtime;
  const hasBunRuntime = runtime?.some((r) => r.name === "bun");

  // Detect specific framework
  let frameworkName = "Unknown";
  let frameworkDetail = "";

  if (fw) {
    const name = fw.name.toLowerCase();
    if (name === "vitest") {
      frameworkName = "Vitest";
      frameworkDetail = `Vitest ${fw.version}`;
    } else if (name === "jest" || name === "@jest/core") {
      frameworkName = "Jest";
      frameworkDetail = `Jest ${fw.version}`;
    } else if (name === "mocha") {
      frameworkName = "Mocha";
      frameworkDetail = `Mocha ${fw.version}`;
    } else if (name === "ava") {
      frameworkName = "Ava";
      frameworkDetail = `Ava ${fw.version}`;
    }
  }

  // Fallback: check root devDeps for test frameworks (common in monorepos)
  if (frameworkName === "Unknown" && context.rootDevDeps) {
    for (const depName of Object.keys(context.rootDevDeps)) {
      if (KNOWN_TEST_FRAMEWORKS.includes(depName)) {
        const version = context.rootDevDeps[depName]?.replace(/^[\^~>=<]*\s*/, "") ?? "";
        const name = depName.toLowerCase();
        if (name === "vitest") {
          frameworkName = "Vitest";
          frameworkDetail = `Vitest ${version} (from monorepo root)`;
        } else if (name === "jest" || name === "@jest/core") {
          frameworkName = "Jest";
          frameworkDetail = `Jest ${version} (from monorepo root)`;
        } else if (name === "mocha") {
          frameworkName = "Mocha";
          frameworkDetail = `Mocha ${version} (from monorepo root)`;
        } else if (name === "ava") {
          frameworkName = "Ava";
          frameworkDetail = `Ava ${version} (from monorepo root)`;
        }
        if (frameworkName !== "Unknown") break;
      }
    }
  }

  // Check for Bun test — no package.json dep needed, just Bun runtime + test files
  if (frameworkName === "Unknown" && hasBunRuntime) {
    // Check if test files use bun:test imports
    const bunTestFiles = testFiles.filter((f) =>
      f.imports.some((i) => i.moduleSpecifier === "bun:test"),
    );
    if (bunTestFiles.length > 0) {
      frameworkName = "Bun test";
      frameworkDetail = "Bun built-in test runner";
    } else if (testFiles.length > 0) {
      // If Bun runtime and test files exist but no explicit test framework dep
      // It's likely using Bun test (which is built-in, no npm package needed)
      frameworkName = "Bun test (inferred)";
      frameworkDetail = "Bun built-in test runner (inferred from runtime + test files)";
    }
  }

  // Check for Playwright / Cypress (e2e)
  const deps = context.dependencies.frameworks?.map((f) => f.name) ?? [];
  const hasPlaywright = deps.includes("@playwright/test");
  const hasCypress = deps.includes("cypress");

  if (frameworkName !== "Unknown") {
    conventions.push({
      category: "testing",
      name: `${frameworkName} test framework (ecosystem)`,
      description: `Tests use ${frameworkDetail}${hasPlaywright ? " + Playwright (e2e)" : ""}${hasCypress ? " + Cypress (e2e)" : ""}`,
      confidence: buildConfidence(testFiles.length, testFiles.length),
      examples: [`${testFiles.length} test files detected`],
    });
  }

  return conventions;
};
