# Adversarial Review: Execution Flow Tracing

Send these prompts to 4-6 diverse models. Each prompt gives full context about the tool and the proposed design.

---

## Prompt 1: Algorithm Design Review

```
You are a principal engineer reviewing an execution flow tracing algorithm for a TypeScript codebase intelligence engine called synaps.

WHAT THE TOOL DOES:
synaps analyzes TypeScript/JavaScript codebases and serves intelligence via the Model Context Protocol (MCP) to AI coding agents (Claude Code, Cursor, etc). It currently has:
- 18-stage analysis pipeline producing StructuredAnalysis
- Call graph: CallGraphEdge[] with {from, to, fromFile, toFile} — 92 edges on a medium project (itself)
- Import chain: FileImportEdge[] tracking which files import what symbols from where
- Git co-change mining: Jaccard similarity on file pairs from commit history
- Implicit coupling: co-change pairs with NO import relationship
- 13 convention detectors (error handling, async patterns, state management, etc.)
- Type-aware analysis: opt-in ts.Program for resolved parameter/return types
- Diagnose tool: backward tracing from test failures to root cause (validated on 95 bug-fix commits, 47% R@3)
- plan_change tool: shows import dependents + co-change partners + implicit coupling + symbol-level filtering
- 51 test files, 681 tests, published on npm

The engine currently has NO execution flow detection. When a developer modifies a function, we show "these 25 files depend on it" but not "this function is step 3 of 7 in the LoginFlow, and your change breaks the authentication pipeline."

COMPETING APPROACH (GitNexus, a similar tool with 25K LOC):
GitNexus's process-processor.ts (455 LOC) does:
1. Score entry points: baseScore = callees/(callers+1) × exportMultiplier × namePatternMultiplier × frameworkMultiplier
2. Keep top 200 entry point candidates
3. Forward BFS from each entry: maxDepth=10, maxBranching=4, minSteps=3
4. Cycle detection via path membership check (array.includes)
5. Dedup: subset removal (longer trace wins via string containment) + endpoint dedup (longest per entry→terminal pair)
6. Classify: intra_community vs cross_community (using Leiden clustering)
7. Dynamic maxProcesses = max(20, min(300, symbolCount/10))
8. Label: "EntryName → TerminalName"
9. Stores as ProcessNode with trace array + STEP_IN_PROCESS relationships in LadybugDB

OUR PROPOSED ALGORITHM (~175 LOC, simplified for TS/JS only):

1. Score entry points:
   score = callees/(callers+1) × exportMultiplier(1.5) × nameMultiplier
   nameMultiplier = 2.0 for "handle*","run*","start*","execute*","init*","serve*","bootstrap*","listen*","create*Server","register*"
   nameMultiplier = 0.3 PENALTY for "get*","set*","is*","has*","to*","from*","parse*","format*","validate*","normalize*","ensure*"
   Keep top max(10, min(50, functionCount/5)) entries

2. Forward BFS from each entry:
   maxDepth=10, maxBranching=4, minSteps=3
   Cycle detection: path-local Set (skip if current already in path)
   Terminal: no callees OR maxDepth reached → save if length >= minSteps
   Early exit per entry: stop after maxBranching * 3 traces

3. Dedup:
   Phase 1: Subset removal — sort by length desc, discard if steps are contiguous subsequence of kept flow
   Phase 2: Endpoint dedup — keep longest per (entry, terminal) pair
   Cap: max(10, min(50, functionCount/5))

4. Label: "entry → ... → terminal (N steps)"

5. Store as ExecutionFlow[] on PackageAnalysis (optional, like callGraph)

6. Surface via existing MCP tools:
   - get_architecture: top 5 flows
   - plan_change: affected flows (files intersect)
   - diagnose: flows containing suspect files

QUESTIONS FOR REVIEW:

1. Is the scoring formula correct? Will callees/(callers+1) actually identify real entry points in a TS/JS codebase? What about Express route handlers that are registered via app.get() (low out-degree, imported by router)? What about React component trees?

2. The name patterns — are we missing critical TS/JS entry points? Consider:
   - Express/Fastify: app.get("/path", handler) — the handler function
   - Next.js: getServerSideProps, getStaticProps, page components
   - CLI tools: bin entry, yargs commands
   - Test runners: describe/it blocks (should these be excluded?)
   - React: component render functions, useEffect callbacks

3. Is maxBranching=4 the right default? With 92 edges, most functions have 1-3 callees. But a pipeline orchestrator (runPipeline calls 15 functions) has high branching — should it trace all 15 or only 4?

4. The subset removal uses "contiguous subsequence" check. Is this correct? If flow A = [X,Y,Z] and flow B = [X,Y,Z,W], A is a prefix of B. But what if A = [Y,Z] — is that a subsequence of B? Should it be removed?

5. Should flows carry a confidence score? Our diagnose tool uses confidence everywhere. A flow traced through high-confidence call edges (same-file resolution) is more trustworthy than one through fuzzy global resolution. GitNexus doesn't score flows — should we?

6. What are the failure modes? When will this produce garbage?
   - Callback-heavy code (event emitters, Promise chains)?
   - Decorator patterns (@Controller, @Get)?
   - Higher-order functions (map/filter/reduce)?
   - Dynamic dispatch (strategy pattern)?

7. With 92 edges and ~50 functions, how many flows do we expect? Is 10-20 reasonable? What if we get 0 (graph too sparse) or 100 (graph too dense)?

8. Is 175 LOC realistic, or will edge cases balloon it to 300+?

9. GitNexus uses 455 LOC with Leiden clustering. We're at 175 without it. Are we cutting too much? What are we losing by not having community detection?

10. Should we also trace BACKWARDS from terminal functions (error handlers, DB writes, response senders) to find "who eventually calls this critical function"?

Be critical. Challenge every design choice.
```

---

## Prompt 2: Integration & UX Review

```
You are a senior product engineer reviewing how execution flows integrate into an existing AI coding assistant tool.

THE TOOL:
synaps serves 13 MCP tools to AI agents. When a developer uses Claude Code or Cursor, the agent calls these tools to understand the codebase before making changes. The most important tools are:

- plan_change({files, symbols?}): "I'm about to modify these files — what else needs updating?"
  Returns: import dependents, co-change partners from git history, implicit coupling (files that co-change without import relationship), affected workflow rules, registration/barrel files. With optional symbols parameter, narrows dependents from 98 to 25 (only files importing that specific symbol).

- diagnose({errorText, filePath?, testFile?}): "This test is failing — what's the likely root cause?"
  Returns: top 5 suspect files ranked by 7 scoring signals (recency, co-change, dependency, workflow, test mapping, directory locality, missing co-change). Includes confidence level (high/medium/low) and import path traces.

- get_architecture: Directory structure, entry point, package type, conventions
- get_exports: Public API with resolved TypeScript types (parameter types, return types)
- get_conventions: 13 detectors — error handling, async patterns, state management, API patterns, etc.
- analyze_impact: Blast radius for a function (callers, co-changes)

PROPOSED CHANGE:
Add execution flow tracing. No new tool — flows integrate into existing tools:

1. get_architecture: Append "### Execution Flows" section with top 5 flows:
   "runPipeline → analyzePackage → buildSymbolGraph → computeImpactRadius (4 steps)"

2. plan_change: Append "### Affected Execution Flows" section:
   "runPipeline → analyzePackage → buildSymbolGraph (3 steps) — touches src/pipeline.ts"

3. diagnose: Append "### Execution Context" section:
   "src/pipeline.ts participates in: runPipeline → analyzePackage → buildSymbolGraph (step 2/3)"

QUESTIONS:

1. Should there be a dedicated "get_flows" or "list_flows" tool instead of embedding in existing tools? Arguments for: agents can query flows directly, cleaner separation. Arguments against: one more tool to learn, flows are contextual not standalone.

2. For plan_change — if a developer modifies src/types.ts which appears in 15 flows, showing all 15 is noise. How should we filter/rank? By flow length? By how many steps touch the modified file? By flow importance?

3. For diagnose — showing "src/pipeline.ts is step 2/3 in runPipeline flow" gives spatial context. But is it ACTIONABLE? Does knowing the position in a flow help debug a test failure? Or is it just interesting trivia that wastes tokens?

4. The label format "runPipeline → analyzePackage → buildSymbolGraph (3 steps)" — is this the right level of detail for an AI agent? Should we show file paths too? Function signatures? Or is the function name chain sufficient?

5. What about the AGENTS.md / deterministic output? Should flows appear in the static context file that tools without MCP read? Or is this MCP-only intelligence?

6. How do flows interact with symbol-level filtering? If plan_change({files: ["src/types.ts"], symbols: ["Convention"]}) already narrows to 25 dependents, does showing affected flows add value or is it redundant with the narrowed dependent list?

7. Risk: Could showing flows cause the AI agent to make WORSE decisions? For example, if a flow shows "validateUser → checkPassword → createSession" and the agent is fixing a bug in checkPassword, might it unnecessarily modify validateUser or createSession because it sees them in the same flow?

8. For large codebases with 50+ flows, the get_architecture response could become very long. What's the right cap? Top 5? Top 10? Should it be configurable?

9. GitNexus exposes flows as both MCP tools AND MCP resources (gitnexus://repo/{name}/processes). Should we consider MCP resources for flows?

10. How should flows handle monorepo packages? If a flow spans src/core/ → src/mcp/ → src/cli/, does it belong to one package or cross-package?
```

---

## Prompt 3: Comparison with GitNexus

```
You are comparing two approaches to execution flow detection in code intelligence tools.

APPROACH A (GitNexus — existing, production):
- 455 LOC in process-processor.ts + 402 LOC in entry-point-scoring.ts
- 13 language support (TS, JS, Python, Java, Go, Rust, C#, etc.)
- Entry point scoring with framework-specific multipliers (3.0x for @Controller, 2.5x for Express routes, etc.)
- Leiden community detection → classify flows as intra_community or cross_community
- Top 200 entry points, dynamic maxProcesses = max(20, min(300, symbolCount/10))
- Knowledge graph stored in LadybugDB with STEP_IN_PROCESS relationships
- Process-grouped search: query results ranked by process participation
- Affected flows in change detection tool
- Wiki generation uses flows for module documentation

APPROACH B (synaps — proposed, not yet built):
- ~175 LOC target in execution-flow.ts
- TypeScript/JavaScript only
- Entry point scoring: callees/(callers+1) × exportMultiplier × nameMultiplier (TS/JS patterns only)
- No community detection — flows are standalone
- Top max(10, min(50, functionCount/5)) entries, same cap for flows
- Stored as ExecutionFlow[] in memory (no graph database)
- Integrated into existing tools (plan_change, diagnose, get_architecture)
- Has UNIQUE signals GitNexus doesn't: git co-change history, implicit coupling, convention detection, type enrichment

QUESTIONS:

1. What does GitNexus get from Leiden community classification that we'd miss? Is "cross_community" flow type actually useful for AI agents, or is it metadata that's rarely acted on?

2. GitNexus keeps 200 entry points; we keep 10-50. For a TS/JS codebase, is 10-50 sufficient? When would we miss an important entry point?

3. GitNexus stores flows in a graph database (LadybugDB) with queryable relationships. We store as a flat array. What do we lose? Can Cypher queries over flows provide insights that array filtering can't?

4. GitNexus has process-grouped search (query results ranked by process participation). We don't have search at all. Would adding flows to our query capabilities make sense, or is search a separate concern?

5. What's the MINIMUM useful implementation? If we had to cut our 175 LOC to 100 LOC, what would we keep and what would we drop?

6. GitNexus's framework multipliers (3.0x for controllers) seem important for web apps. We don't have them. For a TS/JS codebase using Express/Fastify/Next.js, would our callees/(callers+1) formula alone find the route handlers?

7. GitNexus traces flows and also shows them in wiki generation. We have a deterministic AGENTS.md formatter. Should flows appear there?

8. Our unique advantage is git co-change data. Could we use co-change to IMPROVE flow detection? For example: if files A→B→C frequently co-change AND there's a call chain A→B→C, that flow is higher confidence. GitNexus can't do this because they don't mine git history.

9. Is ~175 LOC actually simpler, or is it just less? Is there important logic in GitNexus's 455 LOC that we're ignoring at our peril?

10. If you had to choose ONE thing from GitNexus's approach that we absolutely must include, what would it be?
```

---

## How to Run the Review

### Models to Use
Pick 4-6 diverse models:
- **Reasoning-focused:** Claude Opus, GPT-4o, DeepSeek R1
- **Fast/practical:** Gemini 2.5 Pro, Grok 3, Claude Sonnet
- **Alternative:** Qwen, MiniMax, GLM-4

### Distribution
- Prompts 1 and 3 → ALL models (algorithm + comparison are universal concerns)
- Prompt 2 → at least 3 models (integration is more subjective)

### Synthesis
For each prompt:
1. **Unanimous findings** — all models agree → must address
2. **Strong consensus (4+/6)** — high priority
3. **Split decisions** — document both sides
4. **Unique insights** — single model raised something important

### After Synthesis
Update EXECUTION-FLOW-PLAN.md with adversarial feedback, then implement.
