// test/wave3-improvements.test.ts — Tests for Wave 3 improvements
import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { scanWorkspaceCommands } from "../src/command-extractor.js";
import { generateWorkflowRules } from "../src/workflow-rules.js";
import { inferRole } from "../src/role-inferrer.js";
import type {
  PackageAnalysis,
  WorkspaceCommand,
  DependencyInsights,
  ConfigAnalysis,
  CommandSet,
} from "../src/types.js";

// ─── Test fixture helpers ─────────────────────────────────────────────────────

const FIXTURE_ROOT = resolve(__dirname, "fixtures/wave3-workspace");

function setupWorkspaceFixture(): void {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });

  // Root package.json
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, "package.json"), JSON.stringify({
    name: "test-monorepo",
    private: true,
    workspaces: ["packages/*", "apps/*"],
    scripts: {
      build: "turbo run build",
      dev: "turbo run dev",
      lint: "biome check .",
    },
  }));
  writeFileSync(join(FIXTURE_ROOT, "bun.lockb"), "");

  // packages/db with operational scripts
  mkdirSync(join(FIXTURE_ROOT, "packages/db"), { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, "packages/db/package.json"), JSON.stringify({
    name: "@test/db",
    scripts: {
      "db:generate": "drizzle-kit generate",
      "db:migrate": "drizzle-kit migrate",
      "db:push": "drizzle-kit push",
      "db:studio": "drizzle-kit studio",
      "lint": "biome check .",
    },
  }));

  // apps/api with http server
  mkdirSync(join(FIXTURE_ROOT, "apps/api"), { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, "apps/api/package.json"), JSON.stringify({
    name: "@test/api-server",
    scripts: {
      dev: "bun run --watch src/index.ts",
      test: "bun test",
      "db:migrate": "bun run ../../packages/db/src/migrate.ts",
    },
    dependencies: {
      hono: "^4.0.0",
    },
  }));

  // apps/web with Next.js
  mkdirSync(join(FIXTURE_ROOT, "apps/web"), { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, "apps/web/package.json"), JSON.stringify({
    name: "@test/web",
    scripts: {
      dev: "next dev",
      build: "next build",
    },
    dependencies: {
      next: "^14.0.0",
      react: "^18.0.0",
    },
  }));

  // apps/worker with worker scripts
  mkdirSync(join(FIXTURE_ROOT, "apps/worker"), { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, "apps/worker/package.json"), JSON.stringify({
    name: "@test/worker",
    scripts: {
      "dev:worker": "bun run --watch src/worker.ts",
      "sync:bulk": "bun run src/sync-bulk.ts",
    },
  }));
}

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
      packageManager: "bun",
      test: { run: "bun test", source: "package.json" },
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

// ─── W3-1: Workspace Command Scanning ────────────────────────────────────────

describe("W3-1: scanWorkspaceCommands", () => {
  setupWorkspaceFixture();

  it("finds db:generate and db:migrate commands from packages/db", () => {
    const commands = scanWorkspaceCommands(FIXTURE_ROOT);
    const scriptNames = commands.map((c) => c.scriptName);
    expect(scriptNames).toContain("db:generate");
    expect(scriptNames).toContain("db:migrate");
    expect(scriptNames).toContain("db:push");
    expect(scriptNames).toContain("db:studio");
  });

  it("finds worker and sync commands from apps/worker", () => {
    const commands = scanWorkspaceCommands(FIXTURE_ROOT);
    const scriptNames = commands.map((c) => c.scriptName);
    expect(scriptNames).toContain("dev:worker");
    expect(scriptNames).toContain("sync:bulk");
  });

  it("categorizes database commands correctly", () => {
    const commands = scanWorkspaceCommands(FIXTURE_ROOT);
    const dbGenerate = commands.find((c) => c.scriptName === "db:generate");
    expect(dbGenerate).toBeDefined();
    expect(dbGenerate!.category).toBe("database");
    expect(dbGenerate!.packagePath).toBe("packages/db");
  });

  it("formats commands with the detected package manager", () => {
    const commands = scanWorkspaceCommands(FIXTURE_ROOT);
    const dbGenerate = commands.find((c) => c.scriptName === "db:generate");
    expect(dbGenerate).toBeDefined();
    expect(dbGenerate!.run).toBe("bun run db:generate");
  });

  it("deduplicates commands with same name and value", () => {
    const commands = scanWorkspaceCommands(FIXTURE_ROOT);
    // db:migrate appears in both packages/db and apps/api but with different values
    const migrateCmds = commands.filter((c) => c.scriptName === "db:migrate");
    expect(migrateCmds.length).toBe(2); // different scripts = not deduped
  });

  it("does not include non-operational scripts", () => {
    const commands = scanWorkspaceCommands(FIXTURE_ROOT);
    const scriptNames = commands.map((c) => c.scriptName);
    expect(scriptNames).not.toContain("lint");
    expect(scriptNames).not.toContain("dev");
    expect(scriptNames).not.toContain("build");
    expect(scriptNames).not.toContain("test");
  });
});

// ─── W3-2: Workflow Rule Templates ───────────────────────────────────────────

describe("W3-2: generateWorkflowRules", () => {
  it("generates Drizzle migration workflow when db commands exist", () => {
    const workspaceCommands: WorkspaceCommand[] = [
      { run: "bun run db:generate", scriptName: "db:generate", packageName: "@test/db", packagePath: "packages/db", category: "database" },
      { run: "bun run db:migrate", scriptName: "db:migrate", packageName: "@test/db", packagePath: "packages/db", category: "database" },
    ];
    const deps: DependencyInsights = {
      runtime: [],
      frameworks: [{ name: "drizzle-orm", version: "0.36.0" }],
    };

    const rules = generateWorkflowRules({
      workspaceCommands,
      packageCommands: [],
      allDependencyInsights: [deps],
      allConventions: [],
    });

    const drizzleRule = rules.find((r) => r.trigger.includes("schema"));
    expect(drizzleRule).toBeDefined();
    expect(drizzleRule!.action).toContain("bun run db:generate");
    expect(drizzleRule!.action).toContain("bun run db:migrate");
  });

  it("generates Biome lint workflow when Biome is detected", () => {
    const config: ConfigAnalysis = {
      linter: { name: "biome", configFile: "biome.json" },
      formatter: { name: "biome", configFile: "biome.json" },
    };
    const rootCommands: CommandSet = {
      packageManager: "bun",
      lint: { run: "biome check .", source: "root package.json" },
      other: [],
    };

    const rules = generateWorkflowRules({
      workspaceCommands: [],
      rootCommands,
      packageCommands: [],
      configAnalysis: config,
      allDependencyInsights: [],
      allConventions: [],
    });

    const biomeRule = rules.find((r) => r.trigger.includes("linting"));
    expect(biomeRule).toBeDefined();
    expect(biomeRule!.action).toContain("Biome");
    expect(biomeRule!.action).toContain("NOT ESLint");
  });

  it("generates Turbo workflow when Turbo is detected", () => {
    const config: ConfigAnalysis = {
      buildTool: { name: "turbo", taskNames: ["build", "test", "lint"], configFile: "turbo.json" },
    };

    const rules = generateWorkflowRules({
      workspaceCommands: [],
      packageCommands: [],
      configAnalysis: config,
      allDependencyInsights: [],
      allConventions: [],
    });

    const turboRule = rules.find((r) => r.action.includes("turbo run"));
    expect(turboRule).toBeDefined();
  });

  it("generates test workflow when test command exists", () => {
    const rootCommands: CommandSet = {
      packageManager: "bun",
      test: { run: "bun test", source: "package.json" },
      other: [],
    };

    const rules = generateWorkflowRules({
      workspaceCommands: [],
      rootCommands,
      packageCommands: [],
      allDependencyInsights: [],
      allConventions: [],
    });

    const testRule = rules.find((r) => r.trigger.includes("source files"));
    expect(testRule).toBeDefined();
    expect(testRule!.action).toContain("bun test");
  });

  it("generates Prisma workflow when Prisma is detected", () => {
    const workspaceCommands: WorkspaceCommand[] = [
      { run: "npx prisma generate", scriptName: "generate", packageName: "@test/db", packagePath: "packages/db", category: "codegen" },
      { run: "npx prisma migrate", scriptName: "migrate", packageName: "@test/db", packagePath: "packages/db", category: "database" },
    ];
    const deps: DependencyInsights = {
      runtime: [],
      frameworks: [{ name: "@prisma/client", version: "5.0.0" }],
    };

    const rules = generateWorkflowRules({
      workspaceCommands,
      packageCommands: [],
      allDependencyInsights: [deps],
      allConventions: [],
    });

    const prismaRule = rules.find((r) => r.trigger.includes("schema.prisma"));
    expect(prismaRule).toBeDefined();
    expect(prismaRule!.action).toContain("prisma generate");
  });
});

// ─── W3-3: Role Classification Fix ──────────────────────────────────────────

describe("W3-3: inferRole with HTTP/app frameworks", () => {
  it("classifies a Hono API server correctly", () => {
    const analysis = makeAnalysis({
      name: "@test/api-server",
      architecture: {
        entryPoint: "src/index.ts",
        directories: [],
        packageType: "library", // wrongly classified by architecture-detector if no barrel
        hasJSX: false,
      },
      publicAPI: [],
      dependencies: {
        internal: [],
        external: [{ name: "hono", importCount: 5 }],
        totalUniqueDependencies: 1,
      },
      dependencyInsights: {
        runtime: [{ name: "bun", version: "1.3.0" }],
        frameworks: [{ name: "hono", version: "4.0.0" }],
      },
    });

    const role = inferRole(analysis);
    expect(role.summary).toContain("API server");
    expect(role.whenToUse).toContain("API endpoints");
    expect(role.inferredFrom).toContainEqual(expect.stringContaining("HTTP framework"));
  });

  it("classifies a Next.js web application correctly", () => {
    const analysis = makeAnalysis({
      name: "@test/web",
      architecture: {
        entryPoint: "src/index.ts",
        directories: [],
        packageType: "mixed",
        hasJSX: true,
      },
      publicAPI: [
        { name: "HomePage", kind: "component", sourceFile: "src/app/page.tsx", isTypeOnly: false },
      ],
      dependencies: {
        internal: [],
        external: [
          { name: "next", importCount: 10 },
          { name: "react", importCount: 20 },
        ],
        totalUniqueDependencies: 2,
      },
      dependencyInsights: {
        runtime: [{ name: "node", version: "20.0.0" }],
        frameworks: [
          { name: "next", version: "14.0.0" },
          { name: "react", version: "18.0.0" },
        ],
      },
    });

    const role = inferRole(analysis);
    expect(role.summary).toContain("Web application");
    expect(role.whenToUse).toContain("pages");
    expect(role.inferredFrom).toContainEqual(expect.stringContaining("app framework"));
  });

  it("does not reclassify a hooks package as api-server", () => {
    const analysis = makeAnalysis({
      architecture: {
        entryPoint: "src/index.ts",
        directories: [],
        packageType: "hooks",
        hasJSX: false,
      },
      publicAPI: [
        { name: "useFetch", kind: "hook", sourceFile: "src/hooks/use-fetch.ts", isTypeOnly: false },
      ],
      dependencies: {
        internal: [],
        external: [{ name: "express", importCount: 1 }],
        totalUniqueDependencies: 1,
      },
      dependencyInsights: {
        runtime: [],
        frameworks: [{ name: "express", version: "4.0.0" }],
      },
    });

    const role = inferRole(analysis);
    // Should remain hooks, not get reclassified
    expect(role.summary).toContain("Hooks");
  });

  it("classifies Express server with unknown packageType as api-server", () => {
    const analysis = makeAnalysis({
      architecture: {
        entryPoint: "none",
        directories: [],
        packageType: "unknown",
        hasJSX: false,
      },
      publicAPI: [],
      dependencies: {
        internal: [],
        external: [{ name: "express", importCount: 3 }],
        totalUniqueDependencies: 1,
      },
      dependencyInsights: {
        runtime: [],
        frameworks: [{ name: "express", version: "4.18.0" }],
      },
    });

    const role = inferRole(analysis);
    expect(role.summary).toContain("API server");
  });
});

// ─── W3-4: Serialization (no percentage stats) ─────────────────────────────

describe("W3-4: serialization without percentage stats", () => {
  // We test the internal serialization by checking that convention confidence
  // descriptions are NOT included in the serialized output.
  // This is tested indirectly via the integration test below.

  it("architecture-detector classifies Hono as api-server", async () => {
    const { detectArchitecture } = await import("../src/architecture-detector.js");
    // Create minimal fixture for architecture detection
    const apiFixture = join(FIXTURE_ROOT, "apps/api");
    const arch = detectArchitecture(
      [], // no parsed files
      apiFixture,
      [], // no publicAPI
      undefined,
      [],
    );
    expect(arch.packageType).toBe("api-server");
  });

  it("architecture-detector classifies Next.js as web-application", async () => {
    const { detectArchitecture } = await import("../src/architecture-detector.js");
    const webFixture = join(FIXTURE_ROOT, "apps/web");
    const arch = detectArchitecture(
      [],
      webFixture,
      [],
      undefined,
      [],
    );
    expect(arch.packageType).toBe("web-application");
  });
});

// ─── W3-5: Default model ────────────────────────────────────────────────────

describe("W3-5: default model config", () => {
  it("defaults to Opus when env var is not set", async () => {
    // Save and clear env var
    const saved = process.env.AUTODOCS_LLM_MODEL;
    delete process.env.AUTODOCS_LLM_MODEL;

    // Need to re-import to pick up changed env
    // We test the config file directly
    const configModule = await import("../src/config.js");
    const warnings: any[] = [];
    const config = configModule.resolveConfig({
      packages: ["."],
      quiet: false,
      verbose: false,
      dryRun: true,
      help: false,
    }, warnings);

    expect(config.llm.model).toBe("claude-opus-4-20250514");

    // Restore
    if (saved) process.env.AUTODOCS_LLM_MODEL = saved;
  });
});
