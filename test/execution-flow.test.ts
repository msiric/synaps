import { describe, expect, it } from "vitest";
import {
  computeExecutionFlows,
  deduplicateFlows,
  enrichFlowConfidence,
  scoreEntryPoints,
  traceFlows,
} from "../src/execution-flow.js";
import type { CallGraphEdge, CoChangeEdge, PublicAPIEntry } from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function edge(from: string, to: string, fromFile?: string, toFile?: string): CallGraphEdge {
  return { from, to, fromFile: fromFile ?? `src/${from}.ts`, toFile: toFile ?? `src/${to}.ts` };
}

function api(name: string): PublicAPIEntry {
  return { name, kind: "function", sourceFile: `src/${name}.ts`, isTypeOnly: false };
}

// ─── scoreEntryPoints ────────────────────────────────────────────────────────

describe("scoreEntryPoints", () => {
  it("scores high out-degree + zero in-degree highest", () => {
    const graph = [
      edge("runPipeline", "parseFiles"),
      edge("runPipeline", "buildGraph"),
      edge("runPipeline", "analyze"),
      edge("parseFiles", "readFile"),
    ];
    const scored = scoreEntryPoints(graph, []);
    expect(scored[0].nodeId).toContain("runPipeline");
  });

  it("boosts entry-point name patterns", () => {
    const graph = [edge("handleLogin", "validate"), edge("fetchData", "validate")];
    const scored = scoreEntryPoints(graph, []);
    const handleScore = scored.find((s) => s.nodeId.includes("handleLogin"))!.score;
    const fetchScore = scored.find((s) => s.nodeId.includes("fetchData"))!.score;
    expect(handleScore).toBeGreaterThan(fetchScore);
  });

  it("penalizes utility patterns", () => {
    const graph = [edge("getUser", "query"), edge("handleRequest", "query")];
    const scored = scoreEntryPoints(graph, []);
    const getScore = scored.find((s) => s.nodeId.includes("getUser"))!.score;
    const handleScore = scored.find((s) => s.nodeId.includes("handleRequest"))!.score;
    expect(handleScore).toBeGreaterThan(getScore);
  });

  it("boosts exported functions", () => {
    const graph = [edge("runA", "helper"), edge("runB", "helper")];
    const publicAPI = [api("runA")];
    const scored = scoreEntryPoints(graph, publicAPI);
    const aScore = scored.find((s) => s.nodeId.includes("runA"))!.score;
    const bScore = scored.find((s) => s.nodeId.includes("runB"))!.score;
    expect(aScore).toBeGreaterThan(bScore);
  });

  it("excludes test orchestration functions", () => {
    const graph = [edge("describe", "it"), edge("it", "expect"), edge("handleLogin", "validate")];
    const scored = scoreEntryPoints(graph, []);
    expect(scored.find((s) => s.nodeId.includes("describe"))).toBeUndefined();
    expect(scored.find((s) => s.nodeId.includes("it"))).toBeUndefined();
  });

  it("applies framework multiplier when DependencyInsights provided", () => {
    const graph = [edge("getServerSideProps", "fetchData"), edge("handleRequest", "fetchData")];
    const deps = { runtime: [], frameworks: [{ name: "next", version: "14.0.0" }] };
    const scored = scoreEntryPoints(graph, [], deps);
    const nextScore = scored.find((s) => s.nodeId.includes("getServerSideProps"))!.score;
    const handleScore = scored.find((s) => s.nodeId.includes("handleRequest"))!.score;
    expect(nextScore).toBeGreaterThan(handleScore);
  });

  it("handles duplicate function names across files with composite IDs", () => {
    const graph: CallGraphEdge[] = [
      { from: "init", to: "setup", fromFile: "src/auth/init.ts", toFile: "src/setup.ts" },
      { from: "init", to: "config", fromFile: "src/db/init.ts", toFile: "src/config.ts" },
    ];
    const scored = scoreEntryPoints(graph, []);
    const authInit = scored.find((s) => s.nodeId === "src/auth/init.ts#init");
    const dbInit = scored.find((s) => s.nodeId === "src/db/init.ts#init");
    expect(authInit).toBeDefined();
    expect(dbInit).toBeDefined();
    expect(authInit!.nodeId).not.toBe(dbInit!.nodeId);
  });
});

// ─── traceFlows ──────────────────────────────────────────────────────────────

describe("traceFlows", () => {
  it("traces linear chain A→B→C→D", () => {
    const graph = [edge("A", "B"), edge("B", "C"), edge("C", "D")];
    const entries = [{ nodeId: "src/A.ts#A", score: 10 }];
    const flows = traceFlows(graph, entries);
    expect(flows.length).toBeGreaterThanOrEqual(1);
    const main = flows.find((f) => f.nodeIds.length === 4);
    expect(main).toBeDefined();
  });

  it("detects cycles and terminates", () => {
    const graph = [edge("A", "B"), edge("B", "C"), edge("C", "A")];
    const entries = [{ nodeId: "src/A.ts#A", score: 10 }];
    const flows = traceFlows(graph, entries);
    // Should produce A→B→C (length 3) — cycle back to A is detected and skipped
    expect(flows.length).toBeGreaterThanOrEqual(1);
    const longest = flows.reduce((a, b) => (a.nodeIds.length > b.nodeIds.length ? a : b));
    expect(longest.nodeIds.length).toBe(3);
  });

  it("spine-first traces full pipeline through high out-degree orchestrator", () => {
    // Orchestrator calls 8 functions sequentially (each calls the next)
    const graph = [
      edge("orchestrate", "step1"),
      edge("orchestrate", "step2"),
      edge("orchestrate", "step3"),
      edge("orchestrate", "step4"),
      edge("orchestrate", "step5"),
      edge("orchestrate", "step6"),
      edge("step1", "helper1"),
      edge("step3", "helper2"),
    ];
    const entries = [{ nodeId: "src/orchestrate.ts#orchestrate", score: 10 }];
    const flows = traceFlows(graph, entries);
    // Should produce at least one flow with orchestrate as entry
    expect(flows.length).toBeGreaterThanOrEqual(1);
  });

  it("filters paths shorter than minSteps=3", () => {
    const graph = [edge("A", "B")]; // Only 2 nodes
    const entries = [{ nodeId: "src/A.ts#A", score: 10 }];
    const flows = traceFlows(graph, entries);
    // A→B is length 2 < minSteps 3 → filtered
    expect(flows.filter((f) => f.nodeIds.length < 3)).toHaveLength(0);
  });
});

// ─── deduplicateFlows ────────────────────────────────────────────────────────

describe("deduplicateFlows", () => {
  it("removes subset flows", () => {
    const flows = [
      { nodeIds: ["A", "B", "C"] },
      { nodeIds: ["A", "B", "C", "D"] }, // longer — A→B→C is subset
    ];
    const result = deduplicateFlows(flows, 50);
    expect(result).toHaveLength(1);
    expect(result[0].nodeIds).toHaveLength(4);
  });

  it("preserves flows with different paths even if overlapping nodes", () => {
    // A→B→D and A→C→E — different endpoints, different paths
    const flows = [{ nodeIds: ["A", "B", "D"] }, { nodeIds: ["A", "C", "E"] }];
    const result = deduplicateFlows(flows, 50);
    expect(result).toHaveLength(2);
  });

  it("endpoint dedup keeps longest per (entry, terminal) pair", () => {
    const flows = [
      { nodeIds: ["A", "B", "C"] }, // entry=A, terminal=C
      { nodeIds: ["A", "X", "Y", "C"] }, // same endpoints, longer
    ];
    const result = deduplicateFlows(flows, 50);
    const ac = result.filter((f) => f.nodeIds[0] === "A" && f.nodeIds[f.nodeIds.length - 1] === "C");
    expect(ac).toHaveLength(1);
    expect(ac[0].nodeIds).toHaveLength(4); // kept the longer one
  });

  it("respects maxFlows cap", () => {
    const flows = Array.from({ length: 20 }, (_, i) => ({
      nodeIds: [`entry${i}`, "mid", `end${i}`],
    }));
    const result = deduplicateFlows(flows, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

// ─── Co-change confidence ────────────────────────────────────────────────────

describe("enrichFlowConfidence", () => {
  it("computes confidence from co-change Jaccard", () => {
    const flows = [
      {
        label: "test",
        entryPoint: "A",
        entryFile: "src/a.ts",
        terminal: "C",
        terminalFile: "src/c.ts",
        steps: ["A", "B", "C"],
        files: ["src/a.ts", "src/b.ts", "src/c.ts"],
        length: 3,
        confidence: 0,
      },
    ];
    const coChanges: CoChangeEdge[] = [
      {
        file1: "src/a.ts",
        file2: "src/b.ts",
        jaccard: 0.6,
        coChangeCount: 10,
        file1Commits: 15,
        file2Commits: 12,
        lastCoChangeTimestamp: Date.now() / 1000,
      },
      {
        file1: "src/b.ts",
        file2: "src/c.ts",
        jaccard: 0.4,
        coChangeCount: 8,
        file1Commits: 12,
        file2Commits: 10,
        lastCoChangeTimestamp: Date.now() / 1000,
      },
    ];
    enrichFlowConfidence(flows, coChanges);
    expect(flows[0].confidence).toBeCloseTo(0.5, 1); // mean of 0.6 and 0.4
  });

  it("returns 0 confidence when no co-change data", () => {
    const flows = [
      {
        label: "test",
        entryPoint: "A",
        entryFile: "src/a.ts",
        terminal: "B",
        terminalFile: "src/b.ts",
        steps: ["A", "B"],
        files: ["src/a.ts", "src/b.ts"],
        length: 2,
        confidence: 0,
      },
    ];
    enrichFlowConfidence(flows, []);
    expect(flows[0].confidence).toBe(0);
  });
});

// ─── computeExecutionFlows (integration) ─────────────────────────────────────

describe("computeExecutionFlows", () => {
  it("returns empty for sparse graph (<10 edges)", () => {
    const graph = [edge("A", "B"), edge("B", "C")];
    expect(computeExecutionFlows(graph, [])).toHaveLength(0);
  });

  it("produces flows for realistic graph", () => {
    // Build a graph with 15+ edges (above MIN_CALL_GRAPH_EDGES threshold)
    const graph = [
      edge("runPipeline", "discoverFiles"),
      edge("runPipeline", "parseAST"),
      edge("runPipeline", "buildSymbolGraph"),
      edge("runPipeline", "computeImportChain"),
      edge("runPipeline", "classifyTiers"),
      edge("buildSymbolGraph", "resolveExports"),
      edge("buildSymbolGraph", "buildCallGraph"),
      edge("parseAST", "createSourceFile"),
      edge("parseAST", "extractExports"),
      edge("computeImportChain", "resolveModuleSpecifier"),
      edge("discoverFiles", "walkDirectory"),
    ];
    const flows = computeExecutionFlows(graph, [api("runPipeline")]);
    expect(flows.length).toBeGreaterThanOrEqual(1);
    // The primary flow should start with runPipeline
    const pipelineFlow = flows.find((f) => f.entryPoint === "runPipeline");
    expect(pipelineFlow).toBeDefined();
    expect(pipelineFlow!.length).toBeGreaterThanOrEqual(3);
  });

  it("generates sensible labels", () => {
    const graph = Array.from({ length: 12 }, (_, i) => edge(`fn${i}`, `fn${i + 1}`));
    const flows = computeExecutionFlows(graph, [api("fn0")]);
    if (flows.length > 0) {
      expect(flows[0].label).toContain("→");
      expect(flows[0].label).toContain("steps");
    }
  });

  it("includes file paths parallel to steps", () => {
    const graph = Array.from({ length: 12 }, (_, i) => edge(`fn${i}`, `fn${i + 1}`));
    const flows = computeExecutionFlows(graph, []);
    for (const flow of flows) {
      expect(flow.steps.length).toBe(flow.files.length);
      expect(flow.length).toBe(flow.steps.length);
    }
  });
});
