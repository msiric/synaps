// src/bin/serve.ts — CLI entry point for MCP server
// Usage: autodocs-engine serve [path] [--verbose] [--telemetry]

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

export async function runServe(args: { path?: string; verbose?: boolean; telemetry?: boolean }): Promise<void> {
  const projectPath = resolve(args.path ?? ".");

  // Lazy-load MCP dependencies — users who don't use serve don't pay the cost
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { createAutodocsServer, formatSessionSummary } = await import("../mcp/server.js");

  const verbose = args.verbose ?? Boolean(process.env.AUTODOCS_DEBUG);
  const telemetry = args.telemetry ?? process.env.AUTODOCS_TELEMETRY === "1";
  const { server, cache, session } = createAutodocsServer(projectPath, { verbose, telemetry });
  const transport = new StdioServerTransport();

  // Connect first — handshake must complete before heavy analysis work
  await server.connect(transport);

  process.stderr.write(`[autodocs] MCP server ready (project: ${projectPath})\n`);

  // Defer warmup to next tick — ensures the MCP handshake response is fully
  // flushed before synchronous AST parsing blocks the event loop.
  // Without this, large repos block the transport and Claude Code times out.
  setTimeout(() => cache.warm(), 100);

  // Shutdown: process.on('exit') fires on all exit paths including stdin EOF
  // (the normal MCP shutdown path when Claude Code closes). Only sync I/O allowed.
  let finalized = false;
  function finalize(): void {
    if (finalized) return;
    finalized = true;
    if (session.calls.size === 0) return;

    process.stderr.write(formatSessionSummary(session) + "\n");

    // Write session summary to JSONL
    if (session.telemetryPath) {
      try {
        appendFileSync(session.telemetryPath, JSON.stringify({
          v: 1,
          type: "session",
          ts: new Date().toISOString(),
          runId: session.runId,
          durationMs: Date.now() - session.startTime,
          totalCalls: [...session.calls.values()].reduce((a, b) => a + b, 0),
          estInputTokens: session.totalInputTokens,
          estOutputTokens: session.totalOutputTokens,
          errors: session.errors,
          tools: Object.fromEntries(session.calls),
        }) + "\n");
      } catch { /* best-effort */ }
    }
  }

  process.on("exit", finalize);

  // Signal handlers — call process.exit() so the 'exit' handler fires
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));

  // Crash handlers — finalize before dying
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[autodocs] Uncaught exception: ${err.message}\n`);
    finalize();
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`[autodocs] Unhandled rejection: ${reason}\n`);
    finalize();
    process.exit(1);
  });
}
