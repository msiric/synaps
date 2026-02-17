import { describe, it, expect } from "vitest";
import { validateBudget, formatBudgetReport } from "../src/budget-validator.js";

describe("budget-validator", () => {
  describe("validateBudget", () => {
    it("counts actionable rules from bullet points", () => {
      const content = [
        "# My Package",
        "",
        "- Use TypeScript strict mode",
        "- Run `yarn test` before committing",
        "- After modifying .graphql files, run `yarn generate:interfaces`",
        "",
        "## Commands",
        "",
        "| Command | Action |",
        "|---------|--------|",
        "| `yarn test` | Run tests |",
        "| `yarn build` | Build package |",
      ].join("\n");

      const report = validateBudget(content);
      expect(report.ruleCount).toBeGreaterThan(0);
      expect(report.lineCount).toBe(12);
      expect(report.overBudget).toBe(false);
    });

    it("detects style rules", () => {
      const content = [
        "# Rules",
        "- Use kebab-case for all filenames",
        "- Always use named exports",
        "- Run tests before committing",
      ].join("\n");

      const report = validateBudget(content);
      expect(report.styleRules.length).toBe(2);
      expect(report.styleRules[0].text).toContain("kebab-case");
      expect(report.styleRules[1].text).toContain("named exports");
    });

    it("warns when over budget", () => {
      // Generate >120 rules (W5-B2: MAX_RULES increased to 120)
      const rules = Array.from({ length: 130 }, (_, i) =>
        `- Use feature-${i} for all operations`,
      );
      const content = ["# Package", ...rules].join("\n");

      const report = validateBudget(content);
      expect(report.overBudget).toBe(true);
      expect(report.summary).toContain("WARNING");
      expect(report.budgetPercentage).toBeGreaterThan(100);
    });

    it("reports 0 rules for empty content", () => {
      const report = validateBudget("");
      expect(report.ruleCount).toBe(0);
      expect(report.lineCount).toBe(1); // split("") gives [""]
      expect(report.overBudget).toBe(false);
    });

    it("ignores non-actionable lines", () => {
      const content = [
        "# Header",
        "",
        "Some explanatory text about the package.",
        "",
        "> A blockquote with context",
        "",
        "_Placeholder text for human additions_",
        "",
        "---",
      ].join("\n");

      const report = validateBudget(content);
      expect(report.ruleCount).toBe(0);
    });

    it("counts table data rows as rules", () => {
      const content = [
        "| Command | Action |",
        "|---------|--------|",
        "| `yarn test` | Run tests |",
        "| `yarn build` | Build |",
        "| `yarn lint` | Lint code |",
      ].join("\n");

      const report = validateBudget(content);
      // Header + 3 data rows counted, separator excluded
      expect(report.ruleCount).toBe(4);
    });
  });

  describe("formatBudgetReport", () => {
    it("formats basic report", () => {
      const report = validateBudget("- Use TypeScript\n- Run tests");
      const formatted = formatBudgetReport(report);
      expect(formatted).toContain("[BUDGET]");
      expect(formatted).toContain("lines");
      expect(formatted).toContain("rules");
    });

    it("includes style rule suggestions when present", () => {
      const report = validateBudget("- Use kebab-case for filenames");
      const formatted = formatBudgetReport(report);
      expect(formatted).toContain("linter");
      expect(formatted).toContain("kebab-case");
    });

    it("includes over-budget warning", () => {
      const rules = Array.from({ length: 130 }, (_, i) =>
        `- Use feature-${i} for all operations`,
      );
      const report = validateBudget(["# Pkg", ...rules].join("\n"));
      const formatted = formatBudgetReport(report);
      expect(formatted).toContain("Over budget");
    });
  });
});
