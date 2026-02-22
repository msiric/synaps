// src/mcp/cache.ts — Analysis cache with dirty-tree detection + eager warmup
// Fixes applied from 2 rounds of adversarial review:
// - No -uno: includes untracked files in dirty detection
// - Hash status output: catches within-dirty-state changes
// - Non-git TTL fallback: 15s re-analysis for repos without git
// - Singleton promise: prevents concurrent duplicate analyses
// - Warmup error logging: failures visible in stderr

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { analyze } from "../index.js";
import type { StructuredAnalysis } from "../types.js";

const CHECK_TTL_MS = 300;        // Don't hammer git on rapid-fire calls
const NON_GIT_TTL_MS = 15_000;   // Re-analyze non-git repos every 15s

export class AnalysisCache {
  private projectPath: string;
  private cached: { analysis: StructuredAnalysis; key: string } | null = null;
  private inflight: Promise<StructuredAnalysis> | null = null;
  private lastCheckAt = 0;
  private nonGitEpoch = 0;
  private lastNonGitCheck = 0;
  private _lastWasCacheHit = false;

  /** Whether the most recent get() call was a cache hit. */
  get lastWasCacheHit(): boolean { return this._lastWasCacheHit; }

  constructor(projectPath: string) {
    this.projectPath = resolve(projectPath);
  }

  /**
   * Eager warmup — call AFTER server.connect() to avoid event loop blocking.
   */
  warm(): void {
    process.stderr.write("[autodocs] Analyzing in background...\n");
    void this.get()
      .then(analysis => {
        const pkgs = analysis.packages.length;
        const files = analysis.packages.reduce((n, p) => n + p.files.total, 0);
        process.stderr.write(`[autodocs] Analysis complete (${pkgs} package(s), ${files} files)\n`);
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[autodocs] Background analysis failed: ${msg}\n`);
        process.stderr.write("[autodocs] Will retry on first tool call\n");
      });
  }

  /**
   * Get cached analysis or run fresh analysis.
   * Singleton promise prevents duplicate concurrent analyses.
   */
  async get(): Promise<StructuredAnalysis> {
    const key = this.getCacheKey();
    if (this.cached?.key === key) {
      this._lastWasCacheHit = true;
      return this.cached.analysis;
    }
    this._lastWasCacheHit = false;

    // At-most-one concurrent analysis
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const analysis = await analyze({ packages: [this.projectPath] });
      this.cached = { analysis, key: this.getCacheKey() };
      return analysis;
    })();

    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /**
   * Composite cache key: HEAD + hash(git status output).
   * Catches: committed changes (HEAD), uncommitted modifications,
   * new files, staged changes, deletions.
   * Falls back to time-based TTL for non-git repos.
   */
  private getCacheKey(): string {
    const now = Date.now();
    if (now - this.lastCheckAt < CHECK_TTL_MS && this.cached) {
      return this.cached.key;
    }
    this.lastCheckAt = now;

    const head = this.safeGit(["rev-parse", "HEAD"]);

    if (head === null) {
      // Non-git fallback: time-based TTL
      if (now - this.lastNonGitCheck > NON_GIT_TTL_MS) {
        this.lastNonGitCheck = now;
        this.nonGitEpoch++;
      }
      return `no-git:${this.nonGitEpoch}`;
    }

    // Hash git status output (no -uno: includes untracked files)
    const status = this.safeGit(["status", "--porcelain"]) ?? "";
    let hash = 0;
    for (let i = 0; i < status.length; i++) {
      hash = ((hash << 5) - hash + status.charCodeAt(i)) | 0;
    }
    return `${head}:${hash}`;
  }

  private safeGit(args: string[]): string | null {
    try {
      return execFileSync("git", args, {
        cwd: this.projectPath,
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  }
}
