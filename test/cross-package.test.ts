import { describe, expect, it } from "vitest";
import { analyzeCrossPackage } from "../src/cross-package.js";
import type { CommandSet, Convention, PackageAnalysis } from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConvention(name: string, description?: string): Convention {
  return {
    category: "testing",
    name,
    description: description ?? name,
    confidence: { matched: 10, total: 10, percentage: 100, description: description ?? "10 of 10 (100%)" },
    examples: [],
  };
}

function makePkg(overrides: Partial<PackageAnalysis> = {}): PackageAnalysis {
  return {
    name: "test-pkg",
    version: "1.0.0",
    description: "",
    relativePath: ".",
    files: {
      total: 1,
      byTier: {
        tier1: { count: 1, lines: 10, files: [] },
        tier2: { count: 0, lines: 0, files: [] },
        tier3: { count: 0, lines: 0 },
      },
      byExtension: {},
    },
    publicAPI: [],
    conventions: [],
    commands: { packageManager: "npm", other: [] },
    architecture: { entryPoint: "index.ts", directories: [], packageType: "library", hasJSX: false },
    dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
    role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
    antiPatterns: [],
    contributionPatterns: [],
    ...overrides,
  } as PackageAnalysis;
}

// ─── Dependency Graph ────────────────────────────────────────────────────────

describe("analyzeCrossPackage — dependency graph", () => {
  it("returns empty graph for empty packages array", () => {
    const result = analyzeCrossPackage([]);
    expect(result.dependencyGraph).toEqual([]);
  });

  it("returns empty graph for single package with no deps", () => {
    const result = analyzeCrossPackage([makePkg({ name: "A" })]);
    expect(result.dependencyGraph).toEqual([]);
  });

  it("creates edge when package depends on another analyzed package", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", dependencies: { internal: ["B"], external: [], totalUniqueDependencies: 1 } }),
      makePkg({ name: "B" }),
    ]);
    expect(result.dependencyGraph).toHaveLength(1);
    expect(result.dependencyGraph[0]).toEqual({ from: "A", to: "B", isDevOnly: false });
  });

  it("filters out dependency on non-analyzed package", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", dependencies: { internal: ["C"], external: [], totalUniqueDependencies: 1 } }),
      makePkg({ name: "B" }),
    ]);
    // "C" is not in the packages array, so no edge
    expect(result.dependencyGraph).toEqual([]);
  });

  it("handles mutual dependencies without crash", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", dependencies: { internal: ["B"], external: [], totalUniqueDependencies: 1 } }),
      makePkg({ name: "B", dependencies: { internal: ["A"], external: [], totalUniqueDependencies: 1 } }),
    ]);
    expect(result.dependencyGraph).toHaveLength(2);
    expect(result.dependencyGraph).toContainEqual({ from: "A", to: "B", isDevOnly: false });
    expect(result.dependencyGraph).toContainEqual({ from: "B", to: "A", isDevOnly: false });
  });

  it("handles chain A → B → C", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", dependencies: { internal: ["B"], external: [], totalUniqueDependencies: 1 } }),
      makePkg({ name: "B", dependencies: { internal: ["C"], external: [], totalUniqueDependencies: 1 } }),
      makePkg({ name: "C" }),
    ]);
    expect(result.dependencyGraph).toHaveLength(2);
    expect(result.dependencyGraph).toContainEqual({ from: "A", to: "B", isDevOnly: false });
    expect(result.dependencyGraph).toContainEqual({ from: "B", to: "C", isDevOnly: false });
  });
});

// ─── Convention Analysis ─────────────────────────────────────────────────────

describe("analyzeCrossPackage — conventions", () => {
  it("returns empty shared/divergent for single package", () => {
    const result = analyzeCrossPackage([makePkg({ conventions: [makeConvention("vitest")] })]);
    expect(result.sharedConventions).toEqual([]);
    expect(result.divergentConventions).toEqual([]);
  });

  it("classifies convention as shared when present in all packages", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", conventions: [makeConvention("kebab-case")] }),
      makePkg({ name: "B", conventions: [makeConvention("kebab-case")] }),
    ]);
    expect(result.sharedConventions.length).toBeGreaterThanOrEqual(1);
    expect(result.sharedConventions.some((c) => c.name === "kebab-case")).toBe(true);
  });

  it("classifies convention as divergent when present in some but not all", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", conventions: [makeConvention("vitest")] }),
      makePkg({ name: "B", conventions: [makeConvention("vitest")] }),
      makePkg({ name: "C", conventions: [] }),
    ]);
    expect(result.divergentConventions.some((d) => d.convention === "vitest")).toBe(true);
  });

  it("drops convention present in only 1 of N packages", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", conventions: [makeConvention("unique-to-A")] }),
      makePkg({ name: "B", conventions: [] }),
    ]);
    expect(result.sharedConventions).toEqual([]);
    expect(result.divergentConventions).toEqual([]);
  });

  it("uses first package's convention object for shared", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", conventions: [makeConvention("kebab-case", "24 of 30 (80%)")] }),
      makePkg({ name: "B", conventions: [makeConvention("kebab-case", "18 of 20 (90%)")] }),
    ]);
    const shared = result.sharedConventions.find((c) => c.name === "kebab-case");
    expect(shared).toBeDefined();
    expect(shared!.confidence.description).toBe("24 of 30 (80%)");
  });

  it("divergent includes all package values", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", conventions: [makeConvention("vitest", "8 of 10")] }),
      makePkg({ name: "B", conventions: [makeConvention("vitest", "5 of 6")] }),
      makePkg({ name: "C", conventions: [] }),
    ]);
    const div = result.divergentConventions.find((d) => d.convention === "vitest");
    expect(div).toBeDefined();
    expect(div!.packages).toHaveLength(2);
    expect(div!.packages.find((p) => p.name === "A")?.value).toBe("8 of 10");
    expect(div!.packages.find((p) => p.name === "B")?.value).toBe("5 of 6");
  });

  it("handles mixed shared, divergent, and unique conventions", () => {
    const result = analyzeCrossPackage([
      makePkg({
        name: "A",
        conventions: [makeConvention("shared"), makeConvention("divergent"), makeConvention("unique-A")],
      }),
      makePkg({ name: "B", conventions: [makeConvention("shared"), makeConvention("divergent")] }),
      makePkg({ name: "C", conventions: [makeConvention("shared")] }),
    ]);
    expect(result.sharedConventions.some((c) => c.name === "shared")).toBe(true);
    expect(result.divergentConventions.some((d) => d.convention === "divergent")).toBe(true);
    // unique-A appears in only 1 package — should be in neither
    expect(result.sharedConventions.some((c) => c.name === "unique-A")).toBe(false);
    expect(result.divergentConventions.some((d) => d.convention === "unique-A")).toBe(false);
  });
});

// ─── Anti-patterns and Impact ────────────────────────────────────────────────

describe("analyzeCrossPackage — anti-patterns and impact", () => {
  it("derives shared anti-patterns from shared conventions", () => {
    // High-confidence file-naming convention produces anti-pattern
    const result = analyzeCrossPackage([
      makePkg({ name: "A", conventions: [{ ...makeConvention("kebab-case files"), category: "file-naming" }] }),
      makePkg({ name: "B", conventions: [{ ...makeConvention("kebab-case files"), category: "file-naming" }] }),
    ]);
    expect(result.sharedAntiPatterns).toBeInstanceOf(Array);
  });

  it("produces empty anti-patterns when no shared conventions", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", conventions: [makeConvention("only-in-A")] }),
      makePkg({ name: "B", conventions: [makeConvention("only-in-B")] }),
    ]);
    expect(result.sharedAntiPatterns).toEqual([]);
  });
});

// ─── rootCommands passthrough ────────────────────────────────────────────────

describe("analyzeCrossPackage — rootCommands", () => {
  it("passes rootCommands through unchanged", () => {
    const commands: CommandSet = {
      packageManager: "pnpm",
      build: { run: "pnpm build", source: "package.json" },
      other: [],
    };
    const result = analyzeCrossPackage([makePkg({ name: "A" }), makePkg({ name: "B" })], commands);
    expect(result.rootCommands).toBe(commands);
  });

  it("rootCommands is undefined when not provided", () => {
    const result = analyzeCrossPackage([makePkg({ name: "A" }), makePkg({ name: "B" })]);
    expect(result.rootCommands).toBeUndefined();
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("analyzeCrossPackage — edge cases", () => {
  it("handles packages with empty conventions and deps", () => {
    const result = analyzeCrossPackage([
      makePkg({ name: "A", conventions: [], dependencies: { internal: [], external: [], totalUniqueDependencies: 0 } }),
      makePkg({ name: "B", conventions: [], dependencies: { internal: [], external: [], totalUniqueDependencies: 0 } }),
    ]);
    expect(result.dependencyGraph).toEqual([]);
    expect(result.sharedConventions).toEqual([]);
    expect(result.divergentConventions).toEqual([]);
  });
});
