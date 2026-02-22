// src/config.ts — Config Resolver
// Errata applied: E-37 (mri for arg parsing), E-38 (warn if API key in config file)

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { ResolvedConfig, OutputFormat, Warning } from "./types.js";

export type LLMSynthesisMode = "deterministic" | "full";

export interface ParsedArgs {
  packages: string[];
  format?: string;
  output?: string;
  config?: string;
  root?: string;
  quiet: boolean;
  verbose: boolean;
  dryRun: boolean;
  help: boolean;
  hierarchical?: boolean;
  flat?: boolean;
  merge?: boolean;
  diff?: string;
  llmSynthesis?: LLMSynthesisMode;
  noMetaTool?: boolean;
  saveBaseline?: boolean;
  // Benchmark-specific
  full?: boolean;
  model?: string;
  maxTasks?: number;
}

const DEFAULTS: ResolvedConfig = {
  packages: ["."],
  exclude: [],
  rootDir: undefined,
  output: {
    format: "json",
    dir: ".",
  },
  llm: {
    provider: "anthropic",
    model: process.env.AUTODOCS_LLM_MODEL ?? "claude-opus-4-20250514",
    maxOutputTokens: 4096, // E-7
  },
  conventions: {
    disable: [],
  },
  maxPublicAPIEntries: 100, // E-13
  verbose: false,
  metaToolThreshold: 5,
  noMetaTool: false,
};

/**
 * Resolve config from CLI args, config file, and defaults.
 */
export function resolveConfig(
  args: ParsedArgs,
  warnings: Warning[] = [],
): ResolvedConfig {
  // Load config file
  const fileConfig = loadConfigFile(args.config, warnings);

  // Merge: defaults ← fileConfig ← CLI args
  const config: ResolvedConfig = {
    ...DEFAULTS,
    ...fileConfig,
    packages:
      args.packages.length > 0
        ? args.packages.map((p) => resolve(p))
        : fileConfig?.packages?.map((p: string) => resolve(p)) ??
          DEFAULTS.packages.map((p) => resolve(p)),
    exclude: fileConfig?.exclude ?? DEFAULTS.exclude,
    rootDir: args.root ? resolve(args.root) : fileConfig?.rootDir ? resolve(fileConfig.rootDir) : undefined,
    output: {
      format: (args.format as OutputFormat) ??
        fileConfig?.output?.format ??
        DEFAULTS.output.format,
      dir: args.output ?? fileConfig?.output?.dir ?? DEFAULTS.output.dir,
    },
    llm: {
      ...DEFAULTS.llm,
      ...fileConfig?.llm,
      apiKey:
        process.env.ANTHROPIC_API_KEY ??
        process.env.OPENAI_API_KEY ??
        fileConfig?.llm?.apiKey,
    },
    conventions: {
      disable: fileConfig?.conventions?.disable ?? DEFAULTS.conventions.disable,
    },
    maxPublicAPIEntries:
      fileConfig?.maxPublicAPIEntries ?? DEFAULTS.maxPublicAPIEntries,
    verbose: args.verbose,
    metaToolThreshold: fileConfig?.metaToolThreshold ?? DEFAULTS.metaToolThreshold,
    noMetaTool: args.noMetaTool ?? fileConfig?.noMetaTool ?? DEFAULTS.noMetaTool,
  };

  // Decision #11: Auto-detect format based on API key availability
  if (!args.format && !fileConfig?.output?.format) {
    config.output.format = config.llm.apiKey ? "agents.md" : "json";
  }

  // Validate: LLM format requires API key
  if (
    config.output.format !== "json" &&
    !config.llm.apiKey &&
    !args.dryRun
  ) {
    warnings.push({
      level: "warn",
      module: "config",
      message: `Format "${config.output.format}" requires an API key. Set ANTHROPIC_API_KEY or use --format json.`,
    });
  }

  return config;
}

function loadConfigFile(
  configPath: string | undefined,
  warnings: Warning[],
): Partial<ResolvedConfig> | null {
  // Explicit config path
  if (configPath) {
    const absPath = resolve(configPath);
    if (!existsSync(absPath)) {
      warnings.push({
        level: "warn",
        module: "config",
        message: `Config file not found: ${configPath}`,
      });
      return null;
    }
    return parseConfigFile(absPath, warnings);
  }

  // Search for config file
  const cwd = process.cwd();

  // autodocs.config.json
  const jsonConfig = join(cwd, "autodocs.config.json");
  if (existsSync(jsonConfig)) {
    return parseConfigFile(jsonConfig, warnings);
  }

  // autodocs key in package.json
  const pkgJson = join(cwd, "package.json");
  if (existsSync(pkgJson)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJson, "utf-8"));
      if (pkg.autodocs) return pkg.autodocs;
    } catch {
      // Invalid package.json
    }
  }

  return null;
}

function parseConfigFile(
  filePath: string,
  warnings: Warning[],
): Partial<ResolvedConfig> | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);

    // E-38: Warn if API key found in config file
    if (parsed?.llm?.apiKey) {
      warnings.push({
        level: "warn",
        module: "config",
        message:
          "API keys should not be stored in config files. Use ANTHROPIC_API_KEY environment variable instead.",
      });
    }

    return parsed;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push({
      level: "warn",
      module: "config",
      message: `Failed to parse config file ${filePath}: ${msg}`,
    });
    return null;
  }
}

/**
 * E-37: Parse CLI args using mri.
 */
export async function parseCliArgs(
  argv: string[],
): Promise<ParsedArgs> {
  const mri = (await import("mri")).default;
  const args = mri(argv, {
    alias: { f: "format", o: "output", c: "config", q: "quiet", v: "verbose" },
    boolean: ["dry-run", "quiet", "verbose", "help", "hierarchical", "flat", "merge", "no-meta-tool", "save-baseline", "full"],
    string: ["format", "output", "config", "root", "diff", "llm-synthesis", "model", "max-tasks"],
  });

  return {
    packages: args._ as string[],
    format: args.format,
    output: args.output,
    config: args.config,
    root: args.root,
    quiet: args.quiet ?? false,
    verbose: args.verbose ?? false,
    dryRun: args["dry-run"] ?? false,
    help: args.help ?? false,
    hierarchical: args.hierarchical ?? undefined,
    flat: args.flat ?? undefined,
    merge: args.merge ?? undefined,
    diff: args.diff ?? undefined,
    llmSynthesis: (args["llm-synthesis"] as LLMSynthesisMode) ?? undefined,
    noMetaTool: args["no-meta-tool"] ?? undefined,
    saveBaseline: args["save-baseline"] ?? undefined,
    full: args.full ?? undefined,
    model: args.model ?? undefined,
    maxTasks: args["max-tasks"] ? parseInt(args["max-tasks"] as string, 10) : undefined,
  };
}
