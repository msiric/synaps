// src/execution-flow.ts — Execution flow tracing via forward BFS from entry points.
// Detects labeled execution paths: "runPipeline → analyzePackage → buildSymbolGraph (3 steps)"
// Uses spine-first tracing (full primary chain + fork paths) instead of fixed maxBranching.
// Co-change Jaccard validates flows — our unique advantage over GitNexus.

import type { CallGraphEdge, CoChangeEdge, DependencyInsights, ExecutionFlow, PublicAPIEntry } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_CALL_GRAPH_EDGES = 10; // Skip flow detection for sparse graphs
const MAX_TRACE_DEPTH = 10; // Maximum steps in a single flow
const MIN_STEPS = 3; // Minimum steps for a meaningful flow
const MAX_FORK_PATHS = 3; // Alternative callees explored at each spine node
const MAX_TRACES_PER_ENTRY = 15; // Cap traces from a single entry point

// ─── Node Identity ───────────────────────────────────────────────────────────
// Composite IDs prevent name collisions when multiple files export same function name.

type NodeId = string; // "src/pipeline.ts#runPipeline"

function makeNodeId(file: string, fn: string): NodeId {
  return `${file}#${fn}`;
}

function nodeName(id: NodeId): string {
  return id.split("#")[1];
}

function nodeFile(id: NodeId): string {
  return id.split("#")[0];
}

// ─── Entry Point Scoring ─────────────────────────────────────────────────────

// Boost: patterns that indicate genuine entry points in TS/JS
const ENTRY_PATTERNS =
  /^(main|run|start|handle|execute|process|serve|init|bootstrap|listen|register|setup|configure|launch)/i;
const ENTRY_SUFFIX_PATTERNS = /(?:Controller|Middleware|Handler|Router|Command|Plugin)$/;

// Penalty: utility functions that are rarely true entry points
const UTILITY_PATTERNS =
  /^(get|set|is|has|to|from|parse|format|validate|normalize|ensure|assert|check|clone|merge|map|filter|reduce|compose|pipe|wrap|create(?!.*Server))/i;

// Exclude: test orchestration functions
const TEST_PATTERNS = /^(describe|it|test|beforeEach|afterEach|beforeAll|afterAll|expect)$/;

// Framework-specific: high-value entry points detected from dependencies
const FRAMEWORK_PATTERNS: Record<string, { patterns: RegExp[]; multiplier: number }> = {
  next: { patterns: [/^(getServerSideProps|getStaticProps|getStaticPaths|loader|action|default)$/], multiplier: 2.5 },
  express: { patterns: [/Middleware$/i, /Router$/i], multiplier: 2.5 },
  fastify: { patterns: [/Middleware$/i, /Router$/i], multiplier: 2.5 },
  hono: { patterns: [/Middleware$/i, /Handler$/i], multiplier: 2.5 },
  "@nestjs/core": { patterns: [/Controller$/i], multiplier: 2.5 },
  "@nestjs/common": { patterns: [/Controller$/i], multiplier: 2.5 },
};

interface ScoredEntry {
  nodeId: NodeId;
  score: number;
}

export function scoreEntryPoints(
  callGraph: CallGraphEdge[],
  publicAPI: PublicAPIEntry[],
  dependencyInsights?: DependencyInsights,
): ScoredEntry[] {
  // Build adjacency counts
  const outDegree = new Map<NodeId, number>();
  const inDegree = new Map<NodeId, number>();
  const allNodes = new Set<NodeId>();

  for (const edge of callGraph) {
    const from = makeNodeId(edge.fromFile, edge.from);
    const to = makeNodeId(edge.toFile, edge.to);
    allNodes.add(from);
    allNodes.add(to);
    outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  // Detect active frameworks for multipliers
  const activeFrameworks = new Set<string>();
  if (dependencyInsights?.frameworks) {
    for (const fw of dependencyInsights.frameworks) {
      if (FRAMEWORK_PATTERNS[fw.name]) activeFrameworks.add(fw.name);
    }
  }

  const exportedNames = new Set(publicAPI.filter((e) => !e.isTypeOnly).map((e) => e.name));
  const scored: ScoredEntry[] = [];

  for (const nodeId of allNodes) {
    const fn = nodeName(nodeId);
    const out = outDegree.get(nodeId) ?? 0;
    const inD = inDegree.get(nodeId) ?? 0;

    // Exclude test orchestration
    if (TEST_PATTERNS.test(fn)) continue;

    // Base: functions with high out-degree relative to in-degree are entry-like
    const baseScore = (out + 1) / (inD + 1);

    // Export boost: exported functions are more likely externally invoked
    const exportMul = exportedNames.has(fn) ? 1.5 : 1.0;

    // Zero-caller boost: exported with no internal callers = likely framework-invoked
    const externalOnlyMul = inD === 0 && out >= 2 && exportedNames.has(fn) ? 1.8 : 1.0;

    // Framework multiplier (checked first — overrides name penalty for framework entry points)
    let frameworkMul = 1.0;
    for (const fwName of activeFrameworks) {
      const fw = FRAMEWORK_PATTERNS[fwName];
      if (fw.patterns.some((p) => p.test(fn))) {
        frameworkMul = Math.max(frameworkMul, fw.multiplier);
      }
    }

    // Name pattern multiplier (skip penalty if framework multiplier already boosted)
    let nameMul = 1.0;
    if (ENTRY_PATTERNS.test(fn) || ENTRY_SUFFIX_PATTERNS.test(fn)) nameMul = 2.0;
    else if (UTILITY_PATTERNS.test(fn) && frameworkMul <= 1.0) nameMul = 0.3;

    const score = baseScore * exportMul * externalOnlyMul * nameMul * frameworkMul;
    if (score > 0) scored.push({ nodeId, score });
  }

  // Dynamic cap: scale with codebase size
  const maxEntries = Math.max(10, Math.min(200, Math.floor(allNodes.size / 10)));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxEntries);
}

// ─── Forward BFS (Spine-First) ───────────────────────────────────────────────

interface RawFlow {
  nodeIds: NodeId[];
}

export function traceFlows(callGraph: CallGraphEdge[], entries: ScoredEntry[]): RawFlow[] {
  // Build forward adjacency with out-degree for callee ranking
  const adj = new Map<NodeId, NodeId[]>();
  const outDegree = new Map<NodeId, number>();

  for (const edge of callGraph) {
    const from = makeNodeId(edge.fromFile, edge.from);
    const to = makeNodeId(edge.toFile, edge.to);
    const callees = adj.get(from) ?? [];
    callees.push(to);
    adj.set(from, callees);
    outDegree.set(to, (outDegree.get(to) ?? 0) + (adj.get(to)?.length ?? 0));
  }

  // Recount out-degree properly
  for (const [node, callees] of adj) {
    outDegree.set(node, callees.length);
  }

  const allFlows: RawFlow[] = [];

  for (const entry of entries) {
    const traces: RawFlow[] = [];

    // PRIMARY SPINE: follow highest out-degree callee at each step (no branching limit)
    const spine = traceSpine(entry.nodeId, adj, outDegree);
    if (spine.length >= MIN_STEPS) {
      traces.push({ nodeIds: spine });
    }

    // FORK PATHS: at each spine node, explore alternative callees
    for (let i = 0; i < spine.length && traces.length < MAX_TRACES_PER_ENTRY; i++) {
      const node = spine[i];
      const callees = adj.get(node) ?? [];
      if (callees.length <= 1) continue; // No forks at this node

      // Sort callees by out-degree descending, skip the spine callee
      const spineNext = i + 1 < spine.length ? spine[i + 1] : null;
      const forks = callees
        .filter((c) => c !== spineNext)
        .sort((a, b) => (outDegree.get(b) ?? 0) - (outDegree.get(a) ?? 0))
        .slice(0, MAX_FORK_PATHS);

      for (const fork of forks) {
        // Trace a sub-spine from this fork point
        const pathPrefix = spine.slice(0, i + 1);
        const visited = new Set(pathPrefix);
        if (visited.has(fork)) continue;

        const forkSpine = traceSpine(fork, adj, outDegree, visited);
        const fullPath = [...pathPrefix, ...forkSpine];
        if (fullPath.length >= MIN_STEPS) {
          traces.push({ nodeIds: fullPath });
        }
      }
    }

    allFlows.push(...traces);
  }

  return allFlows;
}

/** Trace a single spine: follow highest out-degree callee at each step. */
function traceSpine(
  start: NodeId,
  adj: Map<NodeId, NodeId[]>,
  outDegree: Map<NodeId, number>,
  visited?: Set<NodeId>,
): NodeId[] {
  const path = [start];
  const seen = visited ?? new Set([start]);
  if (visited) seen.add(start);

  let current = start;
  for (let depth = 1; depth < MAX_TRACE_DEPTH; depth++) {
    const callees = (adj.get(current) ?? []).filter((c) => !seen.has(c));
    if (callees.length === 0) break;

    // Pick callee with highest out-degree (leads to deeper paths)
    // Tie-break: alphabetical nodeId for determinism
    callees.sort((a, b) => {
      const diff = (outDegree.get(b) ?? 0) - (outDegree.get(a) ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });

    const next = callees[0];
    seen.add(next);
    path.push(next);
    current = next;
  }

  return path;
}

// ─── Deduplication ───────────────────────────────────────────────────────────

export function deduplicateFlows(candidates: RawFlow[], maxFlows: number): RawFlow[] {
  // Sort by length descending — longer flows are preferred
  const sorted = [...candidates].sort((a, b) => b.nodeIds.length - a.nodeIds.length);

  // Phase 1: Subset removal — discard flows that are contiguous subpaths of a longer flow
  const kept: RawFlow[] = [];
  for (const flow of sorted) {
    const isSubset = kept.some((existing) => isContiguousSubpath(flow.nodeIds, existing.nodeIds));
    if (!isSubset) kept.push(flow);
  }

  // Phase 2: Endpoint dedup — keep longest per (entry, terminal) pair
  const byEndpoints = new Map<string, RawFlow>();
  for (const flow of kept) {
    const key = `${flow.nodeIds[0]}::${flow.nodeIds[flow.nodeIds.length - 1]}`;
    const existing = byEndpoints.get(key);
    if (!existing || flow.nodeIds.length > existing.nodeIds.length) {
      byEndpoints.set(key, flow);
    }
  }

  return [...byEndpoints.values()].sort((a, b) => b.nodeIds.length - a.nodeIds.length).slice(0, maxFlows);
}

/** Check if `sub` is a contiguous subpath of `sup` (sliding window). */
function isContiguousSubpath(sub: NodeId[], sup: NodeId[]): boolean {
  if (sub.length >= sup.length) return false;
  for (let i = 0; i <= sup.length - sub.length; i++) {
    if (sub.every((step, j) => step === sup[i + j])) return true;
  }
  return false;
}

// ─── Co-Change Confidence ────────────────────────────────────────────────────

function computeFlowConfidence(files: string[], coChangeEdges?: CoChangeEdge[]): number {
  if (!coChangeEdges || coChangeEdges.length === 0 || files.length < 2) return 0;

  // Build fast pairwise Jaccard lookup
  const jaccardMap = new Map<string, number>();
  for (const e of coChangeEdges) {
    jaccardMap.set(`${e.file1}\0${e.file2}`, e.jaccard);
    jaccardMap.set(`${e.file2}\0${e.file1}`, e.jaccard);
  }

  let total = 0;
  let pairs = 0;
  for (let i = 0; i < files.length - 1; i++) {
    if (files[i] === files[i + 1]) continue; // Skip same-file adjacent steps
    total += jaccardMap.get(`${files[i]}\0${files[i + 1]}`) ?? 0;
    pairs++;
  }

  return pairs > 0 ? total / pairs : 0;
}

// ─── Label Generation ────────────────────────────────────────────────────────

function generateLabel(steps: string[], files: string[]): string {
  const uniqueFiles = new Set(files).size;
  if (steps.length <= 4) {
    return `${steps.join(" → ")} (${steps.length} steps, ${uniqueFiles} files)`;
  }
  return `${steps[0]} → ${steps[1]} → ... → ${steps[steps.length - 1]} (${steps.length} steps, ${uniqueFiles} files)`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Enrich existing flows with co-change confidence scores.
 * Called after git history is attached to the package analysis.
 */
export function enrichFlowConfidence(flows: ExecutionFlow[], coChangeEdges: CoChangeEdge[]): void {
  for (const flow of flows) {
    flow.confidence = computeFlowConfidence(flow.files, coChangeEdges);
  }
  // Re-sort by confidence
  flows.sort((a, b) => b.confidence - a.confidence || b.length - a.length);
}

/**
 * Detect execution flows via forward BFS from scored entry points.
 * Returns empty array if call graph is too sparse (<10 edges) or package is React-only.
 */
export function computeExecutionFlows(
  callGraph: CallGraphEdge[],
  publicAPI: PublicAPIEntry[],
  dependencyInsights?: DependencyInsights,
  coChangeEdges?: CoChangeEdge[],
): ExecutionFlow[] {
  if (callGraph.length < MIN_CALL_GRAPH_EDGES) return [];

  // Score and select entry points
  const entries = scoreEntryPoints(callGraph, publicAPI, dependencyInsights);
  if (entries.length === 0) return [];

  // Trace flows via spine-first BFS
  const rawFlows = traceFlows(callGraph, entries);
  if (rawFlows.length === 0) return [];

  // Deduplicate
  const functionCount = new Set(callGraph.flatMap((e) => [makeNodeId(e.fromFile, e.from), makeNodeId(e.toFile, e.to)]))
    .size;
  const maxFlows = Math.max(10, Math.min(200, Math.floor(functionCount / 10)));
  const deduped = deduplicateFlows(rawFlows, maxFlows);

  // Convert to ExecutionFlow with co-change confidence
  const flows: ExecutionFlow[] = deduped.map((raw) => {
    const steps = raw.nodeIds.map(nodeName);
    const files = raw.nodeIds.map(nodeFile);
    const confidence = computeFlowConfidence(files, coChangeEdges);

    return {
      label: generateLabel(steps, files),
      entryPoint: steps[0],
      entryFile: files[0],
      terminal: steps[steps.length - 1],
      terminalFile: files[files.length - 1],
      steps,
      files,
      length: steps.length,
      confidence,
    };
  });

  // Sort by confidence descending, then length descending
  flows.sort((a, b) => b.confidence - a.confidence || b.length - a.length);
  return flows;
}
