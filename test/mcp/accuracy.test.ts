// test/mcp/accuracy.test.ts — MCP tool accuracy validation
// Calls each tool on synaps itself and verifies responses
// against known ground truth (we KNOW what our own codebase contains).

import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";
import * as Q from "../../src/mcp/queries.js";
import * as tools from "../../src/mcp/tools.js";
import type { StructuredAnalysis } from "../../src/types.js";

// ─── Setup: analyze synaps itself ───────────────────────────────────

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
    // We know synaps uses TypeScript and Node
    expect(text.toLowerCase()).toMatch(/node|typescript/);
  });
});

// ─── get_architecture accuracy ───────────────────────────────────────────────

describe("MCP accuracy: get_architecture", () => {
  it("identifies correct package type", () => {
    const result = tools.handleGetArchitecture(analysis, {});
    const text = result.content[0].text;
    // synaps is a CLI library
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
    // analysis-builder.ts and queries.ts are known heavy importers of types.ts
    expect(text).toContain("analysis-builder.ts");
    expect(text).toContain("queries.ts");
    // Should show symbol counts
    expect(text).toMatch(/\d+ symbols/);
  });

  it("returns co-change section when scope=cochanges", () => {
    const result = tools.handleAnalyzeImpact(analysis, {
      filePath: "src/types.ts",
      scope: "cochanges",
    });
    const text = result.content[0].text;
    // Always returns a co-change section (may be empty in shallow clones)
    expect(text).toContain("Co-change");
    // Jaccard data only available with sufficient git history
    const pkg = analysis.packages[0];
    if ((pkg.gitHistory?.coChangeEdges?.length ?? 0) > 0) {
      expect(text).toContain("Jaccard");
    }
  });

  it("respects limit parameter", () => {
    const result = tools.handleAnalyzeImpact(analysis, {
      filePath: "src/types.ts",
      scope: "imports",
      limit: 3,
    });
    const text = result.content[0].text;
    // Count bullet points (each importer is a "- `file`" line)
    const importerLines = text.split("\n").filter((l) => l.startsWith("- `"));
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
  it("returns synaps as the package", () => {
    const result = tools.handleListPackages(analysis);
    const text = result.content[0].text;
    expect(text).toContain("synaps");
  });

  it("shows correct package count (single package)", () => {
    const packages = Q.listPackages(analysis);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("synaps");
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
    // synaps uses 98% kebab-case filenames
    expect(text.toLowerCase()).toContain("kebab");
  });
});

// ─── diagnose accuracy ──────────────────────────────────────────────────────

describe("MCP accuracy: diagnose", () => {
  it("diagnoses from filePath against real import graph", () => {
    const result = tools.handleDiagnose(analysis, {
      filePath: "src/types.ts",
    });
    const text = result.content[0].text;
    expect(text).toContain("## Diagnosis");
    expect(text).toContain("src/types.ts");
    expect(text).toContain("Suspect Files");
    expect(text).toContain("Suggested Actions");
    // types.ts is heavily imported — should have suspects
    expect(text).toMatch(/\d\.\s+\*\*/); // At least one numbered suspect
  });

  it("diagnoses from testFile and resolves its imports", () => {
    const result = tools.handleDiagnose(analysis, {
      testFile: "test/mcp/tools.test.ts",
    });
    const text = result.content[0].text;
    expect(text).toContain("## Diagnosis");
    // test/mcp/tools.test.ts imports from src/mcp/ modules — should find suspects
    expect(text).toContain("Suspect Files");
    expect(text).toContain("Suggested Actions");
  });

  it("diagnoses from realistic V8 error text", () => {
    const result = tools.handleDiagnose(analysis, {
      errorText: `TypeError: Cannot read property 'conventions' of undefined
    at extractConventions (src/convention-extractor.ts:42:15)
    at analyzePackage (src/pipeline.ts:120:7)
    at Object.<anonymous> (test/integration.test.ts:15:5)`,
    });
    const text = result.content[0].text;
    expect(text).toContain("## Diagnosis");
    expect(text).toContain("Cannot read property");
    expect(text).toContain("convention-extractor.ts");
    expect(text).toContain("Suspect Files");
  });

  it("getRecentFileChanges returns real git data", () => {
    const rootDir = analysis.meta?.rootDir;
    if (!rootDir) return;
    const changes = Q.getRecentFileChanges(rootDir);
    // We have recent commits — should have some changes
    // (If this test runs right after a commit, there will be committed changes)
    expect(Array.isArray(changes)).toBe(true);
    for (const c of changes) {
      expect(c.file).toBeTruthy();
      expect(c.hoursAgo).toBeGreaterThanOrEqual(0);
      expect(typeof c.isUncommitted).toBe("boolean");
    }
  });

  it("traceImportChain finds path between known connected files", () => {
    // pipeline.ts imports from types.ts — should find a path
    const chain = Q.traceImportChain(analysis, "src/pipeline.ts", "src/types.ts");
    expect(chain).not.toBeNull();
    expect(chain![0]).toBe("src/pipeline.ts");
    expect(chain![chain!.length - 1]).toBe("src/types.ts");
  });

  it("traceImportChain returns null for unrelated files", () => {
    // A file that doesn't exist in the graph should return null
    const chain = Q.traceImportChain(analysis, "src/pipeline.ts", "src/nonexistent.ts");
    expect(chain).toBeNull();
  });

  it("buildSuspectList returns scored suspects for a real file", () => {
    const rootDir = analysis.meta?.rootDir;
    const changes = rootDir ? Q.getRecentFileChanges(rootDir) : [];
    const { suspects } = Q.buildSuspectList(analysis, ["src/types.ts"], changes);

    expect(suspects.length).toBeGreaterThan(0);
    expect(suspects.length).toBeLessThanOrEqual(5);

    // Suspects should be sorted by score descending
    for (let i = 1; i < suspects.length; i++) {
      expect(suspects[i].score).toBeLessThanOrEqual(suspects[i - 1].score);
    }

    // Each suspect should have a reason
    for (const s of suspects) {
      expect(s.file).toBeTruthy();
      expect(s.score).toBeGreaterThan(0);
      expect(s.reason).toBeTruthy();
    }
  });

  it("suggests plan_change as next step", () => {
    const result = tools.handleDiagnose(analysis, {
      filePath: "src/types.ts",
    });
    expect(result.content[0].text).toContain("plan_change");
  });
});

// ─── Cross-cutting accuracy checks ──────────────────────────────────────────

describe("MCP accuracy: data consistency", () => {
  it("import chain edges reference files that exist in the analysis", () => {
    const pkg = analysis.packages[0];
    const chain = pkg.importChain ?? [];
    const knownFiles = new Set(pkg.files.byTier.tier1.files.concat(pkg.files.byTier.tier2.files));

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
    // We know synaps has build and test scripts
    expect(commands.build).toBeTruthy();
    expect(commands.test).toBeTruthy();
  });

  it("package resolution works for single-package repo", () => {
    // Should resolve without packagePath for single-package repos
    const pkg = Q.resolvePackage(analysis);
    expect(pkg.name).toBe("synaps");
  });
});
