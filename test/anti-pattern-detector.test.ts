import { describe, it, expect } from "vitest";
import { deriveAntiPatterns, deriveSharedAntiPatterns } from "../src/anti-pattern-detector.js";
import type { Convention } from "../src/types.js";

function makeConvention(overrides: Partial<Convention>): Convention {
  return {
    category: "file-naming",
    name: "kebab-case filenames",
    description: "Use kebab-case for filenames",
    confidence: {
      matched: 86,
      total: 86,
      percentage: 100,
      description: "86 of 86 files (100%)",
    },
    examples: ["use-create-tab.ts", "use-update-tab.ts"],
    ...overrides,
  };
}

describe("deriveAntiPatterns", () => {
  it("derives 'Do NOT use camelCase' from kebab-case convention at 99%", () => {
    const conventions = [
      makeConvention({
        category: "file-naming",
        name: "kebab-case filenames",
        confidence: { matched: 85, total: 86, percentage: 99, description: "85 of 86 (99%)" },
      }),
    ];

    const antiPatterns = deriveAntiPatterns(conventions);
    expect(antiPatterns).toHaveLength(1);
    expect(antiPatterns[0].rule).toContain("Do NOT use camelCase or PascalCase");
    expect(antiPatterns[0].confidence).toBe("high");
    expect(antiPatterns[0].derivedFrom).toBe("kebab-case filenames");
  });

  it("sets medium confidence for 80-94%", () => {
    const conventions = [
      makeConvention({
        category: "file-naming",
        name: "kebab-case filenames",
        confidence: { matched: 85, total: 100, percentage: 85, description: "85 of 100 (85%)" },
      }),
    ];

    const antiPatterns = deriveAntiPatterns(conventions);
    expect(antiPatterns).toHaveLength(1);
    expect(antiPatterns[0].confidence).toBe("medium");
  });

  it("skips conventions below 80%", () => {
    const conventions = [
      makeConvention({
        category: "file-naming",
        name: "kebab-case filenames",
        confidence: { matched: 70, total: 100, percentage: 70, description: "70 of 100 (70%)" },
      }),
    ];

    const antiPatterns = deriveAntiPatterns(conventions);
    expect(antiPatterns).toHaveLength(0);
  });

  it("derives kebab-case anti-pattern", () => {
    const conventions = [
      makeConvention({
        category: "file-naming",
        name: "kebab-case filenames",
        confidence: { matched: 97, total: 100, percentage: 97, description: "97 of 100 (97%)" },
      }),
    ];

    const antiPatterns = deriveAntiPatterns(conventions);
    expect(antiPatterns).toHaveLength(1);
    expect(antiPatterns[0].rule).toContain("Do NOT use camelCase or PascalCase");
    expect(antiPatterns[0].confidence).toBe("high");
  });

  it("derives co-located test anti-pattern", () => {
    const conventions = [
      makeConvention({
        category: "testing",
        name: "Co-located tests",
        confidence: { matched: 34, total: 34, percentage: 100, description: "34 of 34 (100%)" },
      }),
    ];

    const antiPatterns = deriveAntiPatterns(conventions);
    expect(antiPatterns).toHaveLength(1);
    expect(antiPatterns[0].rule).toContain("Do NOT put tests in a separate __tests__");
  });

  it("derives hooks return objects anti-pattern", () => {
    const conventions = [
      makeConvention({
        category: "hooks",
        name: "Hooks return objects",
        confidence: { matched: 14, total: 14, percentage: 100, description: "14 of 14 (100%)" },
      }),
    ];

    const antiPatterns = deriveAntiPatterns(conventions);
    expect(antiPatterns).toHaveLength(1);
    expect(antiPatterns[0].rule).toContain("Do NOT return arrays from hooks");
  });

  it("handles multiple conventions", () => {
    const conventions = [
      makeConvention({
        category: "file-naming",
        name: "kebab-case filenames",
        confidence: { matched: 97, total: 100, percentage: 97, description: "97 of 100 (97%)" },
      }),
      makeConvention({
        category: "testing",
        name: "Co-located tests",
        confidence: { matched: 34, total: 34, percentage: 100, description: "34 of 34 (100%)" },
      }),
      makeConvention({
        category: "hooks",
        name: "Hooks return objects",
        confidence: { matched: 14, total: 14, percentage: 100, description: "14 of 14 (100%)" },
      }),
    ];

    const antiPatterns = deriveAntiPatterns(conventions);
    expect(antiPatterns.length).toBe(3);
  });
});

describe("deriveSharedAntiPatterns", () => {
  it("derives from shared conventions", () => {
    const shared = [
      makeConvention({
        category: "file-naming",
        name: "kebab-case filenames",
        confidence: { matched: 86, total: 86, percentage: 100, description: "86 of 86 (100%)" },
      }),
    ];
    const result = deriveSharedAntiPatterns(shared);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toContain("Do NOT use camelCase or PascalCase");
  });
});
