# Adversarial Review: MCP Server for autodocs-engine

You are a senior principal engineer with deep experience in protocol design, distributed systems, and AI tooling infrastructure. You're reviewing the most important feature this project will build — an MCP server that transforms a static document generator into a live codebase intelligence API.

This review matters more than any previous one. The MCP server defines what this product IS. A flawed design here creates technical debt that's expensive to unwind. Be thorough, be precise, and challenge every assumption.

## Background

### What autodocs-engine is
A TypeScript codebase intelligence engine that analyzes codebases via AST parsing (18-stage pipeline, 390 tests, ~15K lines). It currently generates static AGENTS.md files for AI coding tools (Claude Code, Cursor, Copilot).

### Why we're building an MCP server
We ran rigorous A/B benchmarks across 3 repos measuring whether AGENTS.md helps AI tools. The results showed:
- **Patterns** (file naming, imports, exports): +6.4% — AI infers these from source code
- **Commands** (build/test/lint): **+16.7%** — AI can't discover project-specific scripts
- **Architecture** (where code goes): **+18.8%** — AI can't infer directory purposes at scale

The static file is a lossy compression of rich intelligence. An MCP server eliminates the compression problem by serving exactly what the AI needs for the current task.

### What MCP is
Model Context Protocol — JSON-RPC 2.0 over STDIO or HTTP. An MCP server exposes Tools (model-driven actions), Resources (cached data), and Prompts (user templates). AI tools (Claude Code, Cursor) connect to MCP servers and call tools as needed during coding sessions.

## The Plan

The complete plan is in `MCP-SERVER-PLAN.md`. Read it fully. Key points:

- **8 tools** in priority order: get_commands, get_architecture, analyze_impact, get_workflow_rules, get_contribution_guide, get_exports, get_conventions, get_tech_stack
- **STDIO transport only** (v1). No HTTP server.
- **Lazy initialization** — analysis runs on first tool call, cached in memory
- **Git HEAD invalidation** — re-analyze when HEAD changes
- **No LLM calls** — all tools serve deterministic analysis data
- **~850 new lines** of source code + ~280 lines of tests
- **2 new dependencies**: @modelcontextprotocol/sdk + zod
- **Integrated `serve` subcommand** — same npm package, `npx autodocs-engine serve`

## What to Review

### Part 1: Design Critique

#### 1. Tool Granularity
The plan has 8 specific tools. Is this the right number? Too few means responses are too large and include irrelevant data. Too many means the AI wastes roundtrips deciding which tool to call.

Consider:
- Should `analyze_impact` be split into `get_import_chain`, `get_call_graph`, and `get_co_changes`? Or is the combined tool better?
- Should there be a `search_exports` tool that takes a query string, instead of `get_exports` that returns all top N?
- Is `get_tech_stack` worth a separate tool, or should it be folded into `get_commands` (since they're both "project config" questions)?
- Are 8 tools too many for an AI to choose from effectively? Research suggests AI models handle 5-15 tools well.

#### 2. Tool Descriptions and AI Discoverability
When the AI decides which tool to call, it reads the tool descriptions. Are the descriptions in the plan specific enough for the AI to make good choices?

Consider:
- Will the AI know to call `analyze_impact` when a user says "I'm about to refactor this module"?
- Will the AI know to call `get_workflow_rules` vs `get_commands` when a user says "what should I do after changing the schema"?
- Should tool descriptions include example queries or use cases?

#### 3. Response Format
The plan says tools return "human-readable text, not raw JSON." Is this right?

Consider:
- AI models can parse JSON efficiently. Structured JSON enables programmatic extraction.
- But text is more natural in conversation and doesn't require parsing.
- Should different tools use different formats? (Commands as a table, architecture as a tree, impact as a list?)
- What about the 25,000 token limit? Are any responses at risk of exceeding it?

#### 4. Caching Strategy
The plan uses in-memory caching with git HEAD invalidation. Challenges:

- `git rev-parse HEAD` doesn't catch uncommitted changes. A user modifies a file, asks "what imports from this?", and gets stale data. Is this acceptable?
- No disk cache means re-analysis on every server restart (~600ms-2s). If Claude Code restarts frequently (e.g., on config change), this adds up. Is the latency acceptable?
- The cache stores the entire `StructuredAnalysis` (~500KB). For monorepos with 10+ packages, this could grow. Is memory a concern?
- What if two Claude Code instances connect to the same project simultaneously? Race conditions on cache?

#### 5. Lazy vs Eager Initialization
The plan runs analysis on the first tool call. But this means the first query is slow (600ms-2s).

Consider:
- Should the server pre-analyze on startup? This makes startup slow but first queries fast.
- Should there be a "warmup" phase where the server starts analysis in the background while waiting for the first call?
- What's the UX when the AI calls `get_commands` and has to wait 2 seconds? Does the MCP protocol handle this gracefully (progress notifications)?

#### 6. Error Handling
The plan mentions "graceful degradation" but doesn't detail specific error scenarios:

- What if `analyze()` throws? (Missing package.json, corrupt tsconfig, OOM on huge repo)
- What if git is not available? (Docker containers, downloaded zips)
- What if the project has no TypeScript files? (JS-only, or wrong directory)
- What if the server is still analyzing when the AI calls a second tool?
- What if the user calls `analyze_impact` with a function name that doesn't exist in the call graph?

#### 7. Package Manager Impact
Adding `@modelcontextprotocol/sdk` + `zod` takes production deps from 3 to 5.

Consider:
- The engine's minimal dependency philosophy is a documented strength (3 production deps). Is this justified?
- What's the install size increase? Does the MCP SDK pull in transitive deps?
- Could the MCP server be an optional peer dependency that's only loaded when `serve` is called?
- Zod is used for tool input validation. Is it strictly necessary, or could we validate manually?

### Part 2: Architecture Concerns

#### 8. Separation of Concerns
The plan puts MCP server code in `src/mcp/`. But the server depends on the analysis pipeline (`analyze()`), which depends on the AST parser, symbol graph, etc.

Consider:
- Is the MCP server a "consumer" of the analysis (like the CLI), or a "mode" of the engine?
- Should `server.ts` import from `src/index.ts` (the public API) or from internal modules directly?
- If the MCP server only uses the public API, it could be a separate package. Is there a reason it shouldn't be?

#### 9. The `analyze_impact` Tool is Doing Too Much
This tool combines three data sources: import chain, call graph, and co-change history. It's the most complex tool and the most likely to:
- Return too much data (exceeding token limits)
- Be slow (if any computation is needed)
- Be hard to test (multiple data paths)
- Be confusing to the AI (when to use it vs individual queries)

Should this be split into focused tools, or is the combined view genuinely more useful?

#### 10. Monorepo Support
The plan says "one project per server instance." But many target users are in monorepos.

Consider:
- A user in a Turborepo with 10 packages configures one MCP server. Which package does it analyze?
- Should tools accept a `packageName` parameter for multi-package repos?
- How does cross-package data (shared conventions, workspace commands, dependency graph) get served?
- Should there be a `list_packages` tool that shows available packages?

### Part 3: Strategic Questions

#### 11. Is STDIO the Right Default Transport?
STDIO is simpler, but:
- It ties the server lifecycle to the IDE. If Claude Code restarts, the server restarts, cache is lost.
- It doesn't support multiple clients (one IDE instance only).
- It doesn't support running on a shared development server.
- Is there a middle ground? (e.g., STDIO with a disk cache that survives restarts)

#### 12. Should Any Tools Trigger LLM Calls?
The plan says "no LLM calls in MCP tools." But the architecture and domain sections use micro-LLM calls in the current AGENTS.md output.

Consider:
- Should there be an opt-in `get_architecture_synthesis` tool that calls the micro-LLM for a richer architecture description?
- If the user has ANTHROPIC_API_KEY set, should the server automatically provide richer responses?
- Or is the deterministic-only approach correct for v1?

#### 13. How Will We Measure MCP Server Effectiveness?
The static AGENTS.md was measured via the benchmark system. How do we measure whether the MCP server actually helps?

Consider:
- Can we log which tools the AI calls and correlate with task success?
- Should the server expose a `/metrics` resource showing tool usage?
- Can we extend the benchmark to compare "static AGENTS.md" vs "MCP server" vs "no context"?

#### 14. Competitive Positioning
Other MCP servers exist for code intelligence (e.g., GitHub's code search, Sourcegraph's Cody).

Consider:
- What does autodocs-engine's MCP server do that others don't?
- Is the "deterministic AST analysis + git co-change + impact radius" combination defensible?
- Should we explicitly position against competitors, or focus on unique capabilities?

#### 15. What If This Is the Wrong Abstraction?
MCP is designed for tool use by AI models. But what if:
- AI models get better at discovering information on their own (making MCP servers less necessary)?
- Claude Code adds built-in code analysis that duplicates what our server provides?
- The MCP protocol changes significantly (v2 is in alpha)?
- Most users never configure MCP servers (too much friction)?

What's the mitigation for each of these risks?

## Output Format

### Design Review
For each of the 15 points above, provide:
- **Agree / Disagree / Nuance** with the plan's approach
- **Specific concern** (if any)
- **Recommended change** (if any)

### Missing Considerations
Things the plan doesn't address that it should.

### Priority Adjustments
Should the tool priority order (P0/P1/P2) change based on your analysis?

### Implementation Risks
Concrete risks during implementation, ordered by likelihood and severity.

### The One Thing
If you could change one thing about this plan, what would it be?

## Codebase Context

- **Engine:** 18-stage pipeline, 390 tests, ~15K lines, 5 production deps (after adding SDK + zod)
- **Analysis timing:** 600ms-2s per repo, <50ms for cached queries
- **Data:** 19 fields per PackageAnalysis, 7 cross-package fields, all deterministic
- **Benchmark data:** Commands +16.7%, Architecture +18.8%, Patterns +6.4% (A-B delta)
- **Current CLI:** init, check, analyze, benchmark subcommands
- **MCP SDK:** @modelcontextprotocol/sdk v1.x, STDIO transport, zod for schemas
- **Research:** Full protocol spec, SDK API, Claude Code/Cursor integration documented in MCP-SERVER-RESEARCH.md

Read `MCP-SERVER-PLAN.md` completely before starting your review.
