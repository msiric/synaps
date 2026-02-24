import { analyze } from "../src/index.js";
import { computeInferabilityScore } from "../src/inferability.js";

const REPOS_V1 = process.env.REPOS_V1!;
const REPOS_V2 = process.env.REPOS_V2!;

const repos = [
  { name: "nitro", path: `${REPOS_V1}/nitro`, preDelta: -20.0 },
  { name: "mcp-sdk", path: `${REPOS_V1}/typescript-sdk`, preDelta: -8.5 },
];

for (const repo of repos) {
  try {
    const analysis = await analyze({ packages: [repo.path] });
    const pkg = analysis.packages[0];
    if (!pkg) { console.log(`${repo.name}: NO PACKAGE`); continue; }

    const score = computeInferabilityScore(pkg);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`${repo.name} (benchmark delta: ${repo.preDelta}%)`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Inferability: score=${score.score} rec=${score.recommendation}`);
    console.log(`Factors: dirObv=${score.factors.directoryObviousness} naming=${score.factors.namingConsistency} patUniq=${score.factors.patternUniqueness} regComp=${score.factors.registrationComplexity}`);

    console.log(`\nContribution patterns (${(pkg.contributionPatterns ?? []).length}):`);
    for (const cp of pkg.contributionPatterns ?? []) {
      console.log(`  ${cp.directory}`);
      console.log(`    type=${cp.type} suffix=${cp.exportSuffix ?? "none"} reg=${cp.registrationFile ?? "none"}`);
      console.log(`    commonImports=${(cp.commonImports ?? []).length} steps=${cp.steps.length}`);
      console.log(`    steps: ${cp.steps.join(" → ")}`);
    }

    console.log(`\nArchitecture (${pkg.architecture.directories.length} dirs):`);
    for (const d of pkg.architecture.directories) {
      console.log(`  ${d.path}/ (${d.fileCount} files) — ${d.purpose}`);
    }

    console.log(`\nConventions (${(pkg.conventions ?? []).length}):`);
    for (const c of pkg.conventions ?? []) {
      console.log(`  [${c.category}] ${c.name} — ${c.confidence.percentage}%`);
    }

    // Check what AGENTS.md sections would be generated
    console.log(`\nAGENTS.md sections (based on rec=${score.recommendation}):`);
    console.log(`  Commands: YES (always)`);
    console.log(`  Workflow rules: YES (always)`);
    console.log(`  Change impact: YES (always)`);
    console.log(`  Contribution patterns: ${score.recommendation !== "skip" ? "YES" : "NO"}`);
    console.log(`  Public API: ${score.recommendation === "full" ? "YES" : "NO"}`);
    console.log(`  Conventions: ${score.recommendation === "full" ? "YES" : "NO"}`);
  } catch (e: any) {
    console.log(`${repo.name}: ERROR ${e.message?.slice(0, 200)}`);
  }
}
