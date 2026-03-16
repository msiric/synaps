import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findBestPattern,
  findReferences,
  getCoChangesForFile,
  getExecutionFlows,
  getFlowsForFiles,
  getFlowsForFunction,
  getImplicitCouplingForFile,
  getModuleDoc,
  getRegistrationInsertions,
  search,
} from "../../src/mcp/queries.js";
import { formatSessionSummary, type SessionTelemetry } from "../../src/mcp/server.js";
import * as tools from "../../src/mcp/tools.js";
import type { PackageAnalysis, StructuredAnalysis } from "../../src/types.js";

// ─── Fixture ─────────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<PackageAnalysis> = {}): StructuredAnalysis {
  return {
    meta: { engineVersion: "0.5.0", analyzedAt: "", rootDir: "/tmp", config: {} as any, timingMs: 100 },
    packages: [
      {
        name: "test-pkg",
        version: "1.0.0",
        description: "Test package",
        relativePath: ".",
        files: {
          total: 20,
          byTier: {
            tier1: { count: 5, lines: 500, files: [] },
            tier2: { count: 10, lines: 1000, files: [] },
            tier3: { count: 5, lines: 200 },
          },
          byExtension: { ".ts": 20 },
        },
        publicAPI: [
          {
            name: "analyze",
            kind: "function" as const,
            sourceFile: "src/index.ts",
            isTypeOnly: false,
            importCount: 12,
            signature: "(opts) => Promise<Analysis>",
          },
          { name: "format", kind: "function" as const, sourceFile: "src/index.ts", isTypeOnly: false, importCount: 8 },
          { name: "Config", kind: "type" as const, sourceFile: "src/types.ts", isTypeOnly: true, importCount: 20 },
        ],
        conventions: [
          {
            category: "file-naming" as const,
            name: "kebab-case",
            description: "Use kebab-case",
            confidence: { matched: 20, total: 20, percentage: 100, description: "20/20" },
            examples: [],
            impact: "low" as const,
          },
          {
            category: "testing" as const,
            name: "co-located tests",
            description: "Tests next to source",
            confidence: { matched: 15, total: 18, percentage: 83, description: "15/18" },
            examples: [],
            impact: "high" as const,
          },
        ],
        commands: {
          packageManager: "pnpm" as const,
          build: { run: "pnpm run build", source: "package.json" },
          test: { run: "pnpm run test", source: "package.json" },
          lint: { run: "pnpm run lint", source: "package.json" },
          other: [],
        },
        architecture: {
          entryPoint: "src/index.ts",
          directories: [
            {
              path: "src/detectors",
              purpose: "Convention detectors",
              fileCount: 8,
              exports: ["fileNaming", "hooks"],
              pattern: "{name}.ts",
            },
            { path: "src/llm", purpose: "LLM integration", fileCount: 5, exports: ["adapter", "client"] },
            { path: "src/bin", purpose: "CLI entry points", fileCount: 3, exports: [] },
          ],
          packageType: "library" as const,
          hasJSX: false,
        },
        dependencies: { internal: [], external: [{ name: "typescript", importCount: 5 }], totalUniqueDependencies: 3 },
        role: { summary: "Codebase intelligence engine", purpose: "", whenToUse: "", inferredFrom: [] },
        antiPatterns: [
          {
            rule: "Do NOT use camelCase",
            reason: "Project uses kebab-case",
            confidence: "high" as const,
            derivedFrom: "file-naming",
          },
        ],
        contributionPatterns: [
          {
            type: "function",
            directory: "src/detectors/",
            filePattern: "{name}.ts",
            exampleFile: "src/detectors/file-naming.ts",
            steps: ["Create file", "Import Convention", "Export as Detector", "Register"],
            commonImports: [{ specifier: "../types.js", symbols: ["Convention"], coverage: 0.9 }],
            exportSuffix: "Detector",
            registrationFile: "src/convention-extractor.ts",
          },
        ],
        importChain: [
          {
            importer: "src/pipeline.ts",
            source: "src/types.ts",
            symbolCount: 12,
            symbols: ["StructuredAnalysis", "PackageAnalysis"],
          },
          {
            importer: "src/detectors/file-naming.ts",
            source: "src/types.ts",
            symbolCount: 2,
            symbols: ["Convention", "ConventionDetector"],
          },
          {
            importer: "src/convention-extractor.ts",
            source: "src/detectors/file-naming.ts",
            symbolCount: 1,
            symbols: ["fileNamingDetector"],
          },
          {
            importer: "src/formatter.ts",
            source: "src/types.ts",
            symbolCount: 8,
            symbols: ["Convention", "CommandSet"],
          },
        ],
        callGraph: [
          { from: "runPipeline", to: "analyzePackage", fromFile: "src/pipeline.ts", toFile: "src/pipeline.ts" },
          { from: "analyzePackage", to: "parseFile", fromFile: "src/pipeline.ts", toFile: "src/ast-parser.ts" },
        ],
        gitHistory: {
          coChangeEdges: [
            {
              file1: "src/formatter.ts",
              file2: "src/types.ts",
              coChangeCount: 8,
              file1Commits: 10,
              file2Commits: 15,
              jaccard: 0.47,
              lastCoChangeTimestamp: Date.now() / 1000,
            },
            // Cluster: pipeline <-> types <-> formatter (3-file clique)
            {
              file1: "src/formatter.ts",
              file2: "src/pipeline.ts",
              coChangeCount: 6,
              file1Commits: 10,
              file2Commits: 12,
              jaccard: 0.38,
              lastCoChangeTimestamp: Date.now() / 1000,
            },
            {
              file1: "src/pipeline.ts",
              file2: "src/types.ts",
              coChangeCount: 7,
              file1Commits: 12,
              file2Commits: 15,
              jaccard: 0.35,
              lastCoChangeTimestamp: Date.now() / 1000,
            },
          ],
          totalCommitsAnalyzed: 25,
          commitsFilteredBySize: 1,
          historySpanDays: 30,
        },
        implicitCoupling: [{ file1: "src/formatter.ts", file2: "src/config.ts", jaccard: 0.32, coChangeCount: 4 }],
        coChangeClusters: [["src/formatter.ts", "src/pipeline.ts", "src/types.ts"]],
        executionFlows: [
          {
            label: "runPipeline → analyzePackage (2 steps, 1 files)",
            entryPoint: "runPipeline",
            entryFile: "src/pipeline.ts",
            terminal: "analyzePackage",
            terminalFile: "src/pipeline.ts",
            steps: ["runPipeline", "analyzePackage"],
            files: ["src/pipeline.ts", "src/pipeline.ts"],
            length: 2,
            confidence: 0.35,
          },
        ],
        configAnalysis: {
          typescript: { strict: true, target: "ES2022", module: "esnext", moduleResolution: "bundler" },
        },
        dependencyInsights: {
          runtime: [{ name: "Node", version: "20" }],
          frameworks: [{ name: "TypeScript", version: "5.4" }],
          testFramework: { name: "Vitest", version: "2.0" },
        },
        ...overrides,
      } as PackageAnalysis,
    ],
    crossPackage: {
      dependencyGraph: [],
      sharedConventions: [],
      divergentConventions: [],
      sharedAntiPatterns: [],
      workflowRules: [
        {
          trigger: "When modifying src/types.ts",
          action: "Check 5 dependent files",
          source: "Import chain",
          impact: "high" as const,
        },
        {
          trigger: "After changing convention detectors",
          action: "Run full test suite",
          source: "Technology",
          impact: "high" as const,
        },
      ],
    },
    warnings: [],
  };
}

// ─── Tool Tests ──────────────────────────────────────────────────────────────

describe("handleGetCommands", () => {
  it("returns formatted command table", () => {
    const result = tools.handleGetCommands(makeAnalysis(), {});
    const text = result.content[0].text;
    expect(text).toContain("pnpm run build");
    expect(text).toContain("pnpm run test");
    expect(text).toContain("pnpm run lint");
    expect(text).toContain("Package manager: pnpm");
  });

  it("includes tech stack summary", () => {
    const result = tools.handleGetCommands(makeAnalysis(), {});
    expect(result.content[0].text).toContain("Node 20");
  });
});

describe("handleGetArchitecture", () => {
  it("returns directory tree with purposes", () => {
    const result = tools.handleGetArchitecture(makeAnalysis(), {});
    const text = result.content[0].text;
    expect(text).toContain("src/detectors");
    expect(text).toContain("Convention detectors");
    expect(text).toContain("8 files");
    expect(text).toContain("library");
  });
});

describe("handleAnalyzeImpact", () => {
  it("returns importers for a file", () => {
    const result = tools.handleAnalyzeImpact(makeAnalysis(), {
      filePath: "src/types.ts",
      scope: "imports",
    });
    const text = result.content[0].text;
    expect(text).toContain("src/pipeline.ts");
    expect(text).toContain("12 symbols");
    expect(text).toContain("Importers");
  });

  it("returns co-changes for a file", () => {
    const result = tools.handleAnalyzeImpact(makeAnalysis(), {
      filePath: "src/types.ts",
      scope: "cochanges",
    });
    const text = result.content[0].text;
    expect(text).toContain("src/formatter.ts");
    expect(text).toContain("Jaccard");
  });

  it("returns combined analysis with scope=all", () => {
    const result = tools.handleAnalyzeImpact(makeAnalysis(), {
      filePath: "src/types.ts",
      functionName: "runPipeline",
    });
    const text = result.content[0].text;
    expect(text).toContain("Importers");
    expect(text).toContain("Callers");
    expect(text).toContain("Co-change");
  });

  it("handles missing file gracefully", () => {
    const result = tools.handleAnalyzeImpact(makeAnalysis(), {
      filePath: "src/nonexistent.ts",
      scope: "imports",
    });
    expect(result.content[0].text).toContain("No files import");
  });

  it("shows implicit coupling in cochanges scope", () => {
    const result = tools.handleAnalyzeImpact(makeAnalysis(), {
      filePath: "src/formatter.ts",
      scope: "cochanges",
    });
    const text = result.content[0].text;
    expect(text).toContain("Implicit Coupling");
    expect(text).toContain("src/config.ts");
    expect(text).toContain("no import path");
  });

  it("shows co-change cluster membership", () => {
    const result = tools.handleAnalyzeImpact(makeAnalysis(), {
      filePath: "src/types.ts",
      scope: "cochanges",
    });
    const text = result.content[0].text;
    expect(text).toContain("Co-change Cluster");
    expect(text).toContain("3-file cluster");
    expect(text).toContain("src/formatter.ts");
    expect(text).toContain("src/pipeline.ts");
  });

  it("shows git history metadata", () => {
    const result = tools.handleAnalyzeImpact(makeAnalysis(), {
      filePath: "src/types.ts",
      scope: "cochanges",
    });
    const text = result.content[0].text;
    expect(text).toContain("25 commits analyzed");
    expect(text).toContain("30 days");
    expect(text).toContain("1 large commits excluded");
  });

  it("omits implicit coupling section when none exist", () => {
    const result = tools.handleAnalyzeImpact(makeAnalysis(), {
      filePath: "src/types.ts",
      scope: "cochanges",
    });
    const text = result.content[0].text;
    // src/types.ts has no implicit coupling in fixture — only src/formatter.ts does
    expect(text).not.toContain("Implicit Coupling");
  });
});

describe("handleGetWorkflowRules", () => {
  it("returns numbered rules", () => {
    const result = tools.handleGetWorkflowRules(makeAnalysis(), {});
    const text = result.content[0].text;
    expect(text).toContain("1.");
    expect(text).toContain("When modifying src/types.ts");
    expect(text).toContain("Check 5 dependent files");
  });
});

describe("handleListPackages", () => {
  it("returns package table", () => {
    const result = tools.handleListPackages(makeAnalysis());
    const text = result.content[0].text;
    expect(text).toContain("test-pkg");
    expect(text).toContain("library");
    expect(text).toContain("src/index.ts");
  });
});

describe("handleGetContributionGuide", () => {
  it("returns step-by-step recipe", () => {
    const result = tools.handleGetContributionGuide(makeAnalysis(), {});
    const text = result.content[0].text;
    expect(text).toContain("src/detectors/");
    expect(text).toContain("Detector");
    expect(text).toContain("Register");
    expect(text).toContain("../types.js");
  });

  it("filters by directory", () => {
    const result = tools.handleGetContributionGuide(makeAnalysis(), { directory: "src/llm" });
    expect(result.content[0].text).toContain("No contribution patterns");
  });
});

describe("handleGetExports", () => {
  it("returns API table", () => {
    const result = tools.handleGetExports(makeAnalysis(), {});
    const text = result.content[0].text;
    expect(text).toContain("analyze");
    expect(text).toContain("function");
    expect(text).toContain("12");
  });

  it("filters by query", () => {
    const result = tools.handleGetExports(makeAnalysis(), { query: "config" });
    const text = result.content[0].text;
    expect(text).toContain("Config");
    expect(text).not.toContain("analyze");
  });
});

describe("handleGetConventions", () => {
  it("returns DO/DON'T rules", () => {
    const result = tools.handleGetConventions(makeAnalysis(), {});
    const text = result.content[0].text;
    expect(text).toContain("DO");
    expect(text).toContain("DO NOT");
    expect(text).toContain("camelCase");
  });
});

// ─── findBestPattern + nested directory matching ────────────────────────────

describe("findBestPattern", () => {
  const patterns = [
    {
      type: "class",
      directory: "src/adapters/",
      filePattern: "{name}.ts",
      exampleFile: "src/adapters/fs.ts",
      steps: ["Create"],
      commonImports: [],
      exportSuffix: "Adapter",
      registrationFile: "src/index.ts",
    },
    {
      type: "class",
      directory: "src/adapters/llm/",
      filePattern: "{name}.ts",
      exampleFile: "src/adapters/llm/claude.ts",
      steps: ["Create"],
      commonImports: [],
      exportSuffix: "LLMAdapter",
    },
    {
      type: "function",
      directory: "src/utils/",
      filePattern: "{name}.ts",
      exampleFile: "src/utils/retry.ts",
      steps: ["Create"],
      commonImports: [],
    },
  ] as any[];

  it("selects most-specific pattern for nested directory", () => {
    const result = findBestPattern(patterns, "src/adapters/llm/openai.ts");
    expect(result).toBeDefined();
    expect(result!.directory).toBe("src/adapters/llm/");
    expect(result!.exportSuffix).toBe("LLMAdapter");
  });

  it("selects parent pattern when file is in parent directory", () => {
    const result = findBestPattern(patterns, "src/adapters/fs-adapter.ts");
    expect(result).toBeDefined();
    expect(result!.directory).toBe("src/adapters/");
    expect(result!.exportSuffix).toBe("Adapter");
  });

  it("returns undefined when file matches no pattern", () => {
    const result = findBestPattern(patterns, "src/core/engine.ts");
    expect(result).toBeUndefined();
  });

  it("matches utils directory correctly", () => {
    const result = findBestPattern(patterns, "src/utils/logger.ts");
    expect(result).toBeDefined();
    expect(result!.directory).toBe("src/utils/");
  });
});

describe("getRegistrationInsertions: nested directory fallback", () => {
  let tmpDir: string;

  beforeAll(() => {
    // Create temp project with a real registration file
    tmpDir = mkdtempSync(join(tmpdir(), "autodocs-test-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/index.ts"),
      ['import { FsAdapter } from "./adapters/fs.js";', "", "export const adapters = [FsAdapter];", ""].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeNestedAnalysis(): StructuredAnalysis {
    return {
      meta: { engineVersion: "0.8.0", analyzedAt: "", rootDir: tmpDir, config: {} as any, timingMs: 0 },
      packages: [
        {
          name: "test-pkg",
          version: "1.0.0",
          description: "",
          relativePath: ".",
          files: {
            total: 5,
            byTier: {
              tier1: { count: 5, lines: 500, files: ["src/adapters/fs.ts", "src/adapters/llm/claude.ts"] },
              tier2: { count: 0, lines: 0, files: [] },
              tier3: { count: 0, lines: 0 },
            },
            byExtension: { ".ts": 5 },
          },
          publicAPI: [],
          conventions: [],
          commands: { packageManager: "npm" as const, other: [] },
          architecture: { entryPoint: "src/index.ts", directories: [], packageType: "library" as const, hasJSX: false },
          dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
          role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
          antiPatterns: [],
          contributionPatterns: [
            {
              type: "class",
              directory: "src/adapters/",
              filePattern: "{name}.ts",
              exampleFile: "src/adapters/fs.ts",
              steps: ["Create adapter"],
              commonImports: [{ specifier: "../../core/types.js", symbols: ["Config"], coverage: 0.8 }],
              exportSuffix: "Adapter",
              registrationFile: "src/index.ts",
            },
            {
              type: "class",
              directory: "src/adapters/llm/",
              filePattern: "{name}.ts",
              exampleFile: "src/adapters/llm/claude.ts",
              steps: ["Create LLM adapter"],
              commonImports: [],
              exportSuffix: "LLMAdapter",
              // No registrationFile — this is the edge case
            },
          ],
        } as any,
      ],
      crossPackage: undefined,
      warnings: [],
    };
  }

  it("falls back to parent registrationFile when child has none", () => {
    const result = getRegistrationInsertions(makeNestedAnalysis(), "src/adapters/llm/openai.ts");
    expect(result.registrationFile).not.toBeNull();
    expect(result.registrationFile?.path).toBe("src/index.ts");
  });

  it("preserves child exportSuffix when falling back for registration", () => {
    const result = getRegistrationInsertions(makeNestedAnalysis(), "src/adapters/llm/openai.ts");
    // Export name should use the CHILD pattern's suffix (LLMAdapter), not the parent's
    expect(result.exportName).toBe("openaiLLMAdapter");
  });

  it("uses direct pattern when it has registrationFile", () => {
    const result = getRegistrationInsertions(makeNestedAnalysis(), "src/adapters/new-adapter.ts");
    expect(result.registrationFile).not.toBeNull();
    expect(result.registrationFile?.path).toBe("src/index.ts");
    expect(result.exportName).toBe("newAdapterAdapter");
  });

  it("returns null registration when no pattern matches", () => {
    const result = getRegistrationInsertions(makeNestedAnalysis(), "src/core/something.ts");
    expect(result.registrationFile).toBeNull();
  });
});

// ─── Session Telemetry ──────────────────────────────────────────────────────

describe("formatSessionSummary", () => {
  function makeSession(overrides: Partial<SessionTelemetry> = {}): SessionTelemetry {
    const calls = new Map<string, number>();
    calls.set("get_commands", 3);
    calls.set("diagnose", 2);
    calls.set("plan_change", 1);
    return {
      startTime: Date.now() - 42_000,
      calls,
      totalInputTokens: 230,
      totalOutputTokens: 4120,
      errors: 0,
      seq: 6,
      runId: "test-run",
      telemetryPath: null,
      ...overrides,
    };
  }

  it("formats session with correct totals", () => {
    const summary = formatSessionSummary(makeSession());
    expect(summary).toContain("6 calls");
    expect(summary).toContain("230");
    expect(summary).toContain("4.1K");
    expect(summary).toContain("42s");
  });

  it("lists tools sorted by frequency", () => {
    const summary = formatSessionSummary(makeSession());
    // get_commands (3) should come before diagnose (2) before plan_change (1)
    const toolsLine = summary.split("\n").find((l) => l.includes("Tools:"))!;
    expect(toolsLine).toMatch(/get_commands.*diagnose.*plan_change/);
  });

  it("uses Object.fromEntries for Map serialization", () => {
    const session = makeSession();
    const obj = Object.fromEntries(session.calls);
    expect(obj).toEqual({ get_commands: 3, diagnose: 2, plan_change: 1 });
    // Verify JSON.stringify works (Map would produce {})
    const json = JSON.stringify({ tools: obj });
    expect(json).toContain("get_commands");
    expect(json).toContain("3");
  });
});

// ─── Search Tool ──────────────────────────────────────────────────────────────

describe("handleSearch", () => {
  it("finds public API symbols by name", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "analyze" });
    const text = result.content[0].text;
    expect(text).toContain("analyze");
    expect(text).toContain("function");
    expect(text).toContain("src/index.ts");
    expect(text).toContain("imported by 12 files");
  });

  it("finds call-graph-only functions not in public API", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "parseFile" });
    const text = result.content[0].text;
    expect(text).toContain("parseFile");
    expect(text).toContain("src/ast-parser.ts");
    // parseFile is a callee of analyzePackage — verify caller enrichment
    expect(text).toContain("called by: analyzePackage");
  });

  it("finds files by path", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "formatter" });
    const text = result.content[0].text;
    // src/formatter.ts appears in importChain as an importer
    expect(text).toContain("src/formatter.ts");
    expect(text).toContain("Files");
  });

  it("finds conventions by description", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "kebab" });
    const text = result.content[0].text;
    expect(text).toContain("kebab-case");
    expect(text).toContain("convention");
  });

  it("finds workflow rules", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "types.ts" });
    const text = result.content[0].text;
    // types.ts is in publicAPI (Config type), importChain, and workflow rules
    expect(text).toContain("Conventions & Rules");
    expect(text).toContain("When modifying src/types.ts");
  });

  it("deduplicates API vs call graph — API entry wins", () => {
    // "runPipeline" is in call graph (from field). It's not in publicAPI in default fixture.
    // "analyze" IS in publicAPI. Verify it doesn't appear twice.
    const result = tools.handleSearch(makeAnalysis(), { query: "analyze" });
    const text = result.content[0].text;
    const matches = text.match(/\*\*analyze\*\*/g);
    expect(matches).toHaveLength(1);
  });

  it("returns helpful message when nothing found", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "xyznonexistent" });
    const text = result.content[0].text;
    expect(text).toContain("No results found");
  });

  it("respects limit parameter", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "a", limit: 2 });
    const text = result.content[0].text;
    const resultLines = text.split("\n").filter((l) => l.startsWith("- "));
    expect(resultLines.length).toBeLessThanOrEqual(2);
  });

  it("enriches function results with callees", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "runPipeline" });
    const text = result.content[0].text;
    expect(text).toContain("runPipeline");
    // runPipeline calls analyzePackage per the fixture call graph
    expect(text).toContain("calls: analyzePackage");
  });

  it("file results include co-change context", () => {
    const result = tools.handleSearch(makeAnalysis(), { query: "formatter" });
    const text = result.content[0].text;
    // src/formatter.ts co-changes with src/types.ts per the fixture gitHistory
    expect(text).toContain("co-changes with");
    expect(text).toContain("47%");
  });
});

// ─── Rename Tool ──────────────────────────────────────────────────────────────

describe("handleRename", () => {
  it("finds definition and importers for a public API symbol", () => {
    const result = tools.handleRename(makeAnalysis(), { symbolName: "Config", newName: "AppConfig" });
    const text = result.content[0].text;
    expect(text).toContain("Config → AppConfig");
    expect(text).toContain("src/types.ts");
    expect(text).toContain("Definition");
  });

  it("finds import references across files", () => {
    // "StructuredAnalysis" is imported by src/pipeline.ts in the fixture
    const result = tools.handleRename(makeAnalysis(), { symbolName: "StructuredAnalysis", newName: "Analysis" });
    const text = result.content[0].text;
    expect(text).toContain("Imports");
    expect(text).toContain("src/pipeline.ts");
  });

  it("finds call graph references", () => {
    // parseFile is called by analyzePackage (src/pipeline.ts → src/ast-parser.ts)
    const result = tools.handleRename(makeAnalysis(), { symbolName: "parseFile", newName: "parseSourceFile" });
    const text = result.content[0].text;
    expect(text).toContain("parseFile → parseSourceFile");
    // src/pipeline.ts imports parseFile AND calls it — should appear as call site or import
    expect(text).toContain("src/pipeline.ts");
  });

  it("shows helpful message for nonexistent symbol", () => {
    const result = tools.handleRename(makeAnalysis(), { symbolName: "nonExistent", newName: "foo" });
    const text = result.content[0].text;
    expect(text).toContain("not found");
    expect(text).toContain("search");
  });

  it("includes rename checklist", () => {
    const result = tools.handleRename(makeAnalysis(), { symbolName: "Config", newName: "AppConfig" });
    const text = result.content[0].text;
    expect(text).toContain("Rename Checklist");
    expect(text).toContain("Run tests");
  });
});

// ─── Module Doc Tool ──────────────────────────────────────────────────────────

describe("handleGetModuleDoc", () => {
  it("returns files and exports for a directory", () => {
    // src/ contains pipeline.ts, types.ts, formatter.ts, index.ts, ast-parser.ts per fixture
    const result = tools.handleGetModuleDoc(makeAnalysis(), { directory: "src" });
    const text = result.content[0].text;
    expect(text).toContain("Module: src/");
    expect(text).toContain("Files");
    expect(text).toContain("src/types.ts");
    expect(text).toContain("src/pipeline.ts");
  });

  it("shows exports on files that have them", () => {
    const result = tools.handleGetModuleDoc(makeAnalysis(), { directory: "src" });
    const text = result.content[0].text;
    // src/index.ts exports 'analyze' and 'format' per the fixture publicAPI
    expect(text).toContain("analyze");
  });

  it("shows internal call graph", () => {
    // runPipeline → analyzePackage both in src/pipeline.ts (both in src/)
    const result = tools.handleGetModuleDoc(makeAnalysis(), { directory: "src" });
    const text = result.content[0].text;
    expect(text).toContain("Internal Call Graph");
    expect(text).toContain("runPipeline");
  });

  it("shows cluster membership", () => {
    // Fixture has cluster: [formatter, pipeline, types] — all in src/
    const result = tools.handleGetModuleDoc(makeAnalysis(), { directory: "src" });
    const text = result.content[0].text;
    expect(text).toContain("Co-change Clusters");
    expect(text).toContain("3-file cluster");
  });

  it("handles empty directory gracefully", () => {
    const result = tools.handleGetModuleDoc(makeAnalysis(), { directory: "nonexistent" });
    const text = result.content[0].text;
    expect(text).toContain("No files found");
  });

  it("shows contribution pattern for matching directory", () => {
    const result = tools.handleGetModuleDoc(makeAnalysis(), { directory: "src/detectors" });
    const text = result.content[0].text;
    expect(text).toContain("How to Add Code");
    expect(text).toContain("Detector");
    expect(text).toContain("src/convention-extractor.ts");
  });
});

// ─── Query Function Unit Tests ────────────────────────────────────────────────

describe("getCoChangesForFile", () => {
  it("returns co-change edges sorted by jaccard", () => {
    const edges = getCoChangesForFile(makeAnalysis(), "src/types.ts");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].jaccard).toBeGreaterThanOrEqual(edges[edges.length - 1].jaccard);
  });

  it("returns empty array for file with no co-changes", () => {
    const edges = getCoChangesForFile(makeAnalysis(), "src/nonexistent.ts");
    expect(edges).toEqual([]);
  });

  it("filters to edges involving the requested file", () => {
    const edges = getCoChangesForFile(makeAnalysis(), "src/formatter.ts");
    for (const e of edges) {
      expect(e.file1 === "src/formatter.ts" || e.file2 === "src/formatter.ts").toBe(true);
    }
  });
});

describe("getImplicitCouplingForFile", () => {
  it("returns implicit coupling edges for a file", () => {
    const edges = getImplicitCouplingForFile(makeAnalysis(), "src/formatter.ts");
    expect(edges.length).toBe(1);
    expect(edges[0].file2).toBe("src/config.ts");
  });

  it("returns empty array for file with no implicit coupling", () => {
    const edges = getImplicitCouplingForFile(makeAnalysis(), "src/types.ts");
    expect(edges).toEqual([]);
  });
});

describe("search (query function)", () => {
  it("finds public API symbols", () => {
    const results = search(makeAnalysis(), "analyze");
    expect(results.some((r) => r.name === "analyze")).toBe(true);
  });

  it("finds call graph functions not in API", () => {
    const results = search(makeAnalysis(), "parseFile");
    expect(results.some((r) => r.name === "parseFile")).toBe(true);
  });

  it("finds file paths", () => {
    const results = search(makeAnalysis(), "formatter");
    expect(results.some((r) => r.kind === "file")).toBe(true);
  });

  it("finds conventions by description", () => {
    const results = search(makeAnalysis(), "kebab");
    expect(results.some((r) => r.kind === "convention")).toBe(true);
  });

  it("respects limit", () => {
    const results = search(makeAnalysis(), "a", undefined, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns empty for no matches", () => {
    const results = search(makeAnalysis(), "xyznonexistent");
    expect(results).toEqual([]);
  });

  it("deduplicates API vs call graph", () => {
    // "analyze" is in publicAPI — should not appear twice from call graph
    const results = search(makeAnalysis(), "analyze");
    const analyzeResults = results.filter((r) => r.name === "analyze");
    expect(analyzeResults.length).toBe(1);
  });
});

describe("findReferences", () => {
  it("finds definition and importers for a public API type", () => {
    const result = findReferences(makeAnalysis(), "Config");
    expect(result.sourceFile).toBe("src/types.ts");
    expect(result.symbolKind).toBe("type");
    expect(result.references.length).toBeGreaterThan(0);
    expect(result.references.some((r) => r.kind === "definition")).toBe(true);
  });

  it("finds importers via import chain", () => {
    const result = findReferences(makeAnalysis(), "StructuredAnalysis");
    const imports = result.references.filter((r) => r.kind === "import");
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.some((r) => r.file === "src/pipeline.ts")).toBe(true);
  });

  it("returns empty references for nonexistent symbol", () => {
    const result = findReferences(makeAnalysis(), "nonExistent");
    expect(result.sourceFile).toBeNull();
    expect(result.references.length).toBe(0);
  });

  it("resolves source file from import chain when not in API", () => {
    // fileNamingDetector is imported from src/detectors/file-naming.ts
    const result = findReferences(makeAnalysis(), "fileNamingDetector");
    expect(result.sourceFile).toBe("src/detectors/file-naming.ts");
  });
});

describe("getModuleDoc (query function)", () => {
  it("returns files in the requested directory only", () => {
    const doc = getModuleDoc(makeAnalysis(), "src/detectors");
    // Only files directly in src/detectors/, not in src/ or nested dirs
    for (const f of doc.files) {
      expect(f.path.startsWith("src/detectors/")).toBe(true);
    }
  });

  it("returns dependencies on external files", () => {
    // src/detectors/file-naming.ts imports from src/types.ts (external to module)
    const doc = getModuleDoc(makeAnalysis(), "src/detectors");
    expect(doc.dependencies.some((d) => d.file === "src/types.ts")).toBe(true);
  });

  it("returns dependents that import from this module", () => {
    // src/convention-extractor.ts imports from src/detectors/file-naming.ts
    const doc = getModuleDoc(makeAnalysis(), "src/detectors");
    expect(doc.dependents.some((d) => d.file === "src/convention-extractor.ts")).toBe(true);
  });

  it("includes contribution pattern", () => {
    const doc = getModuleDoc(makeAnalysis(), "src/detectors");
    expect(doc.contribution).toBeDefined();
    expect(doc.contribution!.exportSuffix).toBe("Detector");
    expect(doc.contribution!.registrationFile).toBe("src/convention-extractor.ts");
  });
});

describe("getExecutionFlows", () => {
  it("returns flows for the package", () => {
    const flows = getExecutionFlows(makeAnalysis());
    expect(flows.length).toBeGreaterThan(0);
    expect(flows[0].entryPoint).toBe("runPipeline");
  });
});

describe("getFlowsForFiles", () => {
  it("returns flows containing the specified files", () => {
    const flows = getFlowsForFiles(makeAnalysis(), ["src/pipeline.ts"]);
    expect(flows.length).toBeGreaterThan(0);
  });

  it("returns empty for files not in any flow", () => {
    const flows = getFlowsForFiles(makeAnalysis(), ["src/nonexistent.ts"]);
    expect(flows).toEqual([]);
  });
});

describe("getFlowsForFunction", () => {
  it("returns flows containing the specified function", () => {
    const flows = getFlowsForFunction(makeAnalysis(), "runPipeline");
    expect(flows.length).toBeGreaterThan(0);
  });

  it("returns empty for function not in any flow", () => {
    const flows = getFlowsForFunction(makeAnalysis(), "nonExistent");
    expect(flows).toEqual([]);
  });
});
