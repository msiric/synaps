# Implementation Plan: Execution Flow Tracing (v2 — Post Adversarial Review)

## Context

After 4-model adversarial review (Gemini 3.1 Pro, Opus 4.6, Grok 4.20, Sonnet 4.6, GPT 5.3) of the original 175 LOC plan, the design has been substantially revised. Key changes: composite node IDs to prevent name collisions, framework-aware entry point scoring, spine-first BFS instead of fixed maxBranching, co-change confidence scoring (our unique advantage), and React/JSX exclusion.

**Why:** When a developer modifies a function, we show "25 dependent files." Execution flows show "this function is step 3 of 7 in the pipeline — your change affects the entire analysis flow." Narrative beats lists for AI agents.

**What changed from v1:** 6 critical issues fixed, LOC target raised to ~250, diagnose integration deferred to Phase 2, co-change validation added as primary differentiator vs GitNexus.

---

## 1. Critical Fix: Composite Node IDs

**Problem (unanimous):** Keying adjacency by function name alone fails when two files export `init()` or `handler()`.

**Solution:** Use `file#function` as internal node ID throughout the algorithm. Display uses function name only.

```typescript
type NodeId = string; // "src/pipeline.ts#runPipeline"

function makeNodeId(file: string, fn: string): NodeId {
  return `${file}#${fn}`;
}
function displayName(nodeId: NodeId): string {
  return nodeId.split("#")[1];
}
```

---

## 2. Entry Point Scoring (Framework-Aware)

**Problem (all 4 models):** `callees/(callers+1)` misses Express route handlers, Next.js pages, callback-registered functions.

**Solution:** Multi-source seed strategy using existing `DependencyInsights`.

```typescript
export function scoreEntryPoints(
  callGraph: CallGraphEdge[],
  publicAPI: PublicAPIEntry[],
  dependencyInsights?: DependencyInsights,
): ScoredEntry[]
```

**Scoring formula:**
```
baseScore = (callees + 1) / (callers + 1)
× exportMultiplier    (1.5 if in publicAPI)
× externalOnlyBoost   (1.8 if zero callers from T1/T2 files AND callees ≥ 2)
× nameMultiplier      (2.0 for entry patterns, 0.3 penalty for utility patterns, 0.0 for test)
× frameworkMultiplier  (2.5 for detected framework patterns)
```

**Name multipliers (TS/JS):**
- **Boost (2.0):** `handle*`, `run*`, `start*`, `execute*`, `init*`, `serve*`, `bootstrap*`, `listen*`, `create*Server`, `register*`, `*Controller`, `*Middleware`, `*Handler`
- **Penalty (0.3):** `get*`, `set*`, `is*`, `has*`, `to*`, `from*`, `parse*`, `format*`, `validate*`, `normalize*`, `ensure*`, `assert*`, `check*`, `clone*`, `merge*`, `debounce*`, `throttle*`, `memoize*`
- **Exclude (0.0):** `describe`, `it`, `test`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `expect`

**Framework multipliers (from DependencyInsights):**
- Next.js: `getServerSideProps`, `getStaticProps`, `loader`, `action`, `Page` exports → 2.5
- Express/Fastify/Hono: files in `routes/`, `api/`, `controllers/`; names matching `*Middleware`, `*Router` → 2.5
- NestJS: classes with `Controller` suffix, methods matching HTTP verbs → 2.5
- Vite/Rollup plugins: `transform`, `resolveId`, `load`, `buildStart` → 2.0

**Entry point cap:** `max(10, min(200, Math.floor(functionCount / 10)))`

---

## 3. BFS Tracing (Spine-First, Not Fixed Branching)

**Problem (all 4 models):** `maxBranching=4` truncates `runPipeline` (15+ callees) to 4 steps.

**Solution:** Two-mode tracing instead of fixed branching.

**Algorithm:**
```
For each entry point:
  1. PRIMARY SPINE: Follow the highest-scored callee at each step
     (no branching limit on the spine — trace the full sequential chain)
     Score callee by: its own out-degree (prefer deeper paths)

  2. FORK PATHS: At each spine node, record up to 3 alternative callees
     Each fork becomes a separate short trace (from fork point onward)

  3. CYCLE DETECTION: path-local Set (skip if nodeId already in path)

  4. TERMINATION: no callees OR maxDepth(10) reached
     Save if length ≥ minSteps(3)

  5. EARLY EXIT: stop entry point after 15 total traces
```

This produces one long "primary pipeline" flow plus several shorter "branch" flows from fork points. The primary flow for `runPipeline` traces all 15+ stages; branch flows capture alternative paths.

**Why not GitNexus's approach:** GitNexus uses flat `maxBranching=4` which works for their 13-language/200-entry-point scale. At our scale (TS/JS only, 10-50 entries), spine-first produces better primary flows without the truncation problem.

---

## 4. Co-Change Confidence (Our Unique Advantage)

**Problem (all 4 models):** Git co-change data is completely unused in the original plan despite being our differentiator over GitNexus.

**Solution:** Compute flow confidence from mean pairwise Jaccard between adjacent flow files.

```typescript
function computeFlowConfidence(
  flow: ExecutionFlow,
  coChangeEdges: CoChangeEdge[],
): number {
  if (flow.files.length < 2) return 0;
  // Build lookup for fast pairwise Jaccard
  const jaccardMap = new Map<string, number>();
  for (const e of coChangeEdges) {
    jaccardMap.set(`${e.file1}\0${e.file2}`, e.jaccard);
    jaccardMap.set(`${e.file2}\0${e.file1}`, e.jaccard);
  }

  let total = 0;
  let pairs = 0;
  for (let i = 0; i < flow.files.length - 1; i++) {
    const j = jaccardMap.get(`${flow.files[i]}\0${flow.files[i + 1]}`) ?? 0;
    total += j;
    pairs++;
  }
  return pairs > 0 ? total / pairs : 0;
}
```

Flows with high co-change confidence are "active pipelines" — code that works together AND changes together. Flows with zero co-change are "structural connections" — possibly valid but unvalidated by history.

**Sort flows by confidence descending.** Flag flows with confidence < 0.05 as low-confidence in output.

---

## 5. React/JSX Handling

**Problem (3 models):** JSX component references (`<UserCard />`) produce zero call graph edges. React-only packages get zero useful flows.

**Solution (v1):** Explicit exclusion with diagnostic message.

```typescript
const isReactOnly = pkg.dependencyInsights?.frameworks.some(f => f.name === "react") &&
  !pkg.dependencyInsights?.frameworks.some(f =>
    ["express", "fastify", "hono", "next", "nest", "koa"].includes(f.name)
  );

if (isReactOnly || callGraph.length < 10) {
  return []; // Skip — JSX component trees not traced via call graph
}
```

**Future (v2):** Add JSX reference detection in `ast-parser.ts` — scan for `JsxOpeningElement` with PascalCase tag names matching known exports. ~25 LOC. Not in this phase.

---

## 6. Types

**File:** `src/types.ts`

```typescript
export interface ExecutionFlow {
  label: string;           // "runPipeline → analyzePackage → ... → generateOutput (8 steps)"
  entryPoint: string;      // Display name of first function
  entryFile: string;       // File of first function
  terminal: string;        // Display name of last function
  terminalFile: string;    // File of last function
  steps: string[];         // Ordered function display names
  files: string[];         // Ordered file paths (parallel to steps)
  length: number;          // steps.length
  confidence: number;      // 0-1, mean pairwise adjacent Jaccard (co-change validated)
}
```

Add to `PackageAnalysis`:
```typescript
executionFlows?: ExecutionFlow[];
```

---

## 7. Deduplication

Two passes (same as v1 but with clearer spec):

1. **Subset removal:** Sort by length descending. For each candidate, check if its steps (as nodeIds) form a contiguous subpath of any already-kept flow using sliding window check. Discard subsets.

2. **Endpoint dedup:** For each unique `(entryNodeId, terminalNodeId)` pair, keep only the longest flow.

**Flow count cap:** `max(10, min(200, Math.floor(functionCount / 10)))`

---

## 8. Pipeline Integration

**File:** `src/pipeline.ts` — after call graph logging:

```typescript
import { computeExecutionFlows } from "./execution-flow.js";

const executionFlows = symbolGraph.callGraph.length >= 10
  ? computeExecutionFlows(symbolGraph.callGraph, publicAPI, pkg.dependencyInsights, pkg.gitHistory?.coChangeEdges)
  : [];
```

---

## 9. MCP Tool Integration

### get_architecture (P0)
Top 5 flows sorted by confidence, compact format with file count:
```
### Execution Flows
1. runPipeline → analyzePackage → buildSymbolGraph → ... (8 steps, 6 files, confidence: 0.42)
2. createAutodocsServer → withTelemetry → handleGetExports (3 steps, 2 files, confidence: 0.38)
```

### plan_change (P0)
**Relevance-ranked, capped at 3, with disclaimer:**
```
### Affected Execution Flows
Flows show execution context — updating other steps is not required unless signatures change.

1. runPipeline → ... → buildSymbolGraph (8 steps) — your change at step 3/8
2. handlePlanChange → getImporters → ... (4 steps) — your change at step 1/4
```

**Relevance scoring:** `(changedFilesInFlow / flowLength) × (1 - minStepPosition / flowLength)`

Only show flows where modified files appear at non-terminal steps (position 0 through N-2).

### diagnose (DEFERRED to Phase 2)
Per adversarial review consensus: diagnose flow context adds tokens but questionable value. Ship flows in architecture and plan_change first. Add to diagnose only if agent feedback shows demand.

### AGENTS.md (P1)
Top 3 flows in deterministic formatter, gated by inferability:
```typescript
if (inferabilityScore <= 50 && executionFlows.length > 0) {
  sections.push(formatFlowSection(executionFlows.slice(0, 3)));
}
```

---

## 10. Query Layer

**File:** `src/mcp/queries.ts`

```typescript
export function getExecutionFlows(analysis, packagePath?): ExecutionFlow[]
export function getFlowsForFiles(analysis, files, packagePath?): ExecutionFlow[]
export function getFlowsForFunction(analysis, fnName, packagePath?): ExecutionFlow[]
```

All three query helpers added now (even though no dedicated tool yet) to make future `get_execution_flows` tool trivial.

---

## 11. Test Strategy

**File:** `test/execution-flow.test.ts` (~200 LOC)

**Entry point scoring tests:**
- High out-degree + zero callers scores highest
- Name multiplier boosts "handle*", penalizes "get*"
- Export multiplier works
- Framework multiplier with DependencyInsights
- Test functions excluded (score 0.0)
- Duplicate function names across files produce distinct node IDs

**BFS tracing tests:**
- Linear chain A→B→C→D produces one flow of length 4
- Cycle A→B→C→A terminates at A→B→C
- Spine-first: orchestrator with 10 callees traces full spine + fork paths
- minSteps=3 filters 2-step paths
- maxDepth=10 caps deep chains

**Deduplication tests:**
- Subset removal: A→B→C removed when A→B→C→D exists
- Non-contiguous subsequence preserved: A→B→D kept when A→C→D exists
- Endpoint dedup: longest per (entry, terminal) pair

**Co-change confidence tests:**
- Flow with high Jaccard pairs gets high confidence
- Flow with zero co-change pairs gets confidence 0
- Confidence sorts flows correctly

**Integration tests:**
- React-only package returns empty flows
- Call graph < 10 edges returns empty flows
- Realistic graph produces sensible flows

---

## 12. Validation

Run on synaps (92 edges), knip (full clone), and one Express app:

| Metric | Target | Kill Switch |
|--------|--------|-------------|
| Flows found per package | 3-20 | 0 on non-React repos → fix scoring |
| Average flow length | 3-7 steps | >10 → branching too liberal |
| Computation time | <100ms | >200ms → optimize or reduce entries |
| Co-change support rate | >20% of flows | <10% → call graph too noisy |
| plan_change affected flows | 1-5 per query | >10 → add specificity filter |

---

## 13. Files Changed

| File | Change | LOC |
|------|--------|-----|
| `src/types.ts` | Add ExecutionFlow + PackageAnalysis field | ~20 |
| `src/execution-flow.ts` | **New**: scoring, spine BFS, dedup, co-change confidence | ~250 |
| `src/pipeline.ts` | Import + call + store | ~10 |
| `src/mcp/queries.ts` | 3 query helpers (getExecutionFlows, getFlowsForFiles, getFlowsForFunction) | ~25 |
| `src/mcp/tools.ts` | Flow sections in get_architecture + plan_change | ~50 |
| `src/deterministic-formatter.ts` | Top 3 flows in AGENTS.md (gated by inferability) | ~20 |
| `test/execution-flow.test.ts` | **New**: comprehensive unit tests | ~200 |
| **Total** | | **~575** |

---

## 14. What We're NOT Building (YAGNI)

- Leiden community detection (directory-based classification is sufficient if needed later)
- Backward tracing from terminal functions (Phase 2)
- Dedicated `get_execution_flows` MCP tool (Phase 2 — query helpers ready)
- JSX component tree tracing (Phase 2 — explicit exclusion for v1)
- Diagnose integration (Phase 2 — deferred per adversarial consensus)
- Graph database storage (flat array on PackageAnalysis is sufficient)
- Search/RRF (separate feature entirely)

---

## 15. What We Learned From GitNexus's Implementation

**Adopted:**
- Dynamic flow count scaling with codebase size
- Framework-aware entry point scoring (adapted for TS/JS only)
- Process labeling with entry→terminal naming
- Dedup via subset removal + endpoint pairing

**Improved on:**
- Co-change confidence scoring (GitNexus doesn't have git history)
- Spine-first BFS instead of fixed maxBranching (better for sequential pipelines)
- Composite node IDs (GitNexus uses graph DB IDs)
- Relevance-ranked flow display in plan_change (GitNexus shows all)

**Intentionally dropped:**
- Leiden clustering (not needed for flow detection)
- STEP_IN_PROCESS graph relationships (flat array is sufficient)
- 13-language support (TS/JS only)
- Wiki generation integration (separate feature)
