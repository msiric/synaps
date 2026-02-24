import { analyze } from "../src/index.js";

const repos = [
  { name: "nitro", path: process.env.REPOS_V1 + "/nitro" },
  { name: "cal.com", path: process.env.REPOS_V2 + "/cal.com" },
  { name: "sanity", path: process.env.REPOS_V1 + "/sanity" },
  { name: "zod", path: process.env.REPOS_V2 + "/zod" },
  { name: "medusa", path: process.env.REPOS_V1 + "/medusa" },
];

for (const repo of repos) {
  try {
    const analysis = await analyze({ packages: [repo.path] });
    const pkg = analysis.packages[0];
    if (!pkg) { console.log(`${repo.name}: NO PACKAGE`); continue; }

    const patterns = pkg.contributionPatterns ?? [];
    console.log(`${repo.name}: ${patterns.length} patterns`);
    for (const cp of patterns) {
      console.log(`  ${cp.directory} — ${cp.type}`);
    }
  } catch (e: any) {
    console.log(`${repo.name}: ERROR ${e.message?.slice(0, 100)}`);
  }
}
