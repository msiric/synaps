// src/mcp/server.ts — MCP Server factory
// Creates an McpServer with all registered tools.
// Tools query cached StructuredAnalysis via the queries layer.

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ENGINE_VERSION } from "../types.js";
import { AnalysisCache } from "./cache.js";
import { safeToolHandler, ToolError } from "./errors.js";
import * as tools from "./tools.js";

export interface ServerOptions {
  verbose?: boolean;
  telemetry?: boolean;
  typeChecking?: boolean;
}

// ─── Session Telemetry ──────────────────────────────────────────────────────

export interface SessionTelemetry {
  startTime: number;
  calls: Map<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
  errors: number;
  seq: number;
  runId: string;
  telemetryPath: string | null;
}

const CHARS_PER_TOKEN = 3.5;

function estimateTokens(text: string): number {
  return Math.round(text.length / CHARS_PER_TOKEN);
}

function getTelemetryPath(projectPath: string): string {
  const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
  const dir = join(homedir(), ".synaps", "telemetry");
  return join(dir, `${hash}.jsonl`);
}

function writeTelemetryEvent(session: SessionTelemetry, event: Record<string, unknown>): void {
  if (!session.telemetryPath) return;
  try {
    mkdirSync(join(homedir(), ".synaps", "telemetry"), { recursive: true });
    appendFileSync(session.telemetryPath, `${JSON.stringify(event)}\n`);
  } catch {
    // Disable file telemetry on failure (read-only FS, disk full, etc.)
    session.telemetryPath = null;
  }
}

// ─── Server Instructions ────────────────────────────────────────────────────
// Injected into Claude's system prompt via the MCP initialize handshake.
// This is what makes Claude actually call our tools instead of using grep/read.

const SERVER_INSTRUCTIONS = `synaps provides pre-computed codebase intelligence that cannot be derived from reading files or running grep. The tools use import graph analysis, git co-change history (Jaccard similarity), and call graph data to answer structural questions.

Recommended workflow:

ONBOARDING (new codebase):
- Call get_commands for build/test/lint commands and tech stack
- Call get_conventions for project-specific DO/DON'T rules
- Call get_architecture for directory structure and entry points
- Call search to find code by concept when you don't know the file path

BEFORE MODIFYING FILES:
- Call plan_change with the files you plan to edit — it returns dependent files from the import graph, co-change partners from git history, registration/barrel files that need updating, and an ordered checklist. This information is NOT available from reading files or grep.

WHEN TESTS FAIL:
- Call diagnose IMMEDIATELY with the error text — it traces backward through the import graph and git co-change history to rank suspect files by structural evidence. This catches "missing co-change" (files that usually change together but one was forgotten) which no amount of error text reading can reveal.

WHEN ADDING NEW FILES:
- Call get_contribution_guide to learn the project's file patterns, naming conventions, registration requirements, and see inline code examples from similar files.
- After creating files, call review_changes to verify pattern compliance, then auto_register for exact registration/barrel insertion code.

These tools return pre-computed structural analysis. They are faster and more accurate than manually searching with grep or reading individual files, especially for understanding cross-file dependencies and historical change patterns.`;

// ─── Next-Step Hints ──────────────────────────────────────────────────────
// Appended to every tool response to guide agent workflow.

function getNextStepHint(toolName: string): string {
  switch (toolName) {
    case "get_commands":
      return "\n\n**Next:** Call `get_architecture` for directory structure and entry points.";
    case "get_architecture":
      return "\n\n**Next:** Call `plan_change` before editing files to check impact.";
    case "get_conventions":
      return "\n\n**Next:** Call `get_contribution_guide` for how to add new code following these patterns.";
    case "get_exports":
      return "\n\n**Next:** Call `analyze_impact` on a specific export to see its blast radius.";
    case "get_workflow_rules":
      return "\n\n**Next:** Call `plan_change` to check full impact before making changes.";
    case "get_contribution_guide":
      return "\n\n**Next:** After creating files, call `auto_register` for registration code.";
    case "plan_change":
      return "\n\n**Next:** Call `get_test_info` on changed files to find which tests to run.";
    case "analyze_impact":
      return "\n\n**Next:** Call `plan_change` with these files to see co-change partners and registration needs.";
    case "diagnose":
      return "\n\n**Next:** Call `plan_change` on the top suspect to understand full blast radius before fixing.";
    case "list_packages":
      return "\n\n**Next:** Call `get_architecture` with a specific package to explore it.";
    case "auto_register":
      return "\n\n**Next:** Call `review_changes` to verify pattern compliance.";
    case "search":
      return "\n\n**Next:** Call `analyze_impact` or `plan_change` on a result to understand its dependencies.";
    case "rename":
      return "\n\n**Next:** Apply the rename edits, then run tests to verify.";
    case "get_module_doc":
      return "\n\n**Next:** Call `plan_change` on specific files to check impact before editing.";
    default:
      return "";
  }
}

/**
 * Create an synaps MCP server with all tools registered.
 * Supports single or multiple project paths (multi-repo).
 * Call server.connect(transport) then warm caches after.
 */
export function createSynapsServer(
  projectPaths: string | string[],
  options: ServerOptions = {},
): {
  server: McpServer;
  caches: Map<string, AnalysisCache>;
  /** @deprecated Use caches.values().next().value for single-repo compat */
  cache: AnalysisCache;
  session: SessionTelemetry;
} {
  const verbose = options.verbose ?? Boolean(process.env.SYNAPS_DEBUG);
  const telemetryEnabled = options.telemetry ?? process.env.SYNAPS_TELEMETRY === "1";

  const server = new McpServer({ name: "synaps", version: ENGINE_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  // Build cache registry — one AnalysisCache per project path
  const paths = Array.isArray(projectPaths) ? projectPaths : [projectPaths];
  const caches = new Map<string, AnalysisCache>();
  for (const p of paths) {
    const resolved = resolve(p);
    caches.set(resolved, new AnalysisCache(resolved, { typeChecking: options.typeChecking }));
  }
  const primaryPath = resolve(paths[0]);

  /**
   * Resolve which cache to use for a tool call.
   * - No repo param + single repo → return the only cache
   * - No repo param + multiple repos → throw with available repos
   * - repo param → match by path suffix, basename, or exact path
   */
  function resolveCache(repo?: string): AnalysisCache {
    if (!repo) {
      if (caches.size === 1) return caches.values().next().value!;
      throw new ToolError("AMBIGUOUS_REPO", "Multiple repos indexed. Specify the repo parameter.", [
        `Available: ${[...caches.keys()].map((p) => basename(p)).join(", ")}`,
        "Use the directory name or full path",
      ]);
    }
    // Exact path match
    const resolved = resolve(repo);
    if (caches.has(resolved)) return caches.get(resolved)!;
    // Basename match
    for (const [path, cache] of caches) {
      if (basename(path) === repo || basename(path).toLowerCase() === repo.toLowerCase()) return cache;
    }
    // Suffix match (only for path-like values containing /)
    if (repo.includes("/")) {
      for (const [path, cache] of caches) {
        if (path.endsWith(repo)) return cache;
      }
    }
    throw new ToolError("REPO_NOT_FOUND", `Repo '${repo}' not found.`, [
      `Available: ${[...caches.keys()].map((p) => basename(p)).join(", ")}`,
    ]);
  }

  const session: SessionTelemetry = {
    startTime: Date.now(),
    calls: new Map(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    errors: 0,
    seq: 0,
    runId: `${Date.now()}-${process.pid}`,
    telemetryPath: telemetryEnabled ? getTelemetryPath(primaryPath) : null,
  };

  /**
   * Telemetry wrapper: tracks token estimates, logs to stderr when verbose,
   * writes per-call JSONL events when telemetry is enabled.
   */
  function withTelemetry(
    toolName: string,
    fn: () => Promise<{ content: { type: "text"; text: string }[] }>,
    args?: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    const start = performance.now();
    const estInputTokens = args ? estimateTokens(JSON.stringify(args)) : 0;

    return safeToolHandler(fn).then((result) => {
      const latencyMs = Math.round(performance.now() - start);
      let cacheStatus = "unknown";
      let usedCache: AnalysisCache | null = null;
      try {
        usedCache =
          caches.size === 1
            ? caches.values().next().value!
            : resolveCache((args as Record<string, unknown> | undefined)?.repo as string | undefined);
        cacheStatus = usedCache.lastWasCacheHit ? "hit" : "miss";
      } catch {
        // resolveCache may throw if repo param was invalid — telemetry should not crash
      }
      const isError = Boolean(result.isError);

      // Estimate output tokens (filter to text blocks only — non-text blocks are ignored)
      const estOutputTokens = estimateTokens(
        (result.content ?? [])
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join(""),
      );

      // Update session state
      session.calls.set(toolName, (session.calls.get(toolName) ?? 0) + 1);
      session.totalInputTokens += estInputTokens;
      session.totalOutputTokens += estOutputTokens;
      if (isError) session.errors++;
      session.seq++;

      if (verbose) {
        process.stderr.write(
          `[synaps] tool=${toolName} latency=${latencyMs}ms cache=${cacheStatus} in=~${estInputTokens}tok out=~${estOutputTokens}tok${isError ? " ERROR" : ""}\n`,
        );
      }

      // Write per-call JSONL event
      writeTelemetryEvent(session, {
        v: 1,
        type: "call",
        ts: new Date().toISOString(),
        runId: session.runId,
        seq: session.seq,
        tool: toolName,
        latencyMs,
        cache: cacheStatus,
        estInputTokens,
        estOutputTokens,
        error: isError,
      });

      // Append next-step hint to guide agent workflow
      const hint = getNextStepHint(toolName);
      if (hint && !isError && result.content.length > 0) {
        const hintTarget = result.content[result.content.length - 1];
        if (hintTarget.type === "text") hintTarget.text += hint;
      }

      // Append freshness metadata to every tool response
      if (!isError && usedCache && result.content.length > 0) {
        const meta = usedCache.getMeta();
        const last = result.content[result.content.length - 1];
        if (last.type === "text") {
          last.text += `\n\n---\n*Analyzed: ${meta.analyzedAt} | Commit: ${meta.analyzedCommit} | ${meta.isFresh ? "Fresh" : "Stale — files changed since analysis"}*`;
        }
      }
      return result;
    });
  }

  // ─── P0: get_commands ────────────────────────────────────────────────
  server.tool(
    "get_commands",
    `Get build, test, lint, and start commands for this project, with package manager and tech stack.

WHEN TO CALL:
- User asks "how do I run tests?", "what's the build command?", "which package manager?"
- User needs to execute a command but doesn't know which one

DO NOT CALL:
- User asks about architecture or where to put code (use get_architecture)
- User asks about dependencies or what frameworks are used`,
    {
      packagePath: z.string().optional().describe("Package path or name. Omit for single-package repos."),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "get_commands",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleGetCommands(a, args)),
        args,
      ),
  );

  // ─── P0: get_architecture ────────────────────────────────────────────
  server.tool(
    "get_architecture",
    `Get project directory structure with entry point, directory purposes, file counts, and package type.

WHEN TO CALL:
- User asks "where should I put this code?", "what's the project structure?"
- User needs to create a new file and doesn't know where it belongs
- User asks "where are the API handlers?" or "where are the tests?"

DO NOT CALL:
- User asks about specific file contents or imports (use analyze_impact)
- User asks about build/test commands (use get_commands)`,
    {
      packagePath: z.string().optional().describe("Package path or name."),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "get_architecture",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleGetArchitecture(a, args)),
        args,
      ),
  );

  // ─── P0: analyze_impact ──────────────────────────────────────────────
  server.tool(
    "analyze_impact",
    `Analyze what code is affected by changing a specific file or function. Returns importers (who depends on this file), callers (who calls this function), and co-change partners (files that historically change together from git).

WHEN TO CALL:
- User says "what breaks if I change X?", "what depends on this?"
- User is about to refactor and needs blast radius
- User asks "what files import from this module?"

DO NOT CALL:
- User asks where to put NEW code (use get_architecture)
- User asks what commands to run (use get_commands)
- User asks about workflow steps after a change (use get_workflow_rules)`,
    {
      filePath: z.string().optional().describe("File to analyze (e.g., 'src/types.ts')"),
      functionName: z.string().optional().describe("Function to find callers for"),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
      scope: z
        .enum(["all", "imports", "callers", "cochanges"])
        .optional()
        .describe(
          "Narrow analysis: 'imports' for file importers only, 'callers' for function callers only, 'cochanges' for git history only. Default: all.",
        ),
      limit: z.number().min(1).max(50).optional().describe("Max results per section. Default: 20."),
    },
    async (args) =>
      withTelemetry(
        "analyze_impact",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleAnalyzeImpact(a, args)),
        args,
      ),
  );

  // ─── P0: get_workflow_rules ──────────────────────────────────────────
  server.tool(
    "get_workflow_rules",
    `Get operational rules about what to do AFTER modifying specific files or technologies. Examples: "after changing schema.prisma, run db:generate", "when modifying src/types.ts, check 12 dependent files".

WHEN TO CALL:
- User just modified a file and asks "what else should I do?"
- User asks about post-change workflows or side effects
- User says "I changed the database schema, now what?"

DO NOT CALL:
- User asks WHICH command runs tests (use get_commands)
- User asks WHERE to put new code (use get_architecture)`,
    {
      filePath: z.string().optional().describe("Filter to rules mentioning this file (e.g., 'src/types.ts')"),
      packagePath: z.string().optional().describe("Package path or name."),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "get_workflow_rules",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleGetWorkflowRules(a, args)),
        args,
      ),
  );

  // ─── P0: list_packages ──────────────────────────────────────────────
  server.tool(
    "list_packages",
    `List all packages in this project with names, paths, types, and entry points.

WHEN TO CALL:
- First query in any monorepo to understand project structure
- User asks "what packages are in this repo?", "where is the UI code?"
- Another tool returned AMBIGUOUS_PACKAGE error

DO NOT CALL:
- Single-package repos (will return one item, which is fine but unnecessary)`,
    { repo: z.string().optional().describe("Repository name or path. Omit if single repo.") },
    async (args) =>
      withTelemetry(
        "list_packages",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleListPackages(a)),
        args,
      ),
  );

  // ─── P1: get_contribution_guide ──────────────────────────────────────
  server.tool(
    "get_contribution_guide",
    `Get step-by-step recipes for adding new code: file patterns, common imports, export conventions, registration files.

WHEN TO CALL:
- User asks "how do I add a new detector?", "what's the pattern for new components?"
- User is creating a new file and wants to follow project conventions`,
    {
      directory: z.string().optional().describe("Filter to patterns in this directory (e.g., 'src/detectors/')"),
      packagePath: z.string().optional().describe("Package path or name."),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "get_contribution_guide",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleGetContributionGuide(a, args)),
        args,
      ),
  );

  // ─── P1: get_exports ─────────────────────────────────────────────────
  server.tool(
    "get_exports",
    `Get public API exports sorted by usage (import count), with kind, signature, and source file.

WHEN TO CALL:
- User asks "what can I import from this package?", "what's the public API?"
- User needs to find a specific export by name`,
    {
      packagePath: z.string().optional().describe("Package path or name."),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
      query: z.string().optional().describe("Filter exports by name (substring match)"),
      limit: z.number().min(1).max(100).optional().describe("Max results. Default: 20."),
    },
    async (args) =>
      withTelemetry(
        "get_exports",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleGetExports(a, args)),
        args,
      ),
  );

  // ─── P2: get_conventions ─────────────────────────────────────────────
  server.tool(
    "get_conventions",
    `Get DO/DON'T coding conventions for this project (architecture patterns, not style rules handled by linters).

WHEN TO CALL:
- User asks "what patterns does this project follow?", "are there naming conventions?"`,
    {
      category: z
        .string()
        .optional()
        .describe("Filter by convention category (e.g., 'file-naming', 'hooks', 'testing', 'ecosystem')"),
      packagePath: z.string().optional().describe("Package path or name."),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "get_conventions",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleGetConventions(a, args)),
        args,
      ),
  );

  // ─── New: plan_change ──────────────────────────────────────────────
  server.tool(
    "plan_change",
    `Analyze what files need updating when you change specific files. Returns dependent files (import graph), co-change partners (git history), registration/barrel files that need updating, corresponding test files, blast radius, and an ordered checklist.

WHEN TO CALL:
- Before making multi-file changes to understand the full impact
- After editing files, to check what else needs updating
- When planning a refactor or significant change

DO NOT CALL:
- For single-line changes in isolated utility files
- When you just need test commands (use get_test_info instead)`,
    {
      files: z
        .array(z.string())
        .describe("Files being edited (repo-relative paths, e.g. ['src/types.ts', 'src/pipeline.ts'])"),
      symbols: z
        .array(z.string())
        .optional()
        .describe(
          "Specific symbols being modified (e.g. ['Convention', 'WorkflowRule']). Narrows dependents to files importing these symbols.",
        ),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "plan_change",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handlePlanChange(a, args)),
        args,
      ),
  );

  // ─── New: get_test_info ───────────────────────────────────────────
  server.tool(
    "get_test_info",
    `Get the test file path and exact run command for a specific source file. Maps source files to their corresponding test files using detected patterns.

WHEN TO CALL:
- After modifying a file, to know which test to run
- When adding a new file, to know where the test should go and how to run it

DO NOT CALL:
- When you want to run the full test suite (use get_commands instead)
- When you need test conventions for the whole project (use get_conventions with category='testing')`,
    {
      filePath: z.string().describe("Source file path (e.g., 'src/detectors/file-naming.ts')"),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "get_test_info",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleGetTestInfo(a, args)),
        args,
      ),
  );

  // ─── New: auto_register ─────────────────────────────────────────
  server.tool(
    "auto_register",
    `Generate exact code insertions to register a new file in registration files and barrel/index files. Returns line numbers and code to insert.

WHEN TO CALL:
- After creating a new file that follows a contribution pattern
- When plan_change or review_changes indicates registration is needed

DO NOT CALL:
- For files in directories without contribution patterns
- When modifying existing files (this is for NEW files only)`,
    {
      newFilePath: z.string().describe("Path of the newly created file (e.g., 'src/detectors/graphql.ts')"),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "auto_register",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleAutoRegister(a, args)),
        args,
      ),
  );

  // ─── New: review_changes ──────────────────────────────────────────
  server.tool(
    "review_changes",
    `Review generated code against detected contribution patterns. Checks: export naming suffix, common imports, registration status, barrel exports, and test file existence. Returns pass/fail per check.

WHEN TO CALL:
- After generating new files, before presenting them to the user
- To verify code follows project conventions

DO NOT CALL:
- For style/formatting issues (use linters instead)
- For type checking (use TypeScript compiler instead)`,
    {
      files: z
        .array(
          z.object({
            path: z.string().describe("File path"),
            content: z.string().describe("File content"),
          }),
        )
        .describe("Files to review"),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "review_changes",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleReviewChanges(a, args)),
        args,
      ),
  );

  // ─── New: get_module_doc ────────────────────────────────────────
  server.tool(
    "get_module_doc",
    `Get structured documentation for a directory/module: files, exports, dependencies, dependents, internal call graph, execution flows, co-change partners, and contribution patterns.

WHEN TO CALL:
- User asks "tell me about the MCP module" or "what does src/detectors/ do?"
- User needs an overview of a directory before modifying it
- User wants to understand module boundaries and dependencies

DO NOT CALL:
- For individual file or symbol details (use analyze_impact or get_exports)
- For finding code by concept (use search)`,
    {
      directory: z.string().describe("Directory path (e.g., 'src/mcp', 'src/detectors')"),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "get_module_doc",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleGetModuleDoc(a, args)),
        args,
      ),
  );

  // ─── New: diagnose ──────────────────────────────────────────────
  server.tool(
    "diagnose",
    `Diagnose test failures by tracing backward from errors to likely root cause using import graph, git co-change history, and call graph analysis. Returns ranked suspect files with evidence.

WHEN TO CALL:
- IMMEDIATELY after a test failure — before attempting any fix
- When an error's root cause isn't obvious from the stack trace alone
- When a fix attempt caused a new failure (breaking the "fix loop")

DO NOT CALL:
- For syntax errors or import-not-found (the fix is in the error message)
- When the failing file is the obvious and only cause
- For build/config errors (check get_commands or get_workflow_rules instead)`,
    {
      errorText: z.string().optional().describe("Raw test output / stack trace / error message"),
      filePath: z.string().optional().describe("File where the error occurs (e.g., 'src/types.ts')"),
      testFile: z.string().optional().describe("Failing test file (e.g., 'test/pipeline.test.ts')"),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "diagnose",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleDiagnose(a, args)),
        args,
      ),
  );

  // ─── New: search ────────────────────────────────────────────────
  server.tool(
    "search",
    `Search for symbols, files, and patterns across the codebase. Returns functions, types, files, and conventions matching the query, enriched with call graph context (callers/callees) and co-change partners.

WHEN TO CALL:
- User asks "where is X?", "find the authentication code", "what handles validation?"
- User needs to discover code by concept before knowing specific file paths
- User wants to find internal functions not in the public API

DO NOT CALL:
- User already knows the file and wants impact analysis (use analyze_impact)
- User wants to understand what changes when modifying known files (use plan_change)`,
    {
      query: z.string().describe("Search term — matches symbol names, file paths, and convention descriptions"),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
      limit: z.number().min(1).max(50).optional().describe("Max results. Default: 20."),
    },
    async (args) =>
      withTelemetry(
        "search",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleSearch(a, args)),
        args,
      ),
  );

  // ─── New: rename ─────────────────────────────────────────────────
  server.tool(
    "rename",
    `Find all references to a symbol for safe renaming. Returns the definition location, all import sites, re-exports, and call sites with a rename checklist. Preview only — does not modify files.

WHEN TO CALL:
- User wants to rename a function, type, class, or constant across the codebase
- User asks "what would break if I rename X?" or "where is X used?"
- User needs to find all import statements referencing a symbol

DO NOT CALL:
- For simple find-and-replace of string literals (use grep)
- For renaming files (this tracks symbol references, not file paths)`,
    {
      symbolName: z.string().describe("Current name of the symbol to rename"),
      newName: z.string().describe("New name for the symbol"),
      filePath: z.string().optional().describe("File where the symbol is defined (for disambiguation)"),
      packagePath: z.string().optional().describe("Package path or name"),
      repo: z.string().optional().describe("Repository name or path. Omit if single repo."),
    },
    async (args) =>
      withTelemetry(
        "rename",
        () =>
          resolveCache(args?.repo)
            .get()
            .then((a) => tools.handleRename(a, args)),
        args,
      ),
  );

  // ─── MCP Resources ────────────────────────────────────────────────
  // Static data exposed as resources — cheaper than tool calls for context.

  server.resource("conventions", "synaps://conventions", { mimeType: "text/markdown" }, async () => {
    const a = await resolveCache().get();
    const pkg = a.packages[0];
    if (!pkg)
      return {
        contents: [{ uri: "synaps://conventions", mimeType: "text/markdown", text: "No analysis available." }],
      };
    const lines = ["# Conventions", ""];
    for (const c of pkg.conventions) {
      lines.push(`- **${c.name}** (${c.category}): ${c.description}`);
    }
    for (const ap of pkg.antiPatterns) {
      lines.push(`- **DON'T:** ${ap.rule} — ${ap.reason}`);
    }
    return { contents: [{ uri: "synaps://conventions", mimeType: "text/markdown", text: lines.join("\n") }] };
  });

  server.resource("processes", "synaps://processes", { mimeType: "text/markdown" }, async () => {
    const a = await resolveCache().get();
    const pkg = a.packages[0];
    const flows = pkg?.executionFlows ?? [];
    const lines = ["# Execution Flows", ""];
    if (flows.length === 0) {
      lines.push("No execution flows detected (call graph may be too sparse).");
    } else {
      for (const f of flows) {
        const conf = f.confidence > 0 ? ` (confidence: ${Math.round(f.confidence * 100)}%)` : "";
        lines.push(`- ${f.label}${conf}`);
      }
    }
    return { contents: [{ uri: "synaps://processes", mimeType: "text/markdown", text: lines.join("\n") }] };
  });

  server.resource("clusters", "synaps://clusters", { mimeType: "text/markdown" }, async () => {
    const a = await resolveCache().get();
    const pkg = a.packages[0];
    const clusters = pkg?.coChangeClusters ?? [];
    const lines = [
      "# Co-change Clusters",
      "",
      "Groups of files that frequently change together (all pairs co-change).",
      "",
    ];
    if (clusters.length === 0) {
      lines.push("No clusters detected (requires git history with 3+ files co-changing as a clique).");
    } else {
      for (let i = 0; i < clusters.length; i++) {
        lines.push(`### Cluster ${i + 1} (${clusters[i].length} files)`);
        for (const f of clusters[i]) lines.push(`- \`${f}\``);
        lines.push("");
      }
    }
    return { contents: [{ uri: "synaps://clusters", mimeType: "text/markdown", text: lines.join("\n") }] };
  });

  server.resource("packages", "synaps://packages", { mimeType: "text/markdown" }, async () => {
    const a = await resolveCache().get();
    const lines = ["# Packages", ""];
    for (const pkg of a.packages) {
      lines.push(
        `- **${pkg.name}** (${pkg.relativePath}) — ${pkg.architecture.packageType}, ${pkg.files.total} files, entry: ${pkg.architecture.entryPoint}`,
      );
    }
    return { contents: [{ uri: "synaps://packages", mimeType: "text/markdown", text: lines.join("\n") }] };
  });

  server.resource("schema", "synaps://schema", { mimeType: "text/markdown" }, async () => ({
    contents: [
      {
        uri: "synaps://schema",
        mimeType: "text/markdown",
        text: [
          "# synaps Analysis Schema",
          "",
          "Each analyzed package contains:",
          "- **publicAPI**: Exported symbols with kind, source file, import count, resolved types",
          "- **callGraph**: Cross-file function call edges with confidence",
          "- **importChain**: File-to-file import edges with symbol lists",
          "- **gitHistory.coChangeEdges**: File pairs that frequently change together (Jaccard similarity)",
          "- **implicitCoupling**: Co-change pairs with NO import relationship",
          "- **coChangeClusters**: Groups of 3+ files that ALL co-change (cliques)",
          "- **executionFlows**: Entry-to-terminal execution paths through call graph",
          "- **conventions**: Detected coding patterns from 13 AST-based detectors",
          "- **contributionPatterns**: How to add new code (file patterns, registration, common imports)",
          "- **commands**: Build, test, lint, start commands with exact flags",
          "",
          "Use `search` to find symbols by concept. Use `plan_change` before modifying files.",
          "Use `diagnose` when tests fail. Use `analyze_impact` for blast radius.",
        ].join("\n"),
      },
    ],
  }));

  // ─── MCP Prompts ──────────────────────────────────────────────────
  // Guided workflows composing tools + resources.

  server.prompt("analyze-impact", "Analyze blast radius of current changes before committing", async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Analyze the impact of my current code changes. Follow these steps:",
            "",
            "1. Run `git diff --name-only` to identify changed files",
            "2. Call the `plan_change` tool with those files to see dependents, co-change partners, and registration needs",
            "3. Check the `synaps://clusters` resource to see if any changed files belong to co-change clusters",
            "4. Summarize: what's the blast radius? What other files might need updating? What tests should I run?",
          ].join("\n"),
        },
      },
    ],
  }));

  server.prompt(
    "onboard",
    "Understand this codebase — commands, architecture, conventions, and key patterns",
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Help me understand this codebase. Follow these steps:",
              "",
              "1. Call `get_commands` for build, test, and lint commands",
              "2. Call `get_architecture` for directory structure, entry points, and execution flows",
              "3. Call `get_conventions` for the project's DO and DON'T rules",
              "4. Read the `synaps://schema` resource to understand what analysis data is available",
              "5. Summarize the key things I need to know to start contributing",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return { server, caches, cache: caches.get(primaryPath)!, session };
}

/**
 * Format session telemetry as a human-readable summary for stderr.
 */
export function formatSessionSummary(session: SessionTelemetry): string {
  const durationSec = Math.round((Date.now() - session.startTime) / 1000);
  const totalCalls = [...session.calls.values()].reduce((a, b) => a + b, 0);
  const toolList = [...session.calls.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count})`)
    .join(", ");

  const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

  return [
    `[synaps] Session: ${totalCalls} calls, ~${fmtTokens(session.totalInputTokens)} input tokens, ~${fmtTokens(session.totalOutputTokens)} output tokens, ${durationSec}s`,
    `[synaps] Tools: ${toolList}`,
  ].join("\n");
}
