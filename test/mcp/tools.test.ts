import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StructuredAnalysis, PackageAnalysis } from "../../src/types.js";
import * as tools from "../../src/mcp/tools.js";
import { findBestPattern, getRegistrationInsertions } from "../../src/mcp/queries.js";
import { formatSessionSummary, type SessionTelemetry } from "../../src/mcp/server.js";

// ─── Fixture ─────────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<PackageAnalysis> = {}): StructuredAnalysis {
  return {
    meta: { engineVersion: "0.5.0", analyzedAt: "", rootDir: "/tmp", config: {} as any, timingMs: 100 },
    packages: [{
      name: "test-pkg",
      version: "1.0.0",
      description: "Test package",
      relativePath: ".",
      files: { total: 20, byTier: { tier1: { count: 5, lines: 500, files: [] }, tier2: { count: 10, lines: 1000, files: [] }, tier3: { count: 5, lines: 200 } }, byExtension: { ".ts": 20 } },
      publicAPI: [
        { name: "analyze", kind: "function" as const, sourceFile: "src/index.ts", isTypeOnly: false, importCount: 12, signature: "(opts) => Promise<Analysis>" },
        { name: "format", kind: "function" as const, sourceFile: "src/index.ts", isTypeOnly: false, importCount: 8 },
        { name: "Config", kind: "type" as const, sourceFile: "src/types.ts", isTypeOnly: true, importCount: 20 },
      ],
      conventions: [
        { category: "file-naming" as const, name: "kebab-case", description: "Use kebab-case", confidence: { matched: 20, total: 20, percentage: 100, description: "20/20" }, examples: [], impact: "low" as const },
        { category: "testing" as const, name: "co-located tests", description: "Tests next to source", confidence: { matched: 15, total: 18, percentage: 83, description: "15/18" }, examples: [], impact: "high" as const },
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
          { path: "src/detectors", purpose: "Convention detectors", fileCount: 8, exports: ["fileNaming", "hooks"], pattern: "{name}.ts" },
          { path: "src/llm", purpose: "LLM integration", fileCount: 5, exports: ["adapter", "client"] },
          { path: "src/bin", purpose: "CLI entry points", fileCount: 3, exports: [] },
        ],
        packageType: "library" as const,
        hasJSX: false,
      },
      dependencies: { internal: [], external: [{ name: "typescript", importCount: 5 }], totalUniqueDependencies: 3 },
      role: { summary: "Codebase intelligence engine", purpose: "", whenToUse: "", inferredFrom: [] },
      antiPatterns: [
        { rule: "Do NOT use camelCase", reason: "Project uses kebab-case", confidence: "high" as const, derivedFrom: "file-naming" },
      ],
      contributionPatterns: [
        {
          type: "function", directory: "src/detectors/", filePattern: "{name}.ts",
          exampleFile: "src/detectors/file-naming.ts",
          steps: ["Create file", "Import Convention", "Export as Detector", "Register"],
          commonImports: [{ specifier: "../types.js", symbols: ["Convention"], coverage: 0.9 }],
          exportSuffix: "Detector",
          registrationFile: "src/convention-extractor.ts",
        },
      ],
      importChain: [
        { importer: "src/pipeline.ts", source: "src/types.ts", symbolCount: 12, symbols: ["StructuredAnalysis", "PackageAnalysis"] },
        { importer: "src/formatter.ts", source: "src/types.ts", symbolCount: 8, symbols: ["Convention", "CommandSet"] },
      ],
      callGraph: [
        { from: "runPipeline", to: "analyzePackage", fromFile: "src/pipeline.ts", toFile: "src/pipeline.ts" },
        { from: "analyzePackage", to: "parseFile", fromFile: "src/pipeline.ts", toFile: "src/ast-parser.ts" },
      ],
      gitHistory: {
        coChangeEdges: [
          { file1: "src/formatter.ts", file2: "src/types.ts", coChangeCount: 8, file1Commits: 10, file2Commits: 15, jaccard: 0.47, lastCoChangeTimestamp: Date.now() / 1000 },
        ],
        totalCommitsAnalyzed: 25,
        commitsFilteredBySize: 1,
        historySpanDays: 30,
      },
      configAnalysis: { typescript: { strict: true, target: "ES2022", module: "esnext", moduleResolution: "bundler" } },
      dependencyInsights: {
        runtime: [{ name: "Node", version: "20" }],
        frameworks: [{ name: "TypeScript", version: "5.4" }],
        testFramework: { name: "Vitest", version: "2.0" },
      },
      ...overrides,
    } as PackageAnalysis],
    crossPackage: {
      dependencyGraph: [],
      sharedConventions: [],
      divergentConventions: [],
      sharedAntiPatterns: [],
      workflowRules: [
        { trigger: "When modifying src/types.ts", action: "Check 5 dependent files", source: "Import chain", impact: "high" as const },
        { trigger: "After changing convention detectors", action: "Run full test suite", source: "Technology", impact: "high" as const },
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
      type: "class", directory: "src/adapters/", filePattern: "{name}.ts",
      exampleFile: "src/adapters/fs.ts",
      steps: ["Create"], commonImports: [], exportSuffix: "Adapter",
      registrationFile: "src/index.ts",
    },
    {
      type: "class", directory: "src/adapters/llm/", filePattern: "{name}.ts",
      exampleFile: "src/adapters/llm/claude.ts",
      steps: ["Create"], commonImports: [], exportSuffix: "LLMAdapter",
    },
    {
      type: "function", directory: "src/utils/", filePattern: "{name}.ts",
      exampleFile: "src/utils/retry.ts",
      steps: ["Create"], commonImports: [],
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
    writeFileSync(join(tmpDir, "src/index.ts"), [
      'import { FsAdapter } from "./adapters/fs.js";',
      "",
      "export const adapters = [FsAdapter];",
      "",
    ].join("\n"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeNestedAnalysis(): StructuredAnalysis {
    return {
      meta: { engineVersion: "0.8.0", analyzedAt: "", rootDir: tmpDir, config: {} as any, timingMs: 0 },
      packages: [{
        name: "test-pkg",
        version: "1.0.0",
        description: "",
        relativePath: ".",
        files: { total: 5, byTier: { tier1: { count: 5, lines: 500, files: ["src/adapters/fs.ts", "src/adapters/llm/claude.ts"] }, tier2: { count: 0, lines: 0, files: [] }, tier3: { count: 0, lines: 0 } }, byExtension: { ".ts": 5 } },
        publicAPI: [],
        conventions: [],
        commands: { packageManager: "npm" as const, other: [] },
        architecture: { entryPoint: "src/index.ts", directories: [], packageType: "library" as const, hasJSX: false },
        dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
        role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
        antiPatterns: [],
        contributionPatterns: [
          {
            type: "class", directory: "src/adapters/", filePattern: "{name}.ts",
            exampleFile: "src/adapters/fs.ts",
            steps: ["Create adapter"],
            commonImports: [{ specifier: "../../core/types.js", symbols: ["Config"], coverage: 0.8 }],
            exportSuffix: "Adapter",
            registrationFile: "src/index.ts",
          },
          {
            type: "class", directory: "src/adapters/llm/", filePattern: "{name}.ts",
            exampleFile: "src/adapters/llm/claude.ts",
            steps: ["Create LLM adapter"],
            commonImports: [],
            exportSuffix: "LLMAdapter",
            // No registrationFile — this is the edge case
          },
        ],
      } as any],
      crossPackage: undefined,
      warnings: [],
    };
  }

  it("falls back to parent registrationFile when child has none", () => {
    const result = getRegistrationInsertions(
      makeNestedAnalysis(),
      "src/adapters/llm/openai.ts",
    );
    expect(result.registrationFile).not.toBeNull();
    expect(result.registrationFile?.path).toBe("src/index.ts");
  });

  it("preserves child exportSuffix when falling back for registration", () => {
    const result = getRegistrationInsertions(
      makeNestedAnalysis(),
      "src/adapters/llm/openai.ts",
    );
    // Export name should use the CHILD pattern's suffix (LLMAdapter), not the parent's
    expect(result.exportName).toBe("openaiLLMAdapter");
  });

  it("uses direct pattern when it has registrationFile", () => {
    const result = getRegistrationInsertions(
      makeNestedAnalysis(),
      "src/adapters/new-adapter.ts",
    );
    expect(result.registrationFile).not.toBeNull();
    expect(result.registrationFile?.path).toBe("src/index.ts");
    expect(result.exportName).toBe("newAdapterAdapter");
  });

  it("returns null registration when no pattern matches", () => {
    const result = getRegistrationInsertions(
      makeNestedAnalysis(),
      "src/core/something.ts",
    );
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
    const toolsLine = summary.split("\n").find(l => l.includes("Tools:"))!;
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
