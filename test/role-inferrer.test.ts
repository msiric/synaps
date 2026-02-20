import { describe, it, expect } from "vitest";
import { inferRole } from "../src/role-inferrer.js";
import type { PackageAnalysis } from "../src/types.js";

function makeAnalysis(
  overrides: Partial<Omit<PackageAnalysis, "role" | "antiPatterns" | "contributionPatterns">>,
): Omit<PackageAnalysis, "role" | "antiPatterns" | "contributionPatterns"> {
  return {
    name: "@test/pkg",
    version: "1.0.0",
    description: "",
    relativePath: "packages/test/pkg",
    files: {
      total: 10,
      byTier: {
        tier1: { count: 3, lines: 100, files: [] },
        tier2: { count: 5, lines: 200, files: [] },
        tier3: { count: 2, lines: 50 },
      },
      byExtension: { ".ts": 10 },
    },
    publicAPI: [],
    conventions: [],
    commands: {
      packageManager: "yarn",
      test: { run: "yarn test:unit", source: "package.json" },
      other: [],
    },
    architecture: {
      entryPoint: "src/index.ts",
      directories: [],
      packageType: "library",
      hasJSX: false,
    },
    dependencies: {
      internal: [],
      external: [],
      totalUniqueDependencies: 0,
    },
    ...overrides,
  };
}

describe("inferRole", () => {
  it("identifies a hooks package from export kinds", () => {
    const analysis = makeAnalysis({
      architecture: {
        entryPoint: "src/index.ts",
        directories: [],
        packageType: "hooks",
        hasJSX: false,
      },
      publicAPI: [
        { name: "useCreateTab", kind: "hook", sourceFile: "src/hooks/use-create-tab.ts", isTypeOnly: false },
        { name: "useUpdateTab", kind: "hook", sourceFile: "src/hooks/use-update-tab.ts", isTypeOnly: false },
        { name: "useDeleteTab", kind: "hook", sourceFile: "src/hooks/use-delete-tab.ts", isTypeOnly: false },
        { name: "useFetchData", kind: "hook", sourceFile: "src/hooks/use-fetch-data.ts", isTypeOnly: false },
      ],
      dependencies: {
        internal: [],
        external: [{ name: "@apollo/client", importCount: 4 }],
        totalUniqueDependencies: 1,
      },
    });

    const role = inferRole(analysis);
    expect(role.summary).toContain("Hooks");
    // Domain signals require ≥2 matches per pattern; single CRUD hooks don't trigger
    expect(role.inferredFrom.length).toBeGreaterThan(0);
    expect(role.whenToUse).toContain("Touch this package when");
  });

  it("identifies a CLI tool from packageType", () => {
    const analysis = makeAnalysis({
      architecture: {
        entryPoint: "none",
        directories: [],
        packageType: "cli",
        hasJSX: false,
      },
      publicAPI: [
        { name: "run", kind: "function", sourceFile: "src/run.ts", isTypeOnly: false },
        { name: "parseArgs", kind: "function", sourceFile: "src/parse.ts", isTypeOnly: false },
      ],
      dependencies: {
        internal: [],
        external: [{ name: "mri", importCount: 1 }],
        totalUniqueDependencies: 1,
      },
    });

    const role = inferRole(analysis);
    expect(role.summary).toContain("CLI");
    expect(role.inferredFrom).toContain("packageType: cli");
  });

  it("identifies React components from component exports", () => {
    const analysis = makeAnalysis({
      architecture: {
        entryPoint: "src/index.ts",
        directories: [],
        packageType: "react-components",
        hasJSX: true,
      },
      publicAPI: [
        { name: "TabList", kind: "component", sourceFile: "src/TabList.tsx", isTypeOnly: false },
        { name: "TabPanel", kind: "component", sourceFile: "src/TabPanel.tsx", isTypeOnly: false },
        { name: "renderView", kind: "function", sourceFile: "src/render.ts", isTypeOnly: false },
      ],
      dependencies: {
        internal: [],
        external: [{ name: "react", importCount: 5 }],
        totalUniqueDependencies: 1,
      },
    });

    const role = inferRole(analysis);
    expect(role.summary).toContain("React components");
    expect(role.inferredFrom).toContainEqual(expect.stringContaining("components"));
  });

  it("detects domain signals from export names", () => {
    const analysis = makeAnalysis({
      publicAPI: [
        { name: "fetchUserData", kind: "function", sourceFile: "src/api.ts", isTypeOnly: false },
        { name: "querySettings", kind: "function", sourceFile: "src/api.ts", isTypeOnly: false },
        { name: "validateInput", kind: "function", sourceFile: "src/validation.ts", isTypeOnly: false },
      ],
    });

    const role = inferRole(analysis);
    expect(role.summary.toLowerCase()).toMatch(/data fetching|validation/);
  });

  it("handles packages with no non-type exports", () => {
    const analysis = makeAnalysis({
      publicAPI: [
        { name: "Config", kind: "type", sourceFile: "src/types.ts", isTypeOnly: true },
        { name: "Options", kind: "interface", sourceFile: "src/types.ts", isTypeOnly: true },
      ],
    });

    const role = inferRole(analysis);
    expect(role.summary).toBeTruthy();
    expect(role.whenToUse).toContain("Touch this package when");
  });
});
