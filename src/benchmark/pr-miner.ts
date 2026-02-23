// src/benchmark/pr-miner.ts — Mine git history for real "add file" commits
// Uses actual developer commits as ground truth for benchmark tasks.
// Reads all files at commit time (not HEAD) to avoid time-travel leakage.

import { execSync } from "node:child_process";
import { resolve, dirname, basename, extname } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MinedTask {
  id: string;
  commitSha: string;
  commitMessage: string;
  commitDate: string;
  groundTruth: {
    path: string;       // repo-relative path of the added file
    content: string;    // file content at commit time
    directory: string;  // parent directory
    filename: string;   // just the filename
    lineCount: number;
  };
  context: {
    siblingFiles: { path: string; content: string }[];
    directoryListing: string[];
    barrelFile?: { path: string; content: string };
  };
}

export interface MinerOptions {
  maxTasks?: number;
  maxCommits?: number;    // how many commits to scan
  sinceDays?: number;     // only look at commits from last N days
  minFileLines?: number;
  maxFileLines?: number;
  minSiblings?: number;
  minMessageLength?: number;
  maxFilesPerCommit?: number;
  verbose?: boolean;
}

export interface MinerStats {
  totalCommits: number;
  commitsWithAddedTs: number;
  afterQualityFilter: number;
  afterDiversityFilter: number;
  selected: number;
  filterReasons: Record<string, number>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULTS: Required<MinerOptions> = {
  maxTasks: 30,
  maxCommits: 500,
  sinceDays: 365,
  minFileLines: 20,
  maxFileLines: 500,
  minSiblings: 3,
  minMessageLength: 15,
  maxFilesPerCommit: 10,
  verbose: false,
};

const TS_EXTENSIONS = /\.(ts|tsx)$/;
const SKIP_PATTERNS = [
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /\.d\.(ts|tsx)$/,
  /\.config\.(ts|tsx)$/,
  /\.stories\.(ts|tsx)$/,
  /\.e2e\.(ts|tsx)$/,
  /\/__tests__\//,
  /\/test\//,
  /\/fixtures?\//,
  /\/mocks?\//,
];
const SKIP_FILENAMES = new Set([
  "index.ts", "index.tsx", "mod.ts",  // barrel files
  "types.ts", "constants.ts",          // typically type-only
  "package.json", "tsconfig.json",
]);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Mine a git repository for qualifying "add file" commits.
 * Returns tasks sorted by recency, with diverse directory coverage.
 */
export function mineCommits(
  repoPath: string,
  options: MinerOptions = {},
): { tasks: MinedTask[]; stats: MinerStats } {
  const opts = { ...DEFAULTS, ...options };
  const absRepo = resolve(repoPath);
  const gitRoot = getGitRoot(absRepo);
  if (!gitRoot) {
    throw new Error(`Not a git repository: ${absRepo}`);
  }

  const stats: MinerStats = {
    totalCommits: 0,
    commitsWithAddedTs: 0,
    afterQualityFilter: 0,
    afterDiversityFilter: 0,
    selected: 0,
    filterReasons: {},
  };

  // Phase 1: Find commits that added TS files
  const rawCommits = findAddFileCommits(gitRoot, opts);
  stats.totalCommits = rawCommits.length;

  // Phase 2: Filter each commit's added files by quality criteria
  const candidates: MinedTask[] = [];
  for (const commit of rawCommits) {
    stats.commitsWithAddedTs++;
    for (const filePath of commit.addedFiles) {
      const task = processCandidate(gitRoot, commit, filePath, opts, stats);
      if (task) candidates.push(task);
    }
  }
  stats.afterQualityFilter = candidates.length;

  // Phase 3: Enforce directory diversity (max 2 tasks per directory)
  const diverse = enforceDiversity(candidates);
  stats.afterDiversityFilter = diverse.length;

  // Phase 4: Select top N, preferring recent and diverse
  const selected = diverse.slice(0, opts.maxTasks);
  stats.selected = selected.length;

  if (opts.verbose) {
    logStats(stats);
  }

  return { tasks: selected, stats };
}

// ─── Git Operations ─────────────────────────────────────────────────────────

interface RawCommit {
  sha: string;
  message: string;
  date: string;
  totalFilesChanged: number;
  addedFiles: string[];
}

/**
 * Find commits that added TypeScript files.
 * Uses `git log --diff-filter=A --name-only` to efficiently find additions.
 */
function findAddFileCommits(
  gitRoot: string,
  opts: Required<MinerOptions>,
): RawCommit[] {
  const raw = gitExec(
    gitRoot,
    `git log --no-merges --diff-filter=A --name-only ` +
    `--format="COMMIT:%H|%s|%aI" ` +
    `--since="${opts.sinceDays} days ago" ` +
    `-n ${opts.maxCommits} ` +
    `-- "*.ts" "*.tsx"`,
  );
  if (!raw) return [];

  const commits: RawCommit[] = [];
  let current: RawCommit | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("COMMIT:")) {
      if (current) commits.push(current);
      const parts = line.slice(7).split("|");
      current = {
        sha: parts[0],
        message: parts.slice(1, -1).join("|"), // message may contain |
        date: parts[parts.length - 1],
        totalFilesChanged: 0,
        addedFiles: [],
      };
    } else if (line.trim() && current) {
      current.addedFiles.push(line.trim());
    }
  }
  if (current) commits.push(current);

  // Get total files changed per commit (including non-additions)
  for (const commit of commits) {
    const stat = gitExec(
      gitRoot,
      `git diff-tree --no-commit-id --name-only -r ${commit.sha}`,
    );
    commit.totalFilesChanged = stat
      ? stat.split("\n").filter(l => l.trim()).length
      : commit.addedFiles.length;
  }

  return commits;
}

/**
 * Read a file's content at a specific commit SHA.
 * Returns null if the file doesn't exist at that commit.
 */
export function readFileAtCommit(
  gitRoot: string,
  sha: string,
  filePath: string,
): string | null {
  return gitExec(gitRoot, `git show ${sha}:${filePath}`);
}

/**
 * List files in a directory at a specific commit SHA.
 * Returns repo-relative paths.
 */
export function listDirAtCommit(
  gitRoot: string,
  sha: string,
  dirPath: string,
): string[] {
  // Ensure dirPath ends with / for git ls-tree
  const dir = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  const raw = gitExec(
    gitRoot,
    `git ls-tree --name-only ${sha} ${dir}`,
  );
  if (!raw) return [];
  return raw.split("\n").filter(l => l.trim()).map(f => basename(f));
}

// ─── Candidate Processing ───────────────────────────────────────────────────

function processCandidate(
  gitRoot: string,
  commit: RawCommit,
  filePath: string,
  opts: Required<MinerOptions>,
  stats: MinerStats,
): MinedTask | null {
  const reason = (r: string) => {
    stats.filterReasons[r] = (stats.filterReasons[r] ?? 0) + 1;
    return null;
  };

  // Filter: commit changed too many files (bulk import/refactor)
  if (commit.totalFilesChanged > opts.maxFilesPerCommit) {
    return reason("too-many-files-changed");
  }

  // Filter: commit message too short
  if (commit.message.length < opts.minMessageLength) {
    return reason("short-commit-message");
  }

  // Filter: skip test/config/type/fixture files
  const fileName = basename(filePath);
  if (SKIP_FILENAMES.has(fileName)) {
    return reason("skip-filename");
  }
  if (SKIP_PATTERNS.some(p => p.test(filePath))) {
    return reason("skip-pattern");
  }

  // Filter: must be TS/TSX
  if (!TS_EXTENSIONS.test(filePath)) {
    return reason("not-typescript");
  }

  // Read ground truth at commit time
  const content = readFileAtCommit(gitRoot, commit.sha, filePath);
  if (!content) {
    return reason("file-unreadable");
  }

  // Filter: file size
  const lineCount = content.split("\n").length;
  if (lineCount < opts.minFileLines) {
    return reason("too-small");
  }
  if (lineCount > opts.maxFileLines) {
    return reason("too-large");
  }

  // Get directory context from PARENT commit (before the file was added)
  const dir = dirname(filePath);
  const parentSha = commit.sha + "^";

  // List siblings at parent commit
  const siblings = listDirAtCommit(gitRoot, parentSha, dir);
  const tsSiblings = siblings.filter(f => TS_EXTENSIONS.test(f) && f !== fileName);

  // Filter: must have enough siblings for context
  if (tsSiblings.length < opts.minSiblings) {
    return reason("too-few-siblings");
  }

  // Read sibling files (up to 5, sorted alphabetically for determinism)
  const siblingFiles: { path: string; content: string }[] = [];
  const sibsToRead = tsSiblings.sort().slice(0, 5);
  for (const sib of sibsToRead) {
    const sibPath = dir + "/" + sib;
    const sibContent = readFileAtCommit(gitRoot, parentSha, sibPath);
    if (sibContent) {
      siblingFiles.push({
        path: sibPath,
        content: truncate(sibContent, 100),
      });
    }
  }

  // Check for barrel file at parent commit
  let barrelFile: { path: string; content: string } | undefined;
  for (const barrelName of ["index.ts", "index.tsx"]) {
    const barrelPath = dir + "/" + barrelName;
    const barrelContent = readFileAtCommit(gitRoot, parentSha, barrelPath);
    if (barrelContent) {
      barrelFile = { path: barrelPath, content: barrelContent };
      break;
    }
  }

  // Directory listing at parent commit (all files, not just TS)
  const dirListing = listDirAtCommit(gitRoot, parentSha, dir);

  // Build task ID from directory and filename
  const id = `pr-${dir.replace(/\//g, "-")}-${basename(filePath, extname(filePath))}`;

  return {
    id,
    commitSha: commit.sha,
    commitMessage: commit.message.trim(),
    commitDate: commit.date,
    groundTruth: {
      path: filePath,
      content,
      directory: dir,
      filename: fileName,
      lineCount,
    },
    context: {
      siblingFiles,
      directoryListing: dirListing,
      barrelFile,
    },
  };
}

// ─── Diversity & Selection ──────────────────────────────────────────────────

/**
 * Enforce directory diversity: max 2 tasks per directory, max 4 per package.
 * Preserves order (most recent first from git log).
 */
function enforceDiversity(candidates: MinedTask[]): MinedTask[] {
  const dirCounts = new Map<string, number>();
  const pkgCounts = new Map<string, number>();
  const result: MinedTask[] = [];

  for (const task of candidates) {
    const dir = task.groundTruth.directory;
    const pkg = getPackageRoot(dir);

    const dirCount = dirCounts.get(dir) ?? 0;
    const pkgCount = pkgCounts.get(pkg) ?? 0;

    if (dirCount >= 2 || pkgCount >= 4) continue;

    dirCounts.set(dir, dirCount + 1);
    pkgCounts.set(pkg, pkgCount + 1);
    result.push(task);
  }

  return result;
}

function getPackageRoot(dir: string): string {
  // Extract package root: packages/<name>/ or apps/<name>/ or just the first 2 segments
  const parts = dir.split("/");
  if (parts[0] === "packages" || parts[0] === "apps") {
    return parts.slice(0, 2).join("/");
  }
  return parts.slice(0, Math.min(2, parts.length)).join("/");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function gitExec(cwd: string, command: string): string | null {
  try {
    return execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    }).trimEnd();
  } catch {
    return null;
  }
}

function getGitRoot(dir: string): string | null {
  return gitExec(dir, "git rev-parse --show-toplevel");
}

function truncate(content: string, maxLines: number): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join("\n") + "\n// ... truncated";
}

function logStats(stats: MinerStats): void {
  console.error(`[pr-miner] Commits scanned: ${stats.totalCommits}`);
  console.error(`[pr-miner] With added TS files: ${stats.commitsWithAddedTs}`);
  console.error(`[pr-miner] After quality filter: ${stats.afterQualityFilter}`);
  console.error(`[pr-miner] After diversity filter: ${stats.afterDiversityFilter}`);
  console.error(`[pr-miner] Selected: ${stats.selected}`);
  if (Object.keys(stats.filterReasons).length > 0) {
    console.error(`[pr-miner] Filter reasons:`);
    for (const [reason, count] of Object.entries(stats.filterReasons).sort((a, b) => b[1] - a[1])) {
      console.error(`  ${reason}: ${count}`);
    }
  }
}
