import { analyze } from "../src/index.js";

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

    console.log(`\n=== ${repo.name} ===`);
    console.log(`Directories (${pkg.architecture.directories.length}):`);
    for (const dir of pkg.architecture.directories) {
      console.log(`  ${dir.path} — ${dir.purpose} (${dir.fileCount} files)`);
    }

    console.log(`Contribution patterns (${(pkg.contributionPatterns ?? []).length}):`);
    for (const cp of pkg.contributionPatterns ?? []) {
      console.log(`  ${cp.directory} — type=${cp.type} suffix=${cp.exportSuffix ?? "none"} reg=${cp.registrationFile ?? "none"} imports=${(cp.commonImports ?? []).length}`);
    }

    // Count how many pattern task directories are in the contribution patterns
    const patternDirs = (pkg.contributionPatterns ?? []).map(cp => cp.directory);
    console.log(`Pattern directories: ${patternDirs.join(", ") || "none"}`);
  } catch (e: any) {
    console.log(`${repo.name}: ERROR ${e.message?.slice(0, 100)}`);
  }
}
