import { describe, it, expect } from "vitest";
import { computeInferabilityScore } from "../src/inferability.js";
import type { PackageAnalysis } from "../src/types.js";

function makePkg(overrides: Partial<PackageAnalysis> = {}): PackageAnalysis {
  return {
    name: "test",
    version: "1.0.0",
    description: "",
    relativePath: ".",
    files: { total: 10, byTier: { tier1: { count: 3, lines: 100, files: [] }, tier2: { count: 3, lines: 100, files: [] }, tier3: { count: 4, lines: 100 } }, byExtension: { ".ts": 10 } },
    publicAPI: [],
    conventions: [],
    commands: { packageManager: "npm", other: [] },
    architecture: { entryPoint: "src/index.ts", directories: [], packageType: "library", hasJSX: false },
    dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
    role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
    antiPatterns: [],
    contributionPatterns: [],
    ...overrides,
  } as PackageAnalysis;
}

describe("computeInferabilityScore", () => {
  it("returns high score for standard, obvious structure", () => {
    const pkg = makePkg({
      architecture: {
        entryPoint: "src/index.ts",
        directories: [
          { path: "src/components", purpose: "UI components", fileCount: 10, exports: [] },
          { path: "src/utils", purpose: "Utilities", fileCount: 5, exports: [] },
          { path: "src/hooks", purpose: "React hooks", fileCount: 3, exports: [] },
        ],
        packageType: "library",
        hasJSX: true,
      },
      conventions: [
        { category: "file-naming", name: "kebab-case", description: "", confidence: { matched: 95, total: 100, percentage: 95, description: "" }, examples: [] },
      ],
    });

    const score = computeInferabilityScore(pkg);
    expect(score.score).toBeGreaterThan(65);
    expect(score.recommendation).toBe("skip");
    expect(score.factors.directoryObviousness).toBe(100);
  });

  it("returns low score for non-obvious, complex structure", () => {
    const pkg = makePkg({
      architecture: {
        entryPoint: "src/index.ts",
        directories: [
          { path: "src/detectors", purpose: "Convention detectors", fileCount: 8, exports: ["fileNaming"] },
          { path: "src/protocols", purpose: "Protocol handlers", fileCount: 4, exports: [] },
          { path: "integration-tests", purpose: "Integration tests", fileCount: 10, exports: [] },
        ],
        packageType: "library",
        hasJSX: false,
      },
      conventions: [
        { category: "file-naming", name: "kebab-case", description: "", confidence: { matched: 70, total: 100, percentage: 70, description: "" }, examples: [] },
      ],
      contributionPatterns: [
        {
          type: "function", directory: "src/detectors/", filePattern: "{name}.ts",
          exampleFile: "src/detectors/file-naming.ts", steps: ["Create file"],
          commonImports: [{ specifier: "../types.js", symbols: ["Convention"], coverage: 0.9 }],
          exportSuffix: "Detector",
          registrationFile: "src/convention-extractor.ts",
        },
      ],
    });

    const score = computeInferabilityScore(pkg);
    expect(score.score).toBeLessThan(40);
    expect(score.recommendation).toBe("full");
    expect(score.factors.directoryObviousness).toBeLessThan(50);
  });

  it("returns moderate score for mixed structure", () => {
    const pkg = makePkg({
      architecture: {
        entryPoint: "src/index.ts",
        directories: [
          { path: "src/components", purpose: "UI", fileCount: 10, exports: [] },
          { path: "src/adapters", purpose: "Framework adapters", fileCount: 5, exports: [] },
          { path: "src/protocols", purpose: "Wire protocols", fileCount: 3, exports: [] },
        ],
        packageType: "library",
        hasJSX: false,
      },
      conventions: [
        { category: "file-naming", name: "kebab-case", description: "", confidence: { matched: 75, total: 100, percentage: 75, description: "" }, examples: [] },
      ],
      contributionPatterns: [
        {
          type: "function", directory: "src/adapters/", filePattern: "{name}.ts",
          exampleFile: "src/adapters/react.ts", steps: ["Create adapter"],
          exportSuffix: "Adapter",
          commonImports: [{ specifier: "../base.js", symbols: ["BaseAdapter"], coverage: 0.8 }],
        },
      ],
    });

    const score = computeInferabilityScore(pkg);
    expect(score.score).toBeGreaterThan(30);
    expect(score.score).toBeLessThan(66);
    expect(score.recommendation).toBe("minimal");
  });

  it("handles empty package gracefully", () => {
    const score = computeInferabilityScore(makePkg());
    expect(score.score).toBeGreaterThan(0);
    expect(score.recommendation).toBeDefined();
  });

  it("gives lower score when multiple registration files exist", () => {
    const pkg = makePkg({
      contributionPatterns: [
        { type: "function", directory: "src/a/", filePattern: "*.ts", exampleFile: "a.ts", steps: [], registrationFile: "src/registry-a.ts" },
        { type: "function", directory: "src/b/", filePattern: "*.ts", exampleFile: "b.ts", steps: [], registrationFile: "src/registry-b.ts" },
        { type: "function", directory: "src/c/", filePattern: "*.ts", exampleFile: "c.ts", steps: [], registrationFile: "src/registry-c.ts" },
      ],
    });

    const score = computeInferabilityScore(pkg);
    expect(score.factors.registrationComplexity).toBeLessThan(20);
  });
});
