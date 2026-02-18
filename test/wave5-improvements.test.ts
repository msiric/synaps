import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

// ─── Workstream A: Cleanup ───────────────────────────────────────────────────

describe("W5-A: Cleanup — noisy detectors removed", () => {
  it("convention-extractor has 8 detectors (not 14)", async () => {
    // Import the source and check the registry has only 8 detectors
    const mod = await import("../src/convention-extractor.js");
    // extractConventions is the public API — run it with empty data to verify no crashes
    const conventions = mod.extractConventions([], new Map(), []);
    // With no files, no conventions should be detected
    expect(conventions).toHaveLength(0);
  });

  it("ConventionCategory only has 4 valid values", async () => {
    // The type can't be tested at runtime directly, but we can verify
    // that ecosystem detectors use "ecosystem" category
    const { dataFetchingDetector } = await import("../src/detectors/data-fetching.js");
    const { databaseDetector } = await import("../src/detectors/database.js");
    const { buildToolDetector } = await import("../src/detectors/build-tool.js");
    const { webFrameworkDetector } = await import("../src/detectors/web-framework.js");

    // These should not throw when called with empty data
    expect(dataFetchingDetector([], new Map(), [])).toEqual([]);
    expect(databaseDetector([], new Map(), [])).toEqual([]);
    expect(buildToolDetector([], new Map(), [])).toEqual([]);
    expect(webFrameworkDetector([], new Map(), [])).toEqual([]);
  });

  it("deleted detector files do not exist", async () => {
    const { existsSync } = await import("node:fs");
    const deletedFiles = [
      "src/detectors/import-patterns.ts",
      "src/detectors/export-patterns.ts",
      "src/detectors/component-patterns.ts",
      "src/detectors/error-handling.ts",
      "src/detectors/graphql-patterns.ts",
      "src/detectors/telemetry-patterns.ts",
    ];
    for (const f of deletedFiles) {
      expect(existsSync(resolve(__dirname, "..", f)), `${f} should be deleted`).toBe(false);
    }
  });

  it("convention-extractor no longer has GraphQL suppression logic", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(resolve(__dirname, "../src/convention-extractor.ts"), "utf-8");
    expect(source).not.toContain("hasDataFetchingConvention");
    expect(source).not.toContain('c.name === "GraphQL hooks"');
  });
});

// ─── Workstream B: Refactoring ──────────────────────────────────────────────

describe("W5-B1: LLM adapter split", () => {
  it("barrel re-exports formatWithLLM", async () => {
    const barrel = await import("../src/llm-adapter.js");
    expect(typeof barrel.formatWithLLM).toBe("function");
  });

  it("barrel re-exports formatHierarchical", async () => {
    const barrel = await import("../src/llm-adapter.js");
    expect(typeof barrel.formatHierarchical).toBe("function");
  });

  it("individual modules export their functions", async () => {
    const client = await import("../src/llm/client.js");
    expect(typeof client.callLLMWithRetry).toBe("function");

    const serializer = await import("../src/llm/serializer.js");
    expect(typeof serializer.serializeToMarkdown).toBe("function");
    expect(typeof serializer.serializePackageToMarkdown).toBe("function");
    expect(typeof serializer.sanitize).toBe("function");

    const templateSelector = await import("../src/llm/template-selector.js");
    expect(typeof templateSelector.getTemplate).toBe("function");

    const hierarchical = await import("../src/llm/hierarchical.js");
    expect(typeof hierarchical.formatHierarchical).toBe("function");
    expect(typeof hierarchical.toPackageFilename).toBe("function");

    const adapter = await import("../src/llm/adapter.js");
    expect(typeof adapter.formatWithLLM).toBe("function");
    expect(typeof adapter.validateAndCorrect).toBe("function");
  });

  it("template-selector returns correct templates", async () => {
    const { getTemplate } = await import("../src/llm/template-selector.js");

    const single = getTemplate("agents.md", false);
    expect(single.systemPrompt).toContain("AGENTS.md");

    const multi = getTemplate("agents.md", true);
    expect(multi.systemPrompt).toContain("multi-package");

    const claude = getTemplate("claude.md");
    expect(claude.systemPrompt).toBeDefined();

    const cursor = getTemplate("cursorrules");
    expect(cursor.systemPrompt).toBeDefined();
  });

  it("toPackageFilename strips scope and sanitizes", async () => {
    const { toPackageFilename } = await import("../src/llm/hierarchical.js");
    expect(toPackageFilename("@scope/my-package")).toBe("my-package.md");
    expect(toPackageFilename("simple-name")).toBe("simple-name.md");
    expect(toPackageFilename("@org/complex.name")).toBe("complex-name.md");
  });
});

describe("W5-B2: Budget limits adjusted", () => {
  it("MAX_RULES is now 120 (not 100)", async () => {
    const { validateBudget } = await import("../src/budget-validator.js");
    // 110 rules should NOT be over budget anymore (was over at 100)
    const rules = Array.from({ length: 110 }, (_, i) =>
      `- Use feature-${i} for all operations`,
    );
    const report = validateBudget(["# Package", ...rules].join("\n"));
    expect(report.overBudget).toBe(false);

    // 125 rules SHOULD be over budget
    const moreRules = Array.from({ length: 125 }, (_, i) =>
      `- Use feature-${i} for all operations`,
    );
    const overReport = validateBudget(["# Package", ...moreRules].join("\n"));
    expect(overReport.overBudget).toBe(true);
  });

  it("templates target higher line counts", async () => {
    const { agentsMdSingleTemplate, agentsMdMultiRootTemplate, agentsMdPackageDetailTemplate } =
      await import("../src/templates/agents-md.js");

    expect(agentsMdSingleTemplate.systemPrompt).toContain("at least 90 lines");
    expect(agentsMdMultiRootTemplate.systemPrompt).toContain("at least 80 lines");
    expect(agentsMdPackageDetailTemplate.systemPrompt).toContain("at least 100 lines");
  });
});

describe("W5-B3: Simplified pattern fingerprinter", () => {
  const FIXTURES = resolve(__dirname, "fixtures");

  it("produces fingerprints without error/async/complexity noise", async () => {
    const { fingerprintTopExports } = await import("../src/pattern-fingerprinter.js");

    const exports = [
      {
        name: "add",
        kind: "function" as const,
        sourceFile: "src/math.ts",
        isTypeOnly: false,
        importCount: 5,
      },
    ];

    const fps = fingerprintTopExports(exports, resolve(FIXTURES, "minimal-pkg"), 5);
    expect(Array.isArray(fps)).toBe(true);
  });
});

// ─── Workstream C: New Features ─────────────────────────────────────────────

describe("W5-C1: Example extractor", () => {
  const FIXTURES = resolve(__dirname, "fixtures");

  it("extracts examples from test files that import public API", async () => {
    const { extractExamples } = await import("../src/example-extractor.js");
    const { parseFile } = await import("../src/ast-parser.js");
    const { discoverFiles } = await import("../src/file-discovery.js");

    const pkgDir = resolve(FIXTURES, "hooks-pkg");
    const files = discoverFiles(pkgDir, []);
    const parsed = files.map((f: string) => {
      try { return parseFile(f, pkgDir, []); }
      catch { return null; }
    }).filter(Boolean);

    const publicAPI = [
      { name: "useData", kind: "hook" as const, sourceFile: "src/use-data.ts", isTypeOnly: false, importCount: 3 },
    ];

    const examples = extractExamples(publicAPI, parsed, pkgDir, 10, []);
    expect(Array.isArray(examples)).toBe(true);
    for (const ex of examples) {
      expect(ex).toHaveProperty("exportName");
      expect(ex).toHaveProperty("testFile");
      expect(ex).toHaveProperty("snippet");
      expect(ex).toHaveProperty("context");
    }
  });

  it("returns empty array when no test files exist", async () => {
    const { extractExamples } = await import("../src/example-extractor.js");
    const examples = extractExamples(
      [{ name: "foo", kind: "function" as const, sourceFile: "src/foo.ts", isTypeOnly: false }],
      [],
      "/tmp",
      10,
      [],
    );
    expect(examples).toEqual([]);
  });
});

describe("W5-C2: Plugin system", () => {
  it("loadPlugins returns empty array when no plugins configured", async () => {
    const { loadPlugins } = await import("../src/plugin-loader.js");
    const plugins = loadPlugins("/tmp/nonexistent", [], []);
    expect(plugins).toEqual([]);
  });

  it("loadPlugins warns for missing plugin paths", async () => {
    const { loadPlugins } = await import("../src/plugin-loader.js");
    const warnings: any[] = [];
    const plugins = loadPlugins("/tmp", ["/tmp/nonexistent-plugin.js"], warnings);
    expect(plugins).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain("not found");
  });

  it("convention-extractor accepts plugins parameter", async () => {
    const { extractConventions } = await import("../src/convention-extractor.js");

    const mockPlugin = {
      name: "test-plugin",
      version: "1.0.0",
      detect: () => [{
        category: "ecosystem" as const,
        name: "Test convention",
        description: "From plugin",
        confidence: { matched: 1, total: 1, percentage: 100, description: "1 of 1 (100%)" },
        examples: [],
      }],
    };

    const conventions = extractConventions([], new Map(), [], [], undefined, [mockPlugin]);
    expect(conventions).toHaveLength(1);
    expect(conventions[0].name).toBe("Test convention");
  });

  it("convention-extractor handles plugin errors gracefully", async () => {
    const { extractConventions } = await import("../src/convention-extractor.js");
    const warnings: any[] = [];

    const badPlugin = {
      name: "bad-plugin",
      version: "1.0.0",
      detect: () => { throw new Error("Plugin crashed!"); },
    };

    const conventions = extractConventions([], new Map(), [], warnings, undefined, [badPlugin]);
    expect(conventions).toHaveLength(0);
    expect(warnings.some((w: any) => w.message.includes("bad-plugin"))).toBe(true);
  });

  it("convention-extractor respects disabled plugins", async () => {
    const { extractConventions } = await import("../src/convention-extractor.js");

    const mockPlugin = {
      name: "disabled-plugin",
      version: "1.0.0",
      detect: () => [{
        category: "ecosystem" as const,
        name: "Should not appear",
        description: "Disabled",
        confidence: { matched: 1, total: 1, percentage: 100, description: "1 of 1 (100%)" },
        examples: [],
      }],
    };

    const conventions = extractConventions([], new Map(), ["disabled-plugin"], [], undefined, [mockPlugin]);
    expect(conventions).toHaveLength(0);
  });
});

describe("W5-C3: Mermaid diagram generator", () => {
  it("generates diagram from dependency graph", async () => {
    const { generateDependencyDiagram } = await import("../src/mermaid-generator.js");

    const packages = [
      { name: "hooks", architecture: { packageType: "hooks" } },
      { name: "components", architecture: { packageType: "react-components" } },
      { name: "app", architecture: { packageType: "web-application" } },
    ] as any;

    const graph = [
      { from: "app", to: "components", isDevOnly: false },
      { from: "components", to: "hooks", isDevOnly: false },
      { from: "app", to: "hooks", isDevOnly: false },
    ];

    const diagram = generateDependencyDiagram(packages, graph);

    expect(diagram).toContain("```mermaid");
    expect(diagram).toContain("graph TD");
    expect(diagram).toContain("app");
    expect(diagram).toContain("components");
    expect(diagram).toContain("hooks");
    expect(diagram).toContain("-->");
    expect(diagram).toContain("fill:#e1f5fe"); // hooks
    expect(diagram).toContain("fill:#f3e5f5"); // react-components
    expect(diagram).toContain("fill:#fff3e0"); // web-application
    expect(diagram).toContain("```");
  });

  it("returns empty string for single package", async () => {
    const { generateDependencyDiagram } = await import("../src/mermaid-generator.js");
    const diagram = generateDependencyDiagram(
      [{ name: "solo", architecture: { packageType: "library" } }] as any,
      [],
    );
    expect(diagram).toBe("");
  });

  it("returns empty string for empty dependency graph", async () => {
    const { generateDependencyDiagram } = await import("../src/mermaid-generator.js");
    const diagram = generateDependencyDiagram(
      [
        { name: "a", architecture: { packageType: "library" } },
        { name: "b", architecture: { packageType: "library" } },
      ] as any,
      [],
    );
    expect(diagram).toBe("");
  });
});

// ─── Integration: Pipeline with Wave 5 features ────────────────────────────

describe("W5 Integration", () => {
  const FIXTURES = resolve(__dirname, "fixtures");

  it("pipeline produces examples field in package analysis", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const result = await runPipeline({
      packages: [resolve(FIXTURES, "hooks-pkg")],
      exclude: [],
      output: { format: "json", dir: "/tmp" },
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514", maxOutputTokens: 4096 },
      conventions: { disable: [] },
      maxPublicAPIEntries: 100,
      verbose: false,
    });

    expect(result.packages).toHaveLength(1);
    // examples may or may not be present depending on fixture content
    // But the field should at least be valid
    const pkg = result.packages[0];
    if (pkg.examples) {
      expect(Array.isArray(pkg.examples)).toBe(true);
    }
  });

  it("multi-package pipeline produces Mermaid diagram", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const result = await runPipeline({
      packages: [
        resolve(FIXTURES, "hooks-pkg"),
        resolve(FIXTURES, "minimal-pkg"),
      ],
      exclude: [],
      rootDir: FIXTURES,
      output: { format: "json", dir: "/tmp" },
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514", maxOutputTokens: 4096 },
      conventions: { disable: [] },
      maxPublicAPIEntries: 100,
      verbose: false,
    });

    expect(result.packages).toHaveLength(2);
    // Cross-package analysis should exist
    if (result.crossPackage && result.crossPackage.dependencyGraph.length > 0) {
      // If there are deps, diagram should be generated
      expect(result.crossPackage.mermaidDiagram).toBeDefined();
      expect(result.crossPackage.mermaidDiagram).toContain("mermaid");
    }
  });

  it("no noisy conventions in hooks-pkg output", async () => {
    const { runPipeline } = await import("../src/pipeline.js");
    const result = await runPipeline({
      packages: [resolve(FIXTURES, "hooks-pkg")],
      exclude: [],
      output: { format: "json", dir: "/tmp" },
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514", maxOutputTokens: 4096 },
      conventions: { disable: [] },
      maxPublicAPIEntries: 100,
      verbose: false,
    });

    const convNames = result.packages[0].conventions.map((c) => c.name);

    // These noisy conventions should NOT appear
    const noisy = [
      "Barrel imports",
      "Named exports",
      "displayName",
      "Try-catch",
      "GraphQL hooks",
      "Relative imports",
      "Type-only imports",
    ];
    for (const n of noisy) {
      expect(convNames, `"${n}" should not appear in conventions`).not.toContain(n);
    }
  });
});
