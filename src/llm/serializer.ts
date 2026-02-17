// src/llm/serializer.ts — StructuredAnalysis to markdown serialization
// Split from llm-adapter.ts (W5-B1)

import type { StructuredAnalysis, PackageAnalysis } from "../types.js";

// E-34: Sanitize values before interpolation
export function sanitize(s: string, maxLen = 500): string {
  return s.replace(/\n/g, " ").replace(/`/g, "'").slice(0, maxLen);
}

/**
 * Serialize a single package's analysis to markdown (for per-package LLM calls).
 */
export function serializePackageToMarkdown(pkg: PackageAnalysis): string {
  const lines: string[] = [];
  serializePackage(pkg, lines);
  return lines.join("\n");
}

/**
 * Serialize the full StructuredAnalysis to markdown for LLM consumption.
 */
export function serializeToMarkdown(analysis: StructuredAnalysis): string {
  const lines: string[] = [];

  for (const pkg of analysis.packages) {
    serializePackage(pkg, lines);
  }

  // Cross-package section (improved serialization for multi-package template)
  if (analysis.crossPackage) {
    lines.push("# Cross-Package Analysis");
    lines.push("");

    // Package summary table for easy reference
    lines.push("## Package Summary");
    lines.push("| Package | Type | Public Exports | Files (T1/T2/T3) |");
    lines.push("|---------|------|---------------|------------------|");
    for (const pkg of analysis.packages) {
      const t = pkg.files.byTier;
      lines.push(
        `| ${pkg.name} | ${pkg.architecture.packageType} | ${pkg.publicAPI.length} | ${t.tier1.count}/${t.tier2.count}/${t.tier3.count} |`,
      );
    }
    lines.push("");

    if (analysis.crossPackage.dependencyGraph.length > 0) {
      lines.push("## Dependency Graph");
      for (const edge of analysis.crossPackage.dependencyGraph) {
        lines.push(`- ${edge.from} \u2192 ${edge.to}`);
      }
      lines.push("");

      // W5-C3: Mermaid diagram
      if (analysis.crossPackage.mermaidDiagram) {
        lines.push("## Dependency Diagram");
        lines.push(analysis.crossPackage.mermaidDiagram);
        lines.push("");
      }
    }

    if (analysis.crossPackage.sharedConventions.length > 0) {
      lines.push("## Shared Conventions (apply to ALL packages)");
      for (const conv of analysis.crossPackage.sharedConventions) {
        const impact = conv.impact ? ` [impact: ${conv.impact}]` : "";
        const examples = conv.examples.length > 0
          ? ` (e.g., ${conv.examples.slice(0, 2).map((e) => `\`${sanitize(e, 80)}\``).join(", ")})`
          : "";
        lines.push(`- **${conv.name}**: ${conv.description}${impact}${examples}`);
      }
      lines.push("");
    }

    if (analysis.crossPackage.divergentConventions.length > 0) {
      lines.push("## Divergent Conventions (package-specific differences)");
      for (const div of analysis.crossPackage.divergentConventions) {
        const pkgs = div.packages.map((p) => `${p.name}: ${p.value}`).join("; ");
        lines.push(`- **${div.convention}**: ${pkgs}`);
      }
      lines.push("");
    }

    if (analysis.crossPackage.sharedAntiPatterns?.length > 0) {
      lines.push("## Shared Anti-Patterns (apply to ALL packages)");
      for (const ap of analysis.crossPackage.sharedAntiPatterns) {
        const impact = ap.impact ? ` [impact: ${ap.impact}]` : "";
        lines.push(`- **${ap.rule}** [${ap.confidence}]${impact} \u2014 ${sanitize(ap.reason)}`);
      }
      lines.push("");
    }

    // Package roles summary
    const rolesPresent = analysis.packages.some((p) => p.role?.summary);
    if (rolesPresent) {
      lines.push("## Package Roles");
      for (const pkg of analysis.packages) {
        if (pkg.role?.summary) {
          lines.push(`- **${pkg.name}**: ${sanitize(pkg.role.summary)}`);
          lines.push(`  - When to use: ${sanitize(pkg.role.whenToUse)}`);
        }
      }
      lines.push("");
    }

    if (analysis.crossPackage.rootCommands) {
      lines.push("## Root Commands");
      const rc = analysis.crossPackage.rootCommands;
      if (rc.test) {
        lines.push(`- Test: \`${rc.test.run}\``);
        if (rc.test.variants?.length) {
          for (const v of rc.test.variants) {
            lines.push(`  - ${v.name}: \`${v.run}\``);
          }
        }
      }
      if (rc.build) lines.push(`- Build: \`${rc.build.run}\``);
      if (rc.lint) lines.push(`- Lint: \`${rc.lint.run}\``);
      if (rc.start) lines.push(`- Start: \`${rc.start.run}\``);
      for (const cmd of rc.other) {
        lines.push(`- ${cmd.source}: \`${cmd.run}\``);
      }
      lines.push("");
    }

    // W3-1: Workspace commands from all workspace packages
    if (analysis.crossPackage.workspaceCommands && analysis.crossPackage.workspaceCommands.length > 0) {
      lines.push("## Workspace Commands");
      lines.push("| Command | Package | Category |");
      lines.push("|---------|---------|----------|");
      for (const cmd of analysis.crossPackage.workspaceCommands) {
        lines.push(`| \`${cmd.run}\` | ${cmd.packagePath} | ${cmd.category} |`);
      }
      lines.push("");
    }

    // W3-2: Technology-aware workflow rules
    if (analysis.crossPackage.workflowRules && analysis.crossPackage.workflowRules.length > 0) {
      lines.push("## Workflow Rules (Technology-Specific)");
      for (const rule of analysis.crossPackage.workflowRules) {
        lines.push(`- ${rule.trigger} \u2192 ${rule.action}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Serialize a single package into markdown lines (shared between full and per-package serialization).
 */
export function serializePackage(pkg: PackageAnalysis, lines: string[]): void {
  lines.push(`# ${sanitize(pkg.name, 200)}`);
  if (pkg.description) lines.push(sanitize(pkg.description));
  lines.push(`Version: ${pkg.version}`);
  lines.push("");

  lines.push("## File Summary");
  lines.push(
    `Total: ${pkg.files.total} files | T1: ${pkg.files.byTier.tier1.count} | T2: ${pkg.files.byTier.tier2.count} | T3: ${pkg.files.byTier.tier3.count}`,
  );
  lines.push("");

  lines.push("## Public API");
  if (pkg.publicAPI.length === 0) {
    lines.push("No public API detected.");
  } else {
    for (const entry of pkg.publicAPI) {
      const sig = entry.signature ? `: \`${sanitize(entry.signature)}\`` : "";
      const desc = entry.description ? ` \u2014 ${sanitize(entry.description)}` : "";
      const imports = entry.importCount != null ? ` (${entry.importCount} imports)` : "";
      lines.push(`- \`${entry.name}\` (${entry.kind})${sig}${desc}${imports}`);
    }
  }
  lines.push("");

  // W3-4: Convention examples and impact — strip percentage stats
  lines.push("## Conventions");
  for (const conv of pkg.conventions) {
    const impact = conv.impact ? ` [impact: ${conv.impact}]` : "";
    const examples = conv.examples.length > 0
      ? ` (e.g., ${conv.examples.slice(0, 2).map((e) => `\`${sanitize(e, 80)}\``).join(", ")})`
      : "";
    lines.push(
      `- **${conv.name}**: ${conv.description}${impact}${examples}`,
    );
  }
  lines.push("");

  lines.push("## Commands");
  if (pkg.commands.test) {
    lines.push(`- Test: \`${pkg.commands.test.run}\``);
    if (pkg.commands.test.variants?.length) {
      for (const v of pkg.commands.test.variants) {
        lines.push(`  - ${v.name}: \`${v.run}\``);
      }
    }
  }
  if (pkg.commands.build) lines.push(`- Build: \`${pkg.commands.build.run}\``);
  if (pkg.commands.lint) lines.push(`- Lint: \`${pkg.commands.lint.run}\``);
  if (pkg.commands.start) lines.push(`- Start: \`${pkg.commands.start.run}\``);
  for (const cmd of pkg.commands.other) {
    lines.push(`- ${cmd.source}: \`${cmd.run}\``);
  }
  lines.push(`- Package manager: ${pkg.commands.packageManager}`);
  lines.push("");

  // Role inference
  if (pkg.role && pkg.role.summary) {
    lines.push("## Role");
    lines.push(`- Summary: ${sanitize(pkg.role.summary)}`);
    lines.push(`- Purpose: ${sanitize(pkg.role.purpose)}`);
    lines.push(`- When to use: ${sanitize(pkg.role.whenToUse)}`);
    lines.push(`- Inferred from: ${pkg.role.inferredFrom.map((s) => sanitize(s, 100)).join("; ")}`);
    lines.push("");
  }

  lines.push("## Architecture");
  lines.push(`- Entry point: \`${pkg.architecture.entryPoint}\``);
  lines.push(`- Package type: ${pkg.architecture.packageType}`);
  lines.push(`- Has JSX: ${pkg.architecture.hasJSX}`);
  for (const dir of pkg.architecture.directories) {
    // W3-4: Surface specific implementation names instead of just file counts
    const pattern = dir.pattern ? ` | pattern: \`${dir.pattern}\`` : "";
    if (dir.exports && dir.exports.length > 0) {
      const exportList = dir.exports.length <= 8
        ? dir.exports.join(", ")
        : `${dir.exports.slice(0, 8).join(", ")} (+${dir.exports.length - 8} more)`;
      lines.push(`- **${dir.purpose}**: ${exportList} (see \`${dir.path}/\`)${pattern}`);
    } else {
      lines.push(`- **${dir.purpose}**: \`${dir.path}/\` (${dir.fileCount} files)${pattern}`);
    }
  }
  lines.push("");

  // Improvement 3: Call graph
  if (pkg.callGraph && pkg.callGraph.length > 0) {
    lines.push("## Call Graph");
    lines.push("Key function relationships (caller \u2192 callee):");
    for (const edge of pkg.callGraph.slice(0, 30)) {
      lines.push(`- ${edge.from} \u2192 ${edge.to} (${edge.fromFile} \u2192 ${edge.toFile})`);
    }
    if (pkg.callGraph.length > 30) {
      lines.push(`  ... and ${pkg.callGraph.length - 30} more edges`);
    }
    lines.push("");
  }

  // W2-2: Pattern fingerprints
  if (pkg.patternFingerprints && pkg.patternFingerprints.length > 0) {
    lines.push("## Pattern Fingerprints");
    lines.push("Detailed patterns for the most-imported exports:");
    for (const fp of pkg.patternFingerprints) {
      lines.push(`- **${fp.exportName}** (${fp.sourceFile}): ${fp.summary}`);
      lines.push(`  - Parameters: ${fp.parameterShape}`);
      lines.push(`  - Returns: ${fp.returnShape}`);
      if (fp.internalCalls.length > 0) {
        lines.push(`  - Calls: ${fp.internalCalls.join(", ")}`);
      }
      lines.push(`  - Error handling: ${fp.errorPattern} | Async: ${fp.asyncPattern} | Complexity: ${fp.complexity}`);
    }
    lines.push("");
  }

  // Anti-patterns
  if (pkg.antiPatterns && pkg.antiPatterns.length > 0) {
    lines.push("## Anti-Patterns (DO NOT)");
    for (const ap of pkg.antiPatterns) {
      const impact = ap.impact ? ` [impact: ${ap.impact}]` : "";
      lines.push(`- **${ap.rule}** [${ap.confidence}]${impact} \u2014 ${sanitize(ap.reason)}`);
    }
    lines.push("");
  }

  // Contribution patterns
  if (pkg.contributionPatterns && pkg.contributionPatterns.length > 0) {
    lines.push("## Contribution Patterns");
    for (const cp of pkg.contributionPatterns) {
      lines.push(`- **${cp.type}**: Create \`${cp.filePattern}\` in \`${cp.directory}\``);
      if (cp.testPattern) lines.push(`  - Test: \`${cp.testPattern}\``);
      lines.push(`  - Example: \`${cp.exampleFile}\``);
      for (const step of cp.steps) {
        lines.push(`  - ${step}`);
      }
    }
    lines.push("");
  }

  // Improvement 1: Config analysis
  if (pkg.configAnalysis) {
    const ca = pkg.configAnalysis;
    const parts: string[] = [];
    if (ca.buildTool && ca.buildTool.name !== "none") parts.push(`Build tool: ${ca.buildTool.name} (${ca.buildTool.configFile})`);
    if (ca.linter && ca.linter.name !== "none") parts.push(`Linter: ${ca.linter.name} (${ca.linter.configFile})`);
    if (ca.formatter && ca.formatter.name !== "none") parts.push(`Formatter: ${ca.formatter.name} (${ca.formatter.configFile})`);
    if (ca.taskRunner && ca.taskRunner.name !== "none") parts.push(`Task runner: ${ca.taskRunner.name} (${ca.taskRunner.configFile}), targets: ${ca.taskRunner.targets.join(", ")}`);
    if (ca.typescript) {
      parts.push(`TypeScript: strict=${ca.typescript.strict}, target=${ca.typescript.target}, module=${ca.typescript.module}`);
      if (ca.typescript.paths) parts.push(`Path aliases: ${Object.keys(ca.typescript.paths).join(", ")}`);
    }
    if (ca.envVars && ca.envVars.length > 0) parts.push(`Required env vars: ${ca.envVars.join(", ")}`);
    if (parts.length > 0) {
      lines.push("## Config");
      for (const p of parts) lines.push(`- ${p}`);
      lines.push("");
    }
  }

  // Improvement 2: Dependency insights
  if (pkg.dependencyInsights) {
    const di = pkg.dependencyInsights;
    const hasSomething = di.runtime.length > 0 || di.frameworks.length > 0 || di.testFramework || di.bundler;
    if (hasSomething) {
      lines.push("## Tech Stack");
      if (di.runtime.length > 0) {
        lines.push(`Runtime: ${di.runtime.map((r) => `${r.name} ${r.version}`).join(", ")}`);
      }
      for (const fw of di.frameworks) {
        const guidance = fw.guidance ? ` \u2014 ${fw.guidance}` : "";
        lines.push(`- ${fw.name}: ${fw.version}${guidance}`);
      }
      if (di.testFramework) lines.push(`- Test framework: ${di.testFramework.name} ${di.testFramework.version}`);
      if (di.bundler) lines.push(`- Bundler: ${di.bundler.name} ${di.bundler.version}`);
      lines.push("");
    }
  }

  // Improvement 4: Existing documentation
  if (pkg.existingDocs) {
    const ed = pkg.existingDocs;
    const existing: string[] = [];
    if (ed.hasReadme) existing.push("README.md");
    if (ed.hasAgentsMd) existing.push("AGENTS.md");
    if (ed.hasClaudeMd) existing.push("CLAUDE.md");
    if (ed.hasCursorrules) existing.push(".cursorrules");
    if (ed.hasContributing) existing.push("CONTRIBUTING.md");
    if (existing.length > 0) {
      lines.push("## Existing Documentation");
      lines.push(`This package already has: ${existing.join(", ")}. Do not duplicate their content.`);
      lines.push("");
    }
  }

  // W5-C1: Usage examples from test files
  if (pkg.examples && pkg.examples.length > 0) {
    lines.push("## Usage Examples (from tests)");
    for (const ex of pkg.examples.slice(0, 5)) {
      lines.push(`### ${ex.exportName}`);
      lines.push(`_${ex.context}_`);
      lines.push("```typescript");
      lines.push(ex.snippet);
      lines.push("```");
      lines.push("");
    }
  }

  lines.push("## Dependencies");
  lines.push(`Internal: ${pkg.dependencies.internal.join(", ") || "none"}`);
  for (const dep of pkg.dependencies.external.slice(0, 10)) {
    lines.push(`- ${dep.name}: ${dep.importCount} imports`);
  }
  lines.push("");
}
