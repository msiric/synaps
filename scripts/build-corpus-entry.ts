#!/usr/bin/env npx tsx
// scripts/build-corpus-entry.ts — Generate a diagnose corpus entry for a repo.
//
// Usage: npx tsx scripts/build-corpus-entry.ts /path/to/repo [packageName]
//
// Runs analyze() on the repo, mines bug-fix commits, and writes a corpus JSON
// file to test/fixtures/diagnose-corpus/{repoName}.json.
//
// For monorepos, specify the package name as the second argument.
// The script picks the package with the most import chain edges by default.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { analyze } from "../src/index.js";

const repoPath = resolve(process.argv[2] ?? ".");
const requestedPkg = process.argv[3];

interface BugFixCommit {
  repo: string;
  commitSha: string;
  commitMessage: string;
  testFiles: string[];
  sourceFiles: string[];
  expectedRootCause: string;
}

function mineBugFixCommits(repoDir: string, pkgPrefix: string, limit = 20): BugFixCommit[] {
  const repoName = basename(repoDir);
  let log: string;
  try {
    log = execFileSync("git", ["log", "--pretty=format:%H|%s", "--name-only", "-n", "500"], {
      cwd: repoDir,
      encoding: "utf-8",
      timeout: 15000,
    }).trim();
  } catch {
    console.error("Failed to run git log");
    return [];
  }

  const commits: BugFixCommit[] = [];
  let current: { sha: string; message: string; files: string[] } | null = null;

  for (const line of log.split("\n")) {
    if (line.includes("|")) {
      if (current) {
        const commit = classify(current, repoName, pkgPrefix);
        if (commit) commits.push(commit);
      }
      const [sha, ...msgParts] = line.split("|");
      current = { sha, message: msgParts.join("|"), files: [] };
    } else if (line.trim() && current) {
      current.files.push(line.trim());
    }
  }
  if (current) {
    const commit = classify(current, repoName, pkgPrefix);
    if (commit) commits.push(commit);
  }

  return commits.slice(0, limit);
}

function classify(
  raw: { sha: string; message: string; files: string[] },
  repoName: string,
  pkgPrefix: string,
): BugFixCommit | null {
  if (!/\bfix/i.test(raw.message)) return null;

  // Filter to files within the target package
  const pkgFiles = pkgPrefix ? raw.files.filter((f) => f.startsWith(pkgPrefix)) : raw.files;
  const normalized = pkgFiles.map((f) => (pkgPrefix ? f.slice(pkgPrefix.length + 1) : f));

  const testFiles = normalized.filter((f) => /\.(test|spec)\.[jt]sx?$/.test(f));
  const sourceFiles = normalized.filter(
    (f) => /\.[jt]sx?$/.test(f) && !testFiles.includes(f) && !f.endsWith(".d.ts") && !f.includes("node_modules"),
  );

  if (sourceFiles.length === 0 || sourceFiles.length > 5) return null;
  if (normalized.every((f) => /\.(md|json|ya?ml)$/.test(f))) return null;

  return {
    repo: repoName,
    commitSha: raw.sha.slice(0, 12),
    commitMessage: raw.message,
    testFiles,
    sourceFiles,
    expectedRootCause: sourceFiles[0], // First source file as root cause (best heuristic)
  };
}

async function main() {
  console.error(`Analyzing ${repoPath}...`);
  const analysis = await analyze({ packages: [repoPath] });

  // Pick best package
  const pkg = requestedPkg
    ? analysis.packages.find((p) => p.name === requestedPkg)
    : analysis.packages.sort((a, b) => (b.importChain?.length ?? 0) - (a.importChain?.length ?? 0))[0];

  if (!pkg) {
    console.error(`Package not found. Available: ${analysis.packages.map((p) => p.name).join(", ")}`);
    process.exit(1);
  }

  console.error(`Using package: ${pkg.name} (${pkg.files.total} files, ${pkg.importChain?.length ?? 0} import edges)`);

  // Determine package prefix in git paths (for monorepos)
  const pkgPrefix = pkg.relativePath === "." ? "" : pkg.relativePath;

  // Mine commits
  const commits = mineBugFixCommits(repoPath, pkgPrefix);
  console.error(`Found ${commits.length} bug-fix commits`);

  if (commits.length === 0) {
    console.error("No bug-fix commits found. Try a deeper clone (git fetch --unshallow).");
    process.exit(1);
  }

  // Build corpus entry
  const repoName = basename(repoPath);
  const entry = {
    repo: repoName,
    packageName: pkg.name,
    importChain: (pkg.importChain ?? []).map((e) => ({
      importer: e.importer,
      source: e.source,
      symbolCount: e.symbolCount,
      symbols: e.symbols.slice(0, 5), // Cap symbols to keep file size reasonable
    })),
    coChangeEdges: pkg.gitHistory?.coChangeEdges ?? [],
    callGraph: pkg.callGraph ?? [],
    workflowRules: analysis.crossPackage?.workflowRules ?? [],
    commits,
  };

  const outPath = resolve("test/fixtures/diagnose-corpus", `${repoName}.json`);
  writeFileSync(outPath, JSON.stringify(entry, null, 2));
  console.error(`Written to ${outPath}`);
  console.error(
    `  ${commits.length} commits, ${entry.importChain.length} import edges, ${entry.callGraph.length} call graph edges, ${entry.coChangeEdges.length} co-change edges`,
  );
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
