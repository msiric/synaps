import { describe, it, expect } from "vitest";
import {
  classifyConventionImpact,
  classifyAntiPatternImpact,
  classifyImpacts,
  isStyleRule,
} from "../src/impact-classifier.js";
import type { Convention, AntiPattern, ConventionConfidence } from "../src/types.js";

function makeConvention(
  overrides: Partial<Convention> & { category: Convention["category"]; name: string; description?: string },
): Convention {
  const conf: ConventionConfidence = { matched: 10, total: 10, percentage: 100, description: "10 of 10 (100%)" };
  return {
    category: overrides.category,
    name: overrides.name,
    description: overrides.description ?? "test convention",
    confidence: overrides.confidence ?? conf,
    examples: overrides.examples ?? [],
    ...overrides,
  };
}

function makeAntiPattern(overrides: Partial<AntiPattern> & { rule: string }): AntiPattern {
  return {
    rule: overrides.rule,
    reason: overrides.reason ?? "test reason",
    confidence: overrides.confidence ?? "high",
    derivedFrom: overrides.derivedFrom ?? "test",
    ...overrides,
  };
}

describe("impact-classifier", () => {
  describe("classifyConventionImpact", () => {
    it("classifies file-naming as low impact", () => {
      const conv = makeConvention({ category: "file-naming", name: "kebab-case filenames" });
      expect(classifyConventionImpact(conv)).toBe("low");
    });

    it("classifies testing as high impact", () => {
      const conv = makeConvention({ category: "testing", name: "co-located tests" });
      expect(classifyConventionImpact(conv)).toBe("high");
    });

    it("classifies ecosystem as high impact", () => {
      const conv = makeConvention({ category: "ecosystem", name: "TanStack Query data fetching" });
      expect(classifyConventionImpact(conv)).toBe("high");
    });

    it("classifies hooks as medium impact", () => {
      const conv = makeConvention({ category: "hooks", name: "hooks return objects" });
      expect(classifyConventionImpact(conv)).toBe("medium");
    });

    it("detects style patterns in name/description and overrides category", () => {
      // A testing convention that mentions kebab-case → still low due to style pattern
      const conv = makeConvention({
        category: "testing",
        name: "test file kebab-case naming",
        description: "Test files use kebab-case names",
      });
      expect(classifyConventionImpact(conv)).toBe("low");
    });

    it("detects 'named exports' as style pattern", () => {
      const conv = makeConvention({
        category: "hooks",
        name: "named exports only",
        description: "All hooks use named exports",
      });
      expect(classifyConventionImpact(conv)).toBe("low");
    });
  });

  describe("classifyAntiPatternImpact", () => {
    it("classifies style anti-patterns as low", () => {
      const ap = makeAntiPattern({
        rule: "Do NOT use default exports",
        reason: "All files use named exports",
      });
      expect(classifyAntiPatternImpact(ap)).toBe("low");
    });

    it("classifies test-related anti-patterns as high", () => {
      const ap = makeAntiPattern({
        rule: "Do NOT put tests in __tests__ directory",
        reason: "Co-locate tests with source",
      });
      expect(classifyAntiPatternImpact(ap)).toBe("high");
    });

    it("classifies kebab-case anti-patterns as low", () => {
      const ap = makeAntiPattern({
        rule: "Do NOT use camelCase for filenames",
        reason: "All files use kebab-case",
      });
      expect(classifyAntiPatternImpact(ap)).toBe("low");
    });

    it("classifies generic anti-patterns as medium", () => {
      const ap = makeAntiPattern({
        rule: "Do NOT return arrays from hooks",
        reason: "Use objects for named fields",
      });
      expect(classifyAntiPatternImpact(ap)).toBe("medium");
    });
  });

  describe("classifyImpacts", () => {
    it("applies impact to all conventions and anti-patterns", () => {
      const conventions = [
        makeConvention({ category: "file-naming", name: "kebab-case" }),
        makeConvention({ category: "testing", name: "co-located tests" }),
      ];
      const antiPatterns = [
        makeAntiPattern({ rule: "No default exports" }),
      ];

      const result = classifyImpacts(conventions, antiPatterns);

      expect(result.conventions[0].impact).toBe("low");
      expect(result.conventions[1].impact).toBe("high");
      expect(result.antiPatterns[0].impact).toBe("low");
    });

    it("does not override existing impact", () => {
      const conventions = [
        { ...makeConvention({ category: "file-naming", name: "kebab-case" }), impact: "high" as const },
      ];

      const result = classifyImpacts(conventions, []);
      expect(result.conventions[0].impact).toBe("high");
    });
  });

  describe("isStyleRule", () => {
    it("detects kebab-case as style", () => {
      expect(isStyleRule("Use kebab-case for filenames")).toBe(true);
    });

    it("detects named exports as style", () => {
      expect(isStyleRule("Always use named exports")).toBe(true);
    });

    it("detects import ordering as style", () => {
      expect(isStyleRule("Sort imports alphabetically")).toBe(true);
    });

    it("does not flag non-style rules", () => {
      expect(isStyleRule("Run yarn test:unit before committing")).toBe(false);
    });

    it("does not flag workflow rules", () => {
      expect(isStyleRule("After modifying .graphql files, run yarn generate:interfaces")).toBe(false);
    });
  });
});
