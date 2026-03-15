// test/diagnose-signals.test.ts — Tests for Phase A/B/C diagnose and plan_change improvements:
// directory locality, error classification, entry point detection, symbol filtering.

import { describe, expect, it } from "vitest";
import * as Q from "../src/mcp/queries.js";
import { handlePlanChange } from "../src/mcp/tools.js";
import type { PackageAnalysis, StructuredAnalysis } from "../src/types.js";

// ─── Shared Fixture ─────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<PackageAnalysis> = {}): StructuredAnalysis {
  return {
    meta: { engineVersion: "test", analyzedAt: "", rootDir: ".", config: {} as any, timingMs: 0 },
    packages: [
      {
        name: "test-pkg",
        version: "1.0.0",
        description: "",
        relativePath: ".",
        files: {
          total: 10,
          byTier: {
            tier1: {
              count: 5,
              lines: 500,
              files: ["src/index.ts", "src/auth.ts", "src/db.ts", "src/utils.ts", "src/config.ts"],
            },
            tier2: {
              count: 3,
              lines: 300,
              files: ["src/plugins/astro/index.ts", "src/plugins/webpack/loader.ts", "src/helpers.ts"],
            },
            tier3: { count: 2, lines: 200 },
          },
          byExtension: { ".ts": 10 },
        },
        publicAPI: [],
        conventions: [],
        commands: { packageManager: "npm" as const, other: [] },
        architecture: { entryPoint: "src/index.ts", directories: [], packageType: "library" as const, hasJSX: false },
        dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
        role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
        antiPatterns: [],
        contributionPatterns: [],
        importChain: [
          // Test imports entry point (integration test pattern)
          { importer: "test/plugins/astro.test.ts", source: "src/index.ts", symbolCount: 1, symbols: ["run"] },
          // Entry point imports everything
          {
            importer: "src/index.ts",
            source: "src/auth.ts",
            symbolCount: 3,
            symbols: ["authenticate", "authorize", "getUser"],
          },
          { importer: "src/index.ts", source: "src/db.ts", symbolCount: 2, symbols: ["query", "connect"] },
          { importer: "src/index.ts", source: "src/plugins/astro/index.ts", symbolCount: 1, symbols: ["astroPlugin"] },
          // Direct unit test import
          {
            importer: "test/auth.test.ts",
            source: "src/auth.ts",
            symbolCount: 3,
            symbols: ["authenticate", "authorize", "getUser"],
          },
          // Auth depends on config
          { importer: "src/auth.ts", source: "src/config.ts", symbolCount: 2, symbols: ["Config", "loadConfig"] },
          // Types file with many importers
          {
            importer: "src/auth.ts",
            source: "src/types.ts",
            symbolCount: 5,
            symbols: ["User", "Session", "Role", "Permission", "Token"],
          },
          { importer: "src/db.ts", source: "src/types.ts", symbolCount: 2, symbols: ["User", "Query"] },
          { importer: "src/utils.ts", source: "src/types.ts", symbolCount: 1, symbols: ["Config"] },
        ],
        callGraph: [],
        gitHistory: { coChangeEdges: [], totalCommitsAnalyzed: 50, commitsFilteredBySize: 0, historySpanDays: 90 },
        ...overrides,
      },
    ],
    crossPackage: { dependencyGraph: [], sharedConventions: [], divergentConventions: [], sharedAntiPatterns: [] },
    warnings: [],
  };
}

// ─── Error Type Classification ──────────────────────────────────────────────

describe("parseErrorText error type classification", () => {
  it("classifies TypeError", () => {
    const result = Q.parseErrorText("TypeError: Cannot read properties of undefined");
    expect(result.errorType).toBe("type");
    expect(result.message).toBe("Cannot read properties of undefined");
  });

  it("classifies ReferenceError", () => {
    const result = Q.parseErrorText("ReferenceError: foo is not defined");
    expect(result.errorType).toBe("reference");
  });

  it("classifies SyntaxError", () => {
    const result = Q.parseErrorText("SyntaxError: Unexpected token }");
    expect(result.errorType).toBe("syntax");
  });

  it("classifies assertion from message content", () => {
    const result = Q.parseErrorText("Error: expect(received).toBe(expected)");
    expect(result.errorType).toBe("assertion");
  });

  it("classifies generic Error as runtime", () => {
    const result = Q.parseErrorText("Error: Connection refused");
    expect(result.errorType).toBe("runtime");
  });

  it("returns null errorType when no error pattern found", () => {
    const result = Q.parseErrorText("some random text without error patterns");
    expect(result.errorType).toBeNull();
  });
});

// ─── Directory Locality ─────────────────────────────────────────────────────

describe("directory locality in diagnose", () => {
  it("adds directory-matched candidates for integration tests", () => {
    const analysis = makeAnalysis();
    // test/plugins/astro.test.ts imports src/index.ts (entry point)
    // directory locality should discover src/plugins/astro/index.ts
    const { suspects } = Q.buildSuspectList(
      analysis,
      ["test/plugins/astro.test.ts"],
      [],
      undefined,
      "test/plugins/astro.test.ts",
    );

    const astroSuspect = suspects.find((s) => s.file === "src/plugins/astro/index.ts");
    expect(astroSuspect).toBeDefined();
    expect(astroSuspect!.signals.directoryLocality).toBe(1);
  });

  it("does not match generic directory names", () => {
    // "plugins" is generic — should not match src/plugins/webpack/loader.ts just because of "plugins"
    const analysis = makeAnalysis();
    const { suspects } = Q.buildSuspectList(
      analysis,
      ["test/plugins/astro.test.ts"],
      [],
      undefined,
      "test/plugins/astro.test.ts",
    );

    const webpackSuspect = suspects.find((s) => s.file === "src/plugins/webpack/loader.ts");
    // webpack shouldn't match "astro" test
    if (webpackSuspect) {
      expect(webpackSuspect.signals.directoryLocality).toBe(0);
    }
  });
});

// ─── Entry Point Detection + Selectivity ────────────────────────────────────

describe("unselective import detection", () => {
  it("detects when test imports entry point", () => {
    const analysis = makeAnalysis();
    // test/plugins/astro.test.ts imports src/index.ts (entry point)
    const { confidence } = Q.buildSuspectList(
      analysis,
      ["test/plugins/astro.test.ts"],
      [],
      undefined,
      "test/plugins/astro.test.ts",
    );
    // Should mention integration test pattern in confidence reason
    expect(confidence).not.toBe("high"); // integration test → not high confidence
  });

  it("does not trigger for unit tests that import specific modules", () => {
    const analysis = makeAnalysis();
    // test/auth.test.ts imports src/auth.ts directly (NOT entry point)
    const { suspects } = Q.buildSuspectList(analysis, ["test/auth.test.ts"], [], undefined, "test/auth.test.ts");

    // Auth should be a strong candidate (direct import from test)
    const authSuspect = suspects.find((s) => s.file === "src/auth.ts");
    expect(authSuspect).toBeDefined();
  });
});

// ─── getImportersOfSymbol ───────────────────────────────────────────────────

describe("getImportersOfSymbol", () => {
  it("returns only files importing the specific symbol", () => {
    const analysis = makeAnalysis();
    const importers = Q.getImportersOfSymbol(analysis, "User", "src/types.ts");
    const files = importers.map((e) => e.importer);
    expect(files).toContain("src/auth.ts"); // imports User
    expect(files).toContain("src/db.ts"); // imports User
    expect(files).not.toContain("src/utils.ts"); // imports Config, not User
  });

  it("returns empty for non-existent symbol", () => {
    const analysis = makeAnalysis();
    const importers = Q.getImportersOfSymbol(analysis, "NonExistent", "src/types.ts");
    expect(importers).toHaveLength(0);
  });

  it("returns empty for non-existent source file", () => {
    const analysis = makeAnalysis();
    const importers = Q.getImportersOfSymbol(analysis, "User", "src/missing.ts");
    expect(importers).toHaveLength(0);
  });
});

// ─── plan_change with Symbol Filtering ──────────────────────────────────────

describe("plan_change symbol filtering", () => {
  it("narrows dependents to files importing specific symbols", () => {
    const analysis = makeAnalysis();

    // Without symbols: all importers of src/types.ts
    const all = handlePlanChange(analysis, { files: ["src/types.ts"] });
    const allText = all.content[0].text;

    // With symbols: only files importing "User"
    const narrow = handlePlanChange(analysis, { files: ["src/types.ts"], symbols: ["User"] });
    const narrowText = narrow.content[0].text;

    // Narrow should have fewer dependents
    const allDeps = (allText.match(/(\d+) dependents/) ?? [])[1];
    const narrowDeps = (narrowText.match(/(\d+) dependents/) ?? [])[1];
    expect(Number(narrowDeps)).toBeLessThan(Number(allDeps));

    // Narrow should mention User-importing files
    expect(narrowText).toContain("src/auth.ts");
    expect(narrowText).toContain("src/db.ts");
    // Should NOT mention src/utils.ts (imports Config, not User)
    expect(narrowText).not.toContain("src/utils.ts");
  });

  it("works identically without symbols parameter", () => {
    const analysis = makeAnalysis();

    const result = handlePlanChange(analysis, { files: ["src/types.ts"] });
    const text = result.content[0].text;

    // All importers should be listed
    expect(text).toContain("src/auth.ts");
    expect(text).toContain("src/db.ts");
    expect(text).toContain("src/utils.ts");
  });

  it("handles empty symbols array same as no symbols", () => {
    const analysis = makeAnalysis();

    const withEmpty = handlePlanChange(analysis, { files: ["src/types.ts"], symbols: [] });
    const without = handlePlanChange(analysis, { files: ["src/types.ts"] });

    // Both should produce the same dependents count
    const emptyDeps = (withEmpty.content[0].text.match(/(\d+) dependents/) ?? [])[1];
    const noDeps = (without.content[0].text.match(/(\d+) dependents/) ?? [])[1];
    expect(emptyDeps).toBe(noDeps);
  });
});

// ─── Confidence Assessment ──────────────────────────────────────────────────

describe("diagnose confidence assessment", () => {
  it("returns DiagnoseResult with confidence field", () => {
    const analysis = makeAnalysis();
    const result = Q.buildSuspectList(analysis, ["src/pipeline.ts"], []);
    expect(result.confidence).toBeDefined();
    expect(result.confidenceReason).toBeDefined();
    expect(["high", "medium", "low"]).toContain(result.confidence);
  });

  it("returns low confidence when no suspects found", () => {
    const analysis = makeAnalysis({ importChain: [], gitHistory: undefined, callGraph: [] });
    const result = Q.buildSuspectList(analysis, ["src/nonexistent.ts"], []);
    expect(result.confidence).toBe("low");
  });
});
