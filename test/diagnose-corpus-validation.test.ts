// test/diagnose-corpus-validation.test.ts — Empirical validation of diagnose scoring
// against a corpus of real bug-fix commits from 7+ repos.
//
// Each fixture contains: import chain, co-change edges, call graph, workflow rules,
// and bug-fix commits with known root cause files.
//
// Metrics:
//   precision@1: % of commits where #1 suspect IS the root cause
//   recall@3:    % of commits where root cause appears in top 3 suspects
//   recall@5:    % of commits where root cause appears in top 5 suspects
//   MRR:         mean reciprocal rank (1/rank of first correct result)

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
        const suspects = Q.buildSuspectList(analysis, errorFiles, [], undefined, testFile);
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
});
