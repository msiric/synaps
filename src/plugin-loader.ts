// src/plugin-loader.ts — W5-C2: Plugin System for Org-Specific Detectors
// Allows organizations to add custom convention detectors without modifying the core engine.
// Plugin discovery: package.json "synaps.plugins", .synaps/plugins/ directory, --plugin CLI flag.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ConventionDetector, Warning } from "./types.js";

/**
 * A detector plugin that can be loaded from external sources.
 */
export interface DetectorPlugin {
  name: string;
  version: string;
  detect: ConventionDetector;
  /** Only run this plugin if these dependencies are present in the package */
  dependencies?: string[];
}

/**
 * Discover and load plugins from all configured sources.
 * Sources (checked in order):
 * 1. Explicit paths from CLI --plugin flags
 * 2. package.json "synaps.plugins" field
 * 3. .synaps/plugins/ directory
 */
export function loadPlugins(rootDir: string, explicitPaths: string[] = [], warnings: Warning[] = []): DetectorPlugin[] {
  const plugins: DetectorPlugin[] = [];
  const loaded = new Set<string>();

  // 1. Explicit --plugin paths
  for (const pluginPath of explicitPaths) {
    const abs = resolve(rootDir, pluginPath);
    const plugin = loadPlugin(abs, warnings, rootDir);
    if (plugin && !loaded.has(plugin.name)) {
      loaded.add(plugin.name);
      plugins.push(plugin);
    }
  }

  // 2. package.json "synaps.plugins" field
  const pkgJsonPath = resolve(rootDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      const synaps = pkgJson.synaps;
      if (synaps?.plugins && Array.isArray(synaps.plugins)) {
        for (const pluginPath of synaps.plugins) {
          const abs = resolve(rootDir, pluginPath);
          const plugin = loadPlugin(abs, warnings, rootDir);
          if (plugin && !loaded.has(plugin.name)) {
            loaded.add(plugin.name);
            plugins.push(plugin);
          }
        }
      }
    } catch {
      // package.json parse errors handled elsewhere
    }
  }

  // 3. .synaps/plugins/ directory
  const pluginDir = resolve(rootDir, ".synaps", "plugins");
  if (existsSync(pluginDir)) {
    try {
      const files = readdirSync(pluginDir).filter((f) => {
        const ext = extname(f).toLowerCase();
        return ext === ".js" || ext === ".ts";
      });
      for (const file of files) {
        const abs = resolve(pluginDir, file);
        const plugin = loadPlugin(abs, warnings, rootDir);
        if (plugin && !loaded.has(plugin.name)) {
          loaded.add(plugin.name);
          plugins.push(plugin);
        }
      }
    } catch (err) {
      warnings.push({
        level: "warn",
        module: "plugin-loader",
        message: `Could not read plugin directory .synaps/plugins/: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return plugins;
}

/**
 * Load a single plugin from a file path.
 * The plugin module must default-export a DetectorPlugin object.
 */
function loadPlugin(absPath: string, warnings: Warning[], rootDir?: string): DetectorPlugin | null {
  // Path boundary check: ensure plugin is within the project root
  if (rootDir) {
    const rel = relative(resolve(rootDir), resolve(absPath));
    if (rel.startsWith("..") || isAbsolute(rel)) {
      warnings.push({
        level: "error",
        module: "plugin-loader",
        message: `Plugin path "${absPath}" resolves outside project root — skipped for security`,
      });
      return null;
    }
  }

  if (!existsSync(absPath)) {
    warnings.push({
      level: "warn",
      module: "plugin-loader",
      message: `Plugin not found: ${absPath}`,
    });
    return null;
  }

  try {
    // Dynamic import is async, but we need sync loading here.
    // For .js files, use require-like loading. For .ts files, the runtime
    // (tsx/ts-node) handles transpilation.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(absPath);
    const plugin: DetectorPlugin = mod.default ?? mod;

    if (!plugin.name || !plugin.detect || typeof plugin.detect !== "function") {
      warnings.push({
        level: "warn",
        module: "plugin-loader",
        message: `Plugin at ${absPath} is missing required fields (name, detect)`,
      });
      return null;
    }

    return plugin;
  } catch (err) {
    warnings.push({
      level: "warn",
      module: "plugin-loader",
      message: `Failed to load plugin ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }
}
