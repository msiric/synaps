// src/git-history.ts — Git history co-change analysis
// Mines git log to identify file pairs that frequently change together.
// Produces WorkflowRule entries: "When modifying X → also check Y, Z"
// Uses Jaccard similarity for symmetric, unbiased co-change scoring.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { CoChangeEdge, GitHistoryAnalysis, Warning, WorkflowRule } from "./types.js";
import { SOURCE_EXTENSIONS } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_COMMITS = 10;
const INITIAL_MAX_COMMITS = 500;
const EXPANDED_MAX_COMMITS = 1000;
const FULL_MAX_COMMITS = 2000;
const MAX_DAYS = 365; // expanded from 90 — recency decay handles old data
const MAX_FILES_PER_COMMIT = 30;
const HUB_FILE_THRESHOLD = 0.7;
const HUB_FILE_THRESHOLD_YOUNG = 0.9;
const MIN_HUB_COMMITS = 50;
const MIN_JACCARD = 0.15;
const MIN_CO_CHANGES = 3;
const MAX_EDGES = 50;
const MAX_RULES = 5;
const MAX_DISPLAY_PARTNERS = 3;
const RECENCY_DAYS = 45; // co-change pair must have at least 1 co-change within this window
const MIN_CLUSTER_SIZE = 3; // minimum files to form a co-change cluster

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedCommit {
  hash: string;
  timestamp: number;
  files: string[]; // repo-root-relative paths
}

interface GitHistoryOptions {
  maxCommits?: number;
  maxDays?: number;
  maxFilesPerCommit?: number;
  hubFileThreshold?: number;
  minHubCommits?: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Mine git history for co-change patterns. Runs once at repo level.
 * Returns a map from package directory to GitHistoryAnalysis, or null if git is unavailable.
 */
export function mineGitHistory(
  repoDir: string,
  packageDirs: string[],
  warnings: Warning[],
  options: GitHistoryOptions = {},
): Map<string, GitHistoryAnalysis> | null {
  const absRepoDir = resolve(repoDir);

  // Detect shallow clone
  if (isShallowClone(absRepoDir)) {
    warnings.push({
      level: "info",
      module: "git-history",
      message: "Shallow clone detected — skipping co-change analysis",
    });
    return null;
  }

  const maxDays = options.maxDays ?? MAX_DAYS;

  const gitRoot = resolveGitRoot(absRepoDir);
  if (gitRoot === null) return null;

  // Adaptive windowing: start with 500 commits, expand if insufficient signal
  const commitTargets = [options.maxCommits ?? INITIAL_MAX_COMMITS, EXPANDED_MAX_COMMITS, FULL_MAX_COMMITS];
  let allCommits: ParsedCommit[] = [];

  for (const target of commitTargets) {
    if (allCommits.length >= target) break; // already have enough from prior expansion
    const raw = runGitLog(absRepoDir, target, maxDays);
    if (raw === null) return null;
    allCommits = parseGitLog(raw);
    if (allCommits.length >= target * 0.8) break; // got most of what we asked for — no point expanding
  }

  if (allCommits.length < MIN_COMMITS) {
    warnings.push({
      level: "info",
      module: "git-history",
      message: `Only ${allCommits.length} commits found (minimum ${MIN_COMMITS}) — skipping co-change analysis`,
    });
    return null;
  }

  const results = new Map<string, GitHistoryAnalysis>();

  for (const pkgDir of packageDirs) {
    const absPkgDir = resolve(pkgDir);
    const pkgPrefix = relative(gitRoot, absPkgDir);
    // Filter commits to only files within this package that still exist
    const existingFiles = new Set<string>();
    const packageCommits: ParsedCommit[] = [];

    for (const commit of allCommits) {
      const pkgFiles: string[] = [];
      for (const file of commit.files) {
        // Filter to package scope
        const inPackage =
          pkgPrefix === "" ? !file.includes("/node_modules/") : file.startsWith(`${pkgPrefix}/`) || file === pkgPrefix;
        if (!inPackage) continue;

        // Convert to package-relative path
        const pkgRelative = pkgPrefix === "" ? file : file.slice(pkgPrefix.length + 1);

        // Check file still exists on disk
        const absFile = resolve(absPkgDir, pkgRelative);
        if (!existingFiles.has(pkgRelative)) {
          if (existsSync(absFile)) {
            existingFiles.add(pkgRelative);
          } else {
            continue;
          }
        }
        pkgFiles.push(pkgRelative);
      }
      if (pkgFiles.length > 0) {
        packageCommits.push({ hash: commit.hash, timestamp: commit.timestamp, files: pkgFiles });
      }
    }

    if (packageCommits.length < MIN_COMMITS) continue;

    const maxFiles = options.maxFilesPerCommit ?? MAX_FILES_PER_COMMIT;
    const hubThreshold = options.hubFileThreshold ?? HUB_FILE_THRESHOLD;
    const minHub = options.minHubCommits ?? MIN_HUB_COMMITS;

    const { edges, commitsFilteredBySize } = computeCoChangeEdges(
      packageCommits,
      maxFiles,
      hubThreshold,
      minHub,
      warnings,
    );

    // History span in days
    const timestamps = packageCommits.map((c) => c.timestamp);
    const oldest = Math.min(...timestamps);
    const newest = Math.max(...timestamps);
    const spanDays = Math.round((newest - oldest) / 86400);

    results.set(pkgDir, {
      coChangeEdges: edges,
      totalCommitsAnalyzed: packageCommits.length,
      commitsFilteredBySize,
      historySpanDays: spanDays,
    });

    if (commitsFilteredBySize / packageCommits.length > 0.5) {
      warnings.push({
        level: "warn",
        module: "git-history",
        message: `${commitsFilteredBySize}/${packageCommits.length} commits touch >${maxFiles} files — co-change analysis may be unreliable (squash-merge workflow?)`,
      });
    }
  }

  return results.size > 0 ? results : null;
}

/**
 * Generate workflow rules from co-change edges.
 * Detects co-change clusters (cliques where all files co-change with each other)
 * and emits one cluster rule instead of N symmetric individual rules.
 * Deduplicates against import-chain covered files via structured Set.
 */
export function generateCoChangeRules(
  edges: CoChangeEdge[],
  coveredFiles?: Set<string>,
  maxRules: number = MAX_RULES,
): WorkflowRule[] {
  if (edges.length === 0) return [];

  // Step 1: Detect co-change clusters (cliques)
  const clusters = detectClusters(edges);
  const clusterFiles = new Set(clusters.flat());
  const rules: WorkflowRule[] = [];

  // Step 2: Emit cluster rules (1 per cluster instead of N individual rules)
  for (const cluster of clusters) {
    // Skip cluster if all files are already covered by import-chain
    if (cluster.every((f) => coveredFiles?.has(f))) continue;

    const fileList = cluster.map((f) => `\`${f}\``).join(", ");
    rules.push({
      trigger: `When modifying any of: ${fileList}`,
      action: `Check all files in this co-change cluster — they frequently change together`,
      source: `Git co-change analysis — ${cluster.length} files form a co-change cluster`,
      impact: "high",
    });

    if (rules.length >= maxRules) return rules;
  }

  // Step 3: Generate individual rules for non-cluster files
  const byFile = new Map<
    string,
    { partner: string; jaccard: number; coChangeCount: number; partnerCommits: number }[]
  >();

  for (const edge of edges) {
    for (const [file, partner, partnerCommits] of [
      [edge.file1, edge.file2, edge.file2Commits] as const,
      [edge.file2, edge.file1, edge.file1Commits] as const,
    ]) {
      // Skip files already handled by cluster rules
      if (clusterFiles.has(file)) continue;

      const list = byFile.get(file) ?? [];
      list.push({ partner, jaccard: edge.jaccard, coChangeCount: edge.coChangeCount, partnerCommits });
      byFile.set(file, list);
    }
  }

  const candidates = [...byFile.entries()]
    .filter(([file, partners]) => {
      if (partners.length < 2) return false;
      if (coveredFiles?.has(file)) return false;
      return true;
    })
    .sort((a, b) => b[1].length - a[1].length);

  for (const [file, partners] of candidates) {
    if (rules.length >= maxRules) break;

    const sorted = partners.sort((a, b) => b.jaccard - a.jaccard);
    const top = sorted.slice(0, MAX_DISPLAY_PARTNERS);
    const remaining = sorted.length - MAX_DISPLAY_PARTNERS;

    const partnerList = top
      .map((p) => {
        const pct = Math.round((p.coChangeCount / p.partnerCommits) * 100);
        return `\`${p.partner}\` (co-changed in ${pct}% of its commits)`;
      })
      .join(", ");

    const moreText = remaining > 0 ? `, and ${remaining} more` : "";

    rules.push({
      trigger: `When modifying \`${file}\``,
      action: `Also check: ${partnerList}${moreText}`,
      source: `Git co-change analysis — ${partners.length} files frequently change together with this module`,
      impact: "high",
    });
  }

  return rules;
}

/**
 * Detect co-change clusters: groups of >= MIN_CLUSTER_SIZE files where
 * every pair has a co-change edge (i.e., they form a clique in the edge graph).
 * Uses greedy clique detection — finds the largest cliques first.
 */
export function detectClusters(edges: CoChangeEdge[]): string[][] {
  // Build adjacency set
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const s1 = adjacency.get(edge.file1) ?? new Set();
    s1.add(edge.file2);
    adjacency.set(edge.file1, s1);

    const s2 = adjacency.get(edge.file2) ?? new Set();
    s2.add(edge.file1);
    adjacency.set(edge.file2, s2);
  }

  const allFiles = [...adjacency.keys()].sort((a, b) => {
    const da = adjacency.get(a)?.size ?? 0;
    const db = adjacency.get(b)?.size ?? 0;
    return db - da; // highest degree first
  });

  const claimed = new Set<string>();
  const clusters: string[][] = [];

  for (const seed of allFiles) {
    if (claimed.has(seed)) continue;

    const neighbors = adjacency.get(seed);
    if (!neighbors || neighbors.size < MIN_CLUSTER_SIZE - 1) continue;

    // Greedily build a clique starting from seed
    const clique = [seed];
    const candidateNeighbors = [...neighbors]
      .filter((n) => !claimed.has(n))
      .sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0));

    for (const candidate of candidateNeighbors) {
      // Check if candidate is connected to ALL current clique members
      const candidateAdj = adjacency.get(candidate);
      if (!candidateAdj) continue;
      const isConnectedToAll = clique.every((member) => candidateAdj.has(member));
      if (isConnectedToAll) {
        clique.push(candidate);
      }
    }

    if (clique.length >= MIN_CLUSTER_SIZE) {
      clique.sort();
      clusters.push(clique);
      for (const f of clique) claimed.add(f);
    }
  }

  return clusters;
}

// ─── Internal Functions ──────────────────────────────────────────────────────

/** Run git log and return raw output, or null on failure. */
function runGitLog(dir: string, maxCommits: number, maxDays: number): string | null {
  try {
    return execFileSync(
      "git",
      [
        "log",
        "--name-status",
        "--diff-filter=AMCR",
        "--format=COMMIT:%H %at",
        "--no-merges",
        "-n",
        String(maxCommits),
        "--since",
        `${maxDays} days ago`,
      ],
      { cwd: dir, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    return null;
  }
}

/** Parse git log --name-status output into structured commits. */
export function parseGitLog(raw: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  const chunks = raw.split("COMMIT:").filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk.trim().split("\n");
    if (lines.length === 0) continue;

    // First line: "HASH TIMESTAMP"
    const header = lines[0].trim();
    const spaceIdx = header.indexOf(" ");
    if (spaceIdx === -1) continue;

    const hash = header.slice(0, spaceIdx);
    const timestamp = parseInt(header.slice(spaceIdx + 1), 10);
    if (Number.isNaN(timestamp)) continue;

    // Remaining lines: "STATUS\tFILE" (e.g., "M\tsrc/foo.ts")
    const files: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) continue;
      const filePath = line.slice(tabIdx + 1).trim();
      if (!filePath) continue;
      if (!SOURCE_EXTENSIONS.test(filePath)) continue;
      files.push(filePath);
    }

    commits.push({ hash, timestamp, files });
  }

  return commits;
}

/** Compute co-change edges using Jaccard similarity. */
export function computeCoChangeEdges(
  commits: ParsedCommit[],
  maxFilesPerCommit: number,
  hubThreshold: number,
  minHubCommits: number,
  _warnings: Warning[],
): { edges: CoChangeEdge[]; commitsFilteredBySize: number } {
  // Count per-file commit appearances (before filtering)
  const fileCommitCount = new Map<string, number>();
  let commitsFilteredBySize = 0;

  // Count all files first (needed for hub detection)
  for (const commit of commits) {
    for (const file of commit.files) {
      fileCommitCount.set(file, (fileCommitCount.get(file) ?? 0) + 1);
    }
  }

  // Hub file detection (adaptive threshold, skip for very small datasets)
  const totalCommits = commits.length;
  const hubFiles = new Set<string>();
  if (totalCommits >= MIN_COMMITS) {
    const effectiveHubThreshold = totalCommits >= minHubCommits ? hubThreshold : HUB_FILE_THRESHOLD_YOUNG;
    for (const [file, count] of fileCommitCount) {
      if (count / totalCommits > effectiveHubThreshold) {
        hubFiles.add(file);
      }
    }
  }

  // Build co-change matrix (track counts + most recent timestamp per pair)
  const pairCounts = new Map<string, number>();
  const pairLastTimestamp = new Map<string, number>();

  for (const commit of commits) {
    // Filter to non-hub source files
    const files = commit.files.filter((f) => !hubFiles.has(f));

    if (files.length > maxFilesPerCommit) {
      commitsFilteredBySize++;
      continue;
    }
    if (files.length < 2) continue;

    // Create pairs (alphabetically sorted for canonical key)
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const [a, b] = files[i] < files[j] ? [files[i], files[j]] : [files[j], files[i]];
        const key = `${a}\0${b}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        const prev = pairLastTimestamp.get(key) ?? 0;
        if (commit.timestamp > prev) {
          pairLastTimestamp.set(key, commit.timestamp);
        }
      }
    }
  }

  // Recency cutoff: pairs must have co-changed within RECENCY_DAYS
  const newestCommit = commits.reduce((max, c) => Math.max(max, c.timestamp), 0);
  const recencyCutoff = newestCommit - RECENCY_DAYS * 86400;

  // Compute Jaccard and filter
  // Adaptive thresholds: young repos (<30 commits) get lower minimums
  // so they produce some co-change edges instead of none
  const isYoungRepo = totalCommits < 30;
  const minCoChanges = isYoungRepo ? 2 : MIN_CO_CHANGES;
  const minJaccard = isYoungRepo ? 0.1 : MIN_JACCARD;
  const edges: CoChangeEdge[] = [];

  for (const [key, coChangeCount] of pairCounts) {
    if (coChangeCount < minCoChanges) continue;

    const lastTs = pairLastTimestamp.get(key) ?? 0;
    // Recency filter: skip pairs with no co-change in the recent window
    if (lastTs < recencyCutoff) continue;

    const [file1, file2] = key.split("\0");
    const file1Commits = fileCommitCount.get(file1) ?? 0;
    const file2Commits = fileCommitCount.get(file2) ?? 0;
    const union = file1Commits + file2Commits - coChangeCount;
    const jaccard = union > 0 ? coChangeCount / union : 0;

    if (jaccard < minJaccard) continue;

    edges.push({ file1, file2, coChangeCount, file1Commits, file2Commits, jaccard, lastCoChangeTimestamp: lastTs });
  }

  edges.sort((a, b) => b.jaccard - a.jaccard);
  return { edges: edges.slice(0, MAX_EDGES), commitsFilteredBySize };
}

/** Resolve git repository root directory. */
function resolveGitRoot(dir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/** Detect shallow clone. */
function isShallowClone(dir: string): boolean {
  try {
    const result = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result === "true";
  } catch {
    return false;
  }
}
