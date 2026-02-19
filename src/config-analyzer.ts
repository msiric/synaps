// src/config-analyzer.ts — Improvement 1: Config File Analysis
// Parses turbo.json, biome.json, tsconfig.json, eslint config, prettier config,
// justfile, Makefile, nx.json, .env.example to extract actionable settings.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigAnalysis, Warning } from "./types.js";

/**
 * Analyze config files in a package directory (and optionally its monorepo root).
 */
export function analyzeConfig(
  packageDir: string,
  rootDir?: string,
  warnings: Warning[] = [],
): ConfigAnalysis {
  const result: ConfigAnalysis = {};

  // TypeScript config (package-level first, then root)
  result.typescript = parseTypeScriptConfig(packageDir, rootDir, warnings);

  // Build tool (root-level: turbo.json, nx.json)
  result.buildTool = detectBuildTool(packageDir, rootDir, warnings);

  // Linter
  result.linter = detectLinter(packageDir, rootDir, warnings);

  // Formatter
  result.formatter = detectFormatter(packageDir, rootDir, warnings);

  // Task runner (justfile, Makefile)
  result.taskRunner = detectTaskRunner(packageDir, rootDir, warnings);

  // Environment variables
  result.envVars = detectEnvVars(packageDir, rootDir);

  return result;
}

// ─── TypeScript Config ──────────────────────────────────────────────────────

function parseTypeScriptConfig(
  packageDir: string,
  rootDir?: string,
  warnings: Warning[] = [],
): ConfigAnalysis["typescript"] | undefined {
  // Try package-level first, then root
  const candidates = [
    join(packageDir, "tsconfig.json"),
    ...(rootDir ? [join(rootDir, "tsconfig.json")] : []),
  ];

  for (const configPath of candidates) {
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, "utf-8");
      // Strip single-line and multi-line comments for JSONC support
      const cleaned = stripJsonComments(raw);
      const config = JSON.parse(cleaned);
      const co = config.compilerOptions ?? {};

      return {
        strict: co.strict ?? false,
        target: co.target ?? "unknown",
        module: co.module ?? "unknown",
        moduleResolution: co.moduleResolution ?? "unknown",
        paths: co.paths ?? undefined,
        jsx: co.jsx ?? undefined,
      };
    } catch {
      warnings.push({
        level: "warn",
        module: "config-analyzer",
        message: `Failed to parse ${configPath}`,
      });
    }
  }

  return undefined;
}

// ─── Build Tool ─────────────────────────────────────────────────────────────

function detectBuildTool(
  packageDir: string,
  rootDir?: string,
  warnings: Warning[] = [],
): ConfigAnalysis["buildTool"] | undefined {
  // Check turbo.json (root or package)
  const turboLocations = [
    ...(rootDir ? [join(rootDir, "turbo.json")] : []),
    join(packageDir, "turbo.json"),
  ];
  for (const turboPath of turboLocations) {
    if (!existsSync(turboPath)) continue;
    try {
      const raw = readFileSync(turboPath, "utf-8");
      const cleaned = stripJsonComments(raw);
      const config = JSON.parse(cleaned);

      // Turbo v2: tasks is top-level object with task names as keys
      // Turbo v1: pipeline is top-level object with task names as keys
      const tasksObj = config.tasks ?? config.pipeline ?? {};
      const taskNames = Object.keys(tasksObj).map((t) => t.replace(/^\/\/.*/, "").trim()).filter(Boolean);

      return {
        name: "turbo",
        taskNames,
        configFile: turboPath.startsWith(rootDir ?? "") ? "turbo.json" : turboPath,
      };
    } catch {
      warnings.push({
        level: "warn",
        module: "config-analyzer",
        message: `Failed to parse turbo.json at ${turboPath}`,
      });
    }
  }

  // Check nx.json
  const nxLocations = [
    ...(rootDir ? [join(rootDir, "nx.json")] : []),
    join(packageDir, "nx.json"),
  ];
  for (const nxPath of nxLocations) {
    if (!existsSync(nxPath)) continue;
    try {
      const raw = readFileSync(nxPath, "utf-8");
      const config = JSON.parse(raw);
      const taskNames: string[] = [];

      // Nx: targetDefaults has task names as keys
      if (config.targetDefaults) {
        taskNames.push(...Object.keys(config.targetDefaults));
      }
      // Nx: tasksRunnerOptions may define tasks
      if (config.tasksRunnerOptions) {
        // The runner itself doesn't list tasks, but its presence confirms Nx
      }

      return {
        name: "nx",
        taskNames,
        configFile: "nx.json",
      };
    } catch {
      warnings.push({
        level: "warn",
        module: "config-analyzer",
        message: `Failed to parse nx.json at ${nxPath}`,
      });
    }
  }

  // Check for lerna.json
  const lernaLocations = [
    ...(rootDir ? [join(rootDir, "lerna.json")] : []),
    join(packageDir, "lerna.json"),
  ];
  for (const lernaPath of lernaLocations) {
    if (existsSync(lernaPath)) {
      return {
        name: "lerna",
        taskNames: [],
        configFile: "lerna.json",
      };
    }
  }

  return undefined;
}

// ─── Linter ─────────────────────────────────────────────────────────────────

function detectLinterIn(
  dir: string,
): NonNullable<ConfigAnalysis["linter"]> | undefined {
  // Biome
  for (const name of ["biome.json", "biome.jsonc"]) {
    if (existsSync(join(dir, name))) {
      return { name: "biome", configFile: name };
    }
  }
  // ESLint
  const eslintFiles = [
    "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts",
    ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yaml", ".eslintrc.yml", ".eslintrc",
  ];
  for (const name of eslintFiles) {
    if (existsSync(join(dir, name))) {
      return { name: "eslint", configFile: name };
    }
  }
  return undefined;
}

function detectLinter(
  packageDir: string,
  rootDir?: string,
  _warnings: Warning[] = [],
): ConfigAnalysis["linter"] | undefined {
  // Check package dir FIRST — package-level config takes priority
  const pkgResult = detectLinterIn(packageDir);
  if (pkgResult) return pkgResult;

  // Fall back to root
  if (rootDir) {
    return detectLinterIn(rootDir);
  }

  return undefined;
}

// ─── Formatter ──────────────────────────────────────────────────────────────

function detectFormatterIn(
  dir: string,
): NonNullable<ConfigAnalysis["formatter"]> | undefined {
  // Biome
  for (const name of ["biome.json", "biome.jsonc"]) {
    if (existsSync(join(dir, name))) {
      try {
        const raw = readFileSync(join(dir, name), "utf-8");
        const cleaned = stripJsonComments(raw);
        const config = JSON.parse(cleaned);
        if (config.formatter?.enabled !== false) {
          return { name: "biome", configFile: name };
        }
      } catch {
        return { name: "biome", configFile: name };
      }
    }
  }
  // Prettier
  const prettierFiles = [
    ".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs",
    ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.toml",
    "prettier.config.js", "prettier.config.mjs", "prettier.config.cjs",
  ];
  for (const name of prettierFiles) {
    if (existsSync(join(dir, name))) {
      return { name: "prettier", configFile: name };
    }
  }
  return undefined;
}

function detectFormatter(
  packageDir: string,
  rootDir?: string,
  _warnings: Warning[] = [],
): ConfigAnalysis["formatter"] | undefined {
  // Check package dir FIRST — package-level config takes priority
  const pkgResult = detectFormatterIn(packageDir);
  if (pkgResult) return pkgResult;

  // Fall back to root
  if (rootDir) {
    return detectFormatterIn(rootDir);
  }

  return undefined;
}

// ─── Task Runner ────────────────────────────────────────────────────────────

function detectTaskRunner(
  packageDir: string,
  rootDir?: string,
  _warnings: Warning[] = [],
): ConfigAnalysis["taskRunner"] | undefined {
  const dirs = rootDir ? [packageDir, rootDir] : [packageDir];

  for (const dir of dirs) {
    // Justfile
    for (const name of ["justfile", "Justfile", ".justfile"]) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;

      try {
        const content = readFileSync(path, "utf-8");
        const targets = parseJustfileTargets(content);
        return { name: "just", targets, configFile: name };
      } catch {
        return { name: "just", targets: [], configFile: name };
      }
    }
  }

  for (const dir of dirs) {
    // Makefile
    for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;

      try {
        const content = readFileSync(path, "utf-8");
        const targets = parseMakefileTargets(content);
        return { name: "make", targets, configFile: name };
      } catch {
        return { name: "make", targets: [], configFile: name };
      }
    }
  }

  return undefined;
}

/**
 * Parse justfile target names. Targets are lines like "target-name:" at the start of a line.
 */
function parseJustfileTargets(content: string): string[] {
  const targets: string[] = [];
  for (const line of content.split("\n")) {
    // Justfile recipe: name starts at column 0, followed by optional params and ":"
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*(?:\(.*?\))?\s*:/);
    if (match && !line.startsWith("#") && !line.startsWith(" ") && !line.startsWith("\t")) {
      targets.push(match[1]);
    }
  }
  return targets;
}

/**
 * Parse Makefile target names. Targets are lines like "target:" at the start of a line.
 */
function parseMakefileTargets(content: string): string[] {
  const targets: string[] = [];
  for (const line of content.split("\n")) {
    // Makefile target: starts at column 0, name followed by ":"
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
    if (match && !line.startsWith("\t") && !line.startsWith("#") && !match[1].startsWith(".")) {
      targets.push(match[1]);
    }
  }
  return targets;
}

// ─── Environment Variables ──────────────────────────────────────────────────

function detectEnvVars(packageDir: string, rootDir?: string): string[] | undefined {
  const dirs = rootDir ? [packageDir, rootDir] : [packageDir];
  const envFiles = [".env.example", ".env.sample", ".env.template", ".env.local.example"];

  for (const dir of dirs) {
    for (const name of envFiles) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;

      try {
        const content = readFileSync(path, "utf-8");
        const vars: string[] = [];
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
          if (match) vars.push(match[1]);
        }
        if (vars.length > 0) return vars;
      } catch {
        // skip
      }
    }
  }

  return undefined;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip single-line (//) and multi-line comments from JSON (JSONC support).
 */
function stripJsonComments(json: string): string {
  let result = "";
  let inString = false;
  let inSingleComment = false;
  let inMultiComment = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    const next = json[i + 1];

    if (inSingleComment) {
      if (ch === "\n") {
        inSingleComment = false;
        result += ch;
      }
      continue;
    }

    if (inMultiComment) {
      if (ch === "*" && next === "/") {
        inMultiComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      result += ch;
      if (ch === "\\" && i + 1 < json.length) {
        result += json[++i];
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
    } else if (ch === "/" && next === "/") {
      inSingleComment = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inMultiComment = true;
      i++;
    } else {
      result += ch;
    }
  }

  return result;
}
