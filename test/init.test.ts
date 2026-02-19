import { describe, it, expect, afterAll } from "vitest";
import { detectProjectStructure } from "../src/bin/init.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_BASE = join(import.meta.dirname, "fixtures", "init-test");

function setupFixture(name: string, files: Record<string, string>): string {
  const dir = join(FIXTURES_BASE, name);
  rmSync(dir, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

function cleanupFixtures(): void {
  rmSync(FIXTURES_BASE, { recursive: true, force: true });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("detectProjectStructure", () => {
  afterAll(() => cleanupFixtures());

  it("detects single package (no workspaces)", () => {
    const dir = setupFixture("single-pkg", {
      "package.json": JSON.stringify({ name: "my-app", version: "1.0.0" }),
      "src/index.ts": "export const hello = 'world';",
    });

    const result = detectProjectStructure(dir);
    expect(result.isMonorepo).toBe(false);
    expect(result.packages).toEqual([dir]);
    expect(result.root).toBe(dir);
  });

  it("detects npm/yarn workspaces from package.json", () => {
    const dir = setupFixture("npm-workspaces", {
      "package.json": JSON.stringify({
        name: "my-monorepo",
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({ name: "@mono/app" }),
      "packages/lib/package.json": JSON.stringify({ name: "@mono/lib" }),
      "packages/app/src/index.ts": "",
      "packages/lib/src/index.ts": "",
    });

    const result = detectProjectStructure(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.workspaceSource).toBe("npm/yarn workspaces");
    expect(result.packages.length).toBe(2);
    expect(result.packages.some((p) => p.endsWith("packages/app"))).toBe(true);
    expect(result.packages.some((p) => p.endsWith("packages/lib"))).toBe(true);
  });

  it("detects pnpm workspaces from pnpm-workspace.yaml", () => {
    const dir = setupFixture("pnpm-workspaces", {
      "package.json": JSON.stringify({ name: "pnpm-monorepo" }),
      "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - 'libs/*'\n",
      "apps/web/package.json": JSON.stringify({ name: "@mono/web" }),
      "apps/api/package.json": JSON.stringify({ name: "@mono/api" }),
      "libs/shared/package.json": JSON.stringify({ name: "@mono/shared" }),
      "apps/web/src/index.ts": "",
      "apps/api/src/index.ts": "",
      "libs/shared/src/index.ts": "",
    });

    const result = detectProjectStructure(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.workspaceSource).toBe("pnpm workspaces");
    expect(result.packages.length).toBe(3);
  });

  it("throws when no package.json exists", () => {
    const dir = setupFixture("no-pkg", {
      "src/index.ts": "export const x = 1;",
    });

    expect(() => detectProjectStructure(dir)).toThrow("No package.json found");
  });

  it("falls back to single package when workspace globs match nothing", () => {
    const dir = setupFixture("empty-workspaces", {
      "package.json": JSON.stringify({
        name: "empty-mono",
        workspaces: ["packages/*"],
      }),
      // No packages/ directory at all
    });

    const result = detectProjectStructure(dir);
    expect(result.isMonorepo).toBe(false);
    expect(result.packages).toEqual([dir]);
  });

  it("detects package manager from lockfile", () => {
    const dir = setupFixture("pnpm-lock", {
      "package.json": JSON.stringify({ name: "my-app" }),
      "pnpm-lock.yaml": "",
    });

    const result = detectProjectStructure(dir);
    expect(result.packageManager).toBe("pnpm");
  });

  it("handles yarn workspaces object format", () => {
    const dir = setupFixture("yarn-workspaces-obj", {
      "package.json": JSON.stringify({
        name: "yarn-mono",
        workspaces: { packages: ["packages/*"] },
      }),
      "packages/core/package.json": JSON.stringify({ name: "@yarn/core" }),
      "packages/core/src/index.ts": "",
    });

    const result = detectProjectStructure(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.workspaceSource).toBe("yarn workspaces");
    expect(result.packages.length).toBe(1);
  });

  it("handles multiple workspace glob patterns", () => {
    const dir = setupFixture("multi-globs", {
      "package.json": JSON.stringify({
        name: "multi-mono",
        workspaces: ["apps/*", "packages/*", "tools/*"],
      }),
      "apps/web/package.json": JSON.stringify({ name: "@m/web" }),
      "packages/ui/package.json": JSON.stringify({ name: "@m/ui" }),
      // tools/ doesn't exist — should be skipped gracefully
      "apps/web/src/index.ts": "",
      "packages/ui/src/index.ts": "",
    });

    const result = detectProjectStructure(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.packages.length).toBe(2);
  });
});
