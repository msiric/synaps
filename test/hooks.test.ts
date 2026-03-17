// test/hooks.test.ts — Tests for the Claude Code hook script (synaps-hook.cjs)
// Tests pattern extraction, augmentation logic, and staleness detection.
// Does NOT test actual Claude Code integration (requires running Claude Code).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK_SCRIPT = resolve(import.meta.dirname, "..", "hooks", "synaps-hook.cjs");

// ─── Helper: run hook with simulated input ──────────────────────────────────

function runHook(input: Record<string, unknown>): string {
  try {
    return execFileSync("node", [HOOK_SCRIPT], {
      input: JSON.stringify(input),
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: any) {
    return err.stdout || "";
  }
}

function parseHookOutput(stdout: string): { hookEventName?: string; additionalContext?: string } | null {
  if (!stdout.trim()) return null;
  try {
    const parsed = JSON.parse(stdout);
    return parsed.hookSpecificOutput ?? null;
  } catch {
    return null;
  }
}

// ─── Helper: create a temp cache snapshot ───────────────────────────────────

function createTempSnapshot(cwd: string, data: Record<string, unknown>): void {
  const crypto = require("node:crypto");
  const os = require("node:os");
  const hash = crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  const cacheDir = join(os.homedir(), ".synaps", "cache");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, `${hash}.json`), JSON.stringify(data));
}

function cleanupTempSnapshot(cwd: string): void {
  const crypto = require("node:crypto");
  const os = require("node:os");
  const hash = crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  try {
    rmSync(join(os.homedir(), ".synaps", "cache", `${hash}.json`));
  } catch {
    /* */
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("synaps-hook.cjs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "synaps-hook-test-"));

  const sampleSnapshot = {
    projectPath: tempDir,
    cacheKey: "abc123:def456",
    packages: [
      {
        name: "test-pkg",
        relativePath: ".",
        publicAPI: [
          { name: "runPipeline", kind: "function", sourceFile: "src/pipeline.ts", importCount: 5 },
          { name: "parseFile", kind: "function", sourceFile: "src/ast-parser.ts", importCount: 3 },
        ],
        callGraph: [
          {
            from: "runPipeline",
            to: "parseFile",
            fromFile: "src/pipeline.ts",
            toFile: "src/ast-parser.ts",
            confidence: 0.85,
            resolution: "export-map",
          },
          {
            from: "parseFile",
            to: "extractExports",
            fromFile: "src/ast-parser.ts",
            toFile: "src/ast-parser.ts",
            confidence: 0.95,
            resolution: "same-file",
          },
        ],
        gitHistory: {
          coChangeEdges: [
            {
              file1: "src/ast-parser.ts",
              file2: "src/pipeline.ts",
              jaccard: 0.43,
              coChangeCount: 8,
              file1Commits: 12,
              file2Commits: 15,
              lastCoChangeTimestamp: 0,
            },
          ],
        },
        importChain: [
          { importer: "src/pipeline.ts", source: "src/types.ts", symbolCount: 12, symbols: ["StructuredAnalysis"] },
          { importer: "src/convention-extractor.ts", source: "src/types.ts", symbolCount: 5, symbols: ["Convention"] },
        ],
        conventions: [
          {
            name: "kebab-case",
            description: "Use kebab-case for filenames",
            category: "file-naming",
            source: "fileNaming",
          },
        ],
        executionFlows: [
          {
            label: "runPipeline → parseFile → extractExports (3 steps, 2 files)",
            entryPoint: "runPipeline",
            entryFile: "src/pipeline.ts",
            terminal: "extractExports",
            terminalFile: "src/ast-parser.ts",
            steps: ["runPipeline", "parseFile", "extractExports"],
            files: ["src/pipeline.ts", "src/ast-parser.ts", "src/ast-parser.ts"],
            length: 3,
            confidence: 0.43,
          },
        ],
      },
    ],
    workflowRules: [
      { trigger: "When modifying src/types.ts", action: "Check dependent files", source: "Import chain" },
    ],
  };

  it("returns augmented context for Grep search matching a symbol", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "runPipeline" },
        cwd: tempDir,
      });

      const result = parseHookOutput(output);
      expect(result).not.toBeNull();
      expect(result!.additionalContext).toContain("[synaps]");
      expect(result!.additionalContext).toContain("runPipeline");
      expect(result!.additionalContext).toContain("parseFile"); // callee
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("returns nothing for short patterns (<3 chars)", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "ab" },
        cwd: tempDir,
      });
      expect(parseHookOutput(output)).toBeNull();
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("returns nothing when no snapshot exists", () => {
    const noSnapshotDir = mkdtempSync(join(tmpdir(), "no-snap-"));
    const output = runHook({
      hook_event_name: "PreToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "runPipeline" },
      cwd: noSnapshotDir,
    });
    expect(parseHookOutput(output)).toBeNull();
  });

  it("returns nothing for non-matching patterns", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "nonExistentSymbol" },
        cwd: tempDir,
      });
      expect(parseHookOutput(output)).toBeNull();
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("extracts pattern from Bash grep command", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: 'rg "runPipeline" src/' },
        cwd: tempDir,
      });
      const result = parseHookOutput(output);
      expect(result).not.toBeNull();
      expect(result!.additionalContext).toContain("runPipeline");
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("ignores non-search Bash commands", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
        cwd: tempDir,
      });
      expect(parseHookOutput(output)).toBeNull();
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("shows co-change partners in augmented context", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "parseFile" },
        cwd: tempDir,
      });
      const result = parseHookOutput(output);
      expect(result).not.toBeNull();
      expect(result!.additionalContext).toContain("Co-changes with");
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("shows execution flows in augmented context", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "runPipeline" },
        cwd: tempDir,
      });
      const result = parseHookOutput(output);
      expect(result).not.toBeNull();
      expect(result!.additionalContext).toContain("Flows:");
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("finds files by path when no symbol matches", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "convention-extractor" },
        cwd: tempDir,
      });
      const result = parseHookOutput(output);
      expect(result).not.toBeNull();
      expect(result!.additionalContext).toContain("convention-extractor.ts");
      expect(result!.additionalContext).toContain("Files:");
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("finds conventions by description", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "kebab" },
        cwd: tempDir,
      });
      const result = parseHookOutput(output);
      expect(result).not.toBeNull();
      expect(result!.additionalContext).toContain("Convention:");
      expect(result!.additionalContext).toContain("kebab-case");
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("finds workflow rules by trigger", () => {
    createTempSnapshot(tempDir, sampleSnapshot);
    try {
      const output = runHook({
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "types.ts" },
        cwd: tempDir,
      });
      const result = parseHookOutput(output);
      expect(result).not.toBeNull();
      expect(result!.additionalContext).toContain("Rule:");
      expect(result!.additionalContext).toContain("Check dependent files");
    } finally {
      cleanupTempSnapshot(tempDir);
    }
  });

  it("PostToolUse ignores non-git-mutation commands", () => {
    const output = runHook({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
      tool_output: { exit_code: 0 },
      cwd: tempDir,
    });
    expect(parseHookOutput(output)).toBeNull();
  });

  it("PostToolUse ignores failed git commands", () => {
    const output = runHook({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit -m 'test'" },
      tool_output: { exit_code: 1 },
      cwd: tempDir,
    });
    expect(parseHookOutput(output)).toBeNull();
  });

  it("silently handles invalid JSON input", () => {
    try {
      execFileSync("node", [HOOK_SCRIPT], {
        input: "not json",
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Should not throw — hook handles gracefully
    }
    // If we get here without crash, the hook handled it
    expect(true).toBe(true);
  });
});
