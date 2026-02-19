import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { analyze } from "../src/index.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

describe("integration: analyze()", () => {
  it("analyzes minimal-pkg end-to-end", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "minimal-pkg")],
    });

    expect(result.packages).toHaveLength(1);
    const pkg = result.packages[0];

    expect(pkg.name).toBe("@test/minimal-pkg");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.publicAPI.length).toBeGreaterThanOrEqual(1);

    const greet = pkg.publicAPI.find((e) => e.name === "greet");
    expect(greet).toBeDefined();
    expect(greet?.kind).toBe("function");
    expect(greet?.sourceFile).toBe("src/greet.ts");
    expect(greet?.signature).toContain("name: string");

    expect(pkg.files.total).toBe(2);
    expect(pkg.files.byTier.tier1.count).toBe(2);

    expect(pkg.architecture.entryPoint).toBe("index.ts");
  });

  it("analyzes hooks-pkg end-to-end", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "hooks-pkg")],
    });

    const pkg = result.packages[0];
    expect(pkg.name).toBe("@test/hooks-pkg");

    // Public API includes hooks
    const hookNames = pkg.publicAPI
      .filter((e) => e.kind === "hook")
      .map((e) => e.name);
    expect(hookNames).toContain("useCounter");
    expect(hookNames).toContain("useToggle");
    expect(hookNames).toContain("useLocalStorage");
    expect(hookNames).toContain("useFetch");

    // Architecture detected as hooks
    expect(pkg.architecture.packageType).toBe("hooks");
    expect(pkg.architecture.hasJSX).toBe(false); // hooks are .ts not .tsx

    // Conventions detected
    const conventionNames = pkg.conventions.map((c) => c.name);
    expect(conventionNames.length).toBeGreaterThan(0);

    // Has test and generated files classified
    expect(pkg.files.byTier.tier3.count).toBeGreaterThan(0);

    // Commands
    expect(pkg.commands.test).toBeDefined();
    expect(pkg.commands.build).toBeDefined();
  });

  it("analyzes exports-pkg (E-41: exports field)", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "exports-pkg")],
    });

    const pkg = result.packages[0];
    expect(pkg.name).toBe("@test/exports-pkg");

    const apiNames = pkg.publicAPI.map((e) => e.name);
    expect(apiNames).toContain("createClient");
    expect(apiNames).toContain("ClientOptions");
  });

  it("analyzes circular-reexport-pkg without hanging (E-40)", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "circular-reexport-pkg")],
    });

    expect(result.packages).toHaveLength(1);
    // Should complete and have warnings about circular
    const circularWarning = result.warnings.some(
      (w) => w.message.toLowerCase().includes("circular"),
    );
    expect(circularWarning).toBe(true);
  });

  it("analyzes no-barrel-pkg", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "no-barrel-pkg")],
    });

    const pkg = result.packages[0];
    expect(pkg.publicAPI).toHaveLength(0); // no barrel → no public API
    expect(result.warnings.some((w) => w.message.includes("No barrel"))).toBe(
      true,
    );
  });

  it("analyzes no-package-json directory", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "no-package-json")],
    });

    const pkg = result.packages[0];
    expect(pkg.name).toBe("no-package-json"); // falls back to dir name
    expect(pkg.version).toBe("0.0.0");
  });

  it("analyzes cjs-pkg (E-42)", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "cjs-pkg")],
    });

    const pkg = result.packages[0];
    expect(pkg.files.total).toBe(2); // index.js and bar.js
  });

  it("analyzes multiple packages with cross-package analysis", async () => {
    const result = await analyze({
      packages: [
        resolve(FIXTURES, "minimal-pkg"),
        resolve(FIXTURES, "hooks-pkg"),
      ],
    });

    expect(result.packages).toHaveLength(2);
    expect(result.crossPackage).toBeDefined();
    expect(result.crossPackage?.dependencyGraph).toBeDefined();
  });

  it("includes timing in meta", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "minimal-pkg")],
    });

    expect(result.meta.timingMs).toBeGreaterThanOrEqual(0);
    expect(result.meta.engineVersion).toBe("0.3.0");
    expect(result.meta.analyzedAt).toBeTruthy();
  });

  it("does not leak API key in meta.config (E-6)", async () => {
    const result = await analyze({
      packages: [resolve(FIXTURES, "minimal-pkg")],
      llm: {
        provider: "anthropic",
        model: "test-model",
        apiKey: "sk-secret-key",
        maxOutputTokens: 4096,
      },
    });

    const json = JSON.stringify(result.meta.config);
    expect(json).not.toContain("sk-secret-key");
    expect((result.meta.config.llm as any).apiKey).toBeUndefined();
  });
});
