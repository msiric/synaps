// src/llm-adapter.ts — Module 10: LLM Adapter
// Errata applied: E-33 (AbortController timeout), E-34 (sanitize values),
//                 E-35 (cross-package in serialization), E-36 (retry semantics)
// Updated: hierarchical output support, impact classification in serialization

import type { StructuredAnalysis, ResolvedConfig, PackageAnalysis } from "./types.js";
import { LLMError } from "./types.js";
import { validateOutput } from "./output-validator.js";
import {
  agentsMdSingleTemplate,
  agentsMdMultiTemplate,
  agentsMdMultiRootTemplate,
  agentsMdPackageDetailTemplate,
} from "./templates/agents-md.js";
import { claudeMdTemplate } from "./templates/claude-md.js";
import { cursorrulesTemplate } from "./templates/cursorrules.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HierarchicalOutput {
  root: string;
  packages: { filename: string; content: string }[];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Format a StructuredAnalysis into a single context file via LLM.
 * For "json" format, returns JSON.stringify directly (no LLM call).
 */
export async function formatWithLLM(
  analysis: StructuredAnalysis,
  config: Pick<ResolvedConfig, "output" | "llm">,
): Promise<string> {
  if (config.output.format === "json") {
    return JSON.stringify(analysis, mapReplacer, 2);
  }

  const serialized = serializeToMarkdown(analysis);
  const isMultiPackage = analysis.packages.length > 1;
  const template = getTemplate(config.output.format, isMultiPackage);

  const systemPrompt = template.systemPrompt;
  const userPrompt = `${template.formatInstructions}\n\n---\n\n${serialized}`;

  const apiKey = config.llm.apiKey;
  if (!apiKey) {
    throw new LLMError("No API key provided. Set ANTHROPIC_API_KEY or use --format json.");
  }

  // W2-1: Generate, validate, optionally retry once with corrections
  const output = await callLLMWithRetry(systemPrompt, userPrompt, config.llm);
  return validateAndCorrect(output, analysis, "root", template.systemPrompt, config.llm);
}

/**
 * Format a StructuredAnalysis into hierarchical output: root AGENTS.md + per-package detail files.
 * Only applicable when format is "agents.md" and there are multiple packages.
 */
export async function formatHierarchical(
  analysis: StructuredAnalysis,
  config: Pick<ResolvedConfig, "output" | "llm">,
): Promise<HierarchicalOutput> {
  const apiKey = config.llm.apiKey;
  if (!apiKey) {
    throw new LLMError("No API key provided. Set ANTHROPIC_API_KEY or use --format json.");
  }

  // Generate root AGENTS.md with lean multi-package template
  const rootSerialized = serializeToMarkdown(analysis);
  const rootTemplate = agentsMdMultiRootTemplate;

  // Build package detail filename list for root template to reference
  const packageFilenames = analysis.packages.map((pkg) => ({
    name: pkg.name,
    filename: toPackageFilename(pkg.name),
  }));

  const filenameHint = `\n\nPackage detail files will be at:\n${packageFilenames.map((p) => `- packages/${p.filename}`).join("\n")}`;

  const rootPrompt = `${rootTemplate.formatInstructions}${filenameHint}\n\n---\n\n${rootSerialized}`;
  const rawRoot = await callLLMWithRetry(rootTemplate.systemPrompt, rootPrompt, config.llm);
  // W2-1: Validate root output
  const rootContent = await validateAndCorrect(rawRoot, analysis, "root", rootTemplate.systemPrompt, config.llm);

  // Generate per-package detail files (can be parallelized)
  const packagePromises = analysis.packages.map(async (pkg) => {
    const pkgSerialized = serializePackageToMarkdown(pkg);
    const pkgTemplate = agentsMdPackageDetailTemplate;
    const pkgPrompt = `${pkgTemplate.formatInstructions}\n\n---\n\n${pkgSerialized}`;
    const rawContent = await callLLMWithRetry(pkgTemplate.systemPrompt, pkgPrompt, config.llm);
    // W2-1: Validate per-package output
    const content = await validateAndCorrect(rawContent, pkg, "package-detail", pkgTemplate.systemPrompt, config.llm);
    return {
      filename: toPackageFilename(pkg.name),
      content,
    };
  });

  const packages = await Promise.all(packagePromises);

  return { root: rootContent, packages };
}

// ─── LLM Call ───────────────────────────────────────────────────────────────

async function callLLMWithRetry(
  systemPrompt: string,
  userPrompt: string,
  llmConfig: ResolvedConfig["llm"],
): Promise<string> {
  try {
    return await callLLM(systemPrompt, userPrompt, llmConfig);
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      return await callLLM(systemPrompt, userPrompt, llmConfig);
    } catch (retryErr) {
      throw new LLMError(
        `LLM API failed after retry: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      );
    }
  }
}

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  llmConfig: ResolvedConfig["llm"],
): Promise<string> {
  const baseUrl = llmConfig.baseUrl ?? "https://api.anthropic.com";
  const url = `${baseUrl}/v1/messages`;

  // E-33: AbortController timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": llmConfig.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: llmConfig.model,
        max_tokens: llmConfig.maxOutputTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new LLMError(
        `LLM API returned ${response.status}: ${body}`,
        response.status,
      );
    }

    const data = (await response.json()) as any;
    const text = data?.content?.[0]?.text;
    if (!text) {
      throw new LLMError("LLM response missing content text");
    }
    return text;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof LLMError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new LLMError("LLM API request timed out after 120s");
    }
    throw err;
  }
}

// ─── W2-1: Validation + Correction ──────────────────────────────────────────

/**
 * Validate LLM output against analysis. If errors found, retry once with corrections.
 * Maximum 1 retry (2x cost per file cap).
 */
async function validateAndCorrect(
  output: string,
  analysis: StructuredAnalysis | PackageAnalysis,
  format: "root" | "package-detail",
  systemPrompt: string,
  llmConfig: ResolvedConfig["llm"],
): Promise<string> {
  const validation = validateOutput(output, analysis, format);

  if (validation.isValid || !validation.correctionPrompt) {
    // Log warnings to stderr
    for (const issue of validation.issues) {
      if (issue.severity === "warning") {
        process.stderr.write(`[WARN] output-validator: ${issue.message}\n`);
      }
    }
    return output;
  }

  // Log issues before retry
  for (const issue of validation.issues) {
    process.stderr.write(`[${issue.severity.toUpperCase()}] output-validator: ${issue.message}\n`);
  }
  process.stderr.write(`[INFO] output-validator: Retrying with ${validation.issues.filter((i) => i.severity === "error").length} correction(s)...\n`);

  // One targeted retry
  try {
    const corrected = await callLLMWithRetry(systemPrompt, validation.correctionPrompt, llmConfig);

    // Validate again but don't retry further
    const revalidation = validateOutput(corrected, analysis, format);
    if (!revalidation.isValid) {
      for (const issue of revalidation.issues) {
        process.stderr.write(`[WARN] output-validator (post-retry): ${issue.message}\n`);
      }
    }
    return corrected;
  } catch {
    // If retry fails, return original output
    process.stderr.write(`[WARN] output-validator: Correction retry failed, using original output\n`);
    return output;
  }
}

// ─── Serialization ──────────────────────────────────────────────────────────

// E-34: Sanitize values before interpolation
function sanitize(s: string, maxLen = 500): string {
  return s.replace(/\n/g, " ").replace(/`/g, "'").slice(0, maxLen);
}

/**
 * Serialize a single package's analysis to markdown (for per-package LLM calls).
 */
function serializePackageToMarkdown(pkg: PackageAnalysis): string {
  const lines: string[] = [];
  serializePackage(pkg, lines);
  return lines.join("\n");
}

/**
 * Serialize the full StructuredAnalysis to markdown for LLM consumption.
 */
function serializeToMarkdown(analysis: StructuredAnalysis): string {
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
        lines.push(`- ${edge.from} → ${edge.to}`);
      }
      lines.push("");
    }

    if (analysis.crossPackage.sharedConventions.length > 0) {
      lines.push("## Shared Conventions (apply to ALL packages)");
      for (const conv of analysis.crossPackage.sharedConventions) {
        const impact = conv.impact ? ` [impact: ${conv.impact}]` : "";
        const examples = conv.examples.length > 0
          ? ` (e.g., ${conv.examples.slice(0, 2).map((e) => `\`${sanitize(e, 80)}\``).join(", ")})`
          : "";
        // W3-4: No confidence stats in cross-package conventions either
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
        lines.push(`- **${ap.rule}** [${ap.confidence}]${impact} — ${sanitize(ap.reason)}`);
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
        lines.push(`- ${rule.trigger} → ${rule.action}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Serialize a single package into markdown lines (shared between full and per-package serialization).
 */
function serializePackage(pkg: PackageAnalysis, lines: string[]): void {
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
      const desc = entry.description ? ` — ${sanitize(entry.description)}` : "";
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
    // W3-4: Strip percentage/count stats from confidence description
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
      // Show named implementations prominently
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
    lines.push("Key function relationships (caller → callee):");
    for (const edge of pkg.callGraph.slice(0, 30)) {
      lines.push(`- ${edge.from} → ${edge.to} (${edge.fromFile} → ${edge.toFile})`);
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
      lines.push(`- **${ap.rule}** [${ap.confidence}]${impact} — ${sanitize(ap.reason)}`);
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
        const guidance = fw.guidance ? ` — ${fw.guidance}` : "";
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

  lines.push("## Dependencies");
  lines.push(`Internal: ${pkg.dependencies.internal.join(", ") || "none"}`);
  for (const dep of pkg.dependencies.external.slice(0, 10)) {
    lines.push(`- ${dep.name}: ${dep.importCount} imports`);
  }
  lines.push("");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTemplate(
  format: string,
  isMultiPackage: boolean = false,
): { systemPrompt: string; formatInstructions: string } {
  switch (format) {
    case "agents.md":
      return isMultiPackage ? agentsMdMultiTemplate : agentsMdSingleTemplate;
    case "claude.md":
      return claudeMdTemplate;
    case "cursorrules":
      return cursorrulesTemplate;
    default:
      return isMultiPackage ? agentsMdMultiTemplate : agentsMdSingleTemplate;
  }
}

/**
 * Convert a package name to a safe filename.
 * @scope/my-package-name → my-package-name.md
 */
function toPackageFilename(name: string): string {
  return name
    .replace(/^@[^/]+\//, "") // Strip scope
    .replace(/[^a-z0-9-]/gi, "-") // Replace unsafe chars
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, "") // Trim dashes
    + ".md";
}

function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}
