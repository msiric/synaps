// src/llm/client.ts — HTTP client for LLM API calls
// Split from llm-adapter.ts (W5-B1)

import type { ResolvedConfig } from "../types.js";
import { LLMError } from "../types.js";

interface AnthropicResponse {
  content?: { type?: string; text?: string }[];
}

/**
 * Call LLM API with automatic retry (1 retry after 2s delay).
 */
export async function callLLMWithRetry(
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
        temperature: 0,
      }),
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // Truncate error body to avoid leaking sensitive data in logs
      const safeBody = body.slice(0, 200);
      throw new LLMError(
        `LLM API returned ${response.status}: ${safeBody}`,
        response.status,
      );
    }

    const data: AnthropicResponse = await response.json();
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
