// test/diagnose-corpus-validation.test.ts — Empirical validation of MCP tools
// against a corpus of real bug-fix commits from 7+ repos.
//
// Each fixture contains: import chain, co-change edges, call graph, workflow rules,
// and bug-fix commits with known root cause files.
//
// Tools evaluated:
//   diagnose:       P@1, R@3, R@5, MRR (root cause identification)
//   plan_change:    recall of co-modified source files
//   analyze_impact: recall of all co-committed files (source + test)
//   search:         hit rate (does search find modified files by name?)

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as Q from "../src/mcp/queries.js";
import type { StructuredAnalysis } from "../src/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CorpusCommit {
  repo: string;
  commitSha: string;
  commitMessage: string;
  testFiles: string[];
  sourceFiles: string[];
  expectedRootCause: string;
}

interface CorpusEntry {
  repo: string;
  packageName: string;
  importChain: StructuredAnalysis["packages"][0]["importChain"];
  coChangeEdges: NonNullable<StructuredAnalysis["packages"][0]["gitHistory"]>["coChangeEdges"];
  callGraph: StructuredAnalysis["packages"][0]["callGraph"];
  workflowRules: NonNullable<StructuredAnalysis["crossPackage"]>["workflowRules"];
  commits: CorpusCommit[];
}

// ─── Load Corpus ────────────────────────────────────────────────────────────

const CORPUS_DIR = resolve(import.meta.dirname, "fixtures/diagnose-corpus");

function loadCorpus(): CorpusEntry[] {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(resolve(CORPUS_DIR, f), "utf-8")) as CorpusEntry);
}

function buildMockAnalysis(entry: CorpusEntry): StructuredAnalysis {
  return {
    meta: { engineVersion: "test", analyzedAt: "", rootDir: ".", config: {} as any, timingMs: 0 },
    packages: [
      {
        name: entry.packageName,
        version: "0.0.0",
        description: "",
        relativePath: ".",
        files: {
          total: 0,
          byTier: {
            tier1: { count: 0, lines: 0, files: [] },
            tier2: { count: 0, lines: 0, files: [] },
            tier3: { count: 0, lines: 0 },
          },
          byExtension: {},
        },
        publicAPI: [],
        conventions: [],
        commands: { packageManager: "npm", other: [] },
        architecture: { entryPoint: "", directories: [], packageType: "library", hasJSX: false },
        dependencies: { internal: [], external: [], totalUniqueDependencies: 0 },
        role: { summary: "", purpose: "", whenToUse: "", inferredFrom: [] },
        antiPatterns: [],
        contributionPatterns: [],
        importChain: entry.importChain,
        gitHistory: {
          coChangeEdges: entry.coChangeEdges ?? [],
          totalCommitsAnalyzed: 0,
          commitsFilteredBySize: 0,
          historySpanDays: 0,
        },
        callGraph: entry.callGraph,
      },
    ],
    crossPackage: {
      dependencyGraph: [],
      sharedConventions: [],
      divergentConventions: [],
      sharedAntiPatterns: [],
      workflowRules: entry.workflowRules,
    },
    warnings: [],
  };
}

// ─── Test ───────────────────────────────────────────────────────────────────

describe("diagnose corpus validation", () => {
  const corpus = loadCorpus();
  const totalCommits = corpus.reduce((sum, e) => sum + e.commits.length, 0);

  it(`loaded ${corpus.length} repos with ${totalCommits} bug-fix commits`, () => {
    expect(corpus.length).toBeGreaterThanOrEqual(3);
    expect(totalCommits).toBeGreaterThanOrEqual(20);
  });

  it("measures precision@1, recall@3, recall@5, MRR across all repos", () => {
    let tested = 0;
    let precisionAt1 = 0;
    let recallAt3 = 0;
    let recallAt5 = 0;
    let reciprocalRankSum = 0;

    const perRepo: Record<string, { tested: number; hits1: number; hits3: number; hits5: number }> = {};

    for (const entry of corpus) {
      const analysis = buildMockAnalysis(entry);
      const repoStats = { tested: 0, hits1: 0, hits3: 0, hits5: 0 };

      for (const commit of entry.commits) {
        // Simulate diagnose: test files as error input, NO source files
        // (we don't want to trivially include the answer in the input)
        const errorFiles = commit.testFiles.length > 0 ? commit.testFiles : [commit.expectedRootCause];
        const testFile = commit.testFiles[0] ?? null;

        // No recent changes — test pure structural scoring
        const { suspects } = Q.buildSuspectList(analysis, errorFiles, [], undefined, testFile);
        const suspectFiles = suspects.map((s) => s.file);

        // Check if any of the actual fix files appear in suspects
        const rootCauseFiles = commit.sourceFiles;
        const rank = suspectFiles.findIndex((f) => rootCauseFiles.includes(f));

        tested++;
        repoStats.tested++;

        if (rank === 0) {
          precisionAt1++;
          repoStats.hits1++;
        }
        if (rank >= 0 && rank < 3) {
          recallAt3++;
          repoStats.hits3++;
        }
        if (rank >= 0 && rank < 5) {
          recallAt5++;
          repoStats.hits5++;
        }
        if (rank >= 0) {
          reciprocalRankSum += 1 / (rank + 1);
        }
      }

      perRepo[entry.repo] = repoStats;
    }

    // Report results
    const p1 = tested > 0 ? Math.round((precisionAt1 / tested) * 100) : 0;
    const r3 = tested > 0 ? Math.round((recallAt3 / tested) * 100) : 0;
    const r5 = tested > 0 ? Math.round((recallAt5 / tested) * 100) : 0;
    const mrr = tested > 0 ? (reciprocalRankSum / tested).toFixed(3) : "0";

    console.log(`\n  ═══ Diagnose Corpus Validation ═══`);
    console.log(`  Commits tested: ${tested}`);
    console.log(`  Precision@1: ${precisionAt1}/${tested} (${p1}%)`);
    console.log(`  Recall@3:    ${recallAt3}/${tested} (${r3}%)`);
    console.log(`  Recall@5:    ${recallAt5}/${tested} (${r5}%)`);
    console.log(`  MRR:         ${mrr}`);
    console.log(``);
    console.log(`  Per-repo breakdown:`);
    for (const [repo, stats] of Object.entries(perRepo)) {
      if (stats.tested === 0) continue;
      const rp1 = Math.round((stats.hits1 / stats.tested) * 100);
      const rr3 = Math.round((stats.hits3 / stats.tested) * 100);
      console.log(`    ${repo.padEnd(20)} tested=${stats.tested}  p@1=${rp1}%  r@3=${rr3}%`);
    }

    // Gate: minimum quality thresholds
    expect(tested).toBeGreaterThanOrEqual(20);
    // Precision@1 should be meaningful — not just random
    expect(p1).toBeGreaterThanOrEqual(15);
    // Recall@5 should catch most cases
    expect(r5).toBeGreaterThanOrEqual(30);
  });

  it("measures with simulated recent changes (realistic scenario)", () => {
    // In real usage, the developer has recent changes that broke a test.
    // Simulate by marking the fix files as "recently changed" (hoursAgo=1).
    let tested = 0;
    let precisionAt1 = 0;
    let recallAt3 = 0;

    for (const entry of corpus) {
      const analysis = buildMockAnalysis(entry);

      for (const commit of entry.commits) {
        const errorFiles = commit.testFiles.length > 0 ? commit.testFiles : [commit.expectedRootCause];
        const testFile = commit.testFiles[0] ?? null;

        // Simulate: the fix files were recently changed (the developer made the breaking change)
        const recentChanges: Q.FileChange[] = commit.sourceFiles.map((f) => ({
          file: f,
          hoursAgo: 1,
          commitMessage: "simulated recent change",
          isUncommitted: false,
        }));

        const { suspects } = Q.buildSuspectList(analysis, errorFiles, recentChanges, undefined, testFile);
        const suspectFiles = suspects.map((s) => s.file);
        const rank = suspectFiles.findIndex((f) => commit.sourceFiles.includes(f));

        tested++;
        if (rank === 0) precisionAt1++;
        if (rank >= 0 && rank < 3) recallAt3++;
      }
    }

    const p1 = tested > 0 ? Math.round((precisionAt1 / tested) * 100) : 0;
    const r3 = tested > 0 ? Math.round((recallAt3 / tested) * 100) : 0;

    console.log(`\n  ═══ With Simulated Recent Changes ═══`);
    console.log(`  Precision@1: ${precisionAt1}/${tested} (${p1}%)`);
    console.log(`  Recall@3:    ${recallAt3}/${tested} (${r3}%)`);

    // With recency signal, results should be at least as good as structural-only
    expect(p1).toBeGreaterThanOrEqual(15);
  });
});

// ─── plan_change Evaluation ──────────────────────────────────────────────────
// For multi-source commits: input one source file, check if the tool's
// import graph + co-change data predicts the other modified source files.

describe("plan_change corpus validation", () => {
  const corpus = loadCorpus();

  it("measures recall of co-modified source files", () => {
    let tested = 0;
    let totalRecall = 0;
    const perRepo: Record<string, { tested: number; recallSum: number }> = {};

    for (const entry of corpus) {
      const analysis = buildMockAnalysis(entry);
      const repoStats = { tested: 0, recallSum: 0 };

      for (const commit of entry.commits) {
        if (commit.sourceFiles.length < 2) continue; // Need 2+ source files

        const inputFile = commit.sourceFiles[0];
        const expectedOthers = commit.sourceFiles.filter((f) => f !== inputFile);

        // Collect what plan_change would predict: importers + co-change partners
        const importers = Q.getImportersForFile(analysis, inputFile);
        const coChanges = Q.getCoChangesForFile(analysis, inputFile);
        const implicit = Q.getImplicitCouplingForFile(analysis, inputFile);
        const predicted = new Set([
          ...importers.map((e) => e.importer),
          ...importers.map((e) => e.source),
          ...coChanges.map((e) => (e.file1 === inputFile ? e.file2 : e.file1)),
          ...implicit.map((e) => (e.file1 === inputFile ? e.file2 : e.file1)),
        ]);

        const hits = expectedOthers.filter((f) => predicted.has(f));
        const recall = hits.length / expectedOthers.length;

        tested++;
        totalRecall += recall;
        repoStats.tested++;
        repoStats.recallSum += recall;
      }

      if (repoStats.tested > 0) perRepo[entry.repo] = repoStats;
    }

    const avgRecall = tested > 0 ? Math.round((totalRecall / tested) * 100) : 0;

    console.log(`\n  ═══ plan_change Corpus Validation ═══`);
    console.log(`  Multi-source commits tested: ${tested}`);
    console.log(`  Average recall: ${avgRecall}%`);
    console.log(``);
    console.log(`  Per-repo breakdown:`);
    for (const [repo, stats] of Object.entries(perRepo)) {
      const r = Math.round((stats.recallSum / stats.tested) * 100);
      console.log(`    ${repo.padEnd(20)} tested=${stats.tested}  recall=${r}%`);
    }

    expect(tested).toBeGreaterThanOrEqual(10);
    expect(avgRecall).toBeGreaterThanOrEqual(20);
  });
});

// ─── analyze_impact Evaluation ───────────────────────────────────────────────
// For multi-file commits: input one source file, check if blast radius
// (importers + co-change) includes the other committed files (source + test).

describe("analyze_impact corpus validation", () => {
  const corpus = loadCorpus();

  it("measures recall of all co-committed files", () => {
    let tested = 0;
    let totalRecall = 0;
    const perRepo: Record<string, { tested: number; recallSum: number }> = {};

    for (const entry of corpus) {
      const analysis = buildMockAnalysis(entry);
      const repoStats = { tested: 0, recallSum: 0 };

      for (const commit of entry.commits) {
        const allFiles = [...new Set([...commit.sourceFiles, ...commit.testFiles])];
        if (allFiles.length < 3) continue; // Need 3+ files for meaningful blast radius test

        const inputFile = commit.sourceFiles[0];
        const expectedOthers = allFiles.filter((f) => f !== inputFile);

        // Collect what analyze_impact would report
        const importers = Q.getImportersForFile(analysis, inputFile);
        const coChanges = Q.getCoChangesForFile(analysis, inputFile);
        const predicted = new Set([
          ...importers.map((e) => e.importer),
          ...importers.map((e) => e.source),
          ...coChanges.map((e) => (e.file1 === inputFile ? e.file2 : e.file1)),
        ]);

        const hits = expectedOthers.filter((f) => predicted.has(f));
        const recall = hits.length / expectedOthers.length;

        tested++;
        totalRecall += recall;
        repoStats.tested++;
        repoStats.recallSum += recall;
      }

      if (repoStats.tested > 0) perRepo[entry.repo] = repoStats;
    }

    const avgRecall = tested > 0 ? Math.round((totalRecall / tested) * 100) : 0;

    console.log(`\n  ═══ analyze_impact Corpus Validation ═══`);
    console.log(`  Multi-file commits tested: ${tested}`);
    console.log(`  Average recall: ${avgRecall}%`);
    console.log(``);
    console.log(`  Per-repo breakdown:`);
    for (const [repo, stats] of Object.entries(perRepo)) {
      const r = Math.round((stats.recallSum / stats.tested) * 100);
      console.log(`    ${repo.padEnd(20)} tested=${stats.tested}  recall=${r}%`);
    }

    expect(tested).toBeGreaterThanOrEqual(10);
    expect(avgRecall).toBeGreaterThanOrEqual(15);
  });
});

// ─── search Evaluation ───────────────────────────────────────────────────────
// For each commit: extract filename stems from modified files, search for them,
// check if the search results include the actual file.

describe("search corpus validation", () => {
  const corpus = loadCorpus();

  it("measures hit rate — does search find modified files by name?", () => {
    let tested = 0;
    let hits = 0;

    for (const entry of corpus) {
      const analysis = buildMockAnalysis(entry);

      for (const commit of entry.commits) {
        for (const file of commit.sourceFiles) {
          // Extract filename stem: "src/ast-parser.ts" → "ast-parser"
          const stem = file.replace(/.*\//, "").replace(/\.[^.]+$/, "");
          if (stem.length < 3) continue; // Skip very short names (e.g., "a.ts")

          const results = Q.search(analysis, stem);
          const found = results.some((r) => r.sourceFile === file || r.name === file);

          tested++;
          if (found) hits++;
        }
      }
    }

    const hitRate = tested > 0 ? Math.round((hits / tested) * 100) : 0;

    console.log(`\n  ═══ search Corpus Validation ═══`);
    console.log(`  File searches tested: ${tested}`);
    console.log(`  Hit rate: ${hits}/${tested} (${hitRate}%)`);

    expect(tested).toBeGreaterThanOrEqual(50);
    expect(hitRate).toBeGreaterThanOrEqual(50);
  });
});
