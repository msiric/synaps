// src/llm/hierarchical.ts — Multi-file hierarchical output
// Split from llm-adapter.ts (W5-B1)

import type { StructuredAnalysis, ResolvedConfig } from "../types.js";
import { LLMError } from "../types.js";
import {
  agentsMdMultiRootTemplate,
  agentsMdPackageDetailTemplate,
} from "../templates/agents-md.js";
import { callLLMWithRetry } from "./client.js";
import { serializeToMarkdown, serializePackageToMarkdown } from "./serializer.js";
import { validateAndCorrect, synthesizeArchitecture, synthesizeDomainTerms, synthesizeContributingRules } from "./adapter.js";
import {
  generateDeterministicAgentsMd,
  generatePackageDeterministicAgentsMd,
  assembleFinalOutput,
  formatArchitectureFallback,
} from "../deterministic-formatter.js";
import { extractReadmeContext, extractContributingContext } from "../existing-docs.js";

export interface HierarchicalOutput {
  root: string;
  packages: { filename: string; content: string }[];
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

  const rootPrompt = `<instructions>
${rootTemplate.formatInstructions}${filenameHint}
</instructions>

<analysis>
${rootSerialized}
</analysis>

Generate the AGENTS.md now. Use ONLY data from the <analysis> section. Do NOT add technologies, frameworks, runtimes, or version numbers that are not explicitly present in <analysis>.`;
  const rawRoot = await callLLMWithRetry(rootTemplate.systemPrompt, rootPrompt, config.llm);
  // W2-1: Validate root output
  const rootContent = await validateAndCorrect(rawRoot, analysis, "root", rootTemplate.systemPrompt, config.llm);

  // Generate per-package detail files (can be parallelized)
  const packagePromises = analysis.packages.map(async (pkg) => {
    const pkgSerialized = serializePackageToMarkdown(pkg);
    const pkgTemplate = agentsMdPackageDetailTemplate;
    const pkgPrompt = `<instructions>
${pkgTemplate.formatInstructions}
</instructions>

<analysis>
${pkgSerialized}
</analysis>

Generate the package detail file now. Use ONLY data from the <analysis> section. Do NOT add technologies, frameworks, runtimes, or version numbers that are not explicitly present in <analysis>.`;
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

/**
 * Format hierarchical output using deterministic code for sections + micro-LLM for synthesis.
 * Generates root AGENTS.md + per-package detail files without full LLM calls.
 */
export async function formatHierarchicalDeterministic(
  analysis: StructuredAnalysis,
  config: Pick<ResolvedConfig, "output" | "llm">,
): Promise<HierarchicalOutput> {
  // Root AGENTS.md — deterministic sections
  const rootDeterministic = generateDeterministicAgentsMd(analysis);

  // Doc context for LLM synthesis
  const pkgDir = analysis.packages[0]?.relativePath ?? ".";
  const readmeContext = extractReadmeContext(pkgDir, analysis.meta.rootDir);
  const contributingContext = extractContributingContext(pkgDir, analysis.meta.rootDir);

  // Micro-LLM calls for root architecture + domain + contributing (if API key available)
  let rootArchitecture: string;
  let rootDomain: string;
  let rootContributing: string;

  if (config.llm.apiKey) {
    const [archResult, domainResult, contributingResult] = await Promise.all([
      synthesizeArchitecture(analysis.packages[0], config.llm),
      synthesizeDomainTerms(readmeContext, config.llm),
      synthesizeContributingRules(contributingContext, config.llm),
    ]);
    rootArchitecture = archResult;
    rootDomain = domainResult;
    rootContributing = contributingResult;
  } else {
    rootArchitecture = formatArchitectureFallback(analysis.packages[0]);
    rootDomain = "";
    rootContributing = "";
  }

  const rootContent = assembleFinalOutput(rootDeterministic, rootArchitecture, rootDomain, rootContributing);

  // Per-package detail files — deterministic + micro-LLM architecture per package
  const packagePromises = analysis.packages.map(async (pkg) => {
    const pkgDeterministic = generatePackageDeterministicAgentsMd(pkg);

    let pkgArchitecture: string;
    if (config.llm.apiKey) {
      pkgArchitecture = await synthesizeArchitecture(pkg, config.llm);
    } else {
      pkgArchitecture = formatArchitectureFallback(pkg);
    }

    const content = assembleFinalOutput(pkgDeterministic, pkgArchitecture, "");
    return {
      filename: toPackageFilename(pkg.name),
      content,
    };
  });

  const packages = await Promise.all(packagePromises);

  return { root: rootContent, packages };
}

/**
 * Convert a package name to a safe filename.
 * @scope/my-package-name -> my-package-name.md
 */
export function toPackageFilename(name: string): string {
  return name
    .replace(/^@[^/]+\//, "") // Strip scope
    .replace(/[^a-z0-9-]/gi, "-") // Replace unsafe chars
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, "") // Trim dashes
    + ".md";
}
