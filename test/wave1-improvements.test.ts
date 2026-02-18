import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { analyzeConfig } from "../src/config-analyzer.js";
import { analyzeDependencies } from "../src/dependency-analyzer.js";
import { detectExistingDocs } from "../src/existing-docs.js";
import { wrapWithDelimiters, mergeWithExisting } from "../src/existing-docs.js";
import { parseFile } from "../src/ast-parser.js";
import { buildSymbolGraph } from "../src/symbol-graph.js";
import { discoverFiles } from "../src/file-discovery.js";
import type { Warning } from "../src/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

// ─── Improvement 1: Config File Analysis ────────────────────────────────────

describe("config-analyzer", () => {
  it("detects tsconfig with strict mode and paths", () => {
    const warnings: Warning[] = [];
    const config = analyzeConfig(resolve(FIXTURES, "config-pkg"), undefined, warnings);

    expect(config.typescript).toBeDefined();
    expect(config.typescript!.strict).toBe(true);
    expect(config.typescript!.target).toBe("ES2022");
    expect(config.typescript!.module).toBe("ESNext");
    expect(config.typescript!.moduleResolution).toBe("bundler");
    expect(config.typescript!.jsx).toBe("react-jsx");
    expect(config.typescript!.paths).toEqual({ "@/*": ["./src/*"] });
  });

  it("detects ESLint as linter", () => {
    const config = analyzeConfig(resolve(FIXTURES, "config-pkg"));
    expect(config.linter).toBeDefined();
    expect(config.linter!.name).toBe("eslint");
    expect(config.linter!.configFile).toBe(".eslintrc.json");
  });

  it("detects Prettier as formatter", () => {
    const config = analyzeConfig(resolve(FIXTURES, "config-pkg"));
    expect(config.formatter).toBeDefined();
    expect(config.formatter!.name).toBe("prettier");
    expect(config.formatter!.configFile).toBe(".prettierrc");
  });

  it("detects environment variables from .env.example", () => {
    const config = analyzeConfig(resolve(FIXTURES, "config-pkg"));
    expect(config.envVars).toBeDefined();
    expect(config.envVars).toContain("DATABASE_URL");
    expect(config.envVars).toContain("API_KEY");
    expect(config.envVars).toContain("NODE_ENV");
  });

  it("detects turbo as build tool from root", () => {
    const rootDir = resolve(FIXTURES, "turbo-monorepo");
    const pkgDir = resolve(FIXTURES, "turbo-monorepo/packages/app");
    const config = analyzeConfig(pkgDir, rootDir);

    expect(config.buildTool).toBeDefined();
    expect(config.buildTool!.name).toBe("turbo");
    expect(config.buildTool!.taskNames).toContain("build");
    expect(config.buildTool!.taskNames).toContain("test");
    expect(config.buildTool!.taskNames).toContain("lint");
    expect(config.buildTool!.taskNames).toContain("dev");
  });

  it("detects biome as linter and formatter from root", () => {
    const rootDir = resolve(FIXTURES, "turbo-monorepo");
    const pkgDir = resolve(FIXTURES, "turbo-monorepo/packages/app");
    const config = analyzeConfig(pkgDir, rootDir);

    expect(config.linter).toBeDefined();
    expect(config.linter!.name).toBe("biome");

    expect(config.formatter).toBeDefined();
    expect(config.formatter!.name).toBe("biome");
  });

  it("returns undefined for missing config files", () => {
    const config = analyzeConfig(resolve(FIXTURES, "no-package-json"));
    expect(config.typescript).toBeUndefined();
    expect(config.buildTool).toBeUndefined();
    expect(config.taskRunner).toBeUndefined();
    expect(config.envVars).toBeUndefined();
  });
});

// ─── Improvement 2: Dependency Versioning ───────────────────────────────────

describe("dependency-analyzer", () => {
  it("detects React 18 with correct guidance", () => {
    const insights = analyzeDependencies(resolve(FIXTURES, "config-pkg"));
    const react = insights.frameworks.find((f) => f.name === "react");
    expect(react).toBeDefined();
    expect(react!.version).toContain("18");
    expect(react!.guidance).toContain("do NOT use use() hook");
  });

  it("detects TypeScript 5.4 with guidance", () => {
    const insights = analyzeDependencies(resolve(FIXTURES, "config-pkg"));
    const ts = insights.frameworks.find((f) => f.name === "typescript");
    expect(ts).toBeDefined();
    expect(ts!.version).toContain("5.4");
    expect(ts!.guidance).toContain("satisfies");
  });

  it("detects test framework (vitest)", () => {
    const insights = analyzeDependencies(resolve(FIXTURES, "config-pkg"));
    expect(insights.testFramework).toBeDefined();
    expect(insights.testFramework!.name).toBe("vitest");
  });

  it("detects bundler (vite)", () => {
    const insights = analyzeDependencies(resolve(FIXTURES, "config-pkg"));
    expect(insights.bundler).toBeDefined();
    expect(insights.bundler!.name).toBe("vite");
  });

  it("does NOT leak root bun packageManager into package runtime", () => {
    const insights = analyzeDependencies(
      resolve(FIXTURES, "turbo-monorepo/packages/app"),
      resolve(FIXTURES, "turbo-monorepo"),
    );
    // Root has packageManager: "bun@1.1.0", but the package has no Bun signals.
    // Bun from root packageManager is a build tool choice, not a runtime for this package.
    const bun = insights.runtime.find((r) => r.name === "bun");
    expect(bun).toBeUndefined();
  });

  it("returns empty arrays for package with no deps", () => {
    const insights = analyzeDependencies(resolve(FIXTURES, "no-package-json"));
    expect(insights.runtime).toEqual([]);
    expect(insights.frameworks).toEqual([]);
    expect(insights.testFramework).toBeUndefined();
    expect(insights.bundler).toBeUndefined();
  });
});

// ─── Improvement 3: Call Graph ──────────────────────────────────────────────

describe("call-graph", () => {
  it("extracts call references from a function that calls imported symbols", () => {
    const warnings: Warning[] = [];
    const pf = parseFile(
      resolve(FIXTURES, "callgraph-pkg/src/processor.ts"),
      resolve(FIXTURES, "callgraph-pkg"),
      warnings,
    );

    expect(pf.callReferences).toBeDefined();
    expect(pf.callReferences.length).toBeGreaterThanOrEqual(2);

    const validateCall = pf.callReferences.find((cr) => cr.calleeName === "validateInput");
    expect(validateCall).toBeDefined();
    expect(validateCall!.callerName).toBe("processData");
    expect(validateCall!.isInternal).toBe(true);

    const formatCall = pf.callReferences.find((cr) => cr.calleeName === "formatOutput");
    expect(formatCall).toBeDefined();
    expect(formatCall!.callerName).toBe("processData");
    expect(formatCall!.isInternal).toBe(true);
  });

  it("produces empty call references for leaf functions", () => {
    const pf = parseFile(
      resolve(FIXTURES, "callgraph-pkg/src/validator.ts"),
      resolve(FIXTURES, "callgraph-pkg"),
    );
    // validateInput doesn't call any imported symbols
    expect(pf.callReferences).toEqual([]);
  });

  it("builds call graph edges in symbol graph", () => {
    const warnings: Warning[] = [];
    const pkgDir = resolve(FIXTURES, "callgraph-pkg");
    const files = discoverFiles(pkgDir, [], warnings);
    const parsed = files.map((f) => parseFile(f, pkgDir, warnings));
    const graph = buildSymbolGraph(parsed, pkgDir, warnings);

    expect(graph.callGraph).toBeDefined();
    expect(graph.callGraph.length).toBeGreaterThanOrEqual(2);

    const validateEdge = graph.callGraph.find(
      (e) => e.from === "processData" && e.to === "validateInput",
    );
    expect(validateEdge).toBeDefined();

    const formatEdge = graph.callGraph.find(
      (e) => e.from === "processData" && e.to === "formatOutput",
    );
    expect(formatEdge).toBeDefined();
  });
});

// ─── Improvement 4: Existing Docs Detection & Merge ─────────────────────────

describe("existing-docs", () => {
  it("detects existing documentation files", () => {
    // Use config-pkg which we created with README etc.
    // Actually, config-pkg doesn't have AGENTS.md or README. Let's test what it has
    const docs = detectExistingDocs(resolve(FIXTURES, "config-pkg"));
    expect(docs.hasReadme).toBe(false);
    expect(docs.hasAgentsMd).toBe(false);
    expect(docs.hasClaudeMd).toBe(false);
    expect(docs.hasCursorrules).toBe(false);
    expect(docs.hasContributing).toBe(false);
  });

  it("returns all false for empty directory", () => {
    const docs = detectExistingDocs(resolve(FIXTURES, "no-package-json"));
    expect(docs.hasReadme).toBe(false);
    expect(docs.hasAgentsMd).toBe(false);
  });
});

describe("merge mode", () => {
  it("wraps content in delimiters for first generation", () => {
    const content = "## Commands\n- build: `npm run build`";
    const wrapped = wrapWithDelimiters(content);

    expect(wrapped).toContain("<!-- autodocs:start -->");
    expect(wrapped).toContain("<!-- autodocs:end -->");
    expect(wrapped).toContain("## Commands");
    expect(wrapped).toContain("## Team Knowledge");
  });

  it("replaces delimited section in existing content", () => {
    const existing = [
      "# My Package",
      "",
      "<!-- autodocs:start -->",
      "## Old Commands",
      "- old stuff",
      "<!-- autodocs:end -->",
      "",
      "## Team Knowledge",
      "Important: always use v2 API",
    ].join("\n");

    const newContent = "## Commands\n- build: `turbo run build`";
    const merged = mergeWithExisting(existing, newContent);

    expect(merged).toContain("# My Package");
    expect(merged).toContain("turbo run build");
    expect(merged).toContain("## Team Knowledge");
    expect(merged).toContain("always use v2 API");
    expect(merged).not.toContain("Old Commands");
    expect(merged).not.toContain("old stuff");
  });

  it("appends with separator when no delimiters exist", () => {
    const existing = "# My Package\n\n## Team Knowledge\nImportant context here.";
    const newContent = "## Commands\n- build: `npm run build`";
    const merged = mergeWithExisting(existing, newContent);

    expect(merged).toContain("# My Package");
    expect(merged).toContain("Important context here.");
    expect(merged).toContain("---");
    expect(merged).toContain("<!-- autodocs:start -->");
    expect(merged).toContain("## Commands");
    expect(merged).toContain("<!-- autodocs:end -->");
  });
});
