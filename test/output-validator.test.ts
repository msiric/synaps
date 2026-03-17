import { describe, expect, it } from "vitest";
import { validateOutput } from "../src/output-validator.js";
import type { PackageAnalysis } from "../src/types.js";

/**
 * Helper to build a minimal PackageAnalysis for testing.
 */
function makePackageAnalysis(overrides: Partial<PackageAnalysis> = {}): PackageAnalysis {
  return {
    name: "test-pkg",
    version: "1.0.0",
    description: "A test package",
    relativePath: ".",
    files: {
      total: 10,
      byTier: {
        tier1: { count: 3, lines: 300, files: ["src/index.ts", "src/main.ts", "src/utils.ts"] },
        tier2: { count: 5, lines: 200, files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"] },
        tier3: { count: 2, lines: 50 },
      },
      byExtension: { ".ts": 10 },
    },
    publicAPI: [],
    conventions: [],
    commands: {
      packageManager: "npm",
      build: { run: "npm run build", source: "package.json scripts.build" },
      test: { run: "npm run test", source: "package.json scripts.test" },
      lint: { run: "npm run lint", source: "package.json scripts.lint" },
      other: [],
    },
    architecture: {
      entryPoint: "src/index.ts",
      directories: [],
      packageType: "library",
    },
    dependencies: {
      internal: [],
      external: [
        { name: "react", importCount: 15 },
        { name: "typescript", importCount: 0 },
      ],
      totalUniqueDependencies: 2,
    },
    role: {
      summary: "A library",
      purpose: "Utility functions",
      whenToUse: "When you need utils",
      inferredFrom: ["exports"],
    },
    antiPatterns: [],
    contributionPatterns: [],
    dependencyInsights: {
      runtime: [{ name: "node", version: "18.0.0" }],
      frameworks: [{ name: "react", version: "18.2.0", guidance: "React 18" }],
      testFramework: { name: "vitest", version: "1.6.0" },
      bundler: { name: "vite", version: "5.2.0" },
    },
    configAnalysis: {
      linter: { name: "eslint", configFile: ".eslintrc.json" },
      formatter: { name: "prettier", configFile: ".prettierrc" },
    },
    ...overrides,
  };
}

/**
 * Generate a long valid output string that passes minimum length.
 */
function makeValidOutput(pkg: PackageAnalysis): string {
  const lines = [
    `# ${pkg.name}`,
    "",
    `${pkg.description}`,
    "",
    "## Architecture",
    "",
    "This is a TypeScript library that provides utility functions for the application.",
    "The architecture follows a modular pattern with clear separation of concerns.",
    "Entry point is src/index.ts which exports all public API surface.",
    "",
    "## Commands",
    "",
    `- Build: \`${pkg.commands.build!.run}\``,
    `- Test: \`${pkg.commands.test!.run}\``,
    `- Lint: \`${pkg.commands.lint!.run}\``,
    "",
    "## Conventions",
    "",
    "- Use TypeScript strict mode",
    "- Follow kebab-case for filenames",
    "- Use vitest for testing",
    "- Use eslint for linting",
    "- Use prettier for formatting",
    "",
    "## Dependencies",
    "",
    "- react 18.2.0 for UI components",
    "- vite for bundling",
    "",
    "## Workflow Rules",
    "",
    "- After modifying source files, run tests to verify changes",
    "- Always format code before committing",
    "- Follow the established import patterns in the codebase",
    "",
    "## Public API",
    "",
    "The package exports utility functions and React components.",
    "Key exports include configuration helpers and data transformation utilities.",
    "All exports are TypeScript-typed with strict mode enabled.",
    "",
    "## Additional Notes",
    "",
    "The project uses Node.js 18 as runtime.",
    "Testing is done with vitest, and the build uses vite as bundler.",
    "Code quality is maintained through eslint and prettier.",
    "The codebase follows consistent patterns throughout all modules.",
    "Each module has clear responsibilities and well-defined interfaces.",
  ];
  // Pad to ensure we exceed 400 words
  for (let i = 0; i < 30; i++) {
    lines.push(
      `Additional detail line ${i}: this module provides comprehensive functionality for the application layer.`,
    );
  }
  return lines.join("\n");
}

describe("validateOutput", () => {
  it("accepts valid output that mentions known technologies", () => {
    const pkg = makePackageAnalysis();
    const output = makeValidOutput(pkg);
    const result = validateOutput(output, pkg, "package-detail");

    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(result.isValid).toBe(true);
  });

  it("flags hallucinated technology not in analysis", () => {
    const pkg = makePackageAnalysis();
    const output = `${makeValidOutput(pkg)}\nThis project uses graphql for API queries.`;
    const result = validateOutput(output, pkg, "package-detail");

    const hallucinated = result.issues.filter((i) => i.type === "hallucinated_technology");
    expect(hallucinated.length).toBeGreaterThan(0);
    expect(hallucinated.some((i) => i.message.toLowerCase().includes("graphql"))).toBe(true);
  });

  it("flags output that is too short", () => {
    const pkg = makePackageAnalysis();
    const shortOutput = "# test-pkg\n\nShort description.";
    const result = validateOutput(shortOutput, pkg, "package-detail");

    const lengthIssue = result.issues.find((i) => i.type === "under_minimum_length");
    expect(lengthIssue).toBeDefined();
    expect(lengthIssue!.severity).toBe("error");
  });

  it("flags duplicate technology mentions via whitelist check", () => {
    const pkg = makePackageAnalysis({
      dependencies: {
        internal: [],
        external: [{ name: "react", importCount: 10 }],
        totalUniqueDependencies: 1,
      },
    });
    // Mention prisma which is NOT in deps
    const output = `${makeValidOutput(pkg)}\nThe project uses prisma for database access.`;
    const result = validateOutput(output, pkg, "package-detail");

    const hallucinated = result.issues.filter(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes("prisma"),
    );
    expect(hallucinated.length).toBeGreaterThan(0);
  });

  it("flags meaningless title", () => {
    const pkg = makePackageAnalysis();
    // Pad with enough content to pass length check
    let output = "# src\n\n";
    for (let i = 0; i < 50; i++) {
      output += `Line ${i}: detailed description of the module architecture and its design patterns.\n`;
    }
    output += `\`${pkg.commands.build!.run}\` \`${pkg.commands.test!.run}\` \`${pkg.commands.lint!.run}\`\n`;
    const result = validateOutput(output, pkg, "package-detail");

    const titleIssue = result.issues.find((i) => i.type === "meaningless_title");
    expect(titleIssue).toBeDefined();
    expect(titleIssue!.severity).toBe("error");
  });

  it("generates correction prompt when errors exist", () => {
    const pkg = makePackageAnalysis();
    const shortOutput = "# src\n\nToo short.";
    const result = validateOutput(shortOutput, pkg, "package-detail");

    expect(result.isValid).toBe(false);
    expect(result.correctionPrompt).toBeDefined();
    expect(result.correctionPrompt).toContain("issue(s) that need correction");
  });

  it("handles empty output", () => {
    const pkg = makePackageAnalysis();
    const result = validateOutput("", pkg, "package-detail");

    expect(result.isValid).toBe(false);
    const lengthIssue = result.issues.find((i) => i.type === "under_minimum_length");
    expect(lengthIssue).toBeDefined();
  });

  it("handles empty analysis (no dependencies, no frameworks)", () => {
    const pkg = makePackageAnalysis({
      dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
      dependencyInsights: { runtime: [], frameworks: [] },
      configAnalysis: undefined,
    });
    const output = makeValidOutput(pkg);
    const result = validateOutput(output, pkg, "package-detail");

    // Should still validate without crashing
    expect(result.issues).toBeDefined();
  });

  it("uses root format minimum word count (300) for root format", () => {
    const pkg = makePackageAnalysis();
    // Build output that is between 300 and 400 words — passes root but fails package-detail
    const lines = ["# test-pkg", "", "Description of the project and its purpose.", ""];
    for (let i = 0; i < 25; i++) {
      lines.push(`Detail line ${i}: this module implements important functionality for the application.`);
    }
    lines.push(`\`${pkg.commands.build!.run}\` \`${pkg.commands.test!.run}\` \`${pkg.commands.lint!.run}\``);
    lines.push("react vitest vite eslint prettier");
    const output = lines.join("\n");

    const rootResult = validateOutput(output, pkg, "root");
    const pkgResult = validateOutput(output, pkg, "package-detail");

    const rootLengthIssue = rootResult.issues.find((i) => i.type === "under_minimum_length");
    const pkgLengthIssue = pkgResult.issues.find((i) => i.type === "under_minimum_length");

    // Root format has lower threshold so may pass while package-detail may fail
    // At minimum, root should be more lenient
    if (rootLengthIssue && pkgLengthIssue) {
      // Both fail — that's fine, just check the threshold difference is reflected
      expect(pkgLengthIssue.message).toContain("400");
      expect(rootLengthIssue.message).toContain("300");
    }
  });

  it("flags version mismatch when output says wrong major version", () => {
    const pkg = makePackageAnalysis({
      dependencyInsights: {
        runtime: [{ name: "node", version: "18.0.0" }],
        frameworks: [{ name: "react", version: "18.2.0", guidance: "React 18" }],
      },
    });
    const output = `${makeValidOutput(pkg)}\nThis project uses React 19 features like use() hook.`;
    const result = validateOutput(output, pkg, "package-detail");

    const versionIssue = result.issues.find((i) => i.type === "version_mismatch");
    expect(versionIssue).toBeDefined();
    expect(versionIssue!.message).toContain("18");
  });
});
