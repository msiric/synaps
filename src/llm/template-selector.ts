// src/llm/template-selector.ts — Pick template for output format
// Split from llm-adapter.ts (W5-B1)

import {
  agentsMdSingleTemplate,
  agentsMdMultiTemplate,
} from "../templates/agents-md.js";
import { claudeMdTemplate } from "../templates/claude-md.js";
import { cursorrulesTemplate } from "../templates/cursorrules.js";

/**
 * Get the appropriate template for a given output format.
 */
export function getTemplate(
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
