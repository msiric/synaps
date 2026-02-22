// src/mcp/server.ts — MCP Server factory
// Creates an McpServer with all registered tools.
// Tools query cached StructuredAnalysis via the queries layer.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ENGINE_VERSION } from "../types.js";
import { AnalysisCache } from "./cache.js";
import { safeToolHandler } from "./errors.js";
import * as tools from "./tools.js";

export { AnalysisCache } from "./cache.js";

export interface ServerOptions {
  verbose?: boolean;
}

/**
 * Create an autodocs-engine MCP server with all tools registered.
 * Call server.connect(transport) then cache.warm() after.
 */
export function createAutodocsServer(
  projectPath: string,
  options: ServerOptions = {},
): {
  server: McpServer;
  cache: AnalysisCache;
} {
  const verbose = options.verbose ?? Boolean(process.env.AUTODOCS_DEBUG);

  const server = new McpServer({
    name: "autodocs-engine",
    version: ENGINE_VERSION,
  });

  const cache = new AnalysisCache(projectPath);

  /**
   * Telemetry wrapper: logs tool name, latency, and cache status to stderr.
   * Active when --verbose is set or AUTODOCS_DEBUG=1.
   */
  function withTelemetry(
    toolName: string,
    fn: () => Promise<{ content: { type: "text"; text: string }[] }>,
  ): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
    const start = performance.now();
    return safeToolHandler(fn).then(result => {
      if (verbose) {
        const latency = Math.round(performance.now() - start);
        const cacheStatus = cache.lastWasCacheHit ? "hit" : "miss";
        const status = result.isError ? " ERROR" : "";
        process.stderr.write(
          `[autodocs] tool=${toolName} latency=${latency}ms cache=${cacheStatus}${status}\n`,
        );
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
    { packagePath: z.string().optional().describe("Package path or name. Omit for single-package repos.") },
    async (args) => withTelemetry("get_commands", () =>
      cache.get().then(a => tools.handleGetCommands(a, args)),
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
    { packagePath: z.string().optional().describe("Package path or name.") },
    async (args) => withTelemetry("get_architecture", () =>
      cache.get().then(a => tools.handleGetArchitecture(a, args)),
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
      scope: z.enum(["all", "imports", "callers", "cochanges"]).optional()
        .describe("Narrow analysis: 'imports' for file importers only, 'callers' for function callers only, 'cochanges' for git history only. Default: all."),
      limit: z.number().min(1).max(50).optional().describe("Max results per section. Default: 20."),
    },
    async (args) => withTelemetry("analyze_impact", () =>
      cache.get().then(a => tools.handleAnalyzeImpact(a, args)),
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
    { packagePath: z.string().optional().describe("Package path or name.") },
    async (args) => withTelemetry("get_workflow_rules", () =>
      cache.get().then(a => tools.handleGetWorkflowRules(a, args)),
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
    {},
    async () => withTelemetry("list_packages", () =>
      cache.get().then(a => tools.handleListPackages(a)),
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
    },
    async (args) => withTelemetry("get_contribution_guide", () =>
      cache.get().then(a => tools.handleGetContributionGuide(a, args)),
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
      query: z.string().optional().describe("Filter exports by name (substring match)"),
      limit: z.number().min(1).max(100).optional().describe("Max results. Default: 20."),
    },
    async (args) => withTelemetry("get_exports", () =>
      cache.get().then(a => tools.handleGetExports(a, args)),
    ),
  );

  // ─── P2: get_conventions ─────────────────────────────────────────────
  server.tool(
    "get_conventions",
    `Get DO/DON'T coding conventions for this project (architecture patterns, not style rules handled by linters).

WHEN TO CALL:
- User asks "what patterns does this project follow?", "are there naming conventions?"`,
    { packagePath: z.string().optional().describe("Package path or name.") },
    async (args) => withTelemetry("get_conventions", () =>
      cache.get().then(a => tools.handleGetConventions(a, args)),
    ),
  );

  return { server, cache };
}
