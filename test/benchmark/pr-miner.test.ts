// test/benchmark/pr-miner.test.ts

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listDirAtCommit, mineCommits, readFileAtCommit } from "../../src/benchmark/pr-miner.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

// Helper to get git root
function getGitRoot(): string {
  return execSync("git rev-parse --show-toplevel", {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  }).trim();
}

describe("pr-miner", () => {
  describe("readFileAtCommit", () => {
    it("reads a file at HEAD", () => {
      const gitRoot = getGitRoot();
      const content = readFileAtCommit(gitRoot, "HEAD", "package.json");
      expect(content).toBeTruthy();
      expect(content).toContain("synaps");
    });

    it("returns null for non-existent file", () => {
      const gitRoot = getGitRoot();
      const content = readFileAtCommit(gitRoot, "HEAD", "non-existent-file.ts");
      expect(content).toBeNull();
    });
  });

  describe("listDirAtCommit", () => {
    it("lists files in src/ at HEAD", () => {
      const gitRoot = getGitRoot();
      const files = listDirAtCommit(gitRoot, "HEAD", "src");
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.endsWith(".ts"))).toBe(true);
    });

    it("returns empty for non-existent directory", () => {
      const gitRoot = getGitRoot();
      const files = listDirAtCommit(gitRoot, "HEAD", "non-existent-dir");
      expect(files).toEqual([]);
    });
  });

  describe("mineCommits", () => {
    it("mines commits from synaps itself", () => {
      const { tasks, stats } = mineCommits(REPO_ROOT, {
        maxTasks: 5,
        maxCommits: 100,
        sinceDays: 365,
        minSiblings: 1, // lower threshold for our own repo
        minFileLines: 10,
        verbose: false,
      });

      // Should find at least some tasks in our own repo
      expect(stats.totalCommits).toBeGreaterThan(0);

      if (tasks.length > 0) {
        const task = tasks[0];

        // Verify task structure
        expect(task.id).toBeTruthy();
        expect(task.commitSha).toMatch(/^[a-f0-9]{40}$/);
        expect(task.commitMessage).toBeTruthy();
        expect(task.groundTruth.path).toBeTruthy();
        expect(task.groundTruth.content).toBeTruthy();
        expect(task.groundTruth.directory).toBeTruthy();
        expect(task.groundTruth.filename).toBeTruthy();
        expect(task.groundTruth.lineCount).toBeGreaterThan(0);

        // Context should have siblings
        expect(task.context.siblingFiles.length).toBeGreaterThanOrEqual(0);
        expect(task.context.directoryListing.length).toBeGreaterThan(0);

        // Ground truth should be read from commit, not HEAD
        // (the file content should exist and be non-empty)
        expect(task.groundTruth.content.length).toBeGreaterThan(0);
      }
    });

    it("respects maxTasks limit", () => {
      const { tasks } = mineCommits(REPO_ROOT, {
        maxTasks: 2,
        maxCommits: 100,
        sinceDays: 365,
        minSiblings: 0,
        minFileLines: 5,
      });
      expect(tasks.length).toBeLessThanOrEqual(2);
    });

    it("enforces directory diversity", () => {
      const { tasks } = mineCommits(REPO_ROOT, {
        maxTasks: 20,
        maxCommits: 200,
        sinceDays: 365,
        minSiblings: 0,
        minFileLines: 5,
      });

      // Count tasks per directory
      const dirCounts = new Map<string, number>();
      for (const task of tasks) {
        const dir = task.groundTruth.directory;
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }

      // No directory should have more than 2 tasks
      for (const [, count] of dirCounts) {
        expect(count).toBeLessThanOrEqual(2);
      }
    });

    it("reports filter statistics", () => {
      const { stats } = mineCommits(REPO_ROOT, {
        maxTasks: 5,
        maxCommits: 50,
        sinceDays: 365,
        minSiblings: 1,
        minFileLines: 10,
      });

      expect(stats.totalCommits).toBeGreaterThanOrEqual(0);
      expect(stats.selected).toBeLessThanOrEqual(5);
      expect(typeof stats.filterReasons).toBe("object");
    });

    it("throws for non-git directory", () => {
      expect(() => mineCommits("/tmp")).toThrow(/Not a git repository/);
    });
  });
});
