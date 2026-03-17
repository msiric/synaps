import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeDependencies } from "../src/dependency-analyzer.js";
import type { Warning } from "../src/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

describe("analyzeDependencies", () => {
  it("detects react framework with version-aware guidance from config-pkg", () => {
    const result = analyzeDependencies(resolve(FIXTURES, "config-pkg"));

    const reactFw = result.frameworks.find((f) => f.name === "react");
    expect(reactFw).toBeDefined();
    expect(reactFw!.version).toBe("18.2.0");
    expect(reactFw!.guidance).toContain("React 18");
    expect(reactFw!.guidance).toContain("do NOT use use() hook");
  });

  it("detects typescript framework with guidance from config-pkg", () => {
    const result = analyzeDependencies(resolve(FIXTURES, "config-pkg"));

    const tsFw = result.frameworks.find((f) => f.name === "typescript");
    expect(tsFw).toBeDefined();
    expect(tsFw!.version).toBe("5.4.0");
    expect(tsFw!.guidance).toContain("TypeScript 5");
  });

  it("detects vitest as test framework from config-pkg", () => {
    const result = analyzeDependencies(resolve(FIXTURES, "config-pkg"));
    expect(result.testFramework).toBeDefined();
    expect(result.testFramework!.name).toBe("vitest");
  });

  it("detects vite as bundler from config-pkg", () => {
    const result = analyzeDependencies(resolve(FIXTURES, "config-pkg"));
    expect(result.bundler).toBeDefined();
    expect(result.bundler!.name).toBe("vite");
  });

  it("returns empty result for no-package-json fixture", () => {
    const result = analyzeDependencies(resolve(FIXTURES, "no-package-json"));
    expect(result.runtime).toEqual([]);
    expect(result.frameworks).toEqual([]);
    expect(result.testFramework).toBeUndefined();
    expect(result.bundler).toBeUndefined();
  });

  it("returns no frameworks for hooks-pkg (no known framework deps)", () => {
    const result = analyzeDependencies(resolve(FIXTURES, "hooks-pkg"));
    // hooks-pkg has no dependencies listed in package.json
    expect(result.frameworks).toEqual([]);
  });

  it("filters frameworks when sourceImports is provided", () => {
    const warnings: Warning[] = [];
    // react is in config-pkg deps but we pass sourceImports that does NOT include react
    const sourceImports = new Set(["typescript"]);
    const result = analyzeDependencies(resolve(FIXTURES, "config-pkg"), undefined, warnings, sourceImports);

    // react should be filtered out since it's not in sourceImports
    const reactFw = result.frameworks.find((f) => f.name === "react");
    expect(reactFw).toBeUndefined();

    // typescript should remain since it's in sourceImports
    const tsFw = result.frameworks.find((f) => f.name === "typescript");
    expect(tsFw).toBeDefined();

    // Should emit an info warning about unverified frameworks
    const infoWarning = warnings.find((w) => w.level === "info" && w.message.includes("react"));
    expect(infoWarning).toBeDefined();
  });

  describe("runtime detection", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = resolve(import.meta.dirname, "fixtures", "__tmp-runtime-test");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        resolve(tmpDir, "package.json"),
        JSON.stringify({
          name: "runtime-test",
          engines: { node: ">=18.0.0" },
          dependencies: {},
        }),
      );
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("detects node runtime from engines field", () => {
      const result = analyzeDependencies(tmpDir);
      const nodeRuntime = result.runtime.find((r) => r.name === "node");
      expect(nodeRuntime).toBeDefined();
      expect(nodeRuntime!.version).toBe("18.0.0");
    });
  });

  describe("workspace prefix skipping", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = resolve(import.meta.dirname, "fixtures", "__tmp-workspace-test");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        resolve(tmpDir, "package.json"),
        JSON.stringify({
          name: "workspace-test",
          dependencies: {
            "@internal/shared": "workspace:*",
            react: "^19.0.0",
          },
        }),
      );
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("skips workspace: prefixed dependencies", () => {
      const result = analyzeDependencies(tmpDir);

      // react should be detected as a framework
      const reactFw = result.frameworks.find((f) => f.name === "react");
      expect(reactFw).toBeDefined();
      expect(reactFw!.guidance).toContain("React 19");

      // workspace dep should not appear as a framework
      const internalFw = result.frameworks.find((f) => f.name === "@internal/shared");
      expect(internalFw).toBeUndefined();
    });
  });
});
