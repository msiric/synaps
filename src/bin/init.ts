// src/bin/init.ts — Zero-config init command
// Auto-detects project structure and generates AGENTS.md on first try.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { analyze, formatDeterministic, formatHierarchicalDeterministic, generateMinimalAgentsMd } from "../index.js";
import { discoverWorkspacePackages, parsePnpmWorkspaceYaml } from "../workspace-resolver.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectStructure {
  isMonorepo: boolean;
  workspaceSource?: string;
  root: string;
  packages: string[];
  packageManager: string;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runInit(options: { full?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();

  // Step 1: Detect project structure
  const project = detectProjectStructure(cwd);

  stderr("");
  stderr(`  Detected: ${project.isMonorepo ? `monorepo (${project.workspaceSource})` : "single package"}`);
  if (project.isMonorepo) {
    const relPkgs = project.packages.map((p) => relative(cwd, p));
    stderr(`  Packages: ${relPkgs.join(", ")} (${project.packages.length} found)`);
  }
  stderr(`  Package manager: ${project.packageManager}`);
  stderr("");

  // Step 2: Analyze
  stderr(`  Analyzing ${project.packages.length} package(s)...`);
  const analysisStart = performance.now();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const analysis = await analyze({
    packages: project.packages,
    rootDir: project.root,
    output: { format: "agents.md", dir: "." },
    llm: apiKey
      ? {
          provider: "anthropic",
          model: process.env.AUTODOCS_LLM_MODEL ?? "claude-sonnet-4-20250514",
          maxOutputTokens: 4096,
          apiKey,
        }
      : undefined,
  });

  const analysisMs = Math.round(performance.now() - analysisStart);
  stderr(`  Analysis complete (${(analysisMs / 1000).toFixed(1)}s)`);

  // Step 3: Generate output
  // Default: minimal AGENTS.md (no API key needed, research-backed)
  // --full: comprehensive AGENTS.md (requires API key for 2 LLM sections)
  if (!options.full) {
    const content = generateMinimalAgentsMd(analysis);
    const outPath = resolve(cwd, "AGENTS.md");
    writeFileSafe(outPath, content);
    const tokens = Math.round(content.length / 3.5);
    stderr(`\n  Written: ./AGENTS.md (${content.split("\n").length} lines, ~${tokens} tokens)`);
    if (apiKey) {
      stderr(`  Tip: Use --full for comprehensive output with LLM-enhanced sections.`);
    }
    return;
  }

  // --full mode: requires API key
  if (!apiKey) {
    stderr(`\n  Error: --full mode requires ANTHROPIC_API_KEY to be set.`);
    stderr(`  Run without --full for minimal output (no API key needed).`);
    process.exit(1);
  }

  const llmConfig = {
    output: { format: "agents.md" as const, dir: "." },
    llm: {
      provider: "anthropic" as const,
      model: process.env.AUTODOCS_LLM_MODEL ?? "claude-sonnet-4-20250514",
      maxOutputTokens: 4096,
      apiKey,
    },
  };

  if (project.isMonorepo && project.packages.length > 1) {
    stderr(`  Generating AGENTS.md (hierarchical, full)...`);
    const genStart = performance.now();
    const result = await formatHierarchicalDeterministic(analysis, llmConfig);
    stderr(`  Generation complete (${((performance.now() - genStart) / 1000).toFixed(1)}s)`);

    const rootPath = resolve(cwd, "AGENTS.md");
    writeFileSafe(rootPath, result.root);
    stderr(`\n  Written:`);
    stderr(`    ./AGENTS.md (root, ${result.root.split("\n").length} lines)`);

    const pkgsDir = resolve(cwd, "packages");
    for (const pkg of result.packages) {
      const pkgPath = join(pkgsDir, pkg.filename);
      writeFileSafe(pkgPath, pkg.content);
      stderr(`    ./packages/${pkg.filename} (${pkg.content.split("\n").length} lines)`);
    }
  } else {
    stderr(`  Generating AGENTS.md (full)...`);
    const genStart = performance.now();
    const content = await formatDeterministic(analysis, llmConfig, project.root);
    stderr(`  Generation complete (${((performance.now() - genStart) / 1000).toFixed(1)}s)`);

    const outPath = resolve(cwd, "AGENTS.md");
    writeFileSafe(outPath, content);
    stderr(`\n  Written: ./AGENTS.md (${content.split("\n").length} lines)`);
  }
}

// ─── Project Detection ───────────────────────────────────────────────────────

/** Exported for testing. */
export function detectProjectStructure(cwd: string): ProjectStructure {
  const absCwd = resolve(cwd);

  // Must have package.json
  const pkgJsonPath = join(absCwd, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(
      "No package.json found in current directory.\n" +
        "Run this command from your project root (where package.json is).",
    );
  }

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    throw new Error("Failed to parse package.json.");
  }

  // Detect package manager from lockfiles
  const packageManager = detectPM(absCwd);

  // Check for monorepo signals
  // Signal 1: package.json workspaces field
  if (Array.isArray(pkgJson.workspaces)) {
    const packages = discoverWorkspacePackages(absCwd, pkgJson.workspaces as string[]);
    if (packages.length > 0) {
      return { isMonorepo: true, workspaceSource: "npm/yarn workspaces", root: absCwd, packages, packageManager };
    }
  }

  // Signal 1b: yarn workspaces as object { packages: [...] }
  if (pkgJson.workspaces && typeof pkgJson.workspaces === "object" && !Array.isArray(pkgJson.workspaces)) {
    const ws = pkgJson.workspaces as Record<string, unknown>;
    if (Array.isArray(ws.packages)) {
      const packages = discoverWorkspacePackages(absCwd, ws.packages as string[]);
      if (packages.length > 0) {
        return { isMonorepo: true, workspaceSource: "yarn workspaces", root: absCwd, packages, packageManager };
      }
    }
  }

  // Signal 2: pnpm-workspace.yaml
  const pnpmWsPath = join(absCwd, "pnpm-workspace.yaml");
  if (existsSync(pnpmWsPath)) {
    const globs = parsePnpmWorkspaceYaml(pnpmWsPath);
    if (globs.length > 0) {
      const packages = discoverWorkspacePackages(absCwd, globs);
      if (packages.length > 0) {
        return { isMonorepo: true, workspaceSource: "pnpm workspaces", root: absCwd, packages, packageManager };
      }
    }
  }

  // Single package
  return { isMonorepo: false, root: absCwd, packages: [absCwd], packageManager };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Detect package manager from lockfiles. */
function detectPM(dir: string): string {
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  return "npm";
}

function stderr(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function writeFileSafe(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}
