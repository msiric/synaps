import type { Convention, ConventionDetector } from "../types.js";
import { sourceParsedFiles, buildConfidence } from "../convention-extractor.js";

// Node.js built-in modules (with and without node: prefix)
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
  "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "string_decoder", "sys",
  "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

type ImportGroup = "builtin" | "external" | "local";

function classifyImport(specifier: string): ImportGroup {
  if (specifier.startsWith("node:")) return "builtin";
  if (NODE_BUILTINS.has(specifier)) return "builtin";
  if (specifier.startsWith(".")) return "local";
  return "external";
}

/**
 * Detects whether the codebase follows a consistent import ordering pattern.
 * Common patterns: builtins → external → local, or external → local.
 */
export const importOrderingDetector: ConventionDetector = (files, tiers, _warnings) => {
  const conventions: Convention[] = [];
  const sourceFiles = sourceParsedFiles(files, tiers);

  // Only analyze files with ≥3 imports (need enough to detect ordering)
  const filesWithImports = sourceFiles.filter(f =>
    f.imports.filter(i => !i.isDynamic).length >= 3,
  );
  if (filesWithImports.length < 5) return conventions;

  let builtinFirstCount = 0;
  let externalBeforeLocalCount = 0;
  let totalWithMixedGroups = 0;

  for (const file of filesWithImports) {
    const groups = file.imports
      .filter(i => !i.isDynamic)
      .map(i => classifyImport(i.moduleSpecifier));

    // Skip files with only one import group
    const uniqueGroups = new Set(groups);
    if (uniqueGroups.size < 2) continue;
    totalWithMixedGroups++;

    // Check: do builtins come before all other imports?
    const lastBuiltin = groups.lastIndexOf("builtin");
    const firstExternal = groups.indexOf("external");
    const firstLocal = groups.indexOf("local");
    const firstNonBuiltin = Math.min(
      firstExternal >= 0 ? firstExternal : Infinity,
      firstLocal >= 0 ? firstLocal : Infinity,
    );

    if (lastBuiltin >= 0 && firstNonBuiltin < Infinity && lastBuiltin < firstNonBuiltin) {
      builtinFirstCount++;
    }

    // Check: do externals come before locals?
    const lastExternal = groups.lastIndexOf("external");
    if (lastExternal >= 0 && firstLocal >= 0 && lastExternal < firstLocal) {
      externalBeforeLocalCount++;
    }
  }

  if (totalWithMixedGroups < 5) return conventions;

  // Report: external before local pattern
  const extBeforeLocalPct = Math.round((externalBeforeLocalCount / totalWithMixedGroups) * 100);
  if (extBeforeLocalPct >= 80) {
    conventions.push({
      category: "ecosystem",
      name: "Import ordering: external before local",
      description: "External/package imports appear before local relative imports",
      confidence: buildConfidence(externalBeforeLocalCount, totalWithMixedGroups),
      examples: ["import { x } from \"pkg\"; // before", "import { y } from \"./local\"; // after"],
    });
  }

  // Report: builtin-first pattern (subset of above)
  const builtinFirstPct = Math.round((builtinFirstCount / totalWithMixedGroups) * 100);
  if (builtinFirstPct >= 80 && builtinFirstCount > externalBeforeLocalCount * 0.5) {
    conventions.push({
      category: "ecosystem",
      name: "Import ordering: Node builtins first",
      description: "Node.js built-in imports (node:fs, node:path) appear before all other imports",
      confidence: buildConfidence(builtinFirstCount, totalWithMixedGroups),
      examples: ["import { resolve } from \"node:path\"; // first", "import { z } from \"zod\"; // after"],
    });
  }

  return conventions;
};
