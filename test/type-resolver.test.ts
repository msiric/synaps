import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTypeResolver } from "../src/type-resolver.js";
import type { Warning } from "../src/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const TYPE_CHECK_PKG = resolve(FIXTURES, "type-checker-target");

describe("createTypeResolver", () => {
  it("creates a Program and TypeChecker for a package with tsconfig.json", () => {
    const warnings: Warning[] = [];
    const result = createTypeResolver(TYPE_CHECK_PKG, warnings);

    expect(result).not.toBeNull();
    expect(result!.program).toBeDefined();
    expect(result!.checker).toBeDefined();
    expect(result!.timingMs).toBeGreaterThanOrEqual(0);
    expect(warnings.filter((w) => w.level === "error")).toHaveLength(0);
  });

  it("returns null when no tsconfig.json exists", () => {
    // Isolated temp dir — no tsconfig.json ancestor to find
    const isolated = mkdtempSync(resolve(tmpdir(), "synaps-test-"));
    const warnings: Warning[] = [];
    const result = createTypeResolver(isolated, warnings);
    expect(result).toBeNull();
  });

  it("includes source files from tsconfig include pattern", () => {
    const warnings: Warning[] = [];
    const result = createTypeResolver(TYPE_CHECK_PKG, warnings);
    expect(result).not.toBeNull();

    const sourceFiles = result!.program.getSourceFiles().map((sf) => sf.fileName);
    const hasService = sourceFiles.some((f) => f.includes("service.ts"));
    const hasTypes = sourceFiles.some((f) => f.includes("types.ts"));
    expect(hasService).toBe(true);
    expect(hasTypes).toBe(true);
  });

  it("resolves within timing budget", () => {
    const warnings: Warning[] = [];
    const result = createTypeResolver(TYPE_CHECK_PKG, warnings);
    expect(result).not.toBeNull();
    expect(result!.timingMs).toBeLessThan(5000);
  });
});
