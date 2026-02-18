// src/llm/adapter.ts — Orchestration: serialize -> call LLM -> validate -> output
// Split from llm-adapter.ts (W5-B1)

import type { StructuredAnalysis, ResolvedConfig, PackageAnalysis } from "../types.js";
import { LLMError } from "../types.js";
import { validateOutput } from "../output-validator.js";
import { callLLMWithRetry } from "./client.js";
import { serializeToMarkdown } from "./serializer.js";
import { getTemplate } from "./template-selector.js";

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
