import { describe, it, expect } from "vitest";
import type { StructuredAnalysis, PackageAnalysis } from "../src/types.js";
import * as Q from "../src/mcp/queries.js";
import { handleDiagnose } from "../src/mcp/tools.js";

// ─── Fixture ─────────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<PackageAnalysis> = {}): StructuredAnalysis {
  return {
    meta: { engineVersion: "0.7.3", analyzedAt: "", rootDir: "/tmp/project", config: {} as any, timingMs: 100 },
    packages: [{
      name: "test-pkg",
      version: "1.0.0",
      description: "Test",
      relativePath: ".",
      files: {
        total: 10,
        byTier: {
          tier1: { count: 5, lines: 500, files: ["src/types.ts", "src/pipeline.ts", "src/validator.ts", "src/formatter.ts", "src/utils.ts"] },
          tier2: { count: 3, lines: 300, files: ["src/config.ts", "src/logger.ts", "src/helpers.ts"] },
          tier3: { count: 2, lines: 200 },
        },
        byExtension: { ".ts": 10 },
      },
      publicAPI: [],
      conventions: [],
      commands: {
        packageManager: "pnpm" as const,
        test: { run: "pnpm run test", source: "package.json" },
        other: [],
      },
      architecture: {
        entryPoint: "src/index.ts",
        directories: [],
        packageType: "library" as const,
        hasJSX: false,
      },
      dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
      role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
      antiPatterns: [],
      contributionPatterns: [],
      importChain: [
        // test imports from pipeline
        { importer: "test/pipeline.test.ts", source: "src/pipeline.ts", symbolCount: 3, symbols: ["runPipeline"] },
        // pipeline imports from types
        { importer: "src/pipeline.ts", source: "src/types.ts", symbolCount: 12, symbols: ["StructuredAnalysis", "PackageAnalysis"] },
        // pipeline imports from validator
        { importer: "src/pipeline.ts", source: "src/validator.ts", symbolCount: 4, symbols: ["validate"] },
        // formatter imports from types
        { importer: "src/formatter.ts", source: "src/types.ts", symbolCount: 8, symbols: ["Convention", "CommandSet"] },
        // validator imports from types
        { importer: "src/validator.ts", source: "src/types.ts", symbolCount: 6, symbols: ["Schema", "Rule"] },
      ],
      callGraph: [
        { from: "runPipeline", to: "validate", fromFile: "src/pipeline.ts", toFile: "src/validator.ts" },
        { from: "validate", to: "checkSchema", fromFile: "src/validator.ts", toFile: "src/types.ts" },
      ],
      gitHistory: {
        coChangeEdges: [
          // types.ts and validator.ts strongly co-change (12 times, Jaccard 0.65)
          { file1: "src/types.ts", file2: "src/validator.ts", coChangeCount: 12, file1Commits: 15, file2Commits: 14, jaccard: 0.65, lastCoChangeTimestamp: Date.now() / 1000 },
          // types.ts and formatter.ts moderately co-change
          { file1: "src/formatter.ts", file2: "src/types.ts", coChangeCount: 8, file1Commits: 10, file2Commits: 15, jaccard: 0.47, lastCoChangeTimestamp: Date.now() / 1000 },
          // types.ts and pipeline.ts weakly co-change (below threshold)
          { file1: "src/pipeline.ts", file2: "src/types.ts", coChangeCount: 3, file1Commits: 20, file2Commits: 15, jaccard: 0.09, lastCoChangeTimestamp: Date.now() / 1000 },
        ],
        totalCommitsAnalyzed: 50,
        commitsFilteredBySize: 0,
        historySpanDays: 60,
      },
      ...overrides,
    } as PackageAnalysis],
    crossPackage: {
      dependencyGraph: [],
      sharedConventions: [],
      divergentConventions: [],
      sharedAntiPatterns: [],
      workflowRules: [
        { trigger: "When modifying `src/types.ts`", action: "Check 5 dependent files", source: "Import chain", impact: "high" as const },
      ],
    },
    warnings: [],
  };
}

// ─── parseErrorText ─────────────────────────────────────────────────────────

describe("parseErrorText", () => {
  it("parses V8 stack traces", () => {
    const text = `TypeError: Cannot read property 'name' of undefined
    at processStage (src/pipeline.ts:142:15)
    at runPipeline (src/pipeline.ts:45:7)
    at Object.<anonymous> (test/pipeline.test.ts:23:5)`;

    const result = Q.parseErrorText(text);
    expect(result.message).toBe("Cannot read property 'name' of undefined");
    expect(result.files).toContain("src/pipeline.ts");
    expect(result.files).toContain("test/pipeline.test.ts");
  });

  it("parses TypeScript compiler errors", () => {
    const text = `src/types.ts(42,5): error TS2345: Argument of type 'string' is not assignable.
src/validator.ts(18,10): error TS2322: Type 'number' is not assignable.`;

    const result = Q.parseErrorText(text);
    expect(result.files).toContain("src/types.ts");
    expect(result.files).toContain("src/validator.ts");
  });

  it("parses Vitest output with FAIL header", () => {
    const text = ` FAIL  test/pipeline.test.ts > pipeline > stage 5
 ❯ src/pipeline.ts:142:15
   TypeError: Cannot read property 'name' of undefined`;

    const result = Q.parseErrorText(text);
    expect(result.testFile).toBe("test/pipeline.test.ts");
    expect(result.files).toContain("src/pipeline.ts");
  });

  it("parses generic path patterns (src/, lib/)", () => {
    const text = `Error in src/validator.ts:55 — validation failed
Also see lib/helpers.ts:12 for context`;

    const result = Q.parseErrorText(text);
    expect(result.files).toContain("src/validator.ts");
    expect(result.files).toContain("lib/helpers.ts");
  });

  it("parses non-standard directory prefixes (app/, pages/, components/)", () => {
    const text = `Error at app/api/auth/route.ts:23
  in pages/index.tsx:45
  from components/Button.tsx:12
  via packages/shared/utils.ts:8
  and server/middleware.ts:15`;

    const result = Q.parseErrorText(text);
    expect(result.files).toContain("app/api/auth/route.ts");
    expect(result.files).toContain("pages/index.tsx");
    expect(result.files).toContain("components/Button.tsx");
    expect(result.files).toContain("packages/shared/utils.ts");
    expect(result.files).toContain("server/middleware.ts");
  });

  it("filters out node_modules and node internals", () => {
    const text = `    at processStage (src/pipeline.ts:142:15)
    at Module._compile (node:internal/modules/cjs/loader:1376:14)
    at Object.require (node_modules/typescript/lib/typescript.js:1:1)`;

    const result = Q.parseErrorText(text);
    expect(result.files).toEqual(["src/pipeline.ts"]);
  });

  it("deduplicates file paths", () => {
    const text = `    at foo (src/types.ts:10:5)
    at bar (src/types.ts:20:5)
    at baz (src/types.ts:30:5)`;

    const result = Q.parseErrorText(text);
    expect(result.files).toEqual(["src/types.ts"]);
  });

  it("returns empty when no files parseable", () => {
    const text = `Something went wrong\nNo useful information`;
    const result = Q.parseErrorText(text);
    expect(result.files).toEqual([]);
    expect(result.testFile).toBeNull();
    expect(result.message).toBeNull();
  });

  it("normalizes absolute paths when rootDir provided", () => {
    const text = `    at fn (/tmp/project/src/types.ts:10:5)`;
    const result = Q.parseErrorText(text, "/tmp/project");
    expect(result.files).toEqual(["src/types.ts"]);
  });
});

// ─── traceImportChain ───────────────────────────────────────────────────────

describe("traceImportChain", () => {
  it("finds shortest path between files", () => {
    const analysis = makeAnalysis();
    const chain = Q.traceImportChain(analysis, "test/pipeline.test.ts", "src/types.ts");
    expect(chain).not.toBeNull();
    expect(chain![0]).toBe("test/pipeline.test.ts");
    expect(chain![chain!.length - 1]).toBe("src/types.ts");
    expect(chain!.length).toBeLessThanOrEqual(3);
  });

  it("returns null when no path exists", () => {
    const analysis = makeAnalysis();
    const chain = Q.traceImportChain(analysis, "test/pipeline.test.ts", "src/unrelated.ts");
    expect(chain).toBeNull();
  });

  it("handles bidirectional traversal", () => {
    const analysis = makeAnalysis();
    // src/types.ts → src/pipeline.ts (reverse direction in import chain)
    const chain = Q.traceImportChain(analysis, "src/types.ts", "test/pipeline.test.ts");
    expect(chain).not.toBeNull();
  });
});

// ─── buildSuspectList ───────────────────────────────────────────────────────

describe("buildSuspectList", () => {
  it("ranks missing co-change highest with recent changes", () => {
    const analysis = makeAnalysis();
    // types.ts changed recently, validator.ts did NOT (but they co-change at Jaccard 0.65)
    const recentChanges: Q.FileChange[] = [
      { file: "src/types.ts", hoursAgo: 2, commitMessage: "refactor: split User type", isUncommitted: false },
    ];

    const suspects = Q.buildSuspectList(analysis, ["src/pipeline.ts"], recentChanges);

    expect(suspects.length).toBeGreaterThan(0);
    // validator.ts should rank high due to missing co-change
    const validator = suspects.find(s => s.file === "src/validator.ts");
    expect(validator).toBeDefined();
    expect(validator!.signals.missingCoChange).toBeGreaterThan(0);
    expect(validator!.reason).toContain("Missing co-change");
  });

  it("ranks uncommitted changes with high recency", () => {
    const analysis = makeAnalysis();
    const recentChanges: Q.FileChange[] = [
      { file: "src/types.ts", hoursAgo: 0, isUncommitted: true },
    ];

    const suspects = Q.buildSuspectList(analysis, ["src/pipeline.ts"], recentChanges);
    const types = suspects.find(s => s.file === "src/types.ts");
    expect(types).toBeDefined();
    expect(types!.signals.recency).toBe(1.0); // e^(-0.05 * 0) = 1.0, max(0.05, 1.0) = 1.0
  });

  it("uses coupling-dominant weights when no recent changes", () => {
    const analysis = makeAnalysis();
    // No recent changes at all
    const suspects = Q.buildSuspectList(analysis, ["src/pipeline.ts"], []);

    // With coupling-dominant weights, files with high co-change should rank higher
    // All suspects should have recency=0 and missingCoChange=0
    for (const s of suspects) {
      expect(s.signals.recency).toBe(0);
      expect(s.signals.missingCoChange).toBe(0);
    }
  });

  it("applies call graph bonus excluding error site", () => {
    const analysis = makeAnalysis();
    const recentChanges: Q.FileChange[] = [
      { file: "src/validator.ts", hoursAgo: 1, commitMessage: "fix validation", isUncommitted: false },
    ];

    const suspects = Q.buildSuspectList(analysis, ["src/pipeline.ts"], recentChanges);

    // validator.ts has a call graph edge to pipeline.ts (error site) and is NOT the error site
    const validator = suspects.find(s => s.file === "src/validator.ts");
    expect(validator).toBeDefined();
    expect(validator!.callGraphBonus).toBe(true);

    // pipeline.ts IS the error site — should NOT get call graph bonus
    const pipeline = suspects.find(s => s.file === "src/pipeline.ts");
    if (pipeline) {
      expect(pipeline.callGraphBonus).toBe(false);
    }
  });

  it("returns at most 5 suspects", () => {
    const analysis = makeAnalysis();
    const suspects = Q.buildSuspectList(
      analysis,
      ["src/types.ts"],
      [{ file: "src/types.ts", hoursAgo: 0, isUncommitted: true }],
    );
    expect(suspects.length).toBeLessThanOrEqual(5);
  });

  it("filters out zero-score suspects", () => {
    const analysis = makeAnalysis();
    const suspects = Q.buildSuspectList(analysis, ["src/pipeline.ts"], []);
    for (const s of suspects) {
      expect(s.score).toBeGreaterThan(0);
    }
  });
});

// ─── handleDiagnose ─────────────────────────────────────────────────────────

describe("handleDiagnose", () => {
  it("returns validation message with no inputs", () => {
    const result = handleDiagnose(makeAnalysis(), {});
    const text = result.content[0].text;
    expect(text).toContain("Provide at least one");
    expect(text).toContain("errorText");
  });

  it("returns helpful message when no files parseable", () => {
    const result = handleDiagnose(makeAnalysis(), {
      errorText: "Something broke but no file paths here",
    });
    const text = result.content[0].text;
    expect(text).toContain("Could not extract file paths");
  });

  it("diagnoses from filePath input", () => {
    const result = handleDiagnose(makeAnalysis(), {
      filePath: "src/pipeline.ts",
    });
    const text = result.content[0].text;
    expect(text).toContain("## Diagnosis");
    expect(text).toContain("src/pipeline.ts");
    expect(text).toContain("Suggested Actions");
  });

  it("diagnoses from testFile with import resolution", () => {
    const result = handleDiagnose(makeAnalysis(), {
      testFile: "test/pipeline.test.ts",
    });
    const text = result.content[0].text;
    expect(text).toContain("## Diagnosis");
    // Should resolve test imports to find src/pipeline.ts as error-adjacent
    expect(text).toContain("src/pipeline.ts");
  });

  it("diagnoses from errorText with V8 stack", () => {
    const result = handleDiagnose(makeAnalysis(), {
      errorText: `TypeError: Cannot read property 'name' of undefined
    at processStage (src/pipeline.ts:142:15)
    at runPipeline (src/pipeline.ts:45:7)`,
    });
    const text = result.content[0].text;
    expect(text).toContain("## Diagnosis");
    expect(text).toContain("Cannot read property 'name' of undefined");
    expect(text).toContain("src/pipeline.ts");
    expect(text).toContain("Suspect Files");
  });

  it("includes plan_change next step suggestion", () => {
    const result = handleDiagnose(makeAnalysis(), {
      filePath: "src/pipeline.ts",
    });
    const text = result.content[0].text;
    expect(text).toContain("plan_change");
  });

  it("detects flaky test pattern with no changes", () => {
    // Override rootDir to null so getRecentFileChanges returns empty
    const analysis = makeAnalysis();
    analysis.meta.rootDir = "";

    const result = handleDiagnose(analysis, {
      errorText: "Error: ETIMEDOUT connecting to database\n    at src/db.ts:10:5",
      filePath: "src/db.ts",
    });
    const text = result.content[0].text;
    expect(text).toContain("Flaky Test");
  });
});
