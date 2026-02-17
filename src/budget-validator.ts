// src/budget-validator.ts — Instruction Budget Validator
// After generation, counts rules and warns if the output exceeds the AI instruction budget.
// Research: AI tools follow ~150-200 instructions max. Claude system prompt uses ~50.
// Budget for AGENTS.md: ~100 actionable rules.

export interface BudgetReport {
  lineCount: number;
  ruleCount: number;
  budgetPercentage: number; // ruleCount / MAX_RULES * 100
  styleRules: StyleRuleWarning[];
  overBudget: boolean;
  summary: string;
}

export interface StyleRuleWarning {
  line: number;
  text: string;
  suggestion: string;
}

// W5-B2: Increased from 100 — modern LLMs handle 150+ instructions reliably
const MAX_RULES = 120;

// Patterns that indicate an actionable rule/instruction line
const RULE_PATTERNS = [
  /^[-*]\s+\*?\*?(?:Do|Use|After|When|Always|Never|Run|Create|Add|Set|Include|Ensure|Check|Avoid)/i,
  /^[-*]\s+`[a-z]/i, // Bullet with a command
  /^\|\s*[^|]+\s*\|/, // Table row (non-header)
  /^#{1,4}\s+(?:DO|DO NOT|Rules)/i, // Section headers that are directive
];

// Patterns that indicate a style rule (should be handled by linter)
const STYLE_PATTERNS = [
  { pattern: /kebab[- ]?case/i, suggestion: "Enforce via ESLint naming convention rule" },
  { pattern: /camel[- ]?case/i, suggestion: "Enforce via ESLint naming convention rule" },
  { pattern: /pascal[- ]?case/i, suggestion: "Enforce via ESLint naming convention rule" },
  { pattern: /named exports?/i, suggestion: "Enforce via eslint-plugin-import no-default-export rule" },
  { pattern: /default exports?/i, suggestion: "Enforce via eslint-plugin-import no-default-export rule" },
  { pattern: /barrel exports?/i, suggestion: "Enforce via eslint-plugin-import no-internal-modules rule" },
  { pattern: /semicolons?\b/i, suggestion: "Enforce via Prettier or ESLint semi rule" },
  { pattern: /trailing comma/i, suggestion: "Enforce via Prettier trailingComma option" },
  { pattern: /single quotes?/i, suggestion: "Enforce via Prettier singleQuote option" },
  { pattern: /double quotes?/i, suggestion: "Enforce via Prettier singleQuote option" },
  { pattern: /import order/i, suggestion: "Enforce via eslint-plugin-import order rule" },
  { pattern: /import style/i, suggestion: "Enforce via eslint-plugin-import rules" },
  { pattern: /sort.?imports/i, suggestion: "Enforce via eslint-plugin-import order rule" },
  { pattern: /file.?naming/i, suggestion: "Enforce via eslint-plugin-unicorn filename-case rule" },
  { pattern: /indentation|indent with/i, suggestion: "Enforce via Prettier or ESLint indent rule" },
  { pattern: /line length|max.?len/i, suggestion: "Enforce via Prettier printWidth option" },
];

/**
 * Validate the instruction budget of generated content.
 * Returns a report with rule count, budget usage, and style rule warnings.
 */
export function validateBudget(content: string): BudgetReport {
  const lines = content.split("\n");
  const lineCount = lines.length;

  let ruleCount = 0;
  const styleRules: StyleRuleWarning[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Count actionable rules
    if (isActionableLine(line)) {
      ruleCount++;
    }

    // Detect style rules
    for (const { pattern, suggestion } of STYLE_PATTERNS) {
      if (pattern.test(line)) {
        styleRules.push({
          line: i + 1,
          text: line.slice(0, 120),
          suggestion,
        });
        break; // One warning per line
      }
    }
  }

  const budgetPercentage = Math.round((ruleCount / MAX_RULES) * 100);
  const overBudget = ruleCount > MAX_RULES;

  const parts: string[] = [
    `${lineCount} lines, ${ruleCount} actionable rules (${budgetPercentage}% of ${MAX_RULES} budget)`,
  ];

  if (overBudget) {
    parts.push(
      `WARNING: Exceeds instruction budget by ${ruleCount - MAX_RULES} rules. AI performance may degrade.`,
    );
  }

  if (styleRules.length > 0) {
    parts.push(
      `${styleRules.length} style rule(s) detected — consider moving to linter config.`,
    );
  }

  return {
    lineCount,
    ruleCount,
    budgetPercentage,
    styleRules,
    overBudget,
    summary: parts.join(" | "),
  };
}

/**
 * Check if a line represents an actionable instruction for AI.
 */
function isActionableLine(line: string): boolean {
  // Skip markdown headers, blank lines, horizontal rules, and pure-header table rows
  if (line.startsWith("#") && !/^#{1,4}\s+(?:DO|DO NOT)/i.test(line)) return false;
  if (line.startsWith("---") || line.startsWith("===")) return false;
  if (/^\|[\s:-]+(\|[\s:-]+)*\|$/.test(line)) return false; // Table separator row (multi-column)
  if (line.startsWith("_") && line.endsWith("_")) return false; // Italicized placeholder text
  if (line.startsWith(">")) return false; // Blockquotes (explanatory)

  return RULE_PATTERNS.some((p) => p.test(line));
}

/**
 * Format budget report for verbose console output.
 */
export function formatBudgetReport(report: BudgetReport): string {
  const lines: string[] = [];
  lines.push(`[BUDGET] ${report.summary}`);

  if (report.overBudget) {
    lines.push(`[BUDGET] ⚠ Over budget: ${report.ruleCount} rules exceeds max ${MAX_RULES}`);
  }

  if (report.styleRules.length > 0) {
    lines.push(`[BUDGET] Style rules that should be in linter config:`);
    for (const sr of report.styleRules.slice(0, 5)) {
      lines.push(`[BUDGET]   Line ${sr.line}: "${sr.text}" → ${sr.suggestion}`);
    }
    if (report.styleRules.length > 5) {
      lines.push(`[BUDGET]   ... and ${report.styleRules.length - 5} more`);
    }
  }

  return lines.join("\n");
}
