// src/deterministic-formatter.ts — Generate 13 AGENTS.md sections deterministically from analysis data
// No LLM call — pure data formatting. The LLM is used only for architecture + domain synthesis.

import type {
  StructuredAnalysis,
  PackageAnalysis,
  Convention,
} from "./types.js";
import { ENGINE_VERSION } from "./types.js";
import { sanitize, stripConventionStats } from "./llm/serializer.js";
import { PACKAGE_TO_FAMILY } from "./meta-tool-detector.js";
import { computeImpactRadius, impactLabel, complexityLabel } from "./impact-radius.js";

// ─── Output Type ─────────────────────────────────────────────────────────────

export interface DeterministicOutput {
  title: string;
  summary: string;
  techStack: string;
  commands: string;
  packageGuide: string;       // multi-package only
  workflowRules: string;
  howToAddCode: string;
  publicAPI: string;
  dependencies: string;
  conventions: string;
  changeImpact: string;        // from call graph analysis
  supportedFrameworks: string; // meta-tools only
  dependencyGraph: string;    // multi-package only
  mermaidDiagram: string;     // multi-package only
  teamKnowledge: string;
  // Left empty — filled by micro-LLM synthesis
  architecture: string;
  domainTerminology: string;
  contributingGuidelines: string;
}

const MAX_TEAM_KNOWLEDGE_QUESTIONS = 7;

// ─── Main Entry ──────────────────────────────────────────────────────────────

/**
 * Generate 13 AGENTS.md sections directly from structured analysis data.
 * No LLM call — this is pure deterministic formatting.
 * Architecture and domainTerminology are left empty for micro-LLM synthesis.
 */
export function generateDeterministicAgentsMd(
  analysis: StructuredAnalysis,
): DeterministicOutput {
  return {
    title: formatTitle(analysis),
    summary: formatSummary(analysis),
    techStack: formatTechStack(analysis),
    commands: formatCommands(analysis),
    packageGuide: formatPackageGuide(analysis),
    workflowRules: formatWorkflowRules(analysis),
    howToAddCode: formatContributionPatterns(analysis),
    publicAPI: formatPublicAPI(analysis),
    dependencies: formatDependencies(analysis),
    conventions: formatConventions(analysis),
    changeImpact: formatChangeImpact(analysis),
    supportedFrameworks: formatSupportedFrameworks(analysis),
    dependencyGraph: formatDependencyGraph(analysis),
    mermaidDiagram: formatMermaidDiagram(analysis),
    teamKnowledge: formatTeamKnowledge(analysis),
    architecture: "",
    domainTerminology: "",
    contributingGuidelines: "",
  };
}

// ─── Assembly ────────────────────────────────────────────────────────────────

/**
 * Combine deterministic sections + LLM-synthesized sections into final AGENTS.md.
 */
export function assembleFinalOutput(
  deterministic: DeterministicOutput,
  architectureSection: string,
  domainSection: string,
  contributingSection: string = "",
): string {
  const sections: string[] = [];

  sections.push(deterministic.title);
  sections.push("");
  sections.push(deterministic.summary);

  if (deterministic.techStack) sections.push("", deterministic.techStack);
  if (deterministic.commands) sections.push("", deterministic.commands);
  if (deterministic.packageGuide) sections.push("", deterministic.packageGuide);
  if (architectureSection) sections.push("", architectureSection);
  if (deterministic.workflowRules) sections.push("", deterministic.workflowRules);
  if (domainSection) sections.push("", domainSection);
  if (contributingSection) sections.push("", contributingSection);
  if (deterministic.howToAddCode) sections.push("", deterministic.howToAddCode);
  if (deterministic.publicAPI) sections.push("", deterministic.publicAPI);
  if (deterministic.dependencies) sections.push("", deterministic.dependencies);
  if (deterministic.dependencyGraph) sections.push("", deterministic.dependencyGraph);
  if (deterministic.mermaidDiagram) sections.push("", deterministic.mermaidDiagram);
  if (deterministic.conventions) sections.push("", deterministic.conventions);
  if (deterministic.changeImpact) sections.push("", deterministic.changeImpact);
  if (deterministic.supportedFrameworks) sections.push("", deterministic.supportedFrameworks);

  sections.push("", deterministic.teamKnowledge);

  return sections.join("\n") + "\n";
}

// ─── Section Formatters ──────────────────────────────────────────────────────

function formatTitle(analysis: StructuredAnalysis): string {
  if (analysis.packages.length === 1) {
    return `# ${analysis.packages[0].name}`;
  }
  // Multi-package: use root dir name or first package scope
  const rootName = analysis.meta.rootDir.split("/").filter(Boolean).pop() ?? "Monorepo";
  return `# ${rootName}`;
}

function formatSummary(analysis: StructuredAnalysis): string {
  if (analysis.packages.length === 1) {
    const pkg = analysis.packages[0];
    return pkg.role?.summary || pkg.description || `TypeScript package: ${pkg.name}`;
  }
  // Multi-package summary
  const names = analysis.packages.map((p) => p.name).join(", ");
  return `Monorepo with ${analysis.packages.length} packages: ${names}`;
}

function formatTechStack(analysis: StructuredAnalysis): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const guidanceLines: string[] = [];

  for (const pkg of analysis.packages) {
    // Runtime
    for (const rt of pkg.dependencyInsights?.runtime ?? []) {
      if (!seen.has(rt.name)) {
        parts.push(`${rt.name} ${rt.version}`);
        seen.add(rt.name);
      }
    }
    // Frameworks
    for (const fw of pkg.dependencyInsights?.frameworks ?? []) {
      if (!seen.has(fw.name)) {
        parts.push(`${fw.name} ${fw.version}`);
        seen.add(fw.name);
      }
      if (fw.guidance) guidanceLines.push(`- ${fw.guidance}`);
    }
    // Test framework
    if (pkg.dependencyInsights?.testFramework) {
      const tf = pkg.dependencyInsights.testFramework;
      if (!seen.has(tf.name)) {
        parts.push(`${tf.name} ${tf.version}`);
        seen.add(tf.name);
      }
    }
    // Bundler
    if (pkg.dependencyInsights?.bundler) {
      const b = pkg.dependencyInsights.bundler;
      if (!seen.has(b.name)) {
        parts.push(`${b.name} ${b.version}`);
        seen.add(b.name);
      }
    }
    // Config tools
    if (pkg.configAnalysis?.linter?.name && pkg.configAnalysis.linter.name !== "none") {
      const key = `linter:${pkg.configAnalysis.linter.name}`;
      if (!seen.has(key)) {
        parts.push(`${pkg.configAnalysis.linter.name} (lint)`);
        seen.add(key);
      }
    }
    if (pkg.configAnalysis?.formatter?.name && pkg.configAnalysis.formatter.name !== "none") {
      const key = `formatter:${pkg.configAnalysis.formatter.name}`;
      if (!seen.has(key)) {
        parts.push(`${pkg.configAnalysis.formatter.name} (format)`);
        seen.add(key);
      }
    }
    if (pkg.configAnalysis?.buildTool?.name && pkg.configAnalysis.buildTool.name !== "none") {
      const key = `build:${pkg.configAnalysis.buildTool.name}`;
      if (!seen.has(key)) {
        parts.push(`${pkg.configAnalysis.buildTool.name} (build)`);
        seen.add(key);
      }
    }
  }

  if (parts.length === 0) return "";

  const lines = ["## Tech Stack", "", parts.join(" | ")];
  if (guidanceLines.length > 0) {
    lines.push("");
    lines.push(...guidanceLines);
  }
  return lines.join("\n");
}

function formatCommands(analysis: StructuredAnalysis): string {
  const lines = ["## Commands", "", "| Command | Description |", "|---------|-------------|"];
  let hasCommands = false;

  // Root commands (if multi-package)
  const rootCmds = analysis.crossPackage?.rootCommands;
  if (rootCmds) {
    if (rootCmds.build) { lines.push(`| \`${rootCmds.build.run}\` | Build |`); hasCommands = true; }
    if (rootCmds.test) {
      lines.push(`| \`${rootCmds.test.run}\` | Test |`);
      hasCommands = true;
      for (const v of rootCmds.test.variants ?? []) {
        lines.push(`| \`${v.run}\` | Test (${v.name}) |`);
      }
    }
    if (rootCmds.lint) { lines.push(`| \`${rootCmds.lint.run}\` | Lint |`); hasCommands = true; }
    if (rootCmds.start) { lines.push(`| \`${rootCmds.start.run}\` | Start |`); hasCommands = true; }
    for (const cmd of rootCmds.other) {
      lines.push(`| \`${cmd.run}\` | ${sanitize(cmd.source, 80)} |`);
      hasCommands = true;
    }
  }

  // Single package commands (only if no root commands)
  if (!rootCmds) {
    for (const pkg of analysis.packages) {
      const prefix = analysis.packages.length > 1 ? `${pkg.name}: ` : "";
      if (pkg.commands.build) { lines.push(`| \`${pkg.commands.build.run}\` | ${prefix}Build |`); hasCommands = true; }
      if (pkg.commands.test) {
        lines.push(`| \`${pkg.commands.test.run}\` | ${prefix}Test |`);
        hasCommands = true;
        for (const v of pkg.commands.test.variants ?? []) {
          lines.push(`| \`${v.run}\` | ${prefix}Test (${v.name}) |`);
        }
      }
      if (pkg.commands.lint) { lines.push(`| \`${pkg.commands.lint.run}\` | ${prefix}Lint |`); hasCommands = true; }
      if (pkg.commands.start) { lines.push(`| \`${pkg.commands.start.run}\` | ${prefix}Start |`); hasCommands = true; }
      for (const cmd of pkg.commands.other) {
        lines.push(`| \`${cmd.run}\` | ${prefix}${sanitize(cmd.source, 80)} |`);
        hasCommands = true;
      }
    }
  }

  // Workspace commands
  if (analysis.crossPackage?.workspaceCommands?.length) {
    for (const cmd of analysis.crossPackage.workspaceCommands) {
      lines.push(`| \`${cmd.run}\` | ${sanitize(cmd.category, 40)} (${cmd.packagePath}) |`);
      hasCommands = true;
    }
  }

  if (!hasCommands) return "";
  return lines.join("\n");
}

function formatPackageGuide(analysis: StructuredAnalysis): string {
  if (analysis.packages.length <= 1) return "";

  const lines = [
    "## Package Guide",
    "",
    "| Package | Purpose | When to Use |",
    "|---------|---------|-------------|",
  ];

  for (const pkg of analysis.packages) {
    const purpose = sanitize(pkg.role?.summary ?? pkg.description ?? pkg.architecture.packageType, 100);
    const whenToUse = sanitize(pkg.role?.whenToUse ?? "", 100);
    lines.push(`| ${pkg.name} | ${purpose} | ${whenToUse} |`);
  }

  return lines.join("\n");
}

function formatWorkflowRules(analysis: StructuredAnalysis): string {
  const rules = analysis.crossPackage?.workflowRules;
  if (!rules || rules.length === 0) return "";

  const lines = ["## Workflow Rules"];
  for (const rule of rules) {
    lines.push("");
    lines.push(`**${rule.trigger}**`);
    lines.push(`${rule.action}`);
  }

  return lines.join("\n");
}

function formatContributionPatterns(analysis: StructuredAnalysis): string {
  const allPatterns = analysis.packages.flatMap((p) => p.contributionPatterns ?? []);
  if (allPatterns.length === 0) return "";

  const lines = ["## How to Add New Code"];

  for (const cp of allPatterns) {
    // Use export suffix or directory name as header instead of generic kind
    const dirName = cp.directory.replace(/\/$/, "").split("/").pop() ?? cp.type;
    const header = cp.exportSuffix ?? dirName;
    lines.push("");
    lines.push(`### ${header}`);
    lines.push("");
    lines.push(`Example: \`${cp.exampleFile}\``);
    if (cp.steps.length > 0) {
      lines.push("");
      for (const step of cp.steps) {
        lines.push(`1. ${step}`);
      }
    }
  }

  return lines.join("\n");
}

function formatPublicAPI(analysis: StructuredAnalysis): string {
  // Collect all API entries across packages
  const entries: { pkg: string; entry: typeof analysis.packages[0]["publicAPI"][0] }[] = [];
  for (const pkg of analysis.packages) {
    for (const entry of pkg.publicAPI) {
      entries.push({ pkg: pkg.name, entry });
    }
  }

  if (entries.length === 0) return "";

  // Sort by importCount (most used first), then by kind for grouping
  entries.sort((a, b) => (b.entry.importCount ?? 0) - (a.entry.importCount ?? 0));

  // Group by kind
  const byKind = new Map<string, typeof entries>();
  for (const e of entries) {
    const kind = e.entry.kind;
    const list = byKind.get(kind) ?? [];
    list.push(e);
    byKind.set(kind, list);
  }

  // Order: hooks, functions, components, types, interfaces, classes, enums, consts
  const kindOrder = ["hook", "function", "component", "type", "interface", "class", "enum", "const", "namespace", "unknown"];

  const lines = ["## Public API"];
  const isMulti = analysis.packages.length > 1;

  for (const kind of kindOrder) {
    const group = byKind.get(kind);
    if (!group || group.length === 0) continue;

    const label = kind.charAt(0).toUpperCase() + kind.slice(1) + "s";
    lines.push("");
    lines.push(`### ${label}`);
    lines.push("");

    // Limit to top 20 per kind
    for (const { pkg, entry } of group.slice(0, 20)) {
      const sig = entry.signature ? `: \`${sanitize(entry.signature, 120)}\`` : "";
      const desc = entry.description ? ` — ${sanitize(entry.description, 100)}` : "";
      const imports = entry.importCount != null && entry.importCount > 0 ? ` (${entry.importCount} imports)` : "";
      const pkgLabel = isMulti ? ` [${pkg}]` : "";
      lines.push(`- \`${entry.name}\`${sig}${desc}${imports}${pkgLabel}`);
    }
    if (group.length > 20) {
      lines.push(`- _...and ${group.length - 20} more ${kind}s_`);
    }
  }

  return lines.join("\n");
}

function formatDependencies(analysis: StructuredAnalysis): string {
  const lines = ["## Key Dependencies"];
  let hasContent = false;

  for (const pkg of analysis.packages) {
    const prefix = analysis.packages.length > 1 ? `### ${pkg.name}\n\n` : "";

    // Internal dependencies
    if (pkg.dependencies.internal.length > 0) {
      if (prefix) lines.push("", prefix.trim());
      lines.push("");
      lines.push("**Internal:**");
      for (const dep of pkg.dependencies.internal) {
        lines.push(`- ${dep}`);
      }
      hasContent = true;
    }

    // External (top 10 by import count)
    // For meta-tools, split into core deps vs supported frameworks
    if (pkg.isMetaTool && pkg.metaToolInfo) {
      const supportedPkgs = new Set<string>();
      for (const family of pkg.metaToolInfo.supportedFamilies) {
        for (const [pkgName, fam] of PACKAGE_TO_FAMILY) {
          if (fam === family) supportedPkgs.add(pkgName);
        }
      }
      const testFw = pkg.dependencyInsights?.testFramework?.name;
      const coreDeps = pkg.dependencies.external.filter(d => !supportedPkgs.has(d.name) && d.name !== testFw);
      if (coreDeps.length > 0) {
        if (!hasContent && prefix) lines.push("", prefix.trim());
        lines.push("");
        lines.push("**Core:**");
        for (const dep of coreDeps.slice(0, 10)) {
          lines.push(`- \`${dep.name}\` (${dep.importCount} imports)`);
        }
        hasContent = true;
      }
    } else {
      const testFw = pkg.dependencyInsights?.testFramework?.name;
      const topExternal = pkg.dependencies.external.filter(d => d.name !== testFw).slice(0, 10);
      if (topExternal.length > 0) {
        if (!hasContent && prefix) lines.push("", prefix.trim());
        lines.push("");
        lines.push("**External:**");
        for (const dep of topExternal) {
          lines.push(`- \`${dep.name}\` (${dep.importCount} imports)`);
        }
        hasContent = true;
      }
    }
  }

  if (!hasContent) return "";
  return lines.join("\n");
}

/** Ecosystem detector names whose conventions should be reclassified for meta-tools. */
const ECOSYSTEM_DETECTORS = new Set(["dataFetching", "database", "webFramework", "buildTool"]);

function formatConventions(analysis: StructuredAnalysis): string {
  // Collect DO rules from conventions, DON'T rules from anti-patterns
  const doRules: string[] = [];
  const dontRules: string[] = [];

  for (const pkg of analysis.packages) {
    const coreFamilySet = new Set(pkg.metaToolInfo?.coreFamilies ?? []);

    for (const conv of pkg.conventions) {
      // For meta-tools, reclassify ecosystem conventions (except core family)
      if (pkg.isMetaTool && conv.source && ECOSYSTEM_DETECTORS.has(conv.source)) {
        const isCore = coreFamilySet.size > 0 && [...coreFamilySet].some(
          family => conv.name.toLowerCase().includes(family),
        );
        if (!isCore) continue; // Listed in "Supported Frameworks" section instead
      }

      const desc = stripConventionStats(conv.description);
      if (desc) {
        const examples = conv.examples.length > 0
          ? ` (e.g., \`${sanitize(conv.examples[0], 60)}\`)`
          : "";
        doRules.push(`- **DO**: ${desc}${examples}`);
      }
    }

    for (const ap of pkg.antiPatterns) {
      dontRules.push(`- **DON'T**: ${sanitize(ap.rule, 200)} — ${sanitize(ap.reason, 200)}`);
    }
  }

  // Shared conventions from cross-package
  if (analysis.crossPackage?.sharedConventions) {
    for (const conv of analysis.crossPackage.sharedConventions) {
      const desc = stripConventionStats(conv.description);
      if (desc) {
        doRules.push(`- **DO**: ${desc} _(all packages)_`);
      }
    }
  }

  // Shared anti-patterns
  if (analysis.crossPackage?.sharedAntiPatterns) {
    for (const ap of analysis.crossPackage.sharedAntiPatterns) {
      dontRules.push(`- **DON'T**: ${sanitize(ap.rule, 200)} — ${sanitize(ap.reason, 200)} _(all packages)_`);
    }
  }

  if (doRules.length === 0 && dontRules.length === 0) return "";

  const lines = ["## Conventions"];
  if (doRules.length > 0) {
    lines.push("");
    lines.push(...doRules);
  }
  if (dontRules.length > 0) {
    lines.push("");
    lines.push(...dontRules);
  }
  return lines.join("\n");
}

function formatChangeImpact(analysis: StructuredAnalysis): string {
  // Aggregate call graph edges across all packages
  const allEdges = analysis.packages.flatMap((p) => p.callGraph ?? []);
  const { highImpact, complex } = computeImpactRadius(allEdges);

  if (highImpact.length === 0 && complex.length === 0) return "";

  const lines = ["## Change Impact"];

  if (highImpact.length > 0) {
    lines.push("");
    lines.push("High-impact functions — changes to these affect many callers:");
    lines.push("");
    lines.push("| Function | File | Callers | Impact |");
    lines.push("|----------|------|--------:|--------|");
    for (const entry of highImpact) {
      lines.push(
        `| \`${entry.functionName}\` | \`${entry.file}\` | ${entry.transitiveCallers} | ${impactLabel(entry.transitiveCallers)} |`,
      );
    }
  }

  if (complex.length > 0) {
    lines.push("");
    lines.push("Complex functions — these call many other functions:");
    lines.push("");
    lines.push("| Function | File | Calls | Complexity |");
    lines.push("|----------|------|------:|------------|");
    for (const entry of complex) {
      lines.push(
        `| \`${entry.functionName}\` | \`${entry.file}\` | ${entry.directCalls} | ${complexityLabel(entry.directCalls)} |`,
      );
    }
  }

  return lines.join("\n");
}

function formatSupportedFrameworks(analysis: StructuredAnalysis): string {
  // Only rendered for meta-tool packages
  const pkg = analysis.packages[0];
  if (!pkg?.isMetaTool || !pkg.metaToolInfo) return "";

  const { supportedFamilies, coreFamilies } = pkg.metaToolInfo;
  // Exclude core families from the "supported" list (they're already in conventions)
  const coreSet = new Set(coreFamilies);
  const supported = supportedFamilies.filter(f => !coreSet.has(f));
  if (supported.length === 0) return "";

  const lines = [
    "## Supported Frameworks",
    "",
    `This package has integrations for ${supported.length} framework ecosystems:`,
    supported.join(", "),
    `_These indicate what this tool supports, not conventions to follow._`,
  ];
  return lines.join("\n");
}

function formatDependencyGraph(analysis: StructuredAnalysis): string {
  const edges = analysis.crossPackage?.dependencyGraph;
  if (!edges || edges.length === 0) return "";

  const lines = ["## Dependency Graph", ""];
  for (const edge of edges) {
    const devOnly = edge.isDevOnly ? " (dev)" : "";
    lines.push(`- ${edge.from} \u2192 ${edge.to}${devOnly}`);
  }
  return lines.join("\n");
}

function formatMermaidDiagram(analysis: StructuredAnalysis): string {
  const diagram = analysis.crossPackage?.mermaidDiagram;
  if (!diagram) return "";
  return `## Dependency Diagram\n\n${diagram}`;
}

/**
 * Generate a Team Knowledge section with contextual questions derived from the analysis.
 * The engine asks specific questions it knows are important but can't answer from code alone.
 */
function formatTeamKnowledge(analysis: StructuredAnalysis): string {
  const questions: string[] = [];
  const isMultiPackage = analysis.packages.length > 1;

  // Collect directories already covered by contribution patterns (don't ask redundant questions)
  const coveredDirs = new Set<string>();
  for (const pkg of analysis.packages) {
    for (const cp of pkg.contributionPatterns ?? []) {
      coveredDirs.add(cp.directory.replace(/\/$/, ""));
    }
  }

  for (const pkg of analysis.packages) {
    // Directories with multiple files suggest extensible patterns — skip if already covered
    for (const dir of pkg.architecture.directories) {
      if (dir.fileCount >= 5 && questions.length < MAX_TEAM_KNOWLEDGE_QUESTIONS) {
        if (coveredDirs.has(dir.path)) continue; // Already answered in "How to Add New Code"
        const label = dir.purpose.replace(/^Feature:\s*/i, "").toLowerCase();
        questions.push(
          `\`${dir.path}/\` has ${dir.fileCount} ${label} files. What's the process for adding a new one?`,
        );
        break; // One directory question is enough
      }
    }

    // Call graph complexity suggests coupling concerns
    if (pkg.callGraph && pkg.callGraph.length > 10) {
      questions.push(
        `The codebase has ${pkg.callGraph.length} cross-file call relationships. Are there changes that require updating multiple files together?`,
      );
    }

    // CLI tools have usage conventions
    if (pkg.architecture.packageType === "cli") {
      questions.push(
        "Are there CLI-specific behaviors, flags, or output formats that AI tools should know about?",
      );
    }

    // No CONTRIBUTING.md
    if (pkg.existingDocs && !pkg.existingDocs.hasContributing) {
      questions.push(
        "What's the contribution workflow? (branch naming, commit conventions, PR process, review requirements)",
      );
    }

    // Environment variables detected
    if (pkg.configAnalysis?.envVars && pkg.configAnalysis.envVars.length > 0) {
      questions.push(
        `${pkg.configAnalysis.envVars.length} environment variables detected. Which are required for local development vs. production?`,
      );
    }
  }

  // Multi-package questions
  if (isMultiPackage) {
    questions.push(
      "What's the dependency relationship between packages? Which should be built first?",
    );
  }

  // Multiple commands suggest ordering concerns
  const pkg = analysis.packages[0];
  if (pkg) {
    const cmdCount = [pkg.commands.build, pkg.commands.test, pkg.commands.lint, pkg.commands.start]
      .filter(Boolean).length;
    if (cmdCount >= 3) {
      questions.push(
        "Are there ordering requirements between commands? (e.g., build before test, lint before commit)",
      );
    }
  }

  // Test framework detected — ask about testing philosophy
  const hasTestConvention = analysis.packages.some((p) =>
    p.conventions.some((c) => c.category === "testing"),
  );
  if (hasTestConvention) {
    questions.push(
      "What's the testing philosophy? (unit vs integration, what needs tests, coverage expectations)",
    );
  }

  // Cap at max
  const selected = questions.slice(0, MAX_TEAM_KNOWLEDGE_QUESTIONS);

  if (selected.length === 0) {
    return `## Team Knowledge\n_Add project-specific context here — deployment quirks, review conventions, and decisions AI tools wouldn't know from code alone._`;
  }

  const lines = ["## Team Knowledge", ""];
  lines.push("_autodocs-engine detected these patterns but needs your input:_");
  lines.push("");
  for (const q of selected) {
    lines.push(`- [ ] ${q}`);
  }
  lines.push("");
  lines.push("_Replace the checkboxes above with your answers to help AI tools understand this project._");
  return lines.join("\n");
}

// ─── Deterministic Architecture Fallback ─────────────────────────────────────

/**
 * Generate a deterministic architecture section when no LLM is available.
 * Uses directory purposes and export names to describe capabilities.
 */
export function formatArchitectureFallback(pkg: PackageAnalysis): string {
  const lines = ["## Architecture", ""];
  lines.push(`**Type:** ${pkg.architecture.packageType}`);
  lines.push(`**Entry point:** \`${pkg.architecture.entryPoint}\``);
  lines.push("");

  for (const dir of pkg.architecture.directories) {
    if (dir.exports && dir.exports.length > 0) {
      const exportList = dir.exports.length <= 5
        ? dir.exports.join(", ")
        : `${dir.exports.slice(0, 5).join(", ")} (+${dir.exports.length - 5} more)`;
      lines.push(`- **${dir.purpose}** (\`${dir.path}/\`): ${exportList}`);
    } else {
      lines.push(`- **${dir.purpose}** (\`${dir.path}/\`, ${dir.fileCount} files)`);
    }
  }

  return lines.join("\n");
}

// ─── Per-Package Deterministic Output (for hierarchical mode) ────────────────

/**
 * Generate deterministic AGENTS.md for a single package in hierarchical mode.
 * Creates a standalone package detail file.
 */
export function generatePackageDeterministicAgentsMd(
  pkg: PackageAnalysis,
): DeterministicOutput {
  // Wrap in a minimal StructuredAnalysis for reuse of formatters
  const singleAnalysis: StructuredAnalysis = {
    meta: { engineVersion: ENGINE_VERSION, analyzedAt: "", rootDir: ".", config: {} as any, timingMs: 0 },
    packages: [pkg],
    warnings: [],
  };

  return {
    title: `# ${pkg.name}`,
    summary: pkg.role?.summary ?? pkg.description ?? `TypeScript package: ${pkg.name}`,
    techStack: formatTechStack(singleAnalysis),
    commands: formatCommands(singleAnalysis),
    packageGuide: "",  // Not applicable for single package
    workflowRules: "",  // Root-level only
    howToAddCode: formatContributionPatterns(singleAnalysis),
    publicAPI: formatPublicAPI(singleAnalysis),
    dependencies: formatDependencies(singleAnalysis),
    conventions: formatConventions(singleAnalysis),
    changeImpact: formatChangeImpact(singleAnalysis),
    supportedFrameworks: formatSupportedFrameworks(singleAnalysis),
    dependencyGraph: "",  // Root-level only
    mermaidDiagram: "",   // Root-level only
    teamKnowledge: "",    // Root-level only
    architecture: "",
    domainTerminology: "",
    contributingGuidelines: "",
  };
}

