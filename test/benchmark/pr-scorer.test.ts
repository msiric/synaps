// test/benchmark/pr-scorer.test.ts
import { describe, it, expect } from "vitest";
import {
  scorePROutput,
  scoreFilePlacement,
  pathSimilarity,
  scoreNamingConvention,
  scoreBarrelUpdate,
} from "../../src/benchmark/pr-scorer.js";
import type { MinedTask } from "../../src/benchmark/pr-miner.js";
import type { GeneratedFile } from "../../src/benchmark/types.js";

function makeTask(overrides: Partial<MinedTask> = {}): MinedTask {
  return {
    id: "test-task",
    commitSha: "abc123",
    commitMessage: "feat: add cache adapter",
    commitDate: "2024-06-15T10:00:00Z",
    groundTruth: {
      path: "src/utils/cache-adapter.ts",
      content: "export function createCache() {}",
      directory: "src/utils",
      filename: "cache-adapter.ts",
      lineCount: 30,
    },
    context: {
      siblingFiles: [],
      directoryListing: ["string-helpers.ts", "date-utils.ts"],
      barrelFile: undefined,
    },
    ...overrides,
  };
}

describe("pathSimilarity", () => {
  it("returns 1.0 for exact match", () => {
    expect(pathSimilarity("src/utils", "src/utils")).toBe(1.0);
  });

  it("returns ~0.5 for parent directory", () => {
    const score = pathSimilarity("src", "src/utils");
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.7);
  });

  it("returns low score for completely different paths", () => {
    const score = pathSimilarity("lib/core/auth", "src/utils/cache");
    expect(score).toBeLessThan(0.2);
  });

  it("penalizes package mismatch in monorepos", () => {
    const samePackage = pathSimilarity("packages/auth/src/utils", "packages/auth/src/helpers");
    const diffPackage = pathSimilarity("packages/auth/src/utils", "packages/core/src/utils");
    expect(samePackage).toBeGreaterThan(diffPackage);
  });

  it("handles identical single-segment paths", () => {
    expect(pathSimilarity("src", "src")).toBe(1.0);
  });
});

describe("scoreFilePlacement", () => {
  const task = makeTask();

  it("scores 100% for exact directory match", () => {
    const files: GeneratedFile[] = [{ path: "src/utils/my-cache.ts", content: "export {}" }];
    const result = scoreFilePlacement(files, task);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("scores partially for parent directory", () => {
    const files: GeneratedFile[] = [{ path: "src/my-cache.ts", content: "export {}" }];
    const result = scoreFilePlacement(files, task);
    expect(result.score).toBeGreaterThan(20);
    expect(result.score).toBeLessThan(80);
  });

  it("scores 0 for completely wrong directory", () => {
    const files: GeneratedFile[] = [{ path: "lib/core/my-cache.ts", content: "export {}" }];
    const result = scoreFilePlacement(files, task);
    expect(result.score).toBeLessThan(20);
  });

  it("scores 0 for no implementation files", () => {
    const result = scoreFilePlacement([], task);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("picks the best-scoring file when multiple are generated", () => {
    const files: GeneratedFile[] = [
      { path: "lib/wrong/cache.ts", content: "export {}" },
      { path: "src/utils/cache.ts", content: "export {}" },
    ];
    const result = scoreFilePlacement(files, task);
    expect(result.score).toBe(100);
  });
});

describe("scoreNamingConvention", () => {
  it("scores 100% for matching convention (kebab-case)", () => {
    const task = makeTask(); // ground truth: cache-adapter.ts (kebab-case)
    const files: GeneratedFile[] = [{ path: "src/utils/my-module.ts", content: "" }];
    const result = scoreNamingConvention(files, task);
    expect(result.score).toBe(100);
  });

  it("scores 0% for mismatched convention", () => {
    const task = makeTask({
      groundTruth: {
        path: "src/utils/CacheAdapter.ts",
        content: "export class CacheAdapter {}",
        directory: "src/utils",
        filename: "CacheAdapter.ts",
        lineCount: 30,
      },
    });
    const files: GeneratedFile[] = [{ path: "src/utils/cache-adapter.ts", content: "" }];
    const result = scoreNamingConvention(files, task);
    // PascalCase expected, kebab-case provided
    expect(result.score).toBe(0);
  });
});

describe("scoreBarrelUpdate", () => {
  it("returns 100% when no barrel exists (N/A)", () => {
    const task = makeTask(); // no barrelFile
    const result = scoreBarrelUpdate([], task);
    expect(result.score).toBe(100);
  });

  it("scores 0% when barrel exists but AI didn't update it", () => {
    const task = makeTask({
      context: {
        siblingFiles: [],
        directoryListing: [],
        barrelFile: {
          path: "src/utils/index.ts",
          content: "export * from './string-helpers';\n",
        },
      },
    });
    const files: GeneratedFile[] = [
      { path: "src/utils/cache.ts", content: "export function cache() {}" },
    ];
    const result = scoreBarrelUpdate(files, task);
    expect(result.score).toBe(0);
  });

  it("scores 100% when AI adds export to barrel", () => {
    const task = makeTask({
      context: {
        siblingFiles: [],
        directoryListing: [],
        barrelFile: {
          path: "src/utils/index.ts",
          content: "export * from './string-helpers';\n",
        },
      },
    });
    const files: GeneratedFile[] = [
      { path: "src/utils/cache.ts", content: "export function cache() {}" },
      {
        path: "src/utils/index.ts",
        content: "export * from './string-helpers';\nexport * from './cache';\n",
      },
    ];
    const result = scoreBarrelUpdate(files, task);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });
});

describe("scorePROutput", () => {
  it("returns 0 for empty output", () => {
    const task = makeTask();
    const result = scorePROutput([], task, 0, 0, "No output");
    expect(result.score).toBe(0);
    expect(result.error).toBe("No output");
  });

  it("scores based on file placement as primary metric", () => {
    const task = makeTask();
    const files: GeneratedFile[] = [
      { path: "src/utils/new-cache.ts", content: "export function newCache() {}" },
    ];
    const result = scorePROutput(files, task, 1000, 500);
    expect(result.score).toBe(100); // exact directory match
    expect(result.dimensions.filePlacement.score).toBe(100);
  });

  it("filters test files from scoring", () => {
    const task = makeTask();
    const files: GeneratedFile[] = [
      { path: "test/cache.test.ts", content: "import { test } from 'vitest';" },
      { path: "src/utils/cache.ts", content: "export function cache() {}" },
    ];
    const result = scorePROutput(files, task, 1000, 500);
    // Should score based on the impl file, not the test
    expect(result.score).toBe(100);
  });
});
