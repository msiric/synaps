// src/impact-classifier.ts — Rule Impact Classification
// Classifies conventions and anti-patterns by what AI tools reliably follow.
// Based on user research: commands/workflows = high, architecture = medium, style = low.

import type { Convention, AntiPattern, RuleImpact, ConventionCategory } from "./types.js";

// W5-A: Simplified after removing noisy detector categories
// Categories that represent style rules (linter's job, AI follows unreliably)
const LOW_IMPACT_CATEGORIES: Set<ConventionCategory> = new Set([
  "file-naming",
]);

// Categories that represent workflow rules (AI follows reliably)
const HIGH_IMPACT_CATEGORIES: Set<ConventionCategory> = new Set([
  "testing",
  "ecosystem",
]);

// Pattern-based detection for style rules regardless of category
const STYLE_PATTERNS = [
  /kebab[- ]?case/i,
  /camel[- ]?case/i,
  /pascal[- ]?case/i,
  /named exports?/i,
  /default exports?/i,
  /barrel exports?/i,
  /semicolons?/i,
  /trailing comma/i,
  /single quotes?/i,
  /double quotes?/i,
  /file.?naming/i,
  /import order/i,
  /import style/i,
  /sort.?imports/i,
];

/**
 * Classify the impact of a convention based on its category and content.
 */
export function classifyConventionImpact(convention: Convention): RuleImpact {
  // Check for style patterns first (overrides category)
  const text = `${convention.name} ${convention.description}`;
  if (STYLE_PATTERNS.some((p) => p.test(text))) {
    return "low";
  }

  if (HIGH_IMPACT_CATEGORIES.has(convention.category)) {
    return "high";
  }

  if (LOW_IMPACT_CATEGORIES.has(convention.category)) {
    return "low";
  }

  // Remaining categories: hooks
  return "medium";
}

/**
 * Classify the impact of an anti-pattern.
 * Anti-patterns derived from style conventions are low impact.
 * Anti-patterns about workflows or architecture are high/medium.
 */
export function classifyAntiPatternImpact(antiPattern: AntiPattern): RuleImpact {
  const text = `${antiPattern.rule} ${antiPattern.reason}`;

  // Style-related anti-patterns
  if (STYLE_PATTERNS.some((p) => p.test(text))) {
    return "low";
  }

  // Workflow-related anti-patterns (high)
  if (/test|security|never commit/i.test(text)) {
    return "high";
  }

  return "medium";
}

/**
 * Apply impact classification to all conventions and anti-patterns in a package.
 */
export function classifyImpacts(
  conventions: Convention[],
  antiPatterns: AntiPattern[],
): { conventions: Convention[]; antiPatterns: AntiPattern[] } {
  return {
    conventions: conventions.map((c) => ({
      ...c,
      impact: c.impact ?? classifyConventionImpact(c),
    })),
    antiPatterns: antiPatterns.map((ap) => ({
      ...ap,
      impact: ap.impact ?? classifyAntiPatternImpact(ap),
    })),
  };
}

/**
 * Check if a line of text represents a style rule (should be enforced by linter).
 */
export function isStyleRule(text: string): boolean {
  return STYLE_PATTERNS.some((p) => p.test(text));
}
