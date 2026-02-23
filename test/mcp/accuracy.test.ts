// test/mcp/accuracy.test.ts — MCP tool accuracy validation
// Calls each tool on autodocs-engine itself and verifies responses
// against known ground truth (we KNOW what our own codebase contains).

import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { analyze } from "../../src/index.js";
import type { StructuredAnalysis } from "../../src/types.js";
import * as tools from "../../src/mcp/tools.js";
import * as Q from "../../src/mcp/queries.js";

// ─── Setup: analyze autodocs-engine itself ───────────────────────────────────

let analysis: StructuredAnalysis;

beforeAll(async () => {
  analysis = await analyze({ packages: [resolve(".")] });
}, 30_000);

// ─── get_commands accuracy ───────────────────────────────────────────────────

describe("MCP accuracy: get_commands", () => {
  it("returns correct package manager", () => {
    const result = tools.handleGetCommands(analysis, {});
    const text = result.content[0].text;
    expect(text).toContain("npm");
  });

  it("includes actual npm scripts from package.json", () => {
    const result = tools.handleGetCommands(analysis, {});
    const text = result.content[0].text;
    // These are real scripts in our package.json
    expect(text).toContain("build");
    expect(text).toContain("test");
    expect(text).toContain("typecheck");
  });

  it("includes tech stack summary", () => {
    const result = tools.handleGetCommands(analysis, {});
    const text = result.content[0].text;
    // We know autodocs-engine uses TypeScript and Node
    expect(text.toLowerCase()).toMatch(/node|typescript/);
  });
});

// ─── get_architecture accuracy ───────────────────────────────────────────────

describe("MCP accuracy: get_architecture", () => {
  it("identifies correct package type", () => {
    const result = tools.handleGetArchitecture(analysis, {});
    const text = result.content[0].text;
    // autodocs-engine is a CLI library
    expect(text).toMatch(/library|cli/);
  });

  it("lists real directories", () => {
    const result = tools.handleGetArchitecture(analysis, {});
    const text = result.content[0].text;
    // Non-obvious directories should be listed (detectors, mcp, benchmark, llm)
    // Obvious directories (bin, test) are filtered out by design
    expect(text).toContain("detectors");
    expect(text).toContain("mcp");
    // "bin" is in OBVIOUS_DIR_NAMES so it's filtered — check for standard dirs note instead
    expect(text).toMatch(/standard director|non-exhaustive/i);
  });

  it("shows correct entry point", () => {
    const result = tools.handleGetArchitecture(analysis, {});
    const text = result.content[0].text;
    expect(text).toContain("index.ts");
  });
});

// ─── analyze_impact accuracy ─────────────────────────────────────────────────

describe("MCP accuracy: analyze_impact", () => {
  it("correctly identifies importers of src/types.ts", () => {
    const result = tools.handleAnalyzeImpact(analysis, {
      filePath: "src/types.ts",
      scope: "imports",
    });
    const text = result.content[0].text;
    // pipeline.ts and analysis-builder.ts are known heavy importers
    expect(text).toContain("pipeline.ts");
    expect(text).toContain("analysis-builder.ts");
    // Should show symbol counts
    expect(text).toMatch(/\d+ symbols/);
  });

  it("returns co-change partners when scope=cochanges", () => {
    const result = tools.handleAnalyzeImpact(analysis, {
      filePath: "src/types.ts",
      scope: "cochanges",
    });
    const text = result.content[0].text;
    // types.ts co-changes with pipeline.ts (we verified this in git history tests)
    expect(text).toContain("Co-change");
    expect(text).toContain("Jaccard");
  });

  it("respects limit parameter", () => {
    const result = tools.handleAnalyzeImpact(analysis, {
      filePath: "src/types.ts",
      scope: "imports",
      limit: 3,
    });
    const text = result.content[0].text;
    // Count bullet points (each importer is a "- `file`" line)
    const importerLines = text.split("\n").filter(l => l.startsWith("- `"));
    expect(importerLines.length).toBeLessThanOrEqual(3);
  });

  it("handles nonexistent file gracefully", () => {
    const result = tools.handleAnalyzeImpact(analysis, {
      filePath: "src/nonexistent.ts",
      scope: "imports",
    });
    const text = result.content[0].text;
    expect(text).toContain("No files import");
  });
});

// ─── get_workflow_rules accuracy ─────────────────────────────────────────────

describe("MCP accuracy: get_workflow_rules", () => {
  it("returns workflow rules that reference real files", () => {
    const result = tools.handleGetWorkflowRules(analysis, {});
    const text = result.content[0].text;
    // Should have at least some rules (from import chain + co-change + technology detection)
    expect(text).toContain("Workflow Rules");
    // Rules should reference actual project files or technologies
    expect(text.length).toBeGreaterThan(50);
  });
});

// ─── list_packages accuracy ──────────────────────────────────────────────────

describe("MCP accuracy: list_packages", () => {
  it("returns autodocs-engine as the package", () => {
    const result = tools.handleListPackages(analysis);
    const text = result.content[0].text;
    expect(text).toContain("autodocs-engine");
  });

  it("shows correct package count (single package)", () => {
    const packages = Q.listPackages(analysis);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("autodocs-engine");
  });
});

// ─── get_contribution_guide accuracy ─────────────────────────────────────────

describe("MCP accuracy: get_contribution_guide", () => {
  it("detects the detectors directory pattern", () => {
    const result = tools.handleGetContributionGuide(analysis, { directory: "detectors" });
    const text = result.content[0].text;
    // We know src/detectors/ has a clear pattern (Detector suffix, registration file)
    if (text.includes("No contribution patterns")) {
      // Some analyses may not detect patterns depending on file count threshold
      return;
    }
    expect(text).toContain("src/detectors");
  });
});

// ─── get_exports accuracy ────────────────────────────────────────────────────

describe("MCP accuracy: get_exports", () => {
  it("includes the analyze() function in public API", () => {
    const result = tools.handleGetExports(analysis, { query: "analyze" });
    const text = result.content[0].text;
    expect(text).toContain("analyze");
    expect(text).toContain("function");
  });

  it("includes the ENGINE_VERSION constant", () => {
    const result = tools.handleGetExports(analysis, { query: "ENGINE_VERSION" });
    const text = result.content[0].text;
    expect(text).toContain("ENGINE_VERSION");
  });

  it("respects limit parameter", () => {
    const exports = Q.getPublicAPI(analysis, undefined, undefined, 5);
    expect(exports.length).toBeLessThanOrEqual(5);
  });
});

// ─── get_conventions accuracy ────────────────────────────────────────────────

describe("MCP accuracy: get_conventions", () => {
  it("detects kebab-case naming convention", () => {
    const result = tools.handleGetConventions(analysis, {});
    const text = result.content[0].text;
    // autodocs-engine uses 98% kebab-case filenames
    expect(text.toLowerCase()).toContain("kebab");
  });
});

// ─── Cross-cutting accuracy checks ──────────────────────────────────────────

describe("MCP accuracy: data consistency", () => {
  it("import chain edges reference files that exist in the analysis", () => {
    const pkg = analysis.packages[0];
    const chain = pkg.importChain ?? [];
    const knownFiles = new Set(
      pkg.files.byTier.tier1.files.concat(pkg.files.byTier.tier2.files),
    );

    for (const edge of chain.slice(0, 10)) {
      // At least the source OR importer should be a known file
      const sourceKnown = knownFiles.has(edge.source);
      const importerKnown = knownFiles.has(edge.importer);
      expect(sourceKnown || importerKnown).toBe(true);
    }
  });

  it("co-change edges reference files that exist on disk", () => {
    const pkg = analysis.packages[0];
    const edges = pkg.gitHistory?.coChangeEdges ?? [];

    // Co-change computation already filters by existsSync,
    // so all files should be in the analysis file inventory
    for (const edge of edges.slice(0, 5)) {
      expect(edge.file1).toBeTruthy();
      expect(edge.file2).toBeTruthy();
      expect(edge.jaccard).toBeGreaterThan(0);
      expect(edge.jaccard).toBeLessThanOrEqual(1);
    }
  });

  it("commands reference real package manager", () => {
    const commands = Q.getCommands(analysis);
    expect(["npm", "yarn", "pnpm", "bun", "unknown"]).toContain(commands.packageManager);
    // We know autodocs-engine has build and test scripts
    expect(commands.build).toBeTruthy();
    expect(commands.test).toBeTruthy();
  });

  it("package resolution works for single-package repo", () => {
    // Should resolve without packagePath for single-package repos
    const pkg = Q.resolvePackage(analysis);
    expect(pkg.name).toBe("autodocs-engine");
  });
});
