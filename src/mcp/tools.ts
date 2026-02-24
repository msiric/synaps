// src/mcp/tools.ts — MCP tool handler implementations
// Each function formats analysis data as human-readable markdown for AI consumption.

import type { StructuredAnalysis } from "../types.js";
import * as Q from "./queries.js";

type ToolResult = { content: { type: "text"; text: string }[] };

// ─── P0 Tools ────────────────────────────────────────────────────────────────

export function handleGetCommands(
  analysis: StructuredAnalysis,
  args: { packagePath?: string },
): ToolResult {
  const commands = Q.getCommands(analysis, args.packagePath);
  const techStack = Q.getTechStackSummary(analysis, args.packagePath);

  const lines: string[] = [];
  lines.push(`## Commands`);
  lines.push(`Tech stack: ${techStack}`);
  lines.push(`Package manager: ${commands.packageManager}`);
  lines.push("");
  lines.push("| Action | Command | Source |");
  lines.push("|--------|---------|--------|");

  if (commands.build) lines.push(`| Build | \`${commands.build.run}\` | ${commands.build.source} |`);
  if (commands.test) lines.push(`| Test | \`${commands.test.run}\` | ${commands.test.source} |`);
  if (commands.lint) lines.push(`| Lint | \`${commands.lint.run}\` | ${commands.lint.source} |`);
  if (commands.start) lines.push(`| Start | \`${commands.start.run}\` | ${commands.start.source} |`);
  for (const cmd of commands.other) {
    const name = cmd.run.split(" ").pop() ?? "other";
    lines.push(`| ${name} | \`${cmd.run}\` | ${cmd.source} |`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// Standard directory names that AI can infer without guidance
const OBVIOUS_DIR_NAMES = new Set([
  "src", "lib", "dist", "build", "out", "components", "utils", "util",
  "types", "hooks", "styles", "assets", "public", "pages", "app", "api",
  "config", "constants", "test", "tests", "__tests__", "middleware",
  "services", "store", "context", "common", "shared", "core", "server",
  "client", "bin", "cli",
]);

export function handleGetArchitecture(
  analysis: StructuredAnalysis,
  args: { packagePath?: string },
): ToolResult {
  const arch = Q.getArchitecture(analysis, args.packagePath);
  const pkg = Q.resolvePackage(analysis, args.packagePath);

  const lines: string[] = [];
  lines.push(`## Architecture: ${pkg.name}`);
  lines.push(`Type: ${arch.packageType} | Entry: ${arch.entryPoint}`);
  lines.push("");

  // Separate non-obvious from obvious directories
  const nonObvious = arch.directories.filter(dir => {
    const name = dir.path.replace(/\/$/, "").split("/").pop()?.toLowerCase() ?? "";
    return !OBVIOUS_DIR_NAMES.has(name);
  });
  const obviousCount = arch.directories.length - nonObvious.length;

  if (nonObvious.length > 0) {
    lines.push("Key directories (non-exhaustive — explore the source tree for additional directories):");
    lines.push("");
    for (const dir of nonObvious) {
      const exportsStr = dir.exports.length > 0
        ? ` — exports: ${dir.exports.slice(0, 5).join(", ")}${dir.exports.length > 5 ? `, +${dir.exports.length - 5} more` : ""}`
        : "";
      lines.push(`  ${dir.path}/ (${dir.fileCount} files) — ${dir.purpose}${exportsStr}`);
      if (dir.pattern) lines.push(`    Pattern: ${dir.pattern}`);
    }
    if (obviousCount > 0) {
      lines.push("");
      lines.push(`Plus ${obviousCount} standard directories with conventional purposes.`);
    }
  } else {
    lines.push("All directories:");
    for (const dir of arch.directories) {
      const exportsStr = dir.exports.length > 0
        ? ` — exports: ${dir.exports.slice(0, 5).join(", ")}${dir.exports.length > 5 ? `, +${dir.exports.length - 5} more` : ""}`
        : "";
      lines.push(`  ${dir.path}/ (${dir.fileCount} files) — ${dir.purpose}${exportsStr}`);
    }
    lines.push("");
    lines.push("Standard project structure — explore the source tree for details.");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export function handleAnalyzeImpact(
  analysis: StructuredAnalysis,
  args: {
    filePath?: string;
    functionName?: string;
    packagePath?: string;
    scope?: "all" | "imports" | "callers" | "cochanges";
    limit?: number;
  },
): ToolResult {
  const scope = args.scope ?? "all";
  const limit = Math.min(args.limit ?? 20, 50);
  const lines: string[] = [];

  if (args.filePath) {
    lines.push(`## Impact Analysis: ${args.filePath}`);
  } else if (args.functionName) {
    lines.push(`## Impact Analysis: ${args.functionName}()`);
  } else {
    lines.push("## Impact Analysis");
    lines.push("Specify filePath or functionName to analyze.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  lines.push("");

  // Importers section
  if (args.filePath && (scope === "all" || scope === "imports")) {
    const importers = Q.getImportersForFile(analysis, args.filePath, args.packagePath);
    const shown = importers.slice(0, limit);
    lines.push(`### Importers (${importers.length} files${importers.length > limit ? `, showing top ${limit}` : ""})`);
    if (shown.length === 0) {
      lines.push("No files import from this module.");
    } else {
      for (const imp of shown) {
        lines.push(`- \`${imp.importer}\` — ${imp.symbolCount} symbols: ${imp.symbols.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Callers section
  if (args.functionName && (scope === "all" || scope === "callers")) {
    const { directCallers, transitiveCount } = Q.getCallersForFunction(
      analysis, args.functionName, args.packagePath,
    );
    const shown = directCallers.slice(0, limit);
    lines.push(`### Callers of ${args.functionName}() (${directCallers.length} direct, ${transitiveCount} transitive)`);
    if (shown.length === 0) {
      lines.push("No callers found in call graph.");
    } else {
      for (const caller of shown) {
        lines.push(`- \`${caller.from}\` in \`${caller.fromFile}\``);
      }
    }
    lines.push("");
  }

  // Co-change section
  if (args.filePath && (scope === "all" || scope === "cochanges")) {
    const coChanges = Q.getCoChangesForFile(analysis, args.filePath, args.packagePath);
    const shown = coChanges.slice(0, limit);
    lines.push(`### Co-change Partners (${coChanges.length} files${coChanges.length > limit ? `, showing top ${limit}` : ""})`);
    if (shown.length === 0) {
      lines.push("No co-change data available (git history may be insufficient).");
    } else {
      for (const edge of shown) {
        const partner = edge.file1 === args.filePath ? edge.file2 : edge.file1;
        const pct = Math.round(edge.jaccard * 100);
        lines.push(`- \`${partner}\` — Jaccard ${pct}%, co-changed ${edge.coChangeCount} times`);
      }
    }
    lines.push("");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export function handleGetWorkflowRules(
  analysis: StructuredAnalysis,
  args: { packagePath?: string; filePath?: string },
): ToolResult {
  const rules = Q.getWorkflowRules(analysis, args.filePath);

  const lines: string[] = [];
  lines.push("## Workflow Rules");
  lines.push("");

  if (rules.length === 0) {
    lines.push("No workflow rules detected for this project.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    lines.push(`${i + 1}. **${rule.trigger}**`);
    lines.push(`   ${rule.action}`);
    lines.push(`   *Source: ${rule.source}*`);
    lines.push("");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export function handleListPackages(analysis: StructuredAnalysis): ToolResult {
  const packages = Q.listPackages(analysis);

  const lines: string[] = [];
  lines.push("## Packages");
  lines.push("");
  lines.push("| Name | Path | Type | Entry Point | Files |");
  lines.push("|------|------|------|-------------|------:|");

  for (const pkg of packages) {
    lines.push(`| ${pkg.name} | ${pkg.path} | ${pkg.type} | ${pkg.entryPoint} | ${pkg.fileCount} |`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ─── P1 Tools ────────────────────────────────────────────────────────────────

export function handleGetContributionGuide(
  analysis: StructuredAnalysis,
  args: { directory?: string; packagePath?: string },
): ToolResult {
  const patterns = Q.getContributionPatterns(analysis, args.packagePath, args.directory);

  const lines: string[] = [];
  lines.push("## How to Add New Code");
  lines.push("");

  if (patterns.length === 0) {
    lines.push("No contribution patterns detected. Check the directory path or try a different package.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  for (const pattern of patterns) {
    lines.push(`### ${pattern.type} in ${pattern.directory}`);
    lines.push(`Pattern: \`${pattern.filePattern}\` | Example: \`${pattern.exampleFile}\``);
    if (pattern.exportSuffix) lines.push(`Export suffix: \`${pattern.exportSuffix}\``);
    if (pattern.registrationFile) lines.push(`Register in: \`${pattern.registrationFile}\``);
    lines.push("");
    lines.push("Steps:");
    for (let i = 0; i < pattern.steps.length; i++) {
      lines.push(`${i + 1}. ${pattern.steps[i]}`);
    }
    if (pattern.commonImports && pattern.commonImports.length > 0) {
      lines.push("");
      lines.push("Common imports:");
      for (const imp of pattern.commonImports) {
        lines.push(`- \`${imp.specifier}\`: ${imp.symbols.join(", ")} (${Math.round(imp.coverage * 100)}% of siblings)`);
      }
    }
    lines.push("");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export function handleGetExports(
  analysis: StructuredAnalysis,
  args: { packagePath?: string; query?: string; limit?: number },
): ToolResult {
  const exports = Q.getPublicAPI(analysis, args.packagePath, args.query, args.limit);

  const lines: string[] = [];
  lines.push("## Public API");
  lines.push("");

  if (exports.length === 0) {
    lines.push("No exports found" + (args.query ? ` matching "${args.query}"` : "") + ".");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  lines.push("| Name | Kind | Source | Imports | Signature |");
  lines.push("|------|------|--------|--------:|-----------|");

  for (const exp of exports) {
    const sig = exp.signature ? exp.signature.slice(0, 60) : "";
    lines.push(`| ${exp.name} | ${exp.kind} | ${exp.sourceFile} | ${exp.importCount ?? 0} | ${sig} |`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ─── P2 Tools ────────────────────────────────────────────────────────────────

export function handleGetConventions(
  analysis: StructuredAnalysis,
  args: { packagePath?: string; category?: string },
): ToolResult {
  const { conventions, antiPatterns } = Q.getConventions(analysis, args.packagePath, args.category);

  const lines: string[] = [];
  lines.push("## Conventions");
  lines.push("");

  if (conventions.length > 0) {
    lines.push("### DO");
    for (const conv of conventions) {
      lines.push(`- **${conv.name}**: ${conv.description} (${conv.confidence.description})`);
    }
    lines.push("");
  }

  if (antiPatterns.length > 0) {
    lines.push("### DO NOT");
    for (const ap of antiPatterns) {
      lines.push(`- **${ap.rule}**: ${ap.reason}`);
    }
    lines.push("");
  }

  if (conventions.length === 0 && antiPatterns.length === 0) {
    lines.push("No conventions detected.");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
