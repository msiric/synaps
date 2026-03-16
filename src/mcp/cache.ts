// src/mcp/cache.ts — Analysis cache with dirty-tree detection + eager warmup
// Fixes applied from 2 rounds of adversarial review:
// - No -uno: includes untracked files in dirty detection
// - Hash status output: catches within-dirty-state changes
// - Non-git TTL fallback: 15s re-analysis for repos without git
// - Singleton promise: prevents concurrent duplicate analyses
// - Warmup error logging: failures visible in stderr

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { analyze } from "../index.js";
import type { StructuredAnalysis } from "../types.js";

const CHECK_TTL_MS = 300; // Don't hammer git on rapid-fire calls
const NON_GIT_TTL_MS = 15_000; // Re-analyze non-git repos every 15s

export interface CacheMeta {
  analyzedAt: string;
  analyzedCommit: string;
  isFresh: boolean;
}

export interface CacheOptions {
  typeChecking?: boolean;
}

export class AnalysisCache {
  private projectPath: string;
  private options: CacheOptions;
  private cached: { analysis: StructuredAnalysis; key: string; analyzedAt: string } | null = null;
  private inflight: Promise<StructuredAnalysis> | null = null;
  private lastCheckAt = 0;
  private nonGitEpoch = 0;
  private lastNonGitCheck = 0;
  private _lastWasCacheHit = false;

  /** Whether the most recent get() call was a cache hit. */
  get lastWasCacheHit(): boolean {
    return this._lastWasCacheHit;
  }

  /** Freshness metadata for tool responses. */
  getMeta(): CacheMeta {
    const key = this.cached?.key ?? "";
    const commit = key.includes(":") ? key.split(":")[0] : "unknown";
    const currentKey = this.getCacheKey();
    return {
      analyzedAt: this.cached?.analyzedAt ?? new Date().toISOString(),
      analyzedCommit: commit.length === 40 ? commit.slice(0, 8) : commit,
      isFresh: this.cached?.key === currentKey,
    };
  }

  constructor(projectPath: string, options: CacheOptions = {}) {
    this.projectPath = resolve(projectPath);
    this.options = options;
  }

  /**
   * Eager warmup — call AFTER server.connect() to avoid event loop blocking.
   */
  warm(): void {
    process.stderr.write("[autodocs] Analyzing in background...\n");
    void this.get()
      .then((analysis) => {
        const pkgs = analysis.packages.length;
        const files = analysis.packages.reduce((n, p) => n + p.files.total, 0);
        process.stderr.write(`[autodocs] Analysis complete (${pkgs} package(s), ${files} files)\n`);

        // Warn about shallow clone limiting co-change analysis
        const hasCoChange = analysis.packages.some((p) => (p.gitHistory?.coChangeEdges?.length ?? 0) > 0);
        if (!hasCoChange) {
          const isShallow = this.safeGit(["rev-parse", "--is-shallow-repository"]);
          if (isShallow === "true") {
            process.stderr.write(
              "[autodocs] Note: shallow clone — co-change analysis unavailable. Run `git fetch --unshallow` for richer analysis.\n",
            );
          }
        }
      })
      .catch((err) => {
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
      const analysis = await analyze({
        packages: [this.projectPath],
        typeChecking: this.options.typeChecking,
      });
      this.cached = { analysis, key: this.getCacheKey(), analyzedAt: new Date().toISOString() };
      this.persistToDisk(analysis);
      return analysis;
    })();

    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /**
   * Write a snapshot of the analysis to disk for use by Claude Code hooks.
   * Hooks run as separate processes and can't access in-memory cache.
   * Contains only the data hooks need (import chain, call graph, co-change, flows).
   */
  private persistToDisk(analysis: StructuredAnalysis): void {
    try {
      const cacheDir = join(homedir(), ".autodocs", "cache");
      mkdirSync(cacheDir, { recursive: true });

      const projectHash = createHash("sha256").update(this.projectPath).digest("hex").slice(0, 12);
      const cacheFile = join(cacheDir, `${projectHash}.json`);

      const snapshot = {
        projectPath: this.projectPath,
        cacheKey: this.cached?.key,
        analyzedAt: this.cached?.analyzedAt,
        packages: analysis.packages.map((pkg) => ({
          name: pkg.name,
          relativePath: pkg.relativePath,
          importChain: pkg.importChain,
          callGraph: pkg.callGraph,
          gitHistory: pkg.gitHistory ? { coChangeEdges: pkg.gitHistory.coChangeEdges } : undefined,
          executionFlows: pkg.executionFlows,
          implicitCoupling: pkg.implicitCoupling,
          conventions: pkg.conventions?.map((c) => ({
            name: c.name,
            description: c.description,
            category: c.category,
            source: c.source,
          })),
          publicAPI: pkg.publicAPI.map((e) => ({
            name: e.name,
            kind: e.kind,
            sourceFile: e.sourceFile,
            importCount: e.importCount,
          })),
        })),
        workflowRules: analysis.crossPackage?.workflowRules?.map((r) => ({
          trigger: r.trigger,
          action: r.action,
          source: r.source,
        })),
      };

      writeFileSync(cacheFile, JSON.stringify(snapshot));
    } catch {
      // Best-effort — never crash the server for cache persistence
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
    const hash = createHash("sha256").update(status).digest("hex").slice(0, 12);
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
