// test/benchmark/pr-task-gen.test.ts
import { describe, it, expect } from "vitest";
import { generateTaskPrompt, cleanCommitMessage } from "../../src/benchmark/pr-task-gen.js";
import type { MinedTask } from "../../src/benchmark/pr-miner.js";

function makeTask(overrides: Partial<MinedTask> = {}): MinedTask {
  return {
    id: "test-task",
    commitSha: "abc123",
    commitMessage: overrides.commitMessage ?? "feat: add caching middleware for API responses",
    commitDate: "2024-06-15T10:00:00Z",
    groundTruth: {
      path: "src/middleware/cache.ts",
      content: overrides.groundTruth?.content ?? `export function createCache(maxSize: number) {\n  return new Map();\n}\n`,
      directory: "src/middleware",
      filename: "cache.ts",
      lineCount: 30,
      ...overrides.groundTruth,
    },
    context: {
      siblingFiles: [],
      directoryListing: ["auth.ts", "logger.ts", "cors.ts"],
      ...overrides.context,
    },
  };
}

describe("cleanCommitMessage", () => {
  it("strips conventional commit prefixes", () => {
    expect(cleanCommitMessage("feat: add caching layer")).toBe("Add caching layer");
    expect(cleanCommitMessage("fix(auth): resolve token issue")).toBe("resolve token issue");
    expect(cleanCommitMessage("chore: update dependencies")).toBe("update dependencies");
  });

  it("strips issue references", () => {
    expect(cleanCommitMessage("Add feature (#123)")).toBe("Add feature");
    expect(cleanCommitMessage("Fix bug related to #456")).toBe("Fix bug related to");
  });

  it("strips directory/path hints", () => {
    expect(cleanCommitMessage("Add cache adapter to src/utils")).toBe("Add cache adapter");
    expect(cleanCommitMessage("Move handler in packages/auth/src")).toBe("Move handler");
    // "Create" gets normalized to "Add"; "under" is matched by the path regex
    expect(cleanCommitMessage("Create service under lib/core")).toBe("Add service");
  });

  it("strips filename references", () => {
    expect(cleanCommitMessage("Add cache-adapter.ts")).toBe("Add");
    // "Create" gets normalized to "Add" by the leading-word replacement
    expect(cleanCommitMessage("Create auth-service.tsx for login")).toBe("Add for login");
  });

  it("handles already clean messages", () => {
    expect(cleanCommitMessage("Add Redis-based caching for API responses")).toBe(
      "Add Redis-based caching for API responses"
    );
  });

  it("handles very short messages", () => {
    expect(cleanCommitMessage("fix")).toBe("fix");
    expect(cleanCommitMessage("")).toBe("");
  });
});

describe("generateTaskPrompt", () => {
  it("uses descriptive commit messages", () => {
    const task = makeTask({
      commitMessage: "feat: add caching middleware for API responses",
    });
    const prompt = generateTaskPrompt(task, "my-project");
    expect(prompt).toContain("caching middleware for API responses");
    expect(prompt).toContain("my-project");
    expect(prompt).toContain("conventions");
  });

  it("strips directory hints from commit messages", () => {
    const task = makeTask({
      commitMessage: "feat: add cache adapter to src/utils for session storage",
    });
    const prompt = generateTaskPrompt(task, "my-project");
    expect(prompt).not.toContain("src/utils");
    expect(prompt).toContain("cache adapter");
  });

  it("falls back to file exports when message is short", () => {
    const task = makeTask({
      commitMessage: "update",
      groundTruth: {
        path: "src/middleware/cache.ts",
        content: "export function createCache(maxSize: number) { return new Map(); }",
        directory: "src/middleware",
        filename: "cache.ts",
        lineCount: 30,
      },
    });
    const prompt = generateTaskPrompt(task, "my-project");
    expect(prompt).toContain("create cache");
    expect(prompt).toContain("my-project");
  });

  it("falls back to filename when exports not found", () => {
    const task = makeTask({
      commitMessage: "x",
      groundTruth: {
        path: "src/utils/string-helpers.ts",
        content: "const x = 1;", // no exports
        directory: "src/utils",
        filename: "string-helpers.ts",
        lineCount: 30,
      },
    });
    const prompt = generateTaskPrompt(task, "my-project");
    expect(prompt).toContain("string helpers");
  });

  it("includes convention instructions", () => {
    const task = makeTask();
    const prompt = generateTaskPrompt(task, "my-project");
    expect(prompt).toContain("conventions");
    expect(prompt).toContain("barrel");
  });
});
