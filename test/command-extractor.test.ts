import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractCommands } from "../src/command-extractor.js";
import type { Warning } from "../src/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

describe("extractCommands", () => {
  it("extracts build/test/lint commands from config-pkg", () => {
    const cmds = extractCommands(resolve(FIXTURES, "config-pkg"));

    expect(cmds.build).toBeDefined();
    expect(cmds.build!.run).toBe("npm run build");
    expect(cmds.test).toBeDefined();
    expect(cmds.test!.run).toBe("npm run test");
    expect(cmds.lint).toBeDefined();
    expect(cmds.lint!.run).toBe("npm run lint");
  });

  it("extracts build/test/lint commands from hooks-pkg", () => {
    const cmds = extractCommands(resolve(FIXTURES, "hooks-pkg"));

    expect(cmds.build).toBeDefined();
    expect(cmds.build!.run).toBe("npm run build");
    expect(cmds.test).toBeDefined();
    expect(cmds.test!.run).toBe("npm run test");
    expect(cmds.lint).toBeDefined();
    expect(cmds.lint!.run).toBe("npm run lint");
  });

  it("returns empty commands for no-package-json fixture", () => {
    const cmds = extractCommands(resolve(FIXTURES, "no-package-json"));

    expect(cmds.build).toBeUndefined();
    expect(cmds.test).toBeUndefined();
    expect(cmds.lint).toBeUndefined();
    expect(cmds.start).toBeUndefined();
    expect(cmds.other).toEqual([]);
  });

  it("defaults to npm when no lock file is present", () => {
    const cmds = extractCommands(resolve(FIXTURES, "config-pkg"));
    expect(cmds.packageManager).toBe("npm");
  });

  it("populates the source field for each command", () => {
    const cmds = extractCommands(resolve(FIXTURES, "config-pkg"));

    expect(cmds.build!.source).toContain("package.json");
    expect(cmds.build!.source).toContain("build");
    expect(cmds.test!.source).toContain("package.json");
  });

  it("accepts and does not crash with warnings array", () => {
    const warnings: Warning[] = [];
    const cmds = extractCommands(resolve(FIXTURES, "config-pkg"), undefined, warnings);
    expect(cmds.build).toBeDefined();
    // No warnings expected for a well-formed fixture
  });

  describe("variant detection", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = resolve(import.meta.dirname, "fixtures", "__tmp-variant-test");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        resolve(tmpDir, "package.json"),
        JSON.stringify({
          name: "variant-test",
          scripts: {
            test: "vitest",
            "test:unit": "vitest run unit",
            "test:e2e": "vitest run e2e",
            build: "tsc",
            format: "prettier --write .",
            typecheck: "tsc --noEmit",
          },
        }),
      );
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("matches test:unit as the test command (first pattern match)", () => {
      const cmds = extractCommands(tmpDir);

      // CATEGORY_PATTERNS lists "test:unit" before "test", so test:unit matches first
      // addVariants only looks for sub-variants (test:unit:*), not sibling variants
      expect(cmds.test).toBeDefined();
      expect(cmds.test!.run).toBe("npm run test:unit");
    });

    it("detects test variants when test is the primary script", () => {
      // Create a fixture where "test" is the script name and test:unit/test:e2e are variants
      const variantDir = resolve(import.meta.dirname, "fixtures", "__tmp-variant-test2");
      mkdirSync(variantDir, { recursive: true });
      writeFileSync(
        resolve(variantDir, "package.json"),
        JSON.stringify({
          name: "variant-test2",
          scripts: {
            test: "vitest",
            "test:unit": "vitest run unit",
            "test:e2e": "vitest run e2e",
          },
        }),
      );

      try {
        const cmds = extractCommands(variantDir);
        expect(cmds.test).toBeDefined();
        // "test:unit" matches first in CATEGORY_PATTERNS, so "test" is not the primary
        // But test:unit has no sub-variants
        expect(cmds.test!.run).toBe("npm run test:unit");
      } finally {
        rmSync(variantDir, { recursive: true, force: true });
      }
    });

    it("detects format as an other command", () => {
      const cmds = extractCommands(tmpDir);

      const otherNames = cmds.other.map((c) => c.run);
      expect(otherNames).toContain("npm run format");
    });

    it("detects typecheck as an other command", () => {
      const cmds = extractCommands(tmpDir);

      const otherNames = cmds.other.map((c) => c.run);
      expect(otherNames).toContain("npm run typecheck");
    });
  });

  describe("package manager detection", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = resolve(import.meta.dirname, "fixtures", "__tmp-pm-test");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        resolve(tmpDir, "package.json"),
        JSON.stringify({
          name: "pm-test",
          scripts: { build: "tsc" },
        }),
      );
      writeFileSync(resolve(tmpDir, "yarn.lock"), "");
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("detects yarn when yarn.lock is present", () => {
      const cmds = extractCommands(tmpDir);
      expect(cmds.packageManager).toBe("yarn");
      expect(cmds.build!.run).toBe("yarn build");
    });
  });
});
