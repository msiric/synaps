// src/llm/adapter.ts — Orchestration: serialize -> call LLM -> validate -> output
// Split from llm-adapter.ts (W5-B1)

import type { StructuredAnalysis, ResolvedConfig, PackageAnalysis } from "../types.js";
import { LLMError } from "../types.js";
import { validateOutput } from "../output-validator.js";
import { callLLMWithRetry } from "./client.js";
import { serializeToMarkdown } from "./serializer.js";
import { getTemplate } from "./template-selector.js";
import {
  generateDeterministicAgentsMd,
  assembleFinalOutput,
  formatArchitectureFallback,
} from "../deterministic-formatter.js";
import { extractReadmeContext } from "../existing-docs.js";

// Note: formatHierarchical and HierarchicalOutput are re-exported from the
// barrel (src/llm-adapter.ts) via hierarchical.ts, not through this module,
// to avoid circular dependencies.

function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

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
  const userPrompt = `<instructions>
${template.formatInstructions}
</instructions>

<analysis>
${serialized}
</analysis>

Generate the AGENTS.md now. Use ONLY data from the <analysis> section. Do NOT add technologies, frameworks, runtimes, or version numbers that are not explicitly present in <analysis>.`;

  const apiKey = config.llm.apiKey;
  if (!apiKey) {
    throw new LLMError("No API key provided. Set ANTHROPIC_API_KEY or use --format json.");
  }

  // W2-1: Generate, validate, optionally retry once with corrections
  const output = await callLLMWithRetry(systemPrompt, userPrompt, config.llm);
  return validateAndCorrect(output, analysis, "root", template.systemPrompt, config.llm);
}

// ---- W2-1: Validation + Correction ----

/**
 * Validate LLM output against analysis. If errors found, retry once with corrections.
 * Maximum 1 retry (2x cost per file cap).
 */
export async function validateAndCorrect(
  output: string,
  analysis: StructuredAnalysis | PackageAnalysis,
  format: "root" | "package-detail",
  systemPrompt: string,
  llmConfig: ResolvedConfig["llm"],
): Promise<string> {
  const validation = validateOutput(output, analysis, format);

  if (validation.isValid || !validation.correctionPrompt) {
    return output;
  }

  // One targeted retry
  try {
    const corrected = await callLLMWithRetry(systemPrompt, validation.correctionPrompt, llmConfig);
    return corrected;
  } catch {
    // If retry fails, return original output
    return output;
  }
}

// ---- Deterministic Formatting (70% code, 30% micro-LLM) ----

/**
 * Format a StructuredAnalysis using deterministic code for 13 sections
 * and micro-LLM calls for architecture + domain terminology.
 * This is the default mode for agents.md output.
 */
export async function formatDeterministic(
  analysis: StructuredAnalysis,
  config: Pick<ResolvedConfig, "output" | "llm">,
  rootDir?: string,
): Promise<string> {
  if (config.output.format === "json") {
    return JSON.stringify(analysis, mapReplacer, 2);
  }

  // Step 1: Deterministic sections (no LLM)
  const deterministic = generateDeterministicAgentsMd(analysis);

  // Step 2: README context for domain terminology
  const pkgDir = analysis.packages[0]?.relativePath ?? ".";
  const readmeContext = extractReadmeContext(pkgDir, rootDir);

  // Step 3: Micro-LLM calls for synthesis (small, constrained)
  let architectureSection: string;
  let domainSection: string;

  if (config.llm.apiKey) {
    // Parallel micro-LLM calls
    const [archResult, domainResult] = await Promise.all([
      synthesizeArchitecture(analysis.packages[0], config.llm),
      synthesizeDomainTerms(readmeContext, config.llm),
    ]);
    architectureSection = archResult;
    domainSection = domainResult;
  } else {
    // No API key: use deterministic fallback
    architectureSection = formatArchitectureFallback(analysis.packages[0]);
    domainSection = "";
  }

  // Step 4: Assemble final output
  return assembleFinalOutput(deterministic, architectureSection, domainSection);
}

/**
 * Generate ONLY the architecture section via a constrained micro-LLM call.
 * Input is limited to directory names, export names, and call graph edges.
 * The LLM cannot hallucinate technologies because it doesn't see them.
 */
export async function synthesizeArchitecture(
  pkg: PackageAnalysis,
  llmConfig: ResolvedConfig["llm"],
): Promise<string> {
  // Build constrained input — ONLY architecture data
  const input: string[] = [];
  input.push(`Package: ${pkg.name}`);
  input.push(`Type: ${pkg.architecture.packageType}`);
  input.push(`Entry: ${pkg.architecture.entryPoint}`);
  input.push("");
  input.push("Directories and their exports:");
  for (const dir of pkg.architecture.directories) {
    if (dir.exports?.length) {
      input.push(`  ${dir.purpose}: ${dir.exports.join(", ")}`);
    } else {
      input.push(`  ${dir.purpose}: ${dir.fileCount} files`);
    }
  }
  if (pkg.callGraph?.length) {
    input.push("");
    input.push("Key call relationships:");
    for (const edge of pkg.callGraph.slice(0, 10)) {
      input.push(`  ${edge.from} \u2192 ${edge.to}`);
    }
  }

  const systemPrompt = `You are writing 4-6 bullet points describing a TypeScript package's architecture.
Use ONLY the directory names, export names, and call relationships provided below.
Describe CAPABILITIES (what the code does), not file locations.
Do NOT mention any technology, framework, or library by name — only describe what the exports DO.
Output ONLY the bullet points, no headers or explanations.`;

  const userPrompt = input.join("\n");

  if (!llmConfig.apiKey) return formatArchitectureFallback(pkg);

  try {
    const result = await callLLMWithRetry(systemPrompt, userPrompt, {
      ...llmConfig,
      maxOutputTokens: 500,
    });
    return `## Architecture\n\n${result.trim()}`;
  } catch {
    return formatArchitectureFallback(pkg);
  }
}

/**
 * Generate domain terminology from README context.
 * Input is ONLY the README first paragraph — can't hallucinate technology stack.
 */
export async function synthesizeDomainTerms(
  readmeContext: string | undefined,
  llmConfig: ResolvedConfig["llm"],
): Promise<string> {
  if (!readmeContext || !llmConfig.apiKey) return "";

  const systemPrompt = `Extract 3-5 domain-specific terms from the project description below.
For each term, provide a one-line definition.
These are terms that an AI coding tool wouldn't know from reading source code alone.
Output as a markdown list. If no domain-specific terms are found, output nothing.`;

  try {
    const result = await callLLMWithRetry(systemPrompt, readmeContext, {
      ...llmConfig,
      maxOutputTokens: 300,
    });
    const trimmed = result.trim();
    return trimmed ? `## Domain Terminology\n\n${trimmed}` : "";
  } catch {
    return "";
  }
}
