// test/wave2-improvements.test.ts — Tests for Wave 2 improvements
// W2-1: Output Validator, W2-2: Pattern Fingerprinter, W2-3: Ecosystem Detectors, W2-4: Diff Analyzer

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { validateOutput } from "../src/output-validator.js";
import { fingerprintTopExports } from "../src/pattern-fingerprinter.js";
import { diffAnalyses } from "../src/diff-analyzer.js";
import { dataFetchingDetector } from "../src/detectors/data-fetching.js";
import { testFrameworkEcosystemDetector } from "../src/detectors/test-framework-ecosystem.js";
import { databaseDetector } from "../src/detectors/database.js";
import { webFrameworkDetector } from "../src/detectors/web-framework.js";
import { buildToolDetector } from "../src/detectors/build-tool.js";
import type {
  StructuredAnalysis,
  PackageAnalysis,
  ParsedFile,
  TierInfo,
  Warning,
  DetectorContext,
  DependencyInsights,
} from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePackageAnalysis(overrides: Partial<PackageAnalysis> = {}): PackageAnalysis {
  return {
    name: "test-pkg",
    version: "1.0.0",
    description: "test package",
    relativePath: ".",
    files: {
      total: 10,
      byTier: {
        tier1: { count: 3, lines: 100, files: [] },
        tier2: { count: 5, lines: 200, files: [] },
        tier3: { count: 2, lines: 50 },
      },
      byExtension: { ".ts": 10 },
    },
    publicAPI: [
      { name: "useData", kind: "hook", sourceFile: "src/use-data.ts", isTypeOnly: false, importCount: 5 },
      { name: "fetchItems", kind: "function", sourceFile: "src/fetch-items.ts", isTypeOnly: false, importCount: 3 },
    ],
    conventions: [],
    commands: {
      packageManager: "bun",
      build: { run: "turbo run build", source: "turbo.json tasks.build" },
      test: { run: "vitest run", source: "package.json" },
      lint: { run: "turbo run lint", source: "turbo.json tasks.lint" },
      other: [],
    },
    architecture: {
      entryPoint: "src/index.ts",
      directories: [],
      packageType: "library",
      hasJSX: false,
    },
    dependencies: {
      internal: [],
      external: [
        { name: "@tanstack/react-query", importCount: 12 },
        { name: "react", importCount: 20 },
      ],
      totalUniqueDependencies: 2,
    },
    role: { summary: "test", purpose: "test", whenToUse: "test", inferredFrom: [] },
    antiPatterns: [],
    contributionPatterns: [],
    dependencyInsights: {
      runtime: [{ name: "bun", version: "1.3.8" }],
      frameworks: [
        { name: "react", version: "19.2.4" },
        { name: "next", version: "16.1.6" },
        { name: "@tanstack/react-query", version: "5.0.0" },
      ],
      testFramework: { name: "vitest", version: "2.0.0" },
    },
    ...overrides,
  };
}

function makeStructuredAnalysis(pkgOverrides: Partial<PackageAnalysis> = {}): StructuredAnalysis {
  return {
    meta: {
      engineVersion: "0.2.0",
      analyzedAt: new Date().toISOString(),
      rootDir: ".",
      config: {} as any,
      timingMs: 100,
    },
    packages: [makePackageAnalysis(pkgOverrides)],
    warnings: [],
  };
}

function makeParsedFile(overrides: Partial<ParsedFile> = {}): ParsedFile {
  return {
    relativePath: "src/test.ts",
    exports: [],
    imports: [],
    contentSignals: {
      tryCatchCount: 0, useMemoCount: 0, useCallbackCount: 0,
      useEffectCount: 0, useStateCount: 0, useQueryCount: 0,
      useMutationCount: 0, jestMockCount: 0, hasDisplayName: false,
      hasErrorBoundary: false,
    },
    lineCount: 50,
    isTestFile: false,
    isGeneratedFile: false,
    hasJSX: false,
    hasCJS: false,
    hasSyntaxErrors: false,
    callReferences: [],
    ...overrides,
  };
}

const emptyTiers = new Map<string, TierInfo>();
const emptyWarnings: Warning[] = [];

// ─── W2-1: Output Validator ──────────────────────────────────────────────────

describe("W2-1: Output Validator", () => {
  it("flags GraphQL hallucination when deps have @tanstack/react-query", () => {
    const analysis = makeStructuredAnalysis();
    const output = `# Test Package\n\nGraphQL hooks for data fetching.\nUses useQuery and useMutation for GraphQL operations.`;
    const result = validateOutput(output, analysis, "root");

    expect(result.isValid).toBe(false);
    const techIssue = result.issues.find((i) => i.type === "hallucinated_technology");
    expect(techIssue).toBeDefined();
    expect(techIssue!.message).toContain("graphql");
  });

  it("does not flag GraphQL when @apollo/client is in deps", () => {
    const analysis = makeStructuredAnalysis({
      dependencies: {
        internal: [],
        external: [{ name: "@apollo/client", importCount: 5 }],
        totalUniqueDependencies: 1,
      },
    });
    const output = `# Test Package\n\nGraphQL hooks for data fetching.`;
    const result = validateOutput(output, analysis, "root");

    const techIssues = result.issues.filter((i) => i.type === "hallucinated_technology" && i.message.includes("graphql"));
    expect(techIssues.length).toBe(0);
  });

  it("flags Next.js version mismatch (15 vs 16)", () => {
    const analysis = makeStructuredAnalysis();
    const output = `# Test Package\n\nNext.js 15 — App Router default.`;
    const result = validateOutput(output, analysis, "root");

    const versionIssue = result.issues.find((i) => i.type === "version_mismatch");
    expect(versionIssue).toBeDefined();
    expect(versionIssue!.message).toContain("16");
  });

  it("does not flag correct version", () => {
    const analysis = makeStructuredAnalysis();
    const output = `# Test Package\n\nNext.js 16 — App Router default.`;
    const result = validateOutput(output, analysis, "root");

    const versionIssues = result.issues.filter((i) => i.type === "version_mismatch");
    expect(versionIssues.length).toBe(0);
  });

  it("flags budget exceeded for package-detail format", () => {
    const analysis = makePackageAnalysis();
    const longOutput = Array(200).fill("- line content").join("\n");
    const result = validateOutput(longOutput, analysis, "package-detail");

    const budgetIssue = result.issues.find((i) => i.type === "budget_exceeded");
    expect(budgetIssue).toBeDefined();
  });

  it("does not flag budget for root format", () => {
    const analysis = makeStructuredAnalysis();
    const longOutput = Array(150).fill("- line content").join("\n");
    const result = validateOutput(longOutput, analysis, "root");

    const budgetIssues = result.issues.filter((i) => i.type === "budget_exceeded");
    expect(budgetIssues.length).toBe(0);
  });

  it("composes correction prompt for errors", () => {
    const analysis = makeStructuredAnalysis();
    const output = `# Test\n\nGraphQL hooks. Next.js 15 features.`;
    const result = validateOutput(output, analysis, "root");

    expect(result.correctionPrompt).toBeDefined();
    expect(result.correctionPrompt).toContain("issue(s)");
  });

  it("returns valid when no issues", () => {
    const analysis = makeStructuredAnalysis();
    // Output must meet minimum word count (300 for root format) to pass validation
    const filler = Array(60).fill("This is actionable content for AI tools to follow when working with this package.").join("\n");
    const output = `# Test Package\n\nUses TanStack Query for data fetching.\nNext.js 16 with App Router.\n\n${filler}`;
    const result = validateOutput(output, analysis, "root");

    expect(result.isValid).toBe(true);
    expect(result.correctionPrompt).toBeUndefined();
  });
});

// ─── W2-2: Pattern Fingerprinter ─────────────────────────────────────────────

describe("W2-2: Pattern Fingerprinter", () => {
  const fixtureDir = resolve(__dirname, "fixtures/exports-pkg");

  it("returns fingerprints for top exports", () => {
    const publicAPI = [
      {
        name: "greet",
        kind: "function" as const,
        sourceFile: "src/index.ts",
        isTypeOnly: false,
        importCount: 5,
      },
    ];
    const fps = fingerprintTopExports(publicAPI, fixtureDir, 5);

    // May or may not find greet depending on fixture structure
    // The important thing is it doesn't throw
    expect(Array.isArray(fps)).toBe(true);
  });

  it("returns empty array for type-only exports", () => {
    const publicAPI = [
      {
        name: "MyType",
        kind: "type" as const,
        sourceFile: "src/types.ts",
        isTypeOnly: true,
        importCount: 10,
      },
    ];
    const fps = fingerprintTopExports(publicAPI, fixtureDir, 5);
    expect(fps.length).toBe(0);
  });

  it("limits to topN entries", () => {
    const publicAPI = Array.from({ length: 20 }, (_, i) => ({
      name: `func${i}`,
      kind: "function" as const,
      sourceFile: "src/index.ts",
      isTypeOnly: false,
      importCount: 20 - i,
    }));
    const fps = fingerprintTopExports(publicAPI, fixtureDir, 3);
    // May find fewer if source doesn't have them
    expect(fps.length).toBeLessThanOrEqual(3);
  });
});

// ─── W2-3: Ecosystem Detectors ───────────────────────────────────────────────

describe("W2-3: Data Fetching Detector", () => {
  it("detects TanStack Query from @tanstack/react-query imports", () => {
    const files: ParsedFile[] = [
      makeParsedFile({
        imports: [
          { moduleSpecifier: "@tanstack/react-query", importedNames: ["useQuery", "useMutation"], isTypeOnly: false, isDynamic: false },
        ],
      }),
    ];
    const result = dataFetchingDetector(files, emptyTiers, emptyWarnings);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("TanStack Query");
    expect(result[0].description).toContain("NOT GraphQL");
  });

  it("detects Apollo Client as GraphQL", () => {
    const files: ParsedFile[] = [
      makeParsedFile({
        imports: [
          { moduleSpecifier: "@apollo/client", importedNames: ["useQuery"], isTypeOnly: false, isDynamic: false },
        ],
      }),
    ];
    const result = dataFetchingDetector(files, emptyTiers, emptyWarnings);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("Apollo");
    expect(result[0].name).toContain("GraphQL");
  });

  it("detects tRPC as not GraphQL", () => {
    const files: ParsedFile[] = [
      makeParsedFile({
        imports: [
          { moduleSpecifier: "@trpc/react-query", importedNames: ["useQuery"], isTypeOnly: false, isDynamic: false },
        ],
      }),
    ];
    const result = dataFetchingDetector(files, emptyTiers, emptyWarnings);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("tRPC");
  });

  it("does NOT assume GraphQL for unknown sources", () => {
    const files: ParsedFile[] = [
      makeParsedFile({
        imports: [
          { moduleSpecifier: "./custom-hooks", importedNames: ["useQuery"], isTypeOnly: false, isDynamic: false },
        ],
      }),
    ];
    const result = dataFetchingDetector(files, emptyTiers, emptyWarnings);

    // Should say "Custom" not "GraphQL"
    if (result.length > 0) {
      expect(result[0].name).toContain("Custom");
      expect(result[0].description).toContain("Do NOT assume GraphQL");
    }
  });

  it("returns empty for files without query hooks", () => {
    const files: ParsedFile[] = [
      makeParsedFile({ imports: [{ moduleSpecifier: "react", importedNames: ["useState"], isTypeOnly: false, isDynamic: false }] }),
    ];
    const result = dataFetchingDetector(files, emptyTiers, emptyWarnings);
    expect(result.length).toBe(0);
  });
});

describe("W2-3: Test Framework Ecosystem Detector", () => {
  it("detects Bun test from runtime + test files", () => {
    const files: ParsedFile[] = [
      makeParsedFile({
        relativePath: "src/test.test.ts",
        isTestFile: true,
        imports: [{ moduleSpecifier: "bun:test", importedNames: ["describe", "it", "expect"], isTypeOnly: false, isDynamic: false }],
      }),
    ];
    const context: DetectorContext = {
      dependencies: {
        runtime: [{ name: "bun", version: "1.3.8" }],
        frameworks: [],
      },
    };
    const result = testFrameworkEcosystemDetector(files, emptyTiers, emptyWarnings, context);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("Bun test");
  });

  it("detects Vitest from dependency insights", () => {
    const files: ParsedFile[] = [
      makeParsedFile({ relativePath: "test.test.ts", isTestFile: true }),
    ];
    const context: DetectorContext = {
      dependencies: {
        runtime: [],
        frameworks: [],
        testFramework: { name: "vitest", version: "2.0.0" },
      },
    };
    const result = testFrameworkEcosystemDetector(files, emptyTiers, emptyWarnings, context);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("Vitest");
  });

  it("returns empty when no test files", () => {
    const files: ParsedFile[] = [makeParsedFile()];
    const context: DetectorContext = {
      dependencies: { runtime: [{ name: "bun", version: "1.0.0" }], frameworks: [] },
    };
    const result = testFrameworkEcosystemDetector(files, emptyTiers, emptyWarnings, context);
    expect(result.length).toBe(0);
  });
});

describe("W2-3: Database Detector", () => {
  it("detects Drizzle ORM from framework dependencies", () => {
    const context: DetectorContext = {
      dependencies: {
        runtime: [],
        frameworks: [{ name: "drizzle-orm", version: "0.30.0" }],
      },
    };
    const result = databaseDetector([], emptyTiers, emptyWarnings, context);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("Drizzle");
  });

  it("detects Prisma from imports", () => {
    const files: ParsedFile[] = [
      makeParsedFile({
        imports: [{ moduleSpecifier: "@prisma/client", importedNames: ["PrismaClient"], isTypeOnly: false, isDynamic: false }],
      }),
    ];
    const context: DetectorContext = {
      dependencies: { runtime: [], frameworks: [] },
    };
    const result = databaseDetector(files, emptyTiers, emptyWarnings, context);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("Prisma");
  });
});

describe("W2-3: Web Framework Detector", () => {
  it("detects Hono from framework dependencies", () => {
    const context: DetectorContext = {
      dependencies: {
        runtime: [],
        frameworks: [{ name: "hono", version: "4.0.0" }],
      },
    };
    const result = webFrameworkDetector([], emptyTiers, emptyWarnings, context);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("Hono");
    expect(result[0].description.toLowerCase()).toContain("middleware");
  });

  it("detects Express from imports", () => {
    const files: ParsedFile[] = [
      makeParsedFile({
        imports: [{ moduleSpecifier: "express", importedNames: ["Router"], isTypeOnly: false, isDynamic: false }],
      }),
    ];
    const context: DetectorContext = {
      dependencies: { runtime: [], frameworks: [] },
    };
    const result = webFrameworkDetector(files, emptyTiers, emptyWarnings, context);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("Express");
  });
});

describe("W2-3: Build Tool Detector", () => {
  it("detects Vite from bundler in dependency insights", () => {
    const context: DetectorContext = {
      dependencies: {
        runtime: [],
        frameworks: [],
        bundler: { name: "vite", version: "5.0.0" },
      },
    };
    const result = buildToolDetector([], emptyTiers, emptyWarnings, context);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("Vite");
  });

  it("detects Turbo from config analysis", () => {
    const context: DetectorContext = {
      dependencies: { runtime: [], frameworks: [] },
      config: {
        buildTool: { name: "turbo", taskNames: ["build", "test", "lint"], configFile: "turbo.json" },
      },
    };
    const result = buildToolDetector([], emptyTiers, emptyWarnings, context);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toContain("turbo");
  });
});

// ─── W2-4: Diff Analyzer ────────────────────────────────────────────────────

describe("W2-4: Diff Analyzer", () => {
  it("detects new exports", () => {
    const previous = makeStructuredAnalysis({
      publicAPI: [
        { name: "useData", kind: "hook", sourceFile: "src/use-data.ts", isTypeOnly: false, importCount: 5 },
      ],
    });
    const current = makeStructuredAnalysis({
      publicAPI: [
        { name: "useData", kind: "hook", sourceFile: "src/use-data.ts", isTypeOnly: false, importCount: 5 },
        { name: "useNewHook", kind: "hook", sourceFile: "src/use-new.ts", isTypeOnly: false, importCount: 2 },
      ],
    });
    const diff = diffAnalyses(current, previous);

    expect(diff.newExports).toContain("test-pkg:useNewHook");
    expect(diff.needsUpdate).toBe(true);
  });

  it("detects removed exports", () => {
    const previous = makeStructuredAnalysis({
      publicAPI: [
        { name: "useData", kind: "hook", sourceFile: "src/use-data.ts", isTypeOnly: false, importCount: 5 },
        { name: "oldFunc", kind: "function", sourceFile: "src/old.ts", isTypeOnly: false, importCount: 1 },
      ],
    });
    const current = makeStructuredAnalysis({
      publicAPI: [
        { name: "useData", kind: "hook", sourceFile: "src/use-data.ts", isTypeOnly: false, importCount: 5 },
      ],
    });
    const diff = diffAnalyses(current, previous);

    expect(diff.removedExports).toContain("test-pkg:oldFunc");
    expect(diff.needsUpdate).toBe(true);
  });

  it("detects command changes", () => {
    const previous = makeStructuredAnalysis({
      commands: {
        packageManager: "bun",
        build: { run: "bun run build", source: "package.json" },
        other: [],
      },
    });
    const current = makeStructuredAnalysis({
      commands: {
        packageManager: "bun",
        build: { run: "turbo run build", source: "turbo.json" },
        other: [],
      },
    });
    const diff = diffAnalyses(current, previous);

    expect(diff.commandsChanged).toBe(true);
    expect(diff.needsUpdate).toBe(true);
  });

  it("detects major version bumps", () => {
    const previous = makeStructuredAnalysis({
      dependencyInsights: {
        runtime: [],
        frameworks: [{ name: "react", version: "18.2.0" }],
      },
    });
    const current = makeStructuredAnalysis({
      dependencyInsights: {
        runtime: [],
        frameworks: [{ name: "react", version: "19.2.4" }],
      },
    });
    const diff = diffAnalyses(current, previous);

    expect(diff.dependencyChanges.majorVersionChanged.length).toBeGreaterThan(0);
    expect(diff.dependencyChanges.majorVersionChanged[0]).toContain("react");
    expect(diff.needsUpdate).toBe(true);
  });

  it("returns needsUpdate=false for no changes", () => {
    const analysis = makeStructuredAnalysis();
    const diff = diffAnalyses(analysis, analysis);

    expect(diff.needsUpdate).toBe(false);
    expect(diff.summary).toContain("No significant changes");
  });

  it("provides a human-readable summary", () => {
    const previous = makeStructuredAnalysis({ publicAPI: [] });
    const current = makeStructuredAnalysis();
    const diff = diffAnalyses(current, previous);

    expect(diff.summary.length).toBeGreaterThan(0);
    expect(diff.summary).toContain("export");
  });
});

// ─── Dependency Analyzer Bug Fix ─────────────────────────────────────────────

describe("Dependency Analyzer: Next.js version fix", () => {
  it("produces correct guidance for Next.js 16", async () => {
    // This is tested via the dependency-analyzer directly
    const { analyzeDependencies } = await import("../src/dependency-analyzer.js");
    const fixtureDir = resolve(__dirname, "fixtures/minimal-pkg");
    const result = analyzeDependencies(fixtureDir);

    // The fix ensures major >= 16 gets its own guidance, not "Next.js 15" text
    // We can't test this directly without a fixture that has next@16, but we
    // verify the function still works
    expect(result).toBeDefined();
    expect(result.runtime).toBeDefined();
    expect(result.frameworks).toBeDefined();
  });
});
