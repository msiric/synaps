# MCP Server Plan v3: Codebase Intelligence API (Final — Post 2 Adversarial Rounds)

## Context

autodocs-engine is a TypeScript codebase intelligence engine (18-stage pipeline, 390 tests, ~15K lines). Benchmark data across 3 repos proved AGENTS.md's value is in operational intelligence — Commands +16.7%, Architecture +18.8%, Patterns +6.4%.

The MCP server transforms the engine from a static document generator into a live codebase intelligence API, serving exactly what the AI needs for the current task.

**Revision history:**
- v1: 5 adversarial reviews → all REVISE (cache broken, lazy init wrong, no monorepo, no error handling)
- v2: 5 adversarial reviews → 3 APPROVE, 2 REVISE (minor: -uno flag, async bug, warmup logging)
- v3 (this): Incorporates all 6 remaining fixes. Ready to build.

## Architecture

### Distribution
Integrated `serve` subcommand: `npx autodocs-engine serve`

### Transport
STDIO only (v1). Client spawns process, communicates via stdin/stdout.

### Caching (v3 — all fixes applied)

```typescript
class AnalysisCache {
  private cached: { analysis: StructuredAnalysis; key: string } | null = null;
  private inflight: Promise<StructuredAnalysis> | null = null;
  private lastCheckAt = 0;
  private nonGitEpoch = 0;
  private readonly CHECK_TTL_MS = 300;
  private readonly NON_GIT_TTL_MS = 15_000; // 15s TTL for non-git repos
  private lastNonGitCheck = 0;

  // Eager warmup — call AFTER server.connect() to avoid event loop blocking
  warm(): void {
    process.stderr.write("[autodocs] Analyzing in background...\n");
    void this.get()
      .then(analysis => {
        const pkgs = analysis.packages.length;
        const files = analysis.packages.reduce((n, p) => n + p.files.total, 0);
        process.stderr.write(`[autodocs] Analysis complete (${pkgs} package(s), ${files} files)\n`);
      })
      .catch(err => {
        process.stderr.write(`[autodocs] Background analysis failed: ${err.message}\n`);
        process.stderr.write("[autodocs] Will retry on first tool call\n");
      });
  }

  async get(): Promise<StructuredAnalysis> {
    const key = this.getCacheKey();
    if (this.cached?.key === key) return this.cached.analysis;

    // Singleton promise: at-most-one concurrent analysis
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const analysis = await analyze({ packages: [this.projectPath] });
      this.cached = { analysis, key: this.getCacheKey() };
      return analysis;
    })();

    try { return await this.inflight; }
    finally { this.inflight = null; }
  }

  private getCacheKey(): string {
    const now = Date.now();
    if (now - this.lastCheckAt < this.CHECK_TTL_MS && this.cached) {
      return this.cached.key;
    }
    this.lastCheckAt = now;

    const head = this.safeGit(["rev-parse", "HEAD"]);

    if (head === null) {
      // Non-git fallback: time-based TTL
      if (now - this.lastNonGitCheck > this.NON_GIT_TTL_MS) {
        this.lastNonGitCheck = now;
        this.nonGitEpoch++;
      }
      return `no-git:${this.nonGitEpoch}`;
    }

    // Hash git status output (catches: different files modified, new files, deletions)
    // No -uno flag: includes untracked files
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
        cwd: this.projectPath, encoding: "utf-8",
        timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch { return null; }
  }
}
```

**Key properties:**
- **Eager warmup after connect:** `cache.warm()` called after `server.connect()` completes — prevents event loop blocking during MCP handshake
- **Untracked files detected:** No `-uno` flag — `git status --porcelain` catches new, modified, deleted, and staged files
- **Status hash, not binary flag:** Different dirty states produce different cache keys — catches changes within dirty state
- **Non-git TTL fallback:** Repos without git re-analyze every 15 seconds
- **Singleton promise:** Concurrent tool calls await the same analysis
- **Warmup error logging:** Failures logged to stderr with retry message

### Initialization Sequence

```typescript
export async function createAutodocsServer(projectPath: string): Promise<McpServer> {
  const cache = new AnalysisCache(projectPath);
  const server = new McpServer({ name: "autodocs-engine", version: ENGINE_VERSION });

  // Register all tools (each handler awaits cache.get())
  registerTools(server, cache);

  return server;
}

// In serve.ts:
export async function runServe(args: { path?: string; verbose?: boolean }): Promise<void> {
  const projectPath = resolve(args.path ?? ".");
  const server = await createAutodocsServer(projectPath);
  const transport = new StdioServerTransport();

  // Connect first — handshake must complete before heavy work
  await server.connect(transport);

  // THEN warm the cache — analysis runs in background after handshake
  cache.warm();

  process.stderr.write(`[autodocs] MCP server ready (project: ${projectPath})\n`);
}
```

### Error Handling

```typescript
// Fixed: async/await catches promise rejections
async function safeToolHandler(
  fn: () => Promise<{ content: { type: "text"; text: string }[] }>,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    return await fn(); // await ensures async errors are caught
  } catch (err) {
    const msg = err instanceof ToolError
      ? `${err.code}: ${err.message}\n\nHints:\n${err.hints.map(h => `- ${h}`).join("\n")}`
      : `Internal error: ${err instanceof Error ? err.message : String(err)}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
```

## Tool Inventory (8 Tools)

### P0 — Ship in v1

**`get_commands`** — Build/test/lint/start commands + package manager + variants
- When: "how do I run tests?", "what's the build command?"
- Not: architecture, dependencies, patterns
- Input: `{ packagePath?: string }`
- Output: ~400 tokens. Markdown table with commands + tech stack summary line
- Source: `commands` + `dependencyInsights` (runtime/framework info folded in)

**`get_architecture`** — Directory structure with purposes, package type, entry point
- When: "where should I put this?", "what's the project structure?"
- Not: specific files, imports, commands
- Input: `{ packagePath?: string }`
- Output: ~800 tokens. Indented tree with purpose annotations
- Source: `architecture`

**`analyze_impact`** — What breaks when you change a file or function
- When: "what depends on X?", "blast radius of changing this?", "I'm refactoring this"
- Not: where to put new code, what commands to run
- Input: `{ filePath?, functionName?, packagePath?, scope?: "all"|"imports"|"callers"|"cochanges", limit?: 1-50 (default 20) }`
- Output: ~1200 tokens (bounded by limit). Sectioned: importers, callers, co-change partners
- Source: `importChain` + `callGraph` + `gitHistory`

**`get_workflow_rules`** — "After X, do Y" operational rules
- When: "I just changed the schema", "what should I do after modifying X?"
- Not: which command runs tests (use get_commands), where code goes (use get_architecture)
- Input: `{ packagePath?: string }`
- Output: ~600 tokens. Numbered rules with trigger/action/source
- Source: `crossPackage.workflowRules`

**`list_packages`** — All packages with names, paths, types, entry points
- When: first query in monorepo, "what packages are here?", "where is the UI code?"
- Not: single-package repos (returns one item)
- Input: `{}` (no args)
- Output: ~200 tokens. Markdown table
- Source: `analysis.packages`

### P1 — Ship if time permits

**`get_contribution_guide`** — Step-by-step "how to add new code" recipes
- When: "how do I add a new detector?", "what's the pattern for new components?"
- Input: `{ directory?: string, packagePath?: string }`
- Output: ~1500 tokens
- Source: `contributionPatterns`

**`get_exports`** — Public API sorted by import count
- When: "what can I import?", "what's the public API?"
- Input: `{ packagePath?, query?: string, limit?: number }`
- Output: ~1500 tokens (top 20 default)
- Source: `publicAPI`

### P2 — Defer if needed

**`get_conventions`** — DO/DON'T rules (architecture patterns, not style)
- When: "what patterns does this project follow?"
- Input: `{ packagePath?: string }`
- Output: ~800 tokens
- Source: `conventions` + `antiPatterns`

## Package Resolution

```typescript
function resolvePackage(analysis: StructuredAnalysis, packagePath?: string): PackageAnalysis {
  if (!packagePath) {
    if (analysis.packages.length === 1) return analysis.packages[0];
    throw new ToolError("AMBIGUOUS_PACKAGE",
      `Multiple packages found. Specify packagePath.`,
      [`Call list_packages to see all packages`,
       `Available: ${analysis.packages.map(p => p.name).join(", ")}`]
    );
  }
  const pkg = analysis.packages.find(p =>
    p.relativePath === packagePath || p.name === packagePath
  );
  if (!pkg) {
    throw new ToolError("PACKAGE_NOT_FOUND",
      `Package '${packagePath}' not found.`,
      [`Available: ${analysis.packages.map(p => p.name).join(", ")}`,
       `Call list_packages for full details`]
    );
  }
  return pkg;
}
```

## Error Scenarios

| Scenario | Code | Hints |
|----------|------|-------|
| No package.json | `NO_PROJECT` | ["Is this a JS/TS project?"] |
| Corrupt tsconfig | `ANALYSIS_PARTIAL` | ["TypeScript config invalid, some data unavailable"] |
| No git | `NO_GIT` | ["Co-change data unavailable", "Other tools work normally"] |
| Ambiguous package | `AMBIGUOUS_PACKAGE` | ["Call list_packages", "Specify packagePath"] |
| Package not found | `PACKAGE_NOT_FOUND` | ["Check spelling", available packages] |
| Function not found | `NOT_FOUND` | ["Did you mean: {fuzzy}?"] |
| Analysis timeout (>30s) | `TIMEOUT` | ["Repo may be too large", "Try a specific package"] |
| Empty project | `EMPTY_PROJECT` | ["No analyzable packages found"] |

## Implementation

### File Structure

```
src/
  mcp/
    server.ts           (~180 lines)  McpServer factory + tool registration
    tools.ts            (~350 lines)  Tool handler implementations
    cache.ts            (~120 lines)  AnalysisCache with all fixes
    queries.ts          (~120 lines)  Data access layer over StructuredAnalysis
    errors.ts           (~50 lines)   ToolError + safeToolHandler (async-safe)
  bin/
    serve.ts            (~60 lines)   CLI entry + connect-then-warm + signal handlers
    autodocs-engine.ts  (+10 lines)   Route serve subcommand
test/
  mcp/
    tools.test.ts       (~250 lines)  Tool response validation per tool
    cache.test.ts       (~120 lines)  Invalidation: HEAD, dirty, untracked, non-git TTL, concurrency
    queries.test.ts     (~80 lines)   Data access + package resolution
```

**Total: ~880 new source lines + ~450 test lines**

### New Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "zod": "^3.25.0"
}
```

Lazy-loaded via dynamic import in `serve.ts`. Non-serve CLI users don't pay the cost.

### Signal Handling

```typescript
process.on("SIGTERM", () => {
  process.stderr.write("[autodocs] Shutting down\n");
  process.exit(0);
});
process.on("SIGINT", () => {
  process.stderr.write("[autodocs] Interrupted\n");
  process.exit(0);
});
```

### Telemetry (opt-in via --verbose or AUTODOCS_DEBUG=1)

```
[autodocs] tool=get_commands latency=42ms cache=hit package=root
[autodocs] tool=analyze_impact latency=1204ms cache=miss package=packages/core scope=all
```

## User Setup

**Claude Code:**
```bash
claude mcp add --transport stdio autodocs -- npx autodocs-engine serve
```

**Project .mcp.json (version-controlled):**
```json
{
  "mcpServers": {
    "autodocs": {
      "command": "npx",
      "args": ["-y", "autodocs-engine", "serve"]
    }
  }
}
```

## What We're NOT Building (v1)

- HTTP transport, disk cache, LLM synthesis tools, Resource endpoints
- Prompt templates, file watching, VS Code extension
- get_tech_stack (folded into get_commands)

## Verification

1. `npm run typecheck` — 0 errors
2. `npm test` — all 390 existing + ~30 new MCP tests pass
3. Server starts, logs analysis progress to stderr
4. Claude Code: tools discoverable, responses correct
5. Modify tracked file (uncommitted) → cache invalidates → fresh data
6. Create new file (untracked) → cache invalidates → fresh data
7. Non-git repo → TTL-based re-analysis every 15s
8. Second query on same state → <50ms (cache hit)
9. Monorepo → `list_packages` returns all, tools accept packagePath
10. Concurrent tool calls during analysis → singleton promise, no duplicate work
