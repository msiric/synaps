import { analyze } from "../src/index.js";
import { computeInferabilityScore } from "../src/inferability.js";

const repos = [
  { name: "nitro", path: process.env.REPOS_V1 + "/nitro" },
  { name: "cal.com", path: process.env.REPOS_V2 + "/cal.com" },
  { name: "excalidraw", path: process.env.REPOS_V1 + "/excalidraw" },
  { name: "sanity", path: process.env.REPOS_V1 + "/sanity" },
  { name: "zod", path: process.env.REPOS_V2 + "/zod" },
  { name: "medusa", path: process.env.REPOS_V1 + "/medusa" },
];

for (const repo of repos) {
  try {
    const analysis = await analyze({ packages: [repo.path] });
    const pkg = analysis.packages[0];
    if (!pkg) { console.log(`${repo.name}: NO PACKAGE`); continue; }
    const score = computeInferabilityScore(pkg);
    const patternCount = (pkg.contributionPatterns ?? []).length;
    const dirCount = pkg.architecture.directories.length;
    const convCount = (pkg.conventions ?? []).length;
    console.log(`${repo.name}:`);
    console.log(`  score=${score.score} rec=${score.recommendation}`);
    console.log(`  factors: dirObv=${score.factors.directoryObviousness} naming=${score.factors.namingConsistency} patUniq=${score.factors.patternUniqueness} regComp=${score.factors.registrationComplexity}`);
    console.log(`  patterns=${patternCount} dirs=${dirCount} conventions=${convCount}`);
  } catch (e: any) {
    console.log(`${repo.name}: ERROR ${e.message?.slice(0, 100)}`);
  }
}
