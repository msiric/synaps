import { describe, it, expect } from "vitest";
import { classifyTier, deriveTaskName, generateTasksFromAnalysis } from "../../src/benchmark/task-generator.js";
import type { ContributionPattern, StructuredAnalysis, PackageAnalysis } from "../../src/types.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makePattern(overrides: Partial<ContributionPattern> = {}): ContributionPattern {
  return {
    type: "function",
    directory: "src/detectors/",
    filePattern: "{name}.ts",
    exampleFile: "src/detectors/file-naming.ts",
    steps: ["Create file", "Add exports"],
    ...overrides,
  };
}

describe("classifyTier", () => {
  it("classifies Tier A when all 3 deep signals present", () => {
    const pattern = makePattern({
      commonImports: [{ specifier: "../types.js", symbols: ["Convention"], coverage: 0.8 }],
      exportSuffix: "Detector",
      registrationFile: "src/convention-extractor.ts",
    });
    expect(classifyTier(pattern)).toBe("A");
  });

  it("classifies Tier B when 1-2 deep signals present", () => {
    expect(classifyTier(makePattern({ exportSuffix: "Detector" }))).toBe("B");
    expect(classifyTier(makePattern({
      commonImports: [{ specifier: "./types.js", symbols: ["X"], coverage: 0.9 }],
    }))).toBe("B");
  });

  it("classifies Tier C when no deep signals present", () => {
    expect(classifyTier(makePattern())).toBe("C");
  });
});

describe("deriveTaskName", () => {
  it("derives a name that does not collide with existing files", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bench-"));
    writeFileSync(join(tmpDir, "file-naming.ts"), "");
    writeFileSync(join(tmpDir, "test-patterns.ts"), "");

    const name = deriveTaskName(makePattern(), tmpDir);
    expect(name).toBeTruthy();
    expect(name).not.toBe("file-naming");
    expect(name).not.toBe("test-patterns");

    rmSync(tmpDir, { recursive: true });
  });

  it("returns null if directory does not exist", () => {
    const name = deriveTaskName(makePattern(), "/nonexistent/path");
    expect(name).toBeNull();
  });
});

describe("generateTasksFromAnalysis", () => {
  it("generates tasks from contribution patterns", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bench-"));
    const detectorsDir = join(tmpDir, "src", "detectors");
    mkdirSync(detectorsDir, { recursive: true });
    writeFileSync(join(detectorsDir, "file-naming.ts"), "export function fileNamingDetector() {}");
    writeFileSync(join(detectorsDir, "test-patterns.ts"), "export function testPatternDetector() {}");
    writeFileSync(join(detectorsDir, "hook-patterns.ts"), "export function hookPatternDetector() {}");

    const analysis: StructuredAnalysis = {
      meta: {
        engineVersion: "0.5.0",
        analyzedAt: new Date().toISOString(),
        rootDir: tmpDir,
        config: {} as any,
        timingMs: 100,
      },
      packages: [{
        name: "test-pkg",
        version: "1.0.0",
        description: "",
        relativePath: ".",
        files: { total: 10, byTier: { tier1: { count: 3, lines: 100, files: [] }, tier2: { count: 3, lines: 100, files: [] }, tier3: { count: 4, lines: 100 } }, byExtension: { ".ts": 10 } },
        publicAPI: [],
        conventions: [],
        commands: { packageManager: "npm", other: [] },
        architecture: { entryPoint: "src/index.ts", directories: [], packageType: "library", hasJSX: false },
        dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
        role: { summary: "test", purpose: "", whenToUse: "", inferredFrom: [] },
        antiPatterns: [],
        contributionPatterns: [
          makePattern({
            commonImports: [{ specifier: "../types.js", symbols: ["Convention"], coverage: 0.8 }],
            exportSuffix: "Detector",
            registrationFile: "src/convention-extractor.ts",
          }),
        ],
      } as PackageAnalysis],
      warnings: [],
    };

    const tasks = generateTasksFromAnalysis(analysis, tmpDir, 5);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0].tier).toBe("A");
    expect(tasks[0].prompt).toContain("test-pkg");
    expect(tasks[0].expectedDirectory).toBe("src/detectors/");

    rmSync(tmpDir, { recursive: true });
  });

  it("returns empty array when no contribution patterns exist", () => {
    const analysis: StructuredAnalysis = {
      meta: { engineVersion: "0.5.0", analyzedAt: "", rootDir: "/tmp", config: {} as any, timingMs: 0 },
      packages: [{
        name: "empty",
        version: "1.0.0",
        description: "",
        relativePath: ".",
        files: { total: 0, byTier: { tier1: { count: 0, lines: 0, files: [] }, tier2: { count: 0, lines: 0, files: [] }, tier3: { count: 0, lines: 0 } }, byExtension: {} },
        publicAPI: [],
        conventions: [],
        commands: { packageManager: "npm", other: [] },
        architecture: { entryPoint: "", directories: [], packageType: "library", hasJSX: false },
        dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
        role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
        antiPatterns: [],
        contributionPatterns: [],
      } as PackageAnalysis],
      warnings: [],
    };

    const tasks = generateTasksFromAnalysis(analysis, "/tmp", 5);
    expect(tasks).toHaveLength(0);
  });
});
