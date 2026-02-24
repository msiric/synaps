# MCP Server Research — Synthesis of 3 Investigation Agents

## Investigation Date: 2026-02-22

Three parallel research agents investigated: (1) MCP protocol specification, (2) pipeline data mapping for MCP, (3) MCP server architecture patterns.

---

## Key Findings

### Protocol
- MCP uses **JSON-RPC 2.0** over STDIO (local) or Streamable HTTP (remote)
- Three primitives: **Tools** (model-driven actions), **Resources** (application-driven data), **Prompts** (user-driven templates)
- Server lifecycle: Initialize (capability handshake) → Operate → Shutdown
- SDK: `@modelcontextprotocol/sdk` + `zod` peer dependency
- Default timeout: 60 seconds. Output limit: 25,000 tokens

### Integration with AI Tools
- **Claude Code**: Configure in `.mcp.json` (project) or `~/.claude.json` (user). Add via `claude mcp add --transport stdio autodocs -- npx autodocs-engine serve`
- **Cursor**: Supports MCP via `~/.cursor/mcp.json`
- Both support STDIO and HTTP transports
- Claude Code has `MCP_TIMEOUT` and `MAX_MCP_OUTPUT_TOKENS` env vars

### Data Available for MCP
- 19 fields per PackageAnalysis, all deterministic and cacheable
- 7 cross-package fields for monorepos
- Analysis time: 600ms-2s depending on repo size
- Memory: ~500KB per analysis (trivial to cache)
- All 14 deterministic sections serveable without LLM

### Architecture Decision
- **Recommended**: Integrated `serve` subcommand in existing CLI
- **Transport**: STDIO default, HTTP optional
- **Caching**: In-memory + disk, invalidate on git HEAD change
- **Security**: Read-only, path validation, API key via env var only
- **Distribution**: Same npm package, `npx autodocs-engine serve`

---

## MCP Tool Mapping (from Benchmark Data)

Based on benchmark results showing Commands +16.7% and Architecture +18.8% delta:

| MCP Tool | Query | Benchmark Delta | Priority |
|----------|-------|:---:|:---:|
| `get-commands` | Build/test/lint commands | +16.7% | P0 |
| `get-architecture` | Directory structure + purposes | +18.8% | P0 |
| `analyze-impact` | "What breaks if I change X?" | Untested (expected high) | P0 |
| `get-co-changes` | "What files change together?" | Untested (expected high) | P0 |
| `get-workflow-rules` | "After X, do Y" | Untested (expected moderate) | P1 |
| `get-contribution-guide` | "How to add new code" | +6.4% | P1 |
| `get-exports` | Public API with import counts | +6.4% | P2 |
| `get-conventions` | DO/DON'T rules | +6.4% | P2 |

---

## SDK Usage Pattern

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "autodocs", version: "0.5.0" });

server.registerTool("get-commands", {
  title: "Get Commands",
  description: "Get build/test/lint commands for this project",
  inputSchema: z.object({ packagePath: z.string().optional() }),
  annotations: { readOnlyHint: true }
}, async ({ packagePath }) => {
  const analysis = await getOrComputeAnalysis(packagePath ?? process.cwd());
  const commands = analysis.packages[0].commands;
  return { content: [{ type: "text", text: JSON.stringify(commands, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Implementation Phases

### Phase 1 (MVP — 1 week): STDIO + Core Tools
- 5 tools: get-commands, get-architecture, analyze-impact, get-co-changes, get-workflow-rules
- STDIO transport
- In-memory analysis cache (re-analyze on first query, cache for session)
- `npx autodocs-engine serve` entry point

### Phase 2 (Polish — 1 week): Caching + More Tools
- Disk cache with git HEAD invalidation
- Add: get-contribution-guide, get-exports, get-conventions
- Resource endpoints for browsing analysis data
- `--watch` mode for file change detection

### Phase 3 (Distribution — 3 days): Docs + Config
- README section for MCP setup
- .mcp.json template for project-level config
- Claude Code + Cursor configuration examples
- Test with real AI tool sessions
