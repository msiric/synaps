#!/usr/bin/env npx tsx
// scripts/calibrate-inferability.ts — Compute inferability score for a repo
// Usage: npx tsx scripts/calibrate-inferability.ts [repo-path]
// Compares score against known benchmark deltas to validate thresholds.

import { resolve } from "node:path";
import { analyze } from "../src/index.js";
import { computeInferabilityScore } from "../src/inferability.js";
import { generateMinimalAgentsMd } from "../src/deterministic-formatter.js";

const repoPath = resolve(process.argv[2] ?? ".");
const repoName = repoPath.split("/").pop() ?? repoPath;

async function main() {
  console.log(`\n=== Inferability Calibration: ${repoName} ===\n`);

  const analysis = await analyze({ packages: [repoPath] });

  for (const pkg of analysis.packages) {
    const score = computeInferabilityScore(pkg);
    const dirs = pkg.architecture.directories;
    const patterns = pkg.contributionPatterns ?? [];
    const conventions = pkg.conventions;

    console.log(`Package: ${pkg.name}`);
    console.log(`  Score: ${score.score}/100 → recommendation: "${score.recommendation}"`);
    console.log(`  Factors:`);
    console.log(`    directoryObviousness: ${score.factors.directoryObviousness} (${dirs.length} dirs)`);
    console.log(`    namingConsistency:    ${score.factors.namingConsistency}`);
    console.log(`    patternUniqueness:    ${score.factors.patternUniqueness} (${patterns.length} patterns)`);
    console.log(`    registrationComplexity: ${score.factors.registrationComplexity}`);
    console.log(`  Patterns:`);
    for (const p of patterns) {
      const signals = [
        p.commonImports?.length ? "commonImports" : null,
        p.exportSuffix ? "exportSuffix" : null,
        p.registrationFile ? `registration(${p.registrationFile})` : null,
      ].filter(Boolean);
      console.log(`    ${p.directory}: ${signals.length > 0 ? signals.join(", ") : "no deep signals"}`);
    }
    console.log(`  Conventions: ${conventions.length} (${conventions.filter(c => c.confidence.percentage >= 95).length} at ≥95% confidence)`);
    console.log();
  }

  // Generate minimal output and show token count
  const minimal = generateMinimalAgentsMd(analysis);
  const tokens = Math.round(minimal.length / 3.5);
  const sections = minimal.split("## ").length - 1;
  console.log(`Minimal output: ${tokens} tokens, ${sections} sections, ${minimal.split("\n").length} lines`);
  console.log(`---`);
  console.log(minimal);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
