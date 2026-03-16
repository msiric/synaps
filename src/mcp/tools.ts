// src/mcp/tools.ts — MCP tool handler implementations
// Each function formats analysis data as human-readable markdown for AI consumption.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { detectClusters } from "../git-history.js";
import type { StructuredAnalysis } from "../types.js";
import * as Q from "./queries.js";

type ToolResult = { content: { type: "text"; text: string }[] };

// ─── P0 Tools ────────────────────────────────────────────────────────────────

export function handleGetCommands(analysis: StructuredAnalysis, args: { packagePath?: string }): ToolResult {
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
  "src",
  "lib",
  "dist",
  "build",
  "out",
  "components",
  "utils",
  "util",
  "types",
  "hooks",
  "styles",
  "assets",
  "public",
  "pages",
  "app",
  "api",
  "config",
  "constants",
  "test",
  "tests",
  "__tests__",
  "middleware",
  "services",
  "store",
  "context",
  "common",
  "shared",
  "core",
  "server",
  "client",
  "bin",
  "cli",
]);

export function handleGetArchitecture(analysis: StructuredAnalysis, args: { packagePath?: string }): ToolResult {
  const arch = Q.getArchitecture(analysis, args.packagePath);
  const pkg = Q.resolvePackage(analysis, args.packagePath);

  const lines: string[] = [];
  lines.push(`## Architecture: ${pkg.name}`);
  lines.push(`Type: ${arch.packageType} | Entry: ${arch.entryPoint}`);
  lines.push("");

  // Separate non-obvious from obvious directories
  const nonObvious = arch.directories.filter((dir) => {
    const name = dir.path.replace(/\/$/, "").split("/").pop()?.toLowerCase() ?? "";
    return !OBVIOUS_DIR_NAMES.has(name);
  });
  const obviousCount = arch.directories.length - nonObvious.length;

  if (nonObvious.length > 0) {
    lines.push("Key directories (non-exhaustive — explore the source tree for additional directories):");
    lines.push("");
    for (const dir of nonObvious) {
      const exportsStr =
        dir.exports.length > 0
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
      const exportsStr =
        dir.exports.length > 0
          ? ` — exports: ${dir.exports.slice(0, 5).join(", ")}${dir.exports.length > 5 ? `, +${dir.exports.length - 5} more` : ""}`
          : "";
      lines.push(`  ${dir.path}/ (${dir.fileCount} files) — ${dir.purpose}${exportsStr}`);
    }
    lines.push("");
    lines.push("Standard project structure — explore the source tree for details.");
  }

  // Execution flows (top 5 by confidence)
  const flows = Q.getExecutionFlows(analysis, args.packagePath);
  if (flows.length > 0) {
    lines.push("");
    lines.push("### Execution Flows");
    for (const f of flows.slice(0, 5)) {
      const conf = f.confidence > 0 ? ` | confidence: ${Math.round(f.confidence * 100)}%` : "";
      lines.push(`- ${f.label}${conf}`);
    }
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

  // Blast radius summary (one-line orientation before details)
  if (args.filePath) {
    const importers = Q.getImportersForFile(analysis, args.filePath, args.packagePath);
    const coChanges = Q.getCoChangesForFile(analysis, args.filePath, args.packagePath);
    const total = importers.length + coChanges.length;
    const radius = total <= 5 ? "Small" : total <= 15 ? "Medium" : "Large";
    lines.push(
      `**Blast radius: ${radius}** — ${importers.length} direct importers, ${coChanges.length} co-change partners.`,
    );
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
    const { directCallers, transitiveCount } = Q.getCallersForFunction(analysis, args.functionName, args.packagePath);
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
    const pkg = Q.resolvePackage(analysis, args.packagePath);
    const coChanges = Q.getCoChangesForFile(analysis, args.filePath, args.packagePath);
    const shown = coChanges.slice(0, limit);
    lines.push(
      `### Co-change Partners (${coChanges.length} files${coChanges.length > limit ? `, showing top ${limit}` : ""})`,
    );
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

    // Implicit coupling (co-change with no import relationship — highest-signal subset)
    const implicit = Q.getImplicitCouplingForFile(analysis, args.filePath, args.packagePath);
    if (implicit.length > 0) {
      lines.push(`### Implicit Coupling (${implicit.length} files co-change without import relationship)`);
      for (const edge of implicit.slice(0, limit)) {
        const partner = edge.file1 === args.filePath ? edge.file2 : edge.file1;
        const pct = Math.round(edge.jaccard * 100);
        lines.push(`- \`${partner}\` — Jaccard ${pct}%, co-changed ${edge.coChangeCount} times, no import path`);
      }
      lines.push("");
    }

    // Co-change cluster membership
    const coChangeEdges = pkg.gitHistory?.coChangeEdges ?? [];
    if (coChangeEdges.length > 0) {
      const clusters = detectClusters(coChangeEdges);
      const fileClusters = clusters.filter((c) => c.includes(args.filePath!));
      if (fileClusters.length > 0) {
        lines.push("### Co-change Cluster");
        for (const cluster of fileClusters) {
          const others = cluster.filter((f) => f !== args.filePath);
          lines.push(`This file belongs to a ${cluster.length}-file cluster that frequently changes together:`);
          for (const f of others) {
            lines.push(`- \`${f}\``);
          }
        }
        lines.push("");
      }
    }

    // Git history metadata (analysis quality signal)
    const history = pkg.gitHistory;
    if (history) {
      lines.push(
        `*Git history: ${history.totalCommitsAnalyzed} commits analyzed over ${history.historySpanDays} days${history.commitsFilteredBySize > 0 ? ` (${history.commitsFilteredBySize} large commits excluded)` : ""}*`,
      );
      lines.push("");
    }
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
        lines.push(
          `- \`${imp.specifier}\`: ${imp.symbols.join(", ")} (${Math.round(imp.coverage * 100)}% of siblings)`,
        );
      }
    }
    // Inline example code (first 15 lines of example file)
    const exampleSnippet = readExampleFile(analysis, pattern.exampleFile);
    if (exampleSnippet) {
      lines.push("");
      lines.push(`Example (\`${pattern.exampleFile}\`):`);
      lines.push("```typescript");
      lines.push(exampleSnippet);
      lines.push("```");
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
    lines.push(`No exports found${args.query ? ` matching "${args.query}"` : ""}.`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  for (const exp of exports) {
    const sig = exp.signature ? exp.signature.slice(0, 80) : "";
    lines.push(`### ${exp.name} (${exp.kind})`);
    lines.push(`Source: \`${exp.sourceFile}\` | Imported by: ${exp.importCount ?? 0} files`);
    if (sig) lines.push(`Signature: \`${sig}\``);

    // Phase 3: Display resolved types from TypeChecker (if available)
    if (exp.parameterTypes && exp.parameterTypes.length > 0) {
      const params = exp.parameterTypes.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ");
      lines.push(`Parameters: \`(${params})\``);
    }
    if (exp.returnType && exp.returnType !== "void" && exp.returnType !== "any") {
      lines.push(`Returns: \`${exp.returnType}\``);
    }

    // Add parameter shape from fingerprint if available
    const fp = Q.getFingerprintForExport(analysis, exp.name, args.packagePath);
    if (fp) {
      lines.push(`Params: ${fp.parameterShape} → ${fp.returnShape}`);
    }

    // Add top usage example if available
    const example = Q.getExampleForExport(analysis, exp.name, args.packagePath);
    if (example) {
      lines.push(`Usage (from \`${example.testFile}\`): \`${example.snippet.split("\n")[0].trim()}\``);
    }

    lines.push("");
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
      const pct = conv.confidence.percentage;
      const strength = pct >= 95 ? "strong" : pct >= 80 ? "moderate" : "weak";
      lines.push(`- **${conv.name}**: ${conv.description} (${pct}% confidence — ${strength})`);
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

// ─── New Tools: plan_change + get_test_info ─────────────────────────────────

const MAX_SECTION_ITEMS = 10;
const CO_CHANGE_THRESHOLD = 0.25;

export function handlePlanChange(
  analysis: StructuredAnalysis,
  args: { files: string[]; symbols?: string[]; packagePath?: string },
): ToolResult {
  const inputSet = new Set(args.files);
  const lines: string[] = [];

  // Collect data across all input files
  const dependents = new Map<string, { symbols: string[]; symbolCount: number }>();
  const coChanges = new Map<string, { jaccard: number; count: number; lastCoChangeTimestamp?: number }>();
  const registrationFiles = new Map<string, string>(); // file → reason
  const barrelFiles = new Set<string>();
  const testFiles = new Map<string, string>(); // source → test command

  const symbolFilter = args.symbols && args.symbols.length > 0 ? new Set(args.symbols) : null;

  for (const file of args.files) {
    // 1. Importers (who depends on this file)
    // When symbols are specified, narrow to files importing those specific symbols
    if (symbolFilter) {
      for (const sym of symbolFilter) {
        const importers = Q.getImportersOfSymbol(analysis, sym, file, args.packagePath);
        for (const imp of importers) {
          if (inputSet.has(imp.importer)) continue;
          const matchedSymbols = imp.symbols.filter((s) => symbolFilter.has(s));
          const existing = dependents.get(imp.importer);
          if (!existing || matchedSymbols.length > existing.symbolCount) {
            dependents.set(imp.importer, { symbols: matchedSymbols, symbolCount: matchedSymbols.length });
          }
        }
      }
    } else {
      const importers = Q.getImportersForFile(analysis, file, args.packagePath);
      for (const imp of importers) {
        if (inputSet.has(imp.importer)) continue;
        const existing = dependents.get(imp.importer);
        if (!existing || imp.symbolCount > existing.symbolCount) {
          dependents.set(imp.importer, { symbols: imp.symbols, symbolCount: imp.symbolCount });
        }
      }
    }

    // 2. Co-change partners (git history)
    const edges = Q.getCoChangesForFile(analysis, file, args.packagePath);
    for (const edge of edges) {
      const partner = edge.file1 === file ? edge.file2 : edge.file1;
      if (inputSet.has(partner) || dependents.has(partner)) continue;
      if (edge.jaccard < CO_CHANGE_THRESHOLD) continue;
      const existing = coChanges.get(partner);
      if (!existing || edge.jaccard > existing.jaccard) {
        coChanges.set(partner, {
          jaccard: edge.jaccard,
          count: edge.coChangeCount,
          lastCoChangeTimestamp: edge.lastCoChangeTimestamp,
        });
      }
    }

    // 3. Registration + barrel files
    const dir = file.replace(/\/[^/]+$/, "");
    const patterns = Q.getContributionPatterns(analysis, args.packagePath, dir);
    for (const p of patterns) {
      // Only include registration if the file is actually IN this pattern's directory
      if (p.registrationFile && !inputSet.has(p.registrationFile) && file.startsWith(p.directory)) {
        registrationFiles.set(p.registrationFile, `registration file for ${p.directory}`);
      }
    }
    const barrel = Q.getBarrelFile(analysis, dir, args.packagePath);
    if (barrel && !inputSet.has(barrel)) {
      barrelFiles.add(barrel);
    }

    // 4. Test files
    const testInfo = Q.resolveTestFile(analysis, file, args.packagePath);
    if (testInfo.testFile) {
      testFiles.set(file, testInfo.command);
    }
  }

  // Blast radius
  const totalAffected = dependents.size + coChanges.size + registrationFiles.size + barrelFiles.size;
  const radius = totalAffected <= 5 ? "Small" : totalAffected <= 15 ? "Medium" : "Large";

  lines.push("## Change Plan");
  lines.push("");
  lines.push(
    `**Blast radius: ${radius}** — ${dependents.size} dependents, ${coChanges.size} co-change partners, ${registrationFiles.size + barrelFiles.size} registration/barrel updates.`,
  );

  // Dependents
  if (dependents.size > 0) {
    lines.push("");
    lines.push("### Dependent Files (import graph)");
    const sorted = [...dependents.entries()].sort((a, b) => b[1].symbolCount - a[1].symbolCount);
    for (const [file, info] of sorted.slice(0, MAX_SECTION_ITEMS)) {
      const displaySymbols =
        info.symbols.length > 5
          ? `${info.symbols.slice(0, 5).join(", ")}, ...${info.symbols.length - 5} more`
          : info.symbols.join(", ");
      lines.push(`- \`${file}\` — ${info.symbolCount} symbols: ${displaySymbols}`);
    }
    if (sorted.length > MAX_SECTION_ITEMS) {
      lines.push(`- ...and ${sorted.length - MAX_SECTION_ITEMS} more`);
    }
  }

  // Co-changes (with recency)
  if (coChanges.size > 0) {
    lines.push("");
    lines.push("### Co-Change Partners (git history)");
    const sorted = [...coChanges.entries()].sort((a, b) => b[1].jaccard - a[1].jaccard);
    for (const [file, info] of sorted.slice(0, MAX_SECTION_ITEMS)) {
      const pct = Math.round(info.jaccard * 100);
      const recency = info.lastCoChangeTimestamp
        ? `, last ${Math.round((Date.now() / 1000 - info.lastCoChangeTimestamp) / 86400)}d ago`
        : "";
      lines.push(`- \`${file}\` — Jaccard ${pct}%, co-changed ${info.count} times${recency}`);
    }
  }

  // Implicit coupling (co-change with no import relationship)
  const implicitEdges = new Map<string, { jaccard: number; count: number }>();
  for (const file of args.files) {
    const edges = Q.getImplicitCouplingForFile(analysis, file, args.packagePath);
    for (const edge of edges) {
      const partner = edge.file1 === file ? edge.file2 : edge.file1;
      if (inputSet.has(partner) || dependents.has(partner) || coChanges.has(partner)) continue;
      const existing = implicitEdges.get(partner);
      if (!existing || edge.jaccard > existing.jaccard) {
        implicitEdges.set(partner, { jaccard: edge.jaccard, count: edge.coChangeCount });
      }
    }
  }
  if (implicitEdges.size > 0) {
    lines.push("");
    lines.push("### Implicit Coupling (no import, but co-changes)");
    const sorted = [...implicitEdges.entries()].sort((a, b) => b[1].jaccard - a[1].jaccard);
    for (const [file, info] of sorted.slice(0, MAX_SECTION_ITEMS)) {
      const pct = Math.round(info.jaccard * 100);
      lines.push(`- \`${file}\` — co-changes ${pct}% of the time but has no import relationship`);
    }
  }

  // Workflow rule matches
  const matchedRules: string[] = [];
  for (const file of args.files) {
    const rules = Q.getWorkflowRules(analysis, file);
    for (const rule of rules) {
      const summary = `When modifying \`${rule.trigger}\` → ${rule.action}`;
      if (!matchedRules.includes(summary)) matchedRules.push(summary);
    }
  }
  if (matchedRules.length > 0) {
    lines.push("");
    lines.push("### Workflow Rules");
    for (const rule of matchedRules.slice(0, 5)) {
      lines.push(`- ${rule}`);
    }
  }

  // Affected execution flows (relevance-ranked, capped at 3)
  const affectedFlows = Q.getFlowsForFiles(analysis, args.files, args.packagePath);
  if (affectedFlows.length > 0) {
    // Rank by relevance: how central are the modified files to this flow?
    const ranked = affectedFlows
      .map((f) => {
        const matchCount = args.files.filter((file) => f.files.includes(file)).length;
        const minIdx = Math.min(...args.files.map((file) => f.files.indexOf(file)).filter((i) => i >= 0));
        const positionWeight = 1 - minIdx / f.length;
        return { flow: f, relevance: (matchCount / f.length) * positionWeight };
      })
      .filter((r) => r.relevance > 0.05)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 3);

    if (ranked.length > 0) {
      lines.push("");
      lines.push("### Affected Execution Flows");
      lines.push("Flows show execution context — updating other steps is not required unless signatures change.");
      for (const { flow } of ranked) {
        const positions = args.files
          .map((file) => {
            const idx = flow.files.indexOf(file);
            return idx >= 0 ? `step ${idx + 1}/${flow.length}` : null;
          })
          .filter(Boolean);
        lines.push(`- ${flow.label}${positions.length > 0 ? ` — your change at ${positions.join(", ")}` : ""}`);
      }
    }
  }

  // Registration + barrel
  if (registrationFiles.size > 0 || barrelFiles.size > 0) {
    lines.push("");
    lines.push("### Registration / Barrel Updates");
    for (const [file, reason] of registrationFiles) {
      lines.push(`- \`${file}\` — ${reason}`);
    }
    for (const barrel of barrelFiles) {
      lines.push(`- \`${barrel}\` — barrel file (add re-export)`);
    }
  }

  // Test files
  if (testFiles.size > 0) {
    lines.push("");
    lines.push("### Test Files");
    for (const [source, command] of testFiles) {
      lines.push(`- \`${source}\` → \`${command}\``);
    }
  }

  // Checklist
  const checklist: string[] = [];
  checklist.push("1. Edit the primary files");
  for (const barrel of barrelFiles) {
    checklist.push(`${checklist.length + 1}. Update barrel: \`${barrel}\``);
  }
  for (const [file] of registrationFiles) {
    checklist.push(`${checklist.length + 1}. Update registration: \`${file}\``);
  }
  if (coChanges.size > 0) {
    const top = [...coChanges.entries()].sort((a, b) => b[1].jaccard - a[1].jaccard)[0];
    checklist.push(`${checklist.length + 1}. Verify co-change partner: \`${top[0]}\``);
  }
  if (testFiles.size > 0) {
    const firstCmd = [...testFiles.values()][0];
    checklist.push(`${checklist.length + 1}. Run tests: \`${firstCmd}\``);
  }

  if (checklist.length > 1) {
    lines.push("");
    lines.push("### Checklist");
    lines.push(...checklist);
  }

  if (totalAffected === 0 && testFiles.size === 0) {
    lines.push("");
    lines.push("No dependent files, co-change partners, or registration points found. This change appears isolated.");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export function handleGetTestInfo(
  analysis: StructuredAnalysis,
  args: { filePath: string; packagePath?: string },
): ToolResult {
  const info = Q.resolveTestFile(analysis, args.filePath, args.packagePath);
  const lines: string[] = [];

  lines.push(`## Test Info: ${args.filePath}`);
  lines.push("");

  if (info.testFile) {
    lines.push(`**Test file:** \`${info.testFile}\` (${info.exists ? "exists" : "suggested — does not exist yet"})`);
  } else {
    lines.push("**Test file:** Not found");
  }

  lines.push(`**Framework:** ${info.framework}`);
  lines.push(`**Run command:** \`${info.command}\``);
  lines.push(`**${info.pattern}**`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ─── auto_register + review_changes ─────────────────────────────────────────

export function handleAutoRegister(
  analysis: StructuredAnalysis,
  args: { newFilePath: string; packagePath?: string },
): ToolResult {
  const result = Q.getRegistrationInsertions(analysis, args.newFilePath, args.packagePath);
  const lines: string[] = [];

  lines.push(`## Auto-Registration: ${args.newFilePath}`);
  lines.push(`Export name: \`${result.exportName}\``);
  lines.push("");

  if (!result.registrationFile && !result.barrelFile) {
    lines.push("No registration or barrel file detected for this directory. The file may work as-is.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (result.registrationFile) {
    const reg = result.registrationFile;
    lines.push(`### Registration File: \`${reg.path}\``);
    lines.push(`Insert after line ${reg.lastImportLine} (last import):`);
    lines.push("```typescript");
    lines.push(reg.importStatement);
    lines.push("```");
    if (reg.registryHintLine) {
      lines.push(`Also add \`${result.exportName}\` to the registry/invocation (around line ${reg.registryHintLine}).`);
    }
    lines.push("");
  }

  if (result.barrelFile) {
    const barrel = result.barrelFile;
    lines.push(`### Barrel File: \`${barrel.path}\``);
    lines.push(`Insert after line ${barrel.lastExportLine} (last re-export):`);
    lines.push("```typescript");
    lines.push(barrel.exportStatement);
    lines.push("```");
    lines.push("");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

export function handleReviewChanges(
  analysis: StructuredAnalysis,
  args: { files: { path: string; content: string }[]; packagePath?: string },
): ToolResult {
  const lines: string[] = [];
  lines.push(`## Code Review: ${args.files.length} file(s) checked`);
  lines.push("");

  for (const file of args.files) {
    const dir = file.path.replace(/\/[^/]+$/, "");
    const fileBase = file.path.replace(/.*\//, "").replace(/\.[^.]+$/, "");
    const patterns = Q.getContributionPatterns(analysis, args.packagePath, dir);
    const pattern = Q.findBestPattern(patterns, file.path);

    lines.push(`### ${file.path}`);

    if (!pattern) {
      lines.push("No contribution pattern detected for this directory — skipping pattern checks.");
      lines.push("");
      continue;
    }

    // Parse the file content
    const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);

    // Extract exports
    const exportNames: string[] = [];
    ts.forEachChild(sf, (node) => {
      const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      const isExported = mods?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) return;
      if (ts.isFunctionDeclaration(node) && node.name) exportNames.push(node.name.text);
      else if (ts.isClassDeclaration(node) && node.name) exportNames.push(node.name.text);
      else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) exportNames.push(decl.name.text);
        }
      }
    });

    // Extract import specifiers
    const importSpecs: string[] = [];
    ts.forEachChild(sf, (node) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        importSpecs.push(node.moduleSpecifier.text);
      }
    });

    // Check 1: Export suffix
    if (pattern.exportSuffix) {
      const hasSuffix = exportNames.some((n) => n.endsWith(pattern.exportSuffix!));
      lines.push(
        hasSuffix
          ? `- ✅ Export suffix: \`${exportNames.find((n) => n.endsWith(pattern.exportSuffix!))}\` ends with "${pattern.exportSuffix}"`
          : `- ❌ Export suffix: expected export ending with "${pattern.exportSuffix}", found: ${exportNames.join(", ") || "none"}`,
      );
    }

    // Check 2: Common imports
    if (pattern.commonImports && pattern.commonImports.length > 0) {
      for (const expected of pattern.commonImports) {
        const found = importSpecs.some(
          (s) => s === expected.specifier || s.endsWith(expected.specifier.replace(/^\.\//, "")),
        );
        lines.push(
          found
            ? `- ✅ Import: imports from \`${expected.specifier}\``
            : `- ❌ Import: missing import from \`${expected.specifier}\` (${expected.symbols.join(", ")})`,
        );
      }
    }

    // Check 3: Registration
    if (pattern.registrationFile) {
      const rootDir = analysis.meta?.rootDir ?? ".";
      let isRegistered = false;
      try {
        const regContent = readFileSync(resolve(rootDir, pattern.registrationFile), "utf-8");
        isRegistered = regContent.includes(fileBase);
      } catch {
        /* can't read */
      }
      lines.push(
        isRegistered
          ? `- ✅ Registration: referenced in \`${pattern.registrationFile}\``
          : `- ❌ Registration: not yet registered in \`${pattern.registrationFile}\` — use auto_register to fix`,
      );
    }

    // Check 4: Barrel
    const barrelPath = Q.getBarrelFile(analysis, dir, args.packagePath);
    if (barrelPath) {
      const rootDir = analysis.meta?.rootDir ?? ".";
      let isExported = false;
      try {
        const barrelContent = readFileSync(resolve(rootDir, barrelPath), "utf-8");
        isExported = barrelContent.includes(fileBase);
      } catch {
        /* can't read */
      }
      lines.push(
        isExported
          ? `- ✅ Barrel: exported from \`${barrelPath}\``
          : `- ❌ Barrel: not exported from \`${barrelPath}\` — use auto_register to fix`,
      );
    }

    // Check 5: Test file
    const testInfo = Q.resolveTestFile(analysis, file.path, args.packagePath);
    if (testInfo.exists) {
      lines.push(`- ✅ Test: \`${testInfo.testFile}\` exists`);
    } else {
      lines.push(`- ⚠️ Test: no test file at \`${testInfo.testFile}\``);
    }

    lines.push("");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ─── search ──────────────────────────────────────────────────────────────────

export function handleSearch(
  analysis: StructuredAnalysis,
  args: { query: string; packagePath?: string; limit?: number },
): ToolResult {
  const results = Q.search(analysis, args.query, args.packagePath, args.limit);

  const lines: string[] = [];
  lines.push(`## Search Results: "${args.query}"`);
  lines.push("");

  if (results.length === 0) {
    lines.push("No results found. Try a different search term or check spelling.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // Group results by kind category
  const symbols = results.filter((r) => r.kind !== "file" && r.kind !== "convention" && r.kind !== "rule");
  const files = results.filter((r) => r.kind === "file");
  const conventions = results.filter((r) => r.kind === "convention" || r.kind === "rule");

  if (symbols.length > 0) {
    lines.push(`### Symbols (${symbols.length})`);
    for (const r of symbols) {
      let detail = `\`${r.sourceFile}\``;
      if (r.importCount > 0) detail += ` | imported by ${r.importCount} files`;
      if (r.callers.length > 0) detail += ` | called by: ${r.callers.join(", ")}`;
      if (r.callees.length > 0) detail += ` | calls: ${r.callees.join(", ")}`;
      lines.push(`- **${r.name}** (${r.kind}) — ${detail}`);
    }
    lines.push("");
  }

  if (files.length > 0) {
    lines.push(`### Files (${files.length})`);
    for (const r of files) {
      lines.push(`- \`${r.name}\`${r.context ? ` — ${r.context}` : ""}`);
    }
    lines.push("");
  }

  if (conventions.length > 0) {
    lines.push(`### Conventions & Rules (${conventions.length})`);
    for (const r of conventions) {
      lines.push(`- **${r.name}** (${r.kind}) — ${r.context ?? r.sourceFile}`);
    }
    lines.push("");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ─── diagnose ────────────────────────────────────────────────────────────────

const CONFIG_FILES = ["tsconfig.json", "package.json", ".env", ".env.local"];
const FLAKY_PATTERNS = /timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket hang up|fetch failed/i;

export function handleDiagnose(
  analysis: StructuredAnalysis,
  args: {
    errorText?: string;
    filePath?: string;
    testFile?: string;
    packagePath?: string;
  },
): ToolResult {
  const lines: string[] = [];
  const rootDir = analysis.meta?.rootDir;

  // Validate: at least one input required
  if (!args.errorText && !args.filePath && !args.testFile) {
    lines.push("## Diagnosis");
    lines.push("");
    lines.push("Provide at least one of `errorText`, `filePath`, or `testFile` to diagnose.");
    lines.push("**Tip:** Paste the full test output as `errorText` for best results.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // 1. Parse error text
  const parsed = args.errorText
    ? Q.parseErrorText(args.errorText, rootDir)
    : { files: [] as string[], testFile: null as string | null, message: null as string | null };

  // 2. Determine error files
  const errorFiles = new Set<string>(parsed.files);
  if (args.filePath) errorFiles.add(args.filePath);

  const testFile = args.testFile ?? parsed.testFile;
  if (testFile) {
    // Add source files the test imports (these are the error-adjacent code)
    const pkg = Q.resolvePackage(analysis, args.packagePath);
    for (const edge of pkg.importChain ?? []) {
      if (edge.importer === testFile) errorFiles.add(edge.source);
    }
  }

  // Handle no parseable files gracefully
  if (errorFiles.size === 0 && !testFile) {
    lines.push("## Diagnosis");
    lines.push("");
    lines.push("Could not extract file paths from the error text.");
    lines.push("Try providing `filePath` (the file with the error) or `testFile` (the failing test) directly.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (errorFiles.size === 0 && testFile) errorFiles.add(testFile);
  const errorFileList = [...errorFiles];

  // 3. Get recent git changes
  const recentChanges = rootDir ? Q.getRecentFileChanges(rootDir) : [];

  // 4. Build suspect list (pass testFile for test-to-source mapping signal)
  const { suspects, confidence, confidenceReason } = Q.buildSuspectList(
    analysis,
    errorFileList,
    recentChanges,
    args.packagePath,
    testFile,
  );

  // 5. Format output
  lines.push("## Diagnosis");
  lines.push("");

  if (parsed.message) {
    lines.push(`**Error:** ${parsed.message}`);
  }
  if (errorFileList.length > 0) {
    lines.push(`**Error site:** ${errorFileList.map((f) => `\`${f}\``).join(", ")}`);
  }
  lines.push(`**Confidence:** ${confidence} — ${confidenceReason}`);
  if (suspects.length > 0) {
    lines.push(`**Likely root cause:** \`${suspects[0].file}\` — ${suspects[0].reason}`);
  }
  lines.push("");

  // Suspect list
  if (suspects.length > 0) {
    lines.push("### Suspect Files");
    lines.push("");
    const pkg = Q.resolvePackage(analysis, args.packagePath);
    for (let i = 0; i < suspects.length; i++) {
      const s = suspects[i];
      lines.push(`${i + 1}. **${s.file}** (score: ${s.score})`);
      lines.push(`   ${s.reason}`);
      // Show which symbols connect this suspect to the error site
      if (i < 3) {
        const connectedSymbols: string[] = [];
        for (const ef of errorFileList) {
          const edge = (pkg.importChain ?? []).find(
            (e) => (e.importer === ef && e.source === s.file) || (e.importer === s.file && e.source === ef),
          );
          if (edge) connectedSymbols.push(...edge.symbols.slice(0, 5));
        }
        if (connectedSymbols.length > 0) {
          lines.push(`   Symbols: ${[...new Set(connectedSymbols)].join(", ")}`);
        }
      }
    }
    lines.push("");
  } else {
    lines.push("No suspect files identified. The error may be in the files listed above.");
    lines.push("");
  }

  // Dependency chains (error site → top suspects)
  const chainSources = testFile ? [testFile, ...errorFileList] : errorFileList;
  const shownChains = new Set<string>();
  for (const s of suspects.slice(0, 3)) {
    for (const source of chainSources) {
      if (source === s.file) continue;
      const chain = Q.traceImportChain(analysis, source, s.file, args.packagePath);
      if (chain && chain.length > 1) {
        const key = chain.join(" → ");
        if (!shownChains.has(key)) {
          shownChains.add(key);
          if (shownChains.size === 1) {
            lines.push("### Dependency Chains");
          }
          lines.push(chain.map((f) => `\`${f}\``).join(" → "));
        }
      }
    }
  }
  if (shownChains.size > 0) lines.push("");

  // Config file changes
  const configChanges = recentChanges.filter((c) => CONFIG_FILES.some((cf) => c.file.endsWith(cf)));
  if (configChanges.length > 0) {
    lines.push("### Configuration Changes");
    for (const c of configChanges) {
      const ago = c.isUncommitted
        ? "uncommitted"
        : c.hoursAgo < 1
          ? "just now"
          : c.hoursAgo < 24
            ? `${Math.round(c.hoursAgo)}h ago`
            : `${Math.round(c.hoursAgo / 24)}d ago`;
      lines.push(`- \`${c.file}\` (${ago})`);
    }
    lines.push("");
  }

  // Flaky test detection
  if (args.errorText && FLAKY_PATTERNS.test(args.errorText) && recentChanges.length === 0) {
    lines.push("### Possible Flaky Test");
    lines.push(
      "No code changes correlate with this failure. The error pattern (timeout/network) suggests a flaky test — try re-running.",
    );
    lines.push("");
  }

  // Recently added test detection
  if (testFile) {
    const testChange = recentChanges.find((c) => c.file === testFile);
    const noSuspectChanges = suspects.slice(0, 3).every((s) => !recentChanges.some((c) => c.file === s.file));
    if (testChange && noSuspectChanges) {
      lines.push("### Recently Added Test");
      lines.push(`\`${testFile}\` was recently modified. This may be exposing a pre-existing bug.`);
      lines.push("");
    }
  }

  // At-risk tests
  if (suspects.length > 0) {
    const atRisk = new Set<string>();
    for (const s of suspects.slice(0, 3)) {
      const testInfo = Q.resolveTestFile(analysis, s.file, args.packagePath);
      if (testInfo.exists && testInfo.testFile) atRisk.add(testInfo.testFile);
    }
    if (testFile) atRisk.delete(testFile);
    if (atRisk.size > 0) {
      lines.push("### At-Risk Tests");
      lines.push([...atRisk].map((t) => `\`${t}\``).join(", "));
      lines.push("");
    }
  }

  // Suggested actions
  lines.push("### Suggested Actions");
  if (suspects.length > 0) {
    lines.push(`1. Inspect the likely root cause: \`${suspects[0].file}\``);
    if (suspects[0].reason.includes("Missing co-change")) {
      lines.push(`2. Check what was missed: \`git diff HEAD~3 -- ${suspects[0].file}\``);
    } else {
      lines.push(`2. Review recent changes: \`git log --oneline -5 -- ${suspects[0].file}\``);
    }
    const testCmd = testFile ? `npx vitest run ${testFile}` : "npx vitest run";
    lines.push(`3. Run related tests: \`${testCmd}\``);
  } else {
    lines.push("1. Check the error site files listed above");
    lines.push("2. Review recent git changes: `git log --oneline -10`");
  }
  lines.push("");

  // Next step: suggest plan_change
  if (suspects.length > 0) {
    const topFiles = suspects
      .slice(0, 3)
      .map((s) => `"${s.file}"`)
      .join(", ");
    lines.push(
      `**Next step:** Call \`plan_change({ files: [${topFiles}] })\` to understand full blast radius before fixing.`,
    );
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_EXAMPLE_LINES = 15;

function readExampleFile(analysis: StructuredAnalysis, relativePath: string): string | null {
  try {
    const rootDir = analysis.meta?.rootDir;
    if (!rootDir) return null;
    const absPath = resolve(rootDir, relativePath);
    const content = readFileSync(absPath, "utf-8");
    const lines = content.split("\n").slice(0, MAX_EXAMPLE_LINES);
    if (content.split("\n").length > MAX_EXAMPLE_LINES) {
      lines.push("// ... (truncated)");
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}
