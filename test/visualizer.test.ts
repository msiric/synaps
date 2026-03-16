// test/visualizer.test.ts — Tests for the HTML report generator
import { describe, expect, it } from "vitest";
import type { PackageAnalysis, StructuredAnalysis } from "../src/types.js";
import { generateReport } from "../src/visualizer.js";

function makeAnalysis(overrides: Partial<PackageAnalysis> = {}): StructuredAnalysis {
  return {
    meta: { engineVersion: "0.10.2", analyzedAt: "2026-03-16", rootDir: "/tmp", config: {} as any, timingMs: 100 },
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
          },
        ],
        conventions: [
          {
            category: "file-naming" as const,
            name: "kebab-case",
            description: "Use kebab-case",
            confidence: { matched: 20, total: 20, percentage: 100, description: "20/20" },
            examples: [],
          },
        ],
        commands: { packageManager: "npm" as const, other: [] },
        architecture: {
          entryPoint: "src/index.ts",
          directories: [],
          packageType: "library" as const,
          hasJSX: false,
        },
        dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
        role: { summary: "Test library", purpose: "", whenToUse: "", inferredFrom: [] },
        antiPatterns: [
          { rule: "No camelCase", reason: "Use kebab-case", confidence: "high" as const, derivedFrom: "file-naming" },
        ],
        contributionPatterns: [],
        importChain: [
          {
            importer: "src/pipeline.ts",
            source: "src/types.ts",
            symbolCount: 5,
            symbols: ["A", "B"],
            confidence: 0.95,
            resolution: "relative",
          },
          {
            importer: "src/mcp/tools.ts",
            source: "src/types.ts",
            symbolCount: 3,
            symbols: ["C"],
            confidence: 0.95,
            resolution: "relative",
          },
        ],
        callGraph: [
          {
            from: "run",
            to: "parse",
            fromFile: "src/index.ts",
            toFile: "src/parser.ts",
            confidence: 0.85,
            resolution: "export-map",
          },
        ],
        gitHistory: {
          coChangeEdges: [
            {
              file1: "src/index.ts",
              file2: "src/parser.ts",
              coChangeCount: 5,
              file1Commits: 8,
              file2Commits: 10,
              jaccard: 0.33,
              lastCoChangeTimestamp: 0,
            },
          ],
          totalCommitsAnalyzed: 20,
          commitsFilteredBySize: 0,
          historySpanDays: 30,
        },
        coChangeClusters: [["src/index.ts", "src/parser.ts", "src/types.ts"]],
        executionFlows: [
          {
            label: "run → parse (2 steps, 2 files)",
            entryPoint: "run",
            entryFile: "src/index.ts",
            terminal: "parse",
            terminalFile: "src/parser.ts",
            steps: ["run", "parse"],
            files: ["src/index.ts", "src/parser.ts"],
            length: 2,
            confidence: 0.33,
          },
        ],
        implicitCoupling: [{ file1: "src/index.ts", file2: "src/config.ts", jaccard: 0.25, coChangeCount: 3 }],
        ...overrides,
      } as PackageAnalysis,
    ],
    crossPackage: undefined,
    warnings: [],
  };
}

describe("generateReport", () => {
  it("produces valid HTML document", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("test-pkg");
  });

  it("renders stats section", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("20"); // files total
    expect(html).toContain("Files");
    expect(html).toContain("Public API");
  });

  it("renders module dependency graph with Mermaid", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("Module Dependencies");
    expect(html).toContain("mermaid");
    expect(html).toContain("graph LR");
  });

  it("renders co-change clusters", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("Co-Change Clusters");
    expect(html).toContain("Cluster 1");
    expect(html).toContain("3 files");
  });

  it("renders implicit coupling", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("Implicit Coupling");
    expect(html).toContain("config.ts");
    expect(html).toContain("no import");
  });

  it("renders execution flows with confidence", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("Execution Flows");
    expect(html).toContain("run");
    expect(html).toContain("parse");
    expect(html).toContain("33%");
  });

  it("renders blast radius explorer with file selector", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("Blast Radius Explorer");
    expect(html).toContain("<select");
    expect(html).toContain("src/types.ts");
  });

  it("includes interactive blast radius JavaScript", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("function showBlast");
    expect(html).toContain("const imports");
    expect(html).toContain("const cochanges");
  });

  it("renders conventions", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("Conventions");
    expect(html).toContain("kebab-case");
    expect(html).toContain("No camelCase");
  });

  it("includes footer with engine version", () => {
    const html = generateReport(makeAnalysis());
    expect(html).toContain("autodocs-engine");
    expect(html).toContain("0.10.2");
  });

  it("omits sections when data is empty", () => {
    const html = generateReport(
      makeAnalysis({
        importChain: [],
        callGraph: [],
        executionFlows: [],
        coChangeClusters: [],
        implicitCoupling: [],
        conventions: [],
        antiPatterns: [],
        gitHistory: undefined,
      }),
    );
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).not.toContain("Module Dependencies");
    expect(html).not.toContain("Co-Change Clusters");
  });

  it("escapes HTML in package name", () => {
    const html = generateReport(makeAnalysis({ name: "test<img onerror=alert(1)>" } as any));
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;img");
  });
});
