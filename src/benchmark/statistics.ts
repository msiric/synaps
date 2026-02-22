// src/benchmark/statistics.ts — Statistical analysis for benchmark results
// Pure math, zero dependencies. Provides paired t-test, Wilcoxon signed-rank,
// bootstrap CI, and Cohen's d.

// ─── Paired T-Test ───────────────────────────────────────────────────────────

export interface TTestResult {
  t: number;
  p: number;
  df: number;
  meanDiff: number;
}

/**
 * Two-tailed paired t-test.
 * Tests H0: mean(a) = mean(b) vs H1: mean(a) ≠ mean(b).
 */
export function pairedTTest(a: number[], b: number[]): TTestResult {
  const n = Math.min(a.length, b.length);
  if (n < 2) return { t: 0, p: 1, df: 0, meanDiff: 0 };

  const diffs = a.slice(0, n).map((v, i) => v - b[i]);
  const meanDiff = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - meanDiff) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);

  if (sd === 0) return { t: Infinity, p: 0, df: n - 1, meanDiff };

  const t = meanDiff / (sd / Math.sqrt(n));
  const df = n - 1;
  const p = tDistributionTwoTailP(Math.abs(t), df);

  return { t, p, df, meanDiff };
}

// ─── Cohen's d ───────────────────────────────────────────────────────────────

/**
 * Cohen's d effect size for paired samples.
 * d = mean(diff) / sd(diff)
 * Convention: 0.2 = small, 0.5 = medium, 0.8 = large
 */
export function cohensD(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;

  const diffs = a.slice(0, n).map((v, i) => v - b[i]);
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);

  return sd > 0 ? mean / sd : 0;
}

/**
 * Interpret Cohen's d effect size.
 */
export function effectSizeLabel(d: number): string {
  const abs = Math.abs(d);
  if (abs >= 1.2) return "very large";
  if (abs >= 0.8) return "large";
  if (abs >= 0.5) return "medium";
  if (abs >= 0.2) return "small";
  return "negligible";
}

// ─── Bootstrap CI ────────────────────────────────────────────────────────────

/**
 * Bootstrap confidence interval for the mean of paired differences.
 * Returns [lower, upper] bounds.
 */
export function bootstrapCI(
  a: number[],
  b: number[],
  alpha: number = 0.05,
  nResamples: number = 1000,
  seed: number = 42,
): [number, number] {
  const n = Math.min(a.length, b.length);
  if (n < 2) return [0, 0];

  const diffs = a.slice(0, n).map((v, i) => v - b[i]);
  const bootMeans: number[] = [];

  let s = seed;
  for (let r = 0; r < nResamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const idx = s % n;
      sum += diffs[idx];
    }
    bootMeans.push(sum / n);
  }

  bootMeans.sort((x, y) => x - y);
  const lo = bootMeans[Math.floor((alpha / 2) * nResamples)];
  const hi = bootMeans[Math.floor((1 - alpha / 2) * nResamples)];

  return [lo, hi];
}

// ─── Wilcoxon Signed-Rank Test ───────────────────────────────────────────────

export interface WilcoxonResult {
  W: number;
  p: number;
  n: number;
}

/**
 * Two-tailed Wilcoxon signed-rank test (non-parametric alternative to paired t-test).
 * Uses normal approximation for n >= 10.
 */
export function wilcoxonSignedRank(a: number[], b: number[]): WilcoxonResult {
  const n = Math.min(a.length, b.length);
  const diffs = a.slice(0, n).map((v, i) => v - b[i]).filter(d => d !== 0);
  const effectiveN = diffs.length;

  if (effectiveN < 5) return { W: 0, p: 1, n: effectiveN };

  // Rank absolute differences
  const ranked = diffs
    .map((d, i) => ({ diff: d, abs: Math.abs(d), idx: i }))
    .sort((x, y) => x.abs - y.abs);

  // Assign ranks (handle ties with average rank)
  const ranks = new Array(effectiveN).fill(0);
  let i = 0;
  while (i < effectiveN) {
    let j = i;
    while (j < effectiveN && ranked[j].abs === ranked[i].abs) j++;
    const avgRank = (i + j + 1) / 2; // 1-indexed average
    for (let k = i; k < j; k++) {
      ranks[ranked[k].idx] = avgRank;
    }
    i = j;
  }

  // W+ = sum of ranks for positive differences
  let Wplus = 0;
  for (let k = 0; k < effectiveN; k++) {
    if (diffs[k] > 0) Wplus += ranks[k];
  }

  // Normal approximation for p-value
  const mu = effectiveN * (effectiveN + 1) / 4;
  const sigma = Math.sqrt(effectiveN * (effectiveN + 1) * (2 * effectiveN + 1) / 24);
  const z = sigma > 0 ? (Wplus - mu) / sigma : 0;
  const p = 2 * (1 - normalCDF(Math.abs(z)));

  return { W: Wplus, p, n: effectiveN };
}

// ─── Internal Math ───────────────────────────────────────────────────────────

/**
 * Normal CDF approximation (Abramowitz & Stegun 26.2.17).
 */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1 + sign * y);
}

/**
 * Two-tailed p-value from t-distribution using normal approximation.
 * For df >= 30, this is very accurate. For smaller df, use the
 * Cornish-Fisher expansion for better accuracy.
 */
function tDistributionTwoTailP(t: number, df: number): number {
  if (df <= 0) return 1;

  // For large df, t ≈ normal
  if (df >= 100) {
    return 2 * (1 - normalCDF(t));
  }

  // Cornish-Fisher approximation for moderate df
  const g1 = (t * t + 1) / (4 * df);
  const g2 = (5 * t * t * t * t + 16 * t * t + 3) / (96 * df * df);
  const z = t * (1 - g1 + g2);

  return 2 * (1 - normalCDF(Math.abs(z)));
}
