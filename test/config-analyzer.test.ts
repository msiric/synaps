import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeConfig } from "../src/config-analyzer.js";
import type { Warning } from "../src/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

describe("analyzeConfig", () => {
  it("detects tsconfig with strict mode and paths from config-pkg", () => {
    const config = analyzeConfig(resolve(FIXTURES, "config-pkg"));

    expect(config.typescript).toBeDefined();
    expect(config.typescript!.strict).toBe(true);
    expect(config.typescript!.target).toBe("ES2022");
    expect(config.typescript!.module).toBe("ESNext");
    expect(config.typescript!.moduleResolution).toBe("bundler");
    expect(config.typescript!.jsx).toBe("react-jsx");
    expect(config.typescript!.paths).toEqual({ "@/*": ["./src/*"] });
  });

  it("detects eslint as linter from config-pkg", () => {
    const config = analyzeConfig(resolve(FIXTURES, "config-pkg"));
    expect(config.linter).toBeDefined();
    expect(config.linter!.name).toBe("eslint");
    expect(config.linter!.configFile).toBe(".eslintrc.json");
  });

  it("detects prettier as formatter from config-pkg", () => {
    const config = analyzeConfig(resolve(FIXTURES, "config-pkg"));
    expect(config.formatter).toBeDefined();
    expect(config.formatter!.name).toBe("prettier");
    expect(config.formatter!.configFile).toBe(".prettierrc");
  });

  it("detects env vars from .env.example in config-pkg", () => {
    const config = analyzeConfig(resolve(FIXTURES, "config-pkg"));
    expect(config.envVars).toBeDefined();
    expect(config.envVars).toContain("DATABASE_URL");
    expect(config.envVars).toContain("API_KEY");
    expect(config.envVars).toContain("NODE_ENV");
  });

  it("detects turbo as build tool from turbo-monorepo root", () => {
    const rootDir = resolve(FIXTURES, "turbo-monorepo");
    const pkgDir = resolve(FIXTURES, "turbo-monorepo/packages/app");
    const config = analyzeConfig(pkgDir, rootDir);

    expect(config.buildTool).toBeDefined();
    expect(config.buildTool!.name).toBe("turbo");
    expect(config.buildTool!.taskNames).toContain("build");
    expect(config.buildTool!.taskNames).toContain("test");
    expect(config.buildTool!.taskNames).toContain("lint");
    expect(config.buildTool!.taskNames).toContain("dev");
  });

  it("detects biome as linter and formatter from turbo-monorepo root", () => {
    const rootDir = resolve(FIXTURES, "turbo-monorepo");
    const pkgDir = resolve(FIXTURES, "turbo-monorepo/packages/app");
    const config = analyzeConfig(pkgDir, rootDir);

    expect(config.linter).toBeDefined();
    expect(config.linter!.name).toBe("biome");
    expect(config.formatter).toBeDefined();
    expect(config.formatter!.name).toBe("biome");
  });

  it("returns undefined for missing config files in no-package-json", () => {
    const config = analyzeConfig(resolve(FIXTURES, "no-package-json"));
    expect(config.typescript).toBeUndefined();
    expect(config.buildTool).toBeUndefined();
    expect(config.taskRunner).toBeUndefined();
    expect(config.linter).toBeUndefined();
    expect(config.formatter).toBeUndefined();
    expect(config.envVars).toBeUndefined();
  });

  it("records warnings for malformed config files", () => {
    const tmpDir = resolve(import.meta.dirname, "fixtures", "__tmp-bad-config");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(resolve(tmpDir, "tsconfig.json"), "{ invalid json }}}");

    const warnings: Warning[] = [];
    const config = analyzeConfig(tmpDir, undefined, warnings);

    expect(config.typescript).toBeUndefined();
    expect(warnings.some((w) => w.module === "config-analyzer")).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("task runner detection", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = resolve(import.meta.dirname, "fixtures", "__tmp-taskrunner-test");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        resolve(tmpDir, "Makefile"),
        ["build:", "\tgo build ./...", "", "test:", "\tgo test ./...", "", "lint:", "\tgolangci-lint run"].join("\n"),
      );
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("detects Makefile targets", () => {
      const config = analyzeConfig(tmpDir);

      expect(config.taskRunner).toBeDefined();
      expect(config.taskRunner!.name).toBe("make");
      expect(config.taskRunner!.targets).toContain("build");
      expect(config.taskRunner!.targets).toContain("test");
      expect(config.taskRunner!.targets).toContain("lint");
    });
  });

  describe("justfile detection", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = resolve(import.meta.dirname, "fixtures", "__tmp-justfile-test");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        resolve(tmpDir, "justfile"),
        ["dev:", "  npm run dev", "", "deploy:", "  ./scripts/deploy.sh"].join("\n"),
      );
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("detects justfile targets", () => {
      const config = analyzeConfig(tmpDir);

      expect(config.taskRunner).toBeDefined();
      expect(config.taskRunner!.name).toBe("just");
      expect(config.taskRunner!.targets).toContain("dev");
      expect(config.taskRunner!.targets).toContain("deploy");
    });
  });
});
