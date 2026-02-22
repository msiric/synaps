// src/bin/serve.ts — CLI entry point for MCP server
// Usage: autodocs-engine serve [path] [--verbose]

import { resolve } from "node:path";

export async function runServe(args: { path?: string; verbose?: boolean }): Promise<void> {
  const projectPath = resolve(args.path ?? ".");

  // Lazy-load MCP dependencies — users who don't use serve don't pay the cost
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { createAutodocsServer } = await import("../mcp/server.js");

  const verbose = args.verbose ?? Boolean(process.env.AUTODOCS_DEBUG);
  const { server, cache } = createAutodocsServer(projectPath, { verbose });
  const transport = new StdioServerTransport();

  // Connect first — handshake must complete before heavy analysis work
  await server.connect(transport);

  // THEN warm the cache — analysis runs in background after handshake
  cache.warm();

  process.stderr.write(`[autodocs] MCP server ready (project: ${projectPath})\n`);

  // Signal handlers for clean shutdown
  process.on("SIGTERM", () => {
    process.stderr.write("[autodocs] Shutting down\n");
    process.exit(0);
  });
  process.on("SIGINT", () => {
    process.stderr.write("[autodocs] Interrupted\n");
    process.exit(0);
  });
}
