// test/minimal-formatter.test.ts — Tests for generateMinimalAgentsMd
import { describe, it, expect } from "vitest";
import { generateMinimalAgentsMd } from "../src/deterministic-formatter.js";
import type { StructuredAnalysis, PackageAnalysis } from "../src/types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makePkg(overrides: Partial<PackageAnalysis> = {}): PackageAnalysis {
  return {
    name: "test-project",
    version: "1.0.0",
    description: "A test project",
    relativePath: ".",
    files: { total: 10, byTier: { tier1: 5, tier2: 3, tier3: 2 } } as any,
    publicAPI: [],
    conventions: [],
    commands: {
      packageManager: "pnpm",
      build: { run: "pnpm build", source: "package.json" },
      test: { run: "pnpm vitest run", source: "package.json" },
      lint: { run: "pnpm eslint . --fix", source: "package.json" },
      other: [],
    },
    architecture: {
      entryPoint: "src/index.ts",
      directories: [
        { path: "src", purpose: "Source code", fileCount: 10, exports: [] },
        { path: "test", purpose: "Tests", fileCount: 5, exports: [] },
      ],
      packageType: "library",
      hasJSX: false,
    },
    dependencies: { internal: [], external: [], devExternal: [] } as any,
    role: "library",
    antiPatterns: [],
    contributionPatterns: [],
    ...overrides,
  };
}

function makeAnalysis(overrides: {
  pkg?: Partial<PackageAnalysis>;
  packages?: PackageAnalysis[];
  crossPackage?: any;
} = {}): StructuredAnalysis {
  return {
    meta: { rootDir: "/test", engineVersion: "0.5.0", timestamp: new Date().toISOString() } as any,
    packages: overrides.packages ?? [makePkg(overrides.pkg)],
    crossPackage: overrides.crossPackage,
    warnings: [],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("generateMinimalAgentsMd", () => {
  describe("title and description", () => {
    it("includes package name as title", () => {
      const result = generateMinimalAgentsMd(makeAnalysis());
      expect(result).toContain("# test-project");
    });

    it("includes description when available", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: { description: "My awesome library" },
      }));
      expect(result).toContain("My awesome library");
    });

    it("returns empty string for no packages", () => {
      const result = generateMinimalAgentsMd({
        ...makeAnalysis(),
        packages: [],
      });
      expect(result).toBe("");
    });
  });

  describe("commands", () => {
    it("includes core commands", () => {
      const result = generateMinimalAgentsMd(makeAnalysis());
      expect(result).toContain("## Commands");
      expect(result).toContain("pnpm build");
      expect(result).toContain("pnpm vitest run");
      expect(result).toContain("pnpm eslint . --fix");
    });

    it("caps commands at 6", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          commands: {
            packageManager: "npm",
            build: { run: "npm run build", source: "build" },
            test: { run: "npm test", source: "test" },
            lint: { run: "npm run lint", source: "lint" },
            start: { run: "npm start", source: "start" },
            other: [
              { run: "npm run typecheck", source: "typecheck" },
              { run: "npm run storybook", source: "storybook" },
              { run: "npm run db:generate", source: "db:generate" },
              { run: "npm run deploy", source: "deploy" },
            ],
          },
        },
      }));
      // Count command list items (lines starting with "- **")
      const cmdLines = result.split("\n").filter(l => l.startsWith("- **"));
      expect(cmdLines.length).toBeLessThanOrEqual(6);
    });

    it("shows trivial-commands note when all commands are trivial", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          commands: {
            packageManager: "npm",
            build: { run: "npm run build", source: "build" },
            test: { run: "npm test", source: "test" },
            lint: { run: "npm run lint", source: "lint" },
            other: [],
          },
        },
      }));
      expect(result).toContain("Standard `npm` scripts");
      expect(result).toContain("package.json");
    });

    it("includes non-trivial commands even when some are trivial", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          commands: {
            packageManager: "pnpm",
            build: { run: "pnpm build", source: "build" },
            test: { run: "pnpm vitest run --reporter=verbose", source: "test" },
            other: [],
          },
        },
      }));
      expect(result).toContain("pnpm vitest run --reporter=verbose");
    });
  });

  describe("workflow rules", () => {
    it("includes workflow rules from cross-package data", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        crossPackage: {
          workflowRules: [
            { trigger: "After modifying schema.prisma", action: "Run `pnpm db:generate`", source: "co-change", impact: "high" as const },
          ],
        },
      }));
      expect(result).toContain("## Workflow Rules");
      expect(result).toContain("schema.prisma");
      expect(result).toContain("db:generate");
    });

    it("synthesizes registration rules from contribution patterns", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          contributionPatterns: [{
            type: "function",
            directory: "src/detectors",
            filePattern: "{name}.ts",
            exampleFile: "src/detectors/file-naming.ts",
            steps: [],
            registrationFile: "src/index.ts",
          }],
        },
      }));
      expect(result).toContain("## Workflow Rules");
      expect(result).toContain("src/detectors/");
      expect(result).toContain("src/index.ts");
    });

    it("skips workflow rules when no data exists", () => {
      const result = generateMinimalAgentsMd(makeAnalysis());
      expect(result).not.toContain("## Workflow Rules");
    });

    it("caps at 5 rules", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        crossPackage: {
          workflowRules: Array.from({ length: 10 }, (_, i) => ({
            trigger: `Trigger ${i}`, action: `Action ${i}`, source: "co-change", impact: "high" as const,
          })),
        },
      }));
      const ruleLines = result.split("\n").filter(l => l.startsWith("- ") && l.includes("→"));
      expect(ruleLines.length).toBeLessThanOrEqual(5);
    });
  });

  describe("conventions", () => {
    it("includes conventions when signal gate passes", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          contributionPatterns: [{
            type: "function",
            directory: "src/detectors",
            filePattern: "{name}.ts",
            exampleFile: "src/detectors/file-naming.ts",
            steps: [],
            registrationFile: "src/index.ts",
          }],
          conventions: [{
            category: "file-naming" as any,
            name: "kebab-case filenames",
            description: "Use kebab-case for file names",
            confidence: { matched: 48, total: 50, percentage: 96, description: "48/50" },
            examples: ["my-module.ts"],
          }],
        },
      }));
      expect(result).toContain("## Conventions");
      expect(result).toContain("kebab-case");
    });

    it("skips conventions when signal gate fails (no registration)", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          contributionPatterns: [],
          conventions: [{
            category: "file-naming" as any,
            name: "kebab-case filenames",
            description: "Use kebab-case for file names",
            confidence: { matched: 48, total: 50, percentage: 96, description: "48/50" },
            examples: ["my-module.ts"],
          }],
        },
      }));
      expect(result).not.toContain("## Conventions");
    });

    it("skips conventions below 95% confidence", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          contributionPatterns: [{
            type: "function",
            directory: "src/detectors",
            filePattern: "{name}.ts",
            exampleFile: "src/detectors/file-naming.ts",
            steps: [],
            registrationFile: "src/index.ts",
          }],
          conventions: [{
            category: "file-naming" as any,
            name: "kebab-case filenames",
            description: "Use kebab-case for file names",
            confidence: { matched: 90, total: 100, percentage: 90, description: "90/100" },
            examples: ["my-module.ts"],
          }],
        },
      }));
      expect(result).not.toContain("## Conventions");
    });

    it("includes anti-patterns as DON'T rules", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          contributionPatterns: [{
            type: "function", directory: "src/d", filePattern: "{n}.ts",
            exampleFile: "src/d/x.ts", steps: [], registrationFile: "src/index.ts",
          }],
          antiPatterns: [{ rule: "Don't use console.log", reason: "Use logger instead" } as any],
        },
      }));
      expect(result).toContain("DON'T");
      expect(result).toContain("console.log");
    });
  });

  describe("architecture", () => {
    it("lists non-obvious directories", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          architecture: {
            entryPoint: "src/index.ts",
            directories: [
              { path: "src", purpose: "Source", fileCount: 10, exports: [] },
              { path: "scripts", purpose: "Build automation", fileCount: 3, exports: [] },
              { path: "internal", purpose: "Shared internals", fileCount: 5, exports: [] },
            ],
            packageType: "library",
            hasJSX: false,
          },
        },
      }));
      expect(result).toContain("## Key Directories");
      expect(result).toContain("scripts/");
      expect(result).toContain("internal/");
      expect(result).not.toContain("`src/`"); // src is obvious
      expect(result).toContain("non-exhaustive");
    });

    it("skips architecture when all directories are obvious", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          architecture: {
            entryPoint: "src/index.ts",
            directories: [
              { path: "src", purpose: "Source", fileCount: 10, exports: [] },
              { path: "lib", purpose: "Library", fileCount: 5, exports: [] },
              { path: "test", purpose: "Tests", fileCount: 5, exports: [] },
            ],
            packageType: "library",
            hasJSX: false,
          },
        },
      }));
      expect(result).not.toContain("## Key Directories");
    });
  });

  describe("package guide", () => {
    it("includes package guide for monorepos with 3+ packages", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        packages: [
          makePkg({ name: "core", relativePath: "packages/core", description: "Shared types" }),
          makePkg({ name: "cli", relativePath: "packages/cli", description: "CLI tool" }),
          makePkg({ name: "server", relativePath: "packages/server", description: "API server" }),
        ],
      }));
      expect(result).toContain("## Packages");
      expect(result).toContain("packages/core");
      expect(result).toContain("packages/cli");
    });

    it("skips package guide for single-package repos", () => {
      const result = generateMinimalAgentsMd(makeAnalysis());
      expect(result).not.toContain("## Packages");
    });

    it("caps at 5 packages and summarizes rest", () => {
      const pkgs = Array.from({ length: 8 }, (_, i) =>
        makePkg({ name: `pkg-${i}`, relativePath: `packages/pkg-${i}`, description: `Package ${i}` }),
      );
      const result = generateMinimalAgentsMd(makeAnalysis({ packages: pkgs }));
      expect(result).toContain("3 other packages");
    });
  });

  describe("example pointer", () => {
    it("includes example when registration pattern exists", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          contributionPatterns: [{
            type: "function",
            directory: "src/detectors",
            filePattern: "{name}.ts",
            exampleFile: "src/detectors/file-naming.ts",
            steps: [],
            registrationFile: "src/index.ts",
          }],
        },
      }));
      expect(result).toContain("src/detectors/file-naming.ts");
      expect(result).toContain("src/index.ts");
    });

    it("skips example when no registration patterns", () => {
      const result = generateMinimalAgentsMd(makeAnalysis());
      expect(result).not.toContain("Example");
    });
  });

  describe("kill switch / standard project note", () => {
    it("adds standard note when only title + trivial commands", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          commands: {
            packageManager: "npm",
            build: { run: "npm run build", source: "build" },
            test: { run: "npm test", source: "test" },
            other: [],
          },
        },
      }));
      expect(result).toContain("Standard project structure");
      expect(result).toContain("inferrable from source code");
    });
  });

  describe("token budget", () => {
    it("produces output under 500 tokens for a typical repo", () => {
      const result = generateMinimalAgentsMd(makeAnalysis({
        pkg: {
          contributionPatterns: [{
            type: "function", directory: "src/detectors", filePattern: "{name}.ts",
            exampleFile: "src/detectors/file-naming.ts", steps: [],
            registrationFile: "src/index.ts",
            commonImports: [{ specifier: "../types.js", symbols: ["Convention"], coverage: 0.9 }],
          }],
          conventions: [{
            category: "file-naming" as any,
            name: "kebab-case",
            description: "Use kebab-case for all file names",
            confidence: { matched: 49, total: 50, percentage: 98, description: "49/50" },
            examples: ["my-module.ts"],
          }],
          architecture: {
            entryPoint: "src/index.ts",
            directories: [
              { path: "src", purpose: "Source", fileCount: 10, exports: [] },
              { path: "scripts", purpose: "Build automation", fileCount: 3, exports: [] },
            ],
            packageType: "library",
            hasJSX: false,
          },
        },
        crossPackage: {
          workflowRules: [
            { trigger: "After modifying types.ts", action: "Run tests", source: "co-change", impact: "high" as const },
          ],
        },
      }));

      const estimatedTokens = Math.round(result.length / 3.5);
      expect(estimatedTokens).toBeLessThan(500);
    });
  });
});
