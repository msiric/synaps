# Adversarial Review Results: MCP Server Plan

## Review Context

Five AI models (Gemini 3 Pro, Claude Opus 4.6, Grok 4, GPT-5, GLM) reviewed the MCP Server plan. This is the most important feature the project will build — transforming from static document generator to live codebase intelligence API.

---

## Universal Consensus (All 5 Models)

### 1. Cache Invalidation Is Broken (CRITICAL)

**Every single model flagged this as the top issue.**

`git rev-parse HEAD` does NOT catch uncommitted changes. Users modify a file, query impact, and get stale data. This is the worst failure mode — wrong answers during active development.

| Model | Severity | Recommended Fix |
|-------|----------|----------------|
| Gemini | CRITICAL FAIL | `git status --porcelain` + compound hash |
| Opus | Nuance | Composite key: HEAD + hash(file listing). Or document limitation honestly |
| Grok | High × High | File hash check (`git diff --shortstat`) on each query |
| GPT | Critical | Dirty flag via `git status --porcelain -uno` + background refresh |
| GLM | Critical | File mtime+size hash (~50ms for 1000 files) |

**Consensus fix:** Augment HEAD check with working tree dirty detection. Options range from `git status --porcelain` (fast, catches staged/unstaged) to file mtime hashing (catches everything, ~50ms overhead).

### 2. Eager Background Initialization (Not Lazy)

**4/5 models recommend eager init.** The first tool call waiting 600ms-2s is the worst UX moment.

- **Opus:** "Three lines of code with outsized UX impact. Do this."
- **GPT:** "Start analyze() in background after MCP handshake. If tool arrives before done, await it."
- **Gemini:** "Agree lazy is correct" (lone dissenter — argues against wasting CPU if tools never called)
- **Grok:** "Switch to eager init: Run analyze() on startup in background Promise"
- **GLM:** "Implement eager initialization with progress tracking"

**Consensus:** Start analysis immediately on server startup (non-blocking). First tool call awaits the in-progress analysis. By the time the AI processes the user message and decides to call a tool (200-500ms), analysis is likely already done.

### 3. `analyze_impact` Needs Guardrails

**4/5 models flag `analyze_impact` as too broad.** Split opinions on solution:

| Model | Recommendation |
|-------|---------------|
| Gemini | Split into `get_call_graph` + `get_impact_radius` |
| Opus | Keep combined, add `scope` param (`"all" \| "imports" \| "callers" \| "cochanges"`) + `limit` param |
| Grok | Split into `get_import_chain`, `get_call_graph`, `get_co_changes` |
| GPT | Keep combined, add `includeImporters/includeCallers/includeCoChange` booleans + limits |
| GLM | Split into `get_importers` + `analyze_change_impact` |

**Consensus:** Keep combined tool (it mirrors developer intent: "what breaks?") but add `scope` and `limit` parameters for the AI to narrow when needed.

### 4. Add `list_packages` Tool for Monorepo Support

**4/5 models explicitly request this.** Current plan says "one project per server instance" but monorepos are the primary use case for sophisticated tooling.

- **Opus:** "Add list_packages as P0. It's the orientation tool — the AI calls it first."
- **GPT:** "Add list_packages, package selection by name, and clear defaults for multi-package repos."
- **Grok:** "Add packageName param to all tools. Include list_packages as P1."
- **GLM:** "Add list_packages tool. Support cross-package impact analysis."

**Consensus:** Add `list_packages` as P0. Add `packagePath` or `packageName` parameter to all tools with clear default resolution (single-package repos → the only package; monorepos → nearest package to CWD or error with candidates).

### 5. Tool Descriptions Need "When to Call" / "When NOT to Call"

**All 5 models flag descriptions as insufficient for AI tool selection.**

- **Opus:** "The description is the single most important field for tool selection."
- **GPT:** "Enrich descriptions with 2-3 terse 'Use this when...' examples."
- **GLM:** "Adding explicit WHEN TO CALL / DO NOT CALL sections reduces false-positive invocations."
- **Gemini:** "Rename get_workflow_rules to get_post_change_tasks for action-oriented naming."

**Consensus:** Each tool description should follow: `<what it returns> + <when to use it> + <when NOT to use it>` with 2-3 concrete example triggers.

### 6. Error Handling Is Underspecified

**All 5 models flag this.** The plan says "graceful degradation" with zero specifics.

**Consensus:** Define typed error responses with codes, messages, and recovery hints. Handle: missing package.json, corrupt tsconfig, OOM, no git, concurrent calls during analysis, nonexistent function/file in queries. Add a concurrency guard (singleton promise pattern to prevent duplicate analyses).

### 7. Merge `get_tech_stack` into `get_commands` or Drop It

**4/5 models recommend merging or removing.**

- **Opus:** "Fold into get_commands as optional includeTechStack boolean"
- **GPT:** "Keep get_tech_stack separate; it answers a distinct orientation question" (lone dissenter)
- **Grok:** "Demote to P3"
- **GLM:** "Remove — data is in package.json"
- **Gemini:** Not explicitly addressed

**Consensus:** Either fold into `get_commands` or drop entirely. Reduces tool count from 8 to 7.

---

## Strong Agreement (4/5 Models)

### 8. Response Format: Structured Markdown or JSON, Not Pure Text

- Opus: "Structured Markdown with consistent structure by tool type"
- GPT: "Add format argument: 'text' | 'json' (default 'text')"
- GLM: "JSON for tabular data, formatted text for hierarchical"
- Grok: "Markdown tables for tabular, bullet lists for hierarchies"
- Gemini: "Agree text is correct" (dissenter)

**Near-consensus:** Use Markdown tables for structured data (commands, exports), formatted text for hierarchical data (architecture tree). Optionally support `format: "json"` parameter.

### 9. STDIO Is Correct for v1

**All 5 agree.** No dissent. HTTP deferred to v2.

### 10. No LLM Calls in v1 Is Correct

**All 5 agree.** Deterministic-only. Plan for opt-in synthesis tools in v2.

### 11. MCP Dependencies (SDK + Zod) Are Justified

**All 5 agree** the dependency increase from 3→5 is acceptable. Several recommend lazy-loading the SDK (only import when `serve` subcommand is used).

### 12. Separation of Concerns: Import from Public API Only

**All 5 agree** MCP server should use `src/index.ts` public API, not internal modules. Several recommend adding a thin `queries.ts` data access layer between tools and raw StructuredAnalysis.

### 13. Add Telemetry/Logging for Effectiveness Measurement

**All 5 agree** the plan has no measurement strategy. Recommendations: log tool calls to stderr with timestamps/latency, add optional usage metrics, extend benchmark to compare static AGENTS.md vs MCP.

---

## Priority Adjustments (Consensus)

| Tool | Plan | Consensus | Change |
|------|:----:|:---------:|--------|
| `get_commands` | P0 | **P0** | No change |
| `get_architecture` | P0 | **P0** | No change |
| `analyze_impact` | P0 | **P0** | Add scope + limit params |
| `get_workflow_rules` | P0 | **P1** | Lower urgency (4/5 demote) |
| `list_packages` | — | **P0 (new)** | Essential for monorepo support (4/5) |
| `get_contribution_guide` | P1 | **P1** | No change |
| `get_exports` | P1 | **P1** | Add optional query filter |
| `get_conventions` | P2 | **P2** | No change |
| `get_tech_stack` | P2 | **Remove/Merge** | Fold into get_commands (4/5) |

**Result: 5 P0 tools, 2 P1 tools, 1 P2 tool = 8 tools (with list_packages replacing get_tech_stack)**

---

## The One Thing (Per Model)

- **Gemini:** "You cannot rely on git rev-parse HEAD for invalidation."
- **Opus:** "Start analysis eagerly in the background on server startup."
- **Grok:** "Implement eager initialization with disk caching from the start."
- **GPT:** "Strengthen cache invalidation and response bounding from day one."
- **GLM:** "Fix the cache invalidation strategy."

**3/5 say cache invalidation. 2/5 say eager initialization.** Both are critical. Together they represent the two highest-impact changes to the plan.

---

## Implementation Risks (Ranked by Consensus)

| # | Risk | Models Flagging | Severity |
|---|------|:---:|:---:|
| 1 | Stale data from HEAD-only cache invalidation | 5/5 | Critical |
| 2 | First-call latency degrades UX | 4/5 | High |
| 3 | Monorepo package ambiguity | 4/5 | High |
| 4 | analyze_impact response bloat on hub files | 4/5 | Medium-High |
| 5 | Tool descriptions don't help AI choose correctly | 5/5 | Medium |
| 6 | Error handling gaps cause crashes | 5/5 | Medium |
| 7 | MCP SDK transitive dependency bloat | 3/5 | Low-Medium |
| 8 | Concurrent analysis race conditions | 3/5 | Medium |
