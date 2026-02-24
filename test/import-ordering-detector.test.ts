import { describe, it, expect } from "vitest";
import { importOrderingDetector } from "../src/detectors/import-ordering.js";
import type { ParsedFile, TierInfo } from "../src/types.js";

function makeFile(relativePath: string, imports: { specifier: string }[]): ParsedFile {
  return {
    relativePath,
    exports: [],
    imports: imports.map(i => ({
      moduleSpecifier: i.specifier,
      importedNames: ["x"],
      isTypeOnly: false,
      isDynamic: false,
    })),
    contentSignals: {} as any,
    lineCount: 50,
    isTestFile: false,
    isGeneratedFile: false,
    hasJSX: false,
    hasCJS: false,
    hasSyntaxErrors: false,
    callReferences: [],
  };
}

const tiers = new Map<string, TierInfo>([
  ["src/a.ts", { tier: 1, reason: "public" } as any],
  ["src/b.ts", { tier: 1, reason: "public" } as any],
  ["src/c.ts", { tier: 1, reason: "public" } as any],
  ["src/d.ts", { tier: 1, reason: "public" } as any],
  ["src/e.ts", { tier: 1, reason: "public" } as any],
  ["src/f.ts", { tier: 1, reason: "public" } as any],
]);

describe("importOrderingDetector", () => {
  it("detects external-before-local ordering pattern", () => {
    const files = Array.from({ length: 6 }, (_, i) =>
      makeFile(`src/${String.fromCharCode(97 + i)}.ts`, [
        { specifier: "zod" },
        { specifier: "typescript" },
        { specifier: "./utils.js" },
      ]),
    );

    const result = importOrderingDetector(files, tiers, []);
    expect(result.some(c => c.name.includes("external before local"))).toBe(true);
  });

  it("detects builtin-first ordering pattern", () => {
    const files = Array.from({ length: 6 }, (_, i) =>
      makeFile(`src/${String.fromCharCode(97 + i)}.ts`, [
        { specifier: "node:path" },
        { specifier: "node:fs" },
        { specifier: "zod" },
        { specifier: "./local.js" },
      ]),
    );

    const result = importOrderingDetector(files, tiers, []);
    expect(result.some(c => c.name.includes("builtins first"))).toBe(true);
  });

  it("returns empty for files with too few imports", () => {
    const files = Array.from({ length: 6 }, (_, i) =>
      makeFile(`src/${String.fromCharCode(97 + i)}.ts`, [
        { specifier: "./utils.js" },
      ]),
    );

    const result = importOrderingDetector(files, tiers, []);
    expect(result).toEqual([]);
  });

  it("returns empty for inconsistent ordering", () => {
    const files = [
      // Half external-first
      ...Array.from({ length: 3 }, (_, i) =>
        makeFile(`src/${String.fromCharCode(97 + i)}.ts`, [
          { specifier: "zod" },
          { specifier: "./local.js" },
          { specifier: "typescript" },
        ]),
      ),
      // Half local-first
      ...Array.from({ length: 3 }, (_, i) =>
        makeFile(`src/${String.fromCharCode(100 + i)}.ts`, [
          { specifier: "./local.js" },
          { specifier: "zod" },
          { specifier: "./other.js" },
        ]),
      ),
    ];

    const result = importOrderingDetector(files, tiers, []);
    // Should not report a strong pattern when it's 50/50
    const extBeforeLocal = result.find(c => c.name.includes("external before local"));
    expect(extBeforeLocal).toBeUndefined();
  });

  it("returns empty for too few files", () => {
    const files = [
      makeFile("src/a.ts", [
        { specifier: "zod" },
        { specifier: "./local.js" },
        { specifier: "typescript" },
      ]),
    ];

    const result = importOrderingDetector(files, new Map([["src/a.ts", { tier: 1 } as any]]), []);
    expect(result).toEqual([]);
  });
});
