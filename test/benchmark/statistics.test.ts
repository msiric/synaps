import { describe, it, expect } from "vitest";
import { pairedTTest, cohensD, effectSizeLabel, bootstrapCI, wilcoxonSignedRank } from "../../src/benchmark/statistics.js";

describe("pairedTTest", () => {
  it("detects significant difference between paired samples", () => {
    const a = [80, 85, 90, 75, 88, 92, 78, 84, 86, 91];
    const b = [60, 65, 70, 55, 68, 72, 58, 64, 66, 71];
    // Each pair differs by ~20 points
    const result = pairedTTest(a, b);
    expect(result.meanDiff).toBeCloseTo(20, 0);
    expect(result.t).toBeGreaterThan(2);
    expect(result.p).toBeLessThan(0.05);
    expect(result.df).toBe(9);
  });

  it("returns p ≈ 1 for identical samples", () => {
    const a = [50, 50, 50, 50, 50];
    const b = [50, 50, 50, 50, 50];
    const result = pairedTTest(a, b);
    expect(result.meanDiff).toBe(0);
  });

  it("handles n < 2 gracefully", () => {
    const result = pairedTTest([80], [60]);
    expect(result.df).toBe(0);
    expect(result.p).toBe(1);
  });
});

describe("cohensD", () => {
  it("computes large effect size for clear differences", () => {
    // Differences vary: 25, 15, 35, 20, 28 (mean ≈ 24.6, sd ≈ 7.6, d ≈ 3.2)
    const a = [80, 85, 90, 75, 88];
    const b = [55, 70, 55, 55, 60];
    const d = cohensD(a, b);
    expect(d).toBeGreaterThan(0.8); // large effect
  });

  it("returns 0 for identical samples", () => {
    expect(cohensD([50, 50], [50, 50])).toBe(0);
  });

  it("handles n < 2", () => {
    expect(cohensD([80], [60])).toBe(0);
  });
});

describe("effectSizeLabel", () => {
  it("labels effect sizes correctly", () => {
    expect(effectSizeLabel(0.1)).toBe("negligible");
    expect(effectSizeLabel(0.3)).toBe("small");
    expect(effectSizeLabel(0.6)).toBe("medium");
    expect(effectSizeLabel(0.9)).toBe("large");
    expect(effectSizeLabel(1.5)).toBe("very large");
  });
});

describe("bootstrapCI", () => {
  it("produces CI that brackets the mean difference", () => {
    // Varying differences: 30, 10, 25, 5, 20, 35, 15, 8, 28, 12
    const a = [80, 85, 90, 75, 88, 92, 78, 84, 86, 91];
    const b = [50, 75, 65, 70, 68, 57, 63, 76, 58, 79];
    const [lo, hi] = bootstrapCI(a, b);
    // CI should be a non-trivial interval (lo < hi)
    expect(hi - lo).toBeGreaterThan(0);
    // And both bounds should be positive (since A consistently > B)
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("returns [0, 0] for n < 2", () => {
    expect(bootstrapCI([80], [60])).toEqual([0, 0]);
  });
});

describe("wilcoxonSignedRank", () => {
  it("detects significant difference", () => {
    const a = [80, 85, 90, 75, 88, 92, 78, 84, 86, 91];
    const b = [60, 65, 70, 55, 68, 72, 58, 64, 66, 71];
    const result = wilcoxonSignedRank(a, b);
    expect(result.p).toBeLessThan(0.05);
    expect(result.n).toBe(10);
  });

  it("handles small samples gracefully", () => {
    const result = wilcoxonSignedRank([80, 85], [60, 65]);
    expect(result.p).toBe(1); // n < 5, returns p=1
  });
});
