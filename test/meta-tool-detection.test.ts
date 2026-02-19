import { describe, it, expect } from "vitest";
import { detectMetaTool, PACKAGE_TO_FAMILY } from "../src/meta-tool-detector.js";
import type { ParsedFile, TierInfo } from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeParsedFile(
  relativePath: string,
  imports: { moduleSpecifier: string; isTypeOnly?: boolean }[] = [],
  opts: { isTestFile?: boolean } = {},
): ParsedFile {
  return {
    relativePath,
    exports: [],
    imports: imports.map((i) => ({
      moduleSpecifier: i.moduleSpecifier,
      importedNames: [],
      isTypeOnly: i.isTypeOnly ?? false,
      isDynamic: false,
    })),
    contentSignals: {
      tryCatchCount: 0, useMemoCount: 0, useCallbackCount: 0,
      useEffectCount: 0, useStateCount: 0, useQueryCount: 0,
      useMutationCount: 0, jestMockCount: 0, hasDisplayName: false,
      hasErrorBoundary: false,
    },
    lineCount: 10,
    isTestFile: opts.isTestFile ?? false,
    isGeneratedFile: false,
    hasJSX: false,
    hasCJS: false,
    hasSyntaxErrors: false,
    callReferences: [],
  };
}

function makeTiers(files: ParsedFile[]): Map<string, TierInfo> {
  const tiers = new Map<string, TierInfo>();
  for (const f of files) {
    tiers.set(f.relativePath, {
      tier: f.isTestFile ? 3 : 1,
      reason: f.isTestFile ? "Test file" : "Source",
    });
  }
  return tiers;
}

// ─── Signal 1: peerDependencies ──────────────────────────────────────────────

describe("Signal 1: peerDependencies", () => {
  it("detects meta-tool when ≥3 peer families imported in source", () => {
    const files = [
      makeParsedFile("src/a.ts", [{ moduleSpecifier: "react" }]),
      makeParsedFile("src/b.ts", [{ moduleSpecifier: "vue" }]),
      makeParsedFile("src/c.ts", [{ moduleSpecifier: "@angular/core" }]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {}, devDependencies: {},
      peerDeps: { react: "^18.0.0", vue: "^3.0.0", "@angular/core": "^17.0.0" },
    });
    expect(result.isMetaTool).toBe(true);
    expect(result.signal).toBe("peer-dependencies");
    expect(result.supportedFamilies).toContain("react");
    expect(result.supportedFamilies).toContain("vue");
    expect(result.supportedFamilies).toContain("angular");
  });

  it("does NOT trigger when 5 peer packages map to only 1 family", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "react-dom" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {}, devDependencies: {},
      // All these are either in "react" family or not in any family
      peerDeps: { react: "^18", "react-dom": "^18", "framer-motion": "^10", "@emotion/react": "^11", "styled-components": "^6" },
    });
    expect(result.isMetaTool).toBe(false);
  });

  it("falls through when only 2 peer families", () => {
    const files = [
      makeParsedFile("src/a.ts", [{ moduleSpecifier: "react" }]),
      makeParsedFile("src/b.ts", [{ moduleSpecifier: "vue" }]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {}, devDependencies: {},
      peerDeps: { react: "^18", vue: "^3" },
    });
    expect(result.isMetaTool).toBe(false);
  });
});

// ─── Signal 2: Dependency placement ──────────────────────────────────────────

describe("Signal 2: Dependency placement", () => {
  it("detects meta-tool when ≥4 devDep-only framework families imported", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "vue" },
        { moduleSpecifier: "express" },
        { moduleSpecifier: "webpack" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {},
      devDependencies: { react: "^18", vue: "^3", express: "^4", webpack: "^5" },
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(true);
    expect(result.signal).toBe("dep-placement");
  });

  it("does NOT count non-framework devDep packages", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "chalk" },
        { moduleSpecifier: "lodash" },
        { moduleSpecifier: "minimist" },
        { moduleSpecifier: "cosmiconfig" },
        { moduleSpecifier: "debug" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {},
      devDependencies: { chalk: "^5", lodash: "^4", minimist: "^1", cosmiconfig: "^9", debug: "^4" },
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(false);
  });

  it("falls through when only 3 devDep-only families", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "vue" },
        { moduleSpecifier: "express" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {},
      devDependencies: { react: "^18", vue: "^3", express: "^4" },
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(false);
  });

  it("counts family with only one member imported (relaxed membership)", () => {
    // react imported (but not react-dom), react in devDeps → counts as 1 family
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "vue" },
        { moduleSpecifier: "express" },
        { moduleSpecifier: "webpack" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {},
      devDependencies: { react: "^18", vue: "^3", express: "^4", webpack: "^5" },
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(true);
    expect(result.supportedFamilies).toContain("react");
  });
});

// ─── Signal 3: Family count fallback ─────────────────────────────────────────

describe("Signal 3: Family count fallback", () => {
  it("detects meta-tool when >5 framework families imported", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "vue" },
        { moduleSpecifier: "express" },
        { moduleSpecifier: "webpack" },
        { moduleSpecifier: "prisma" },
        { moduleSpecifier: "redux" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: { react: "^18", vue: "^3", express: "^4", webpack: "^5", prisma: "^5", redux: "^5" },
      devDependencies: {},
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(true);
    expect(result.signal).toBe("family-count");
  });

  it("does NOT trigger for standard Next.js+Prisma+Redux+Express (5 families)", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "react-dom" },
        { moduleSpecifier: "next" },
        { moduleSpecifier: "@reduxjs/toolkit" },
        { moduleSpecifier: "express" },
        { moduleSpecifier: "@prisma/client" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: { react: "^18", "react-dom": "^18", next: "^15", "@reduxjs/toolkit": "^2", express: "^4", "@prisma/client": "^5" },
      devDependencies: {},
      peerDeps: {},
    });
    // react+react-dom=1, next=2, redux(@reduxjs/toolkit)=3, express=4, prisma(@prisma/client)=5
    expect(result.isMetaTool).toBe(false);
  });

  it("deduplicates react + react-dom as 1 family", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "react-dom" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: { react: "^18", "react-dom": "^18" },
      devDependencies: {},
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(false);
    // Only 1 family, well below threshold
  });
});

// ─── Filtering ───────────────────────────────────────────────────────────────

describe("Import filtering", () => {
  it("type-only imports do not count for any signal", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react", isTypeOnly: true },
        { moduleSpecifier: "vue", isTypeOnly: true },
        { moduleSpecifier: "express", isTypeOnly: true },
        { moduleSpecifier: "webpack", isTypeOnly: true },
        { moduleSpecifier: "prisma", isTypeOnly: true },
        { moduleSpecifier: "redux", isTypeOnly: true },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {},
      devDependencies: { react: "^18", vue: "^3", express: "^4", webpack: "^5", prisma: "^5", redux: "^5" },
      peerDeps: { react: "^18", vue: "^3", express: "^4" },
    });
    expect(result.isMetaTool).toBe(false);
  });

  it("test file (T3) imports do not count", () => {
    const files = [
      makeParsedFile("test/a.test.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "vue" },
        { moduleSpecifier: "express" },
        { moduleSpecifier: "webpack" },
        { moduleSpecifier: "prisma" },
        { moduleSpecifier: "redux" },
      ], { isTestFile: true }),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {},
      devDependencies: { react: "^18", vue: "^3", express: "^4", webpack: "^5", prisma: "^5", redux: "^5" },
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(false);
  });
});

// ─── Completeness pass ───────────────────────────────────────────────────────

describe("Completeness pass", () => {
  it("returns ALL framework families even when Signal 1 triggers on 3", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "vue" },
        { moduleSpecifier: "@angular/core" },
        { moduleSpecifier: "express" },
        { moduleSpecifier: "webpack" },
        { moduleSpecifier: "prisma" },
      ]),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {},
      devDependencies: {},
      peerDeps: { react: "^18", vue: "^3", "@angular/core": "^17" },
    });
    expect(result.isMetaTool).toBe(true);
    expect(result.signal).toBe("peer-dependencies");
    // Completeness pass should include ALL families, not just the 3 peerDep ones
    expect(result.supportedFamilies.length).toBeGreaterThanOrEqual(6);
    expect(result.supportedFamilies).toContain("express");
    expect(result.supportedFamilies).toContain("webpack");
    expect(result.supportedFamilies).toContain("prisma");
  });
});

// ─── Dominant family detection ───────────────────────────────────────────────

describe("Dominant family detection", () => {
  it("classifies dominant family as core when in production deps + 3x margin", () => {
    const files = [
      // React has 30 imports, others have 5 each
      ...Array.from({ length: 30 }, (_, i) => makeParsedFile(`src/react-${i}.ts`, [{ moduleSpecifier: "react" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/vue-${i}.ts`, [{ moduleSpecifier: "vue" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/angular-${i}.ts`, [{ moduleSpecifier: "@angular/core" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/express-${i}.ts`, [{ moduleSpecifier: "express" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/webpack-${i}.ts`, [{ moduleSpecifier: "webpack" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/prisma-${i}.ts`, [{ moduleSpecifier: "prisma" }])),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: { react: "^18", "react-dom": "^18" }, // React in production deps
      devDependencies: { vue: "^3", "@angular/core": "^17", express: "^4", webpack: "^5", prisma: "^5" },
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(true);
    expect(result.coreFamilies).toEqual(["react"]);
  });

  it("no core family when dominant is in devDeps only", () => {
    const files = [
      ...Array.from({ length: 30 }, (_, i) => makeParsedFile(`src/react-${i}.ts`, [{ moduleSpecifier: "react" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/vue-${i}.ts`, [{ moduleSpecifier: "vue" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/angular-${i}.ts`, [{ moduleSpecifier: "@angular/core" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/express-${i}.ts`, [{ moduleSpecifier: "express" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/webpack-${i}.ts`, [{ moduleSpecifier: "webpack" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/prisma-${i}.ts`, [{ moduleSpecifier: "prisma" }])),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: {}, // React NOT in production deps
      devDependencies: { react: "^18", vue: "^3", "@angular/core": "^17", express: "^4", webpack: "^5", prisma: "^5" },
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(true);
    expect(result.coreFamilies).toEqual([]);
  });

  it("no core family when dominant lacks 3x margin", () => {
    const files = [
      ...Array.from({ length: 20 }, (_, i) => makeParsedFile(`src/react-${i}.ts`, [{ moduleSpecifier: "react" }])),
      ...Array.from({ length: 18 }, (_, i) => makeParsedFile(`src/vue-${i}.ts`, [{ moduleSpecifier: "vue" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/angular-${i}.ts`, [{ moduleSpecifier: "@angular/core" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/express-${i}.ts`, [{ moduleSpecifier: "express" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/webpack-${i}.ts`, [{ moduleSpecifier: "webpack" }])),
      ...Array.from({ length: 5 }, (_, i) => makeParsedFile(`src/prisma-${i}.ts`, [{ moduleSpecifier: "prisma" }])),
    ];
    const result = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: { react: "^18" },
      devDependencies: { vue: "^3", "@angular/core": "^17", express: "^4", webpack: "^5", prisma: "^5" },
      peerDeps: {},
    });
    expect(result.isMetaTool).toBe(true);
    // 20/18 = 1.1x, less than 3x → no core
    expect(result.coreFamilies).toEqual([]);
  });
});

// ─── Config ──────────────────────────────────────────────────────────────────

describe("Configuration", () => {
  it("custom threshold changes Signal 3 sensitivity", () => {
    const files = [
      makeParsedFile("src/a.ts", [
        { moduleSpecifier: "react" },
        { moduleSpecifier: "vue" },
        { moduleSpecifier: "express" },
        { moduleSpecifier: "webpack" },
        { moduleSpecifier: "prisma" },
        { moduleSpecifier: "redux" },
      ]),
    ];
    // Default threshold (5) would trigger
    const resultDefault = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: { react: "^18", vue: "^3", express: "^4", webpack: "^5", prisma: "^5", redux: "^5" },
      devDependencies: {}, peerDeps: {},
    });
    expect(resultDefault.isMetaTool).toBe(true);

    // Threshold 10 should not trigger
    const resultHigh = detectMetaTool({
      parsedFiles: files, tiers: makeTiers(files),
      dependencies: { react: "^18", vue: "^3", express: "^4", webpack: "^5", prisma: "^5", redux: "^5" },
      devDependencies: {}, peerDeps: {},
      threshold: 10,
    });
    expect(resultHigh.isMetaTool).toBe(false);
  });
});

// ─── PACKAGE_TO_FAMILY map ───────────────────────────────────────────────────

describe("PACKAGE_TO_FAMILY", () => {
  it("maps react-dom to react family", () => {
    expect(PACKAGE_TO_FAMILY.get("react-dom")).toBe("react");
  });

  it("maps @prisma/client to prisma family", () => {
    expect(PACKAGE_TO_FAMILY.get("@prisma/client")).toBe("prisma");
  });

  it("maps @reduxjs/toolkit to redux family", () => {
    expect(PACKAGE_TO_FAMILY.get("@reduxjs/toolkit")).toBe("redux");
  });
});
