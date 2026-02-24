// src/mcp/tools.ts — MCP tool handler implementations
// Each function formats analysis data as human-readable markdown for AI consumption.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  // Blast radius summary (one-line orientation before details)
  if (args.filePath) {
    const importers = Q.getImportersForFile(analysis, args.filePath, args.packagePath);
    const coChanges = Q.getCoChangesForFile(analysis, args.filePath, args.packagePath);
    const total = importers.length + coChanges.length;
    const radius = total <= 5 ? "Small" : total <= 15 ? "Medium" : "Large";
    lines.push(`**Blast radius: ${radius}** — ${importers.length} direct importers, ${coChanges.length} co-change partners.`);
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
    lines.push("No exports found" + (args.query ? ` matching "${args.query}"` : "") + ".");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  for (const exp of exports) {
    const sig = exp.signature ? exp.signature.slice(0, 80) : "";
    lines.push(`### ${exp.name} (${exp.kind})`);
    lines.push(`Source: \`${exp.sourceFile}\` | Imported by: ${exp.importCount ?? 0} files`);
    if (sig) lines.push(`Signature: \`${sig}\``);

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
  args: { files: string[]; packagePath?: string },
): ToolResult {
  const inputSet = new Set(args.files);
  const lines: string[] = [];

  // Collect data across all input files
  const dependents = new Map<string, { symbols: string[]; symbolCount: number }>();
  const coChanges = new Map<string, { jaccard: number; count: number }>();
  const registrationFiles = new Map<string, string>(); // file → reason
  const barrelFiles = new Set<string>();
  const testFiles = new Map<string, string>(); // source → test command

  for (const file of args.files) {
    // 1. Importers (who depends on this file)
    const importers = Q.getImportersForFile(analysis, file, args.packagePath);
    for (const imp of importers) {
      if (inputSet.has(imp.importer)) continue;
      const existing = dependents.get(imp.importer);
      if (!existing || imp.symbolCount > existing.symbolCount) {
        dependents.set(imp.importer, { symbols: imp.symbols, symbolCount: imp.symbolCount });
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
        coChanges.set(partner, { jaccard: edge.jaccard, count: edge.coChangeCount });
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
  lines.push(`**Blast radius: ${radius}** — ${dependents.size} dependents, ${coChanges.size} co-change partners, ${registrationFiles.size + barrelFiles.size} registration/barrel updates.`);

  // Dependents
  if (dependents.size > 0) {
    lines.push("");
    lines.push("### Dependent Files (import graph)");
    const sorted = [...dependents.entries()].sort((a, b) => b[1].symbolCount - a[1].symbolCount);
    for (const [file, info] of sorted.slice(0, MAX_SECTION_ITEMS)) {
      lines.push(`- \`${file}\` — ${info.symbolCount} symbols: ${info.symbols.join(", ")}`);
    }
    if (sorted.length > MAX_SECTION_ITEMS) {
      lines.push(`- ...and ${sorted.length - MAX_SECTION_ITEMS} more`);
    }
  }

  // Co-changes
  if (coChanges.size > 0) {
    lines.push("");
    lines.push("### Co-Change Partners (git history)");
    const sorted = [...coChanges.entries()].sort((a, b) => b[1].jaccard - a[1].jaccard);
    for (const [file, info] of sorted.slice(0, MAX_SECTION_ITEMS)) {
      const pct = Math.round(info.jaccard * 100);
      lines.push(`- \`${file}\` — Jaccard ${pct}%, co-changed ${info.count} times`);
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
    const pattern = patterns.find(p =>
      file.path.startsWith(p.directory) || dir.includes(p.directory),
    );

    lines.push(`### ${file.path}`);

    if (!pattern) {
      lines.push("No contribution pattern detected for this directory — skipping pattern checks.");
      lines.push("");
      continue;
    }

    // Parse the file content
    const ts = require("typescript") as typeof import("typescript");
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
      const hasSuffix = exportNames.some(n => n.endsWith(pattern.exportSuffix!));
      lines.push(hasSuffix
        ? `- ✅ Export suffix: \`${exportNames.find(n => n.endsWith(pattern.exportSuffix!))}\` ends with "${pattern.exportSuffix}"`
        : `- ❌ Export suffix: expected export ending with "${pattern.exportSuffix}", found: ${exportNames.join(", ") || "none"}`);
    }

    // Check 2: Common imports
    if (pattern.commonImports && pattern.commonImports.length > 0) {
      for (const expected of pattern.commonImports) {
        const found = importSpecs.some(s => s === expected.specifier || s.endsWith(expected.specifier.replace(/^\.\//, "")));
        lines.push(found
          ? `- ✅ Import: imports from \`${expected.specifier}\``
          : `- ❌ Import: missing import from \`${expected.specifier}\` (${expected.symbols.join(", ")})`);
      }
    }

    // Check 3: Registration
    if (pattern.registrationFile) {
      const rootDir = analysis.meta?.rootDir ?? ".";
      let isRegistered = false;
      try {
        const regContent = readFileSync(resolve(rootDir, pattern.registrationFile), "utf-8");
        isRegistered = regContent.includes(fileBase);
      } catch { /* can't read */ }
      lines.push(isRegistered
        ? `- ✅ Registration: referenced in \`${pattern.registrationFile}\``
        : `- ❌ Registration: not yet registered in \`${pattern.registrationFile}\` — use auto_register to fix`);
    }

    // Check 4: Barrel
    const barrelPath = Q.getBarrelFile(analysis, dir, args.packagePath);
    if (barrelPath) {
      const rootDir = analysis.meta?.rootDir ?? ".";
      let isExported = false;
      try {
        const barrelContent = readFileSync(resolve(rootDir, barrelPath), "utf-8");
        isExported = barrelContent.includes(fileBase);
      } catch { /* can't read */ }
      lines.push(isExported
        ? `- ✅ Barrel: exported from \`${barrelPath}\``
        : `- ❌ Barrel: not exported from \`${barrelPath}\` — use auto_register to fix`);
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
