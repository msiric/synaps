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
  const ff = fromFile ?? `src/${from}.ts`;
  const tf = toFile ?? `src/${to}.ts`;
  return {
    from,
    to,
    fromFile: ff,
    toFile: tf,
    confidence: ff === tf ? 0.95 : 0.85,
    resolution: ff === tf ? "same-file" : "export-map",
  };
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

// ─── Import count centrality ──────────────────────────────────────────────────

describe("scoreEntryPoints — import count centrality", () => {
  it("boosts heavily-imported public symbols over rarely-imported ones", () => {
    const graph = [edge("coreFunc", "helper"), edge("obscureFunc", "helper")];
    const publicAPI: PublicAPIEntry[] = [
      { name: "coreFunc", kind: "function", sourceFile: "src/coreFunc.ts", isTypeOnly: false, importCount: 15 },
      { name: "obscureFunc", kind: "function", sourceFile: "src/obscureFunc.ts", isTypeOnly: false, importCount: 0 },
    ];
    const scored = scoreEntryPoints(graph, publicAPI);
    const coreScore = scored.find((s) => s.nodeId.includes("coreFunc"))!.score;
    const obscureScore = scored.find((s) => s.nodeId.includes("obscureFunc"))!.score;
    expect(coreScore).toBeGreaterThan(obscureScore);
  });

  it("centrality boost caps at 1.5x (importCount=20 saturates)", () => {
    const graph = [edge("a", "helper"), edge("b", "helper")];
    const publicAPI: PublicAPIEntry[] = [
      { name: "a", kind: "function", sourceFile: "src/a.ts", isTypeOnly: false, importCount: 20 },
      { name: "b", kind: "function", sourceFile: "src/b.ts", isTypeOnly: false, importCount: 100 },
    ];
    const scored = scoreEntryPoints(graph, publicAPI);
    const aScore = scored.find((s) => s.nodeId.includes("#a"))!.score;
    const bScore = scored.find((s) => s.nodeId.includes("#b"))!.score;
    // Both should be equal since centrality caps at 1.5x (importCount >= 20)
    expect(aScore).toBe(bScore);
  });
});

// ─── Framework entry methods ──────────────────────────────────────────────────

describe("scoreEntryPoints — framework entry methods", () => {
  it("boosts hono fetch when hono is active framework", () => {
    const graph = [edge("fetch", "dispatch"), edge("someHelper", "dispatch")];
    const deps = { runtime: [], frameworks: [{ name: "hono", version: "4.0.0" }] };
    const scored = scoreEntryPoints(graph, [], deps);
    const fetchScore = scored.find((s) => s.nodeId.includes("fetch"))!.score;
    const helperScore = scored.find((s) => s.nodeId.includes("someHelper"))!.score;
    expect(fetchScore).toBeGreaterThan(helperScore);
  });

  it("does not boost fetch when hono is NOT active", () => {
    const graph = [edge("fetch", "dispatch"), edge("handleRequest", "dispatch")];
    const scored = scoreEntryPoints(graph, []);
    const fetchScore = scored.find((s) => s.nodeId.includes("fetch"))!.score;
    const handleScore = scored.find((s) => s.nodeId.includes("handleRequest"))!.score;
    // Without framework context, handleRequest matches ENTRY_PATTERNS, fetch doesn't
    expect(handleScore).toBeGreaterThan(fetchScore);
  });

  it("boosts express listen when express is active framework", () => {
    const graph = [edge("listen", "bind"), edge("obscure", "bind")];
    const deps = { runtime: [], frameworks: [{ name: "express", version: "4.0.0" }] };
    const scored = scoreEntryPoints(graph, [], deps);
    const listenScore = scored.find((s) => s.nodeId.includes("listen"))!.score;
    const obscureScore = scored.find((s) => s.nodeId.includes("obscure"))!.score;
    expect(listenScore).toBeGreaterThan(obscureScore);
  });
});

// ─── Flow quality scoring ─────────────────────────────────────────────────────

describe("computeExecutionFlows — flow quality scoring", () => {
  function crossDirEdge(from: string, to: string, fromDir: string, toDir: string): CallGraphEdge {
    return {
      from,
      to,
      fromFile: `src/${fromDir}/${from}.ts`,
      toFile: `src/${toDir}/${to}.ts`,
      confidence: 0.85,
      resolution: "export-map",
    };
  }

  it("ranks cross-directory flows above single-directory flows", () => {
    // Build a graph above MIN_CALL_GRAPH_EDGES with two competing paths:
    // Path A: cross-directory (core → routing → middleware → handlers)
    // Path B: single-directory (ssg/fetch → ssg/filter → ssg/find → ssg/check)
    const graph: CallGraphEdge[] = [
      // Cross-directory path
      crossDirEdge("entryA", "routeA", "core", "routing"),
      crossDirEdge("routeA", "middlewareA", "routing", "middleware"),
      crossDirEdge("middlewareA", "handlerA", "middleware", "handlers"),
      // Single-directory path
      {
        from: "entryB",
        to: "filterB",
        fromFile: "src/ssg/entryB.ts",
        toFile: "src/ssg/filterB.ts",
        confidence: 0.95,
        resolution: "same-file",
      },
      {
        from: "filterB",
        to: "findB",
        fromFile: "src/ssg/filterB.ts",
        toFile: "src/ssg/findB.ts",
        confidence: 0.95,
        resolution: "same-file",
      },
      {
        from: "findB",
        to: "checkB",
        fromFile: "src/ssg/findB.ts",
        toFile: "src/ssg/checkB.ts",
        confidence: 0.95,
        resolution: "same-file",
      },
      // Filler edges to hit MIN_CALL_GRAPH_EDGES threshold
      edge("filler1", "filler2"),
      edge("filler3", "filler4"),
      edge("filler5", "filler6"),
      edge("filler7", "filler8"),
      edge("filler9", "filler10"),
    ];
    const flows = computeExecutionFlows(graph, [api("entryA"), api("entryB")]);
    const crossDirFlow = flows.find((f) => f.entryPoint === "entryA");
    const singleDirFlow = flows.find((f) => f.entryPoint === "entryB");

    expect(crossDirFlow).toBeDefined();
    expect(singleDirFlow).toBeDefined();
    expect(crossDirFlow!.qualityScore).toBeGreaterThan(singleDirFlow!.qualityScore!);
  });

  it("single-directory minimum-length flow gets lowest quality score", () => {
    const graph: CallGraphEdge[] = [
      // 3-step flow in one directory
      {
        from: "a",
        to: "b",
        fromFile: "src/helpers/a.ts",
        toFile: "src/helpers/b.ts",
        confidence: 0.95,
        resolution: "same-file",
      },
      {
        from: "b",
        to: "c",
        fromFile: "src/helpers/b.ts",
        toFile: "src/helpers/c.ts",
        confidence: 0.95,
        resolution: "same-file",
      },
      // Filler
      ...Array.from({ length: 10 }, (_, i) => edge(`fill${i}`, `fill${i + 1}`)),
    ];
    const flows = computeExecutionFlows(graph, [api("a")]);
    const helperFlow = flows.find((f) => f.entryPoint === "a");
    if (helperFlow) {
      // lengthNorm=0, fileSpread=1 (3 unique / 3), dirSpread=0 → 0.3
      expect(helperFlow.qualityScore).toBeLessThanOrEqual(0.3);
    }
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
