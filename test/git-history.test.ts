import { describe, expect, it } from "vitest";
import { computeCoChangeEdges, detectClusters, generateCoChangeRules, parseGitLog } from "../src/git-history.js";
import type { CoChangeEdge } from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NOW = 1700777600; // recent timestamp for recency tests

function makeEdge(
  file1: string,
  file2: string,
  coChangeCount: number,
  file1Commits: number,
  file2Commits: number,
  lastCoChangeTimestamp: number = NOW,
): CoChangeEdge {
  const union = file1Commits + file2Commits - coChangeCount;
  return {
    file1: file1 < file2 ? file1 : file2,
    file2: file1 < file2 ? file2 : file1,
    coChangeCount,
    file1Commits,
    file2Commits,
    jaccard: union > 0 ? coChangeCount / union : 0,
    lastCoChangeTimestamp,
  };
}

// ─── parseGitLog ─────────────────────────────────────────────────────────────

describe("parseGitLog", () => {
  it("parses multi-commit output with --name-status format", () => {
    const raw = [
      "COMMIT:abc123 1700000000",
      "M\tsrc/foo.ts",
      "A\tsrc/bar.ts",
      "",
      "COMMIT:def456 1700086400",
      "M\tsrc/baz.tsx",
      "",
    ].join("\n");

    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0].hash).toBe("abc123");
    expect(commits[0].timestamp).toBe(1700000000);
    expect(commits[0].files).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(commits[1].files).toEqual(["src/baz.tsx"]);
  });

  it("filters out non-source files", () => {
    const raw = [
      "COMMIT:abc123 1700000000",
      "M\tsrc/foo.ts",
      "M\tpackage.json",
      "M\tREADME.md",
      "M\tsrc/styles.css",
      "A\tsrc/bar.jsx",
    ].join("\n");

    const commits = parseGitLog(raw);
    expect(commits[0].files).toEqual(["src/foo.ts", "src/bar.jsx"]);
  });

  it("returns empty array for empty or malformed input", () => {
    expect(parseGitLog("")).toEqual([]);
    expect(parseGitLog("garbage data")).toEqual([]);
    expect(parseGitLog("COMMIT:")).toEqual([]);
  });

  it("handles commits with AMCR status codes", () => {
    const raw = [
      "COMMIT:abc123 1700000000",
      "M\tsrc/modified.ts",
      "A\tsrc/added.ts",
      "C\tsrc/copied.ts",
      "R100\tsrc/renamed.ts",
    ].join("\n");

    const commits = parseGitLog(raw);
    expect(commits[0].files).toContain("src/modified.ts");
    expect(commits[0].files).toContain("src/added.ts");
    expect(commits[0].files).toContain("src/copied.ts");
  });
});

// ─── computeCoChangeEdges ────────────────────────────────────────────────────

describe("computeCoChangeEdges", () => {
  it("detects perfect co-change (Jaccard = 1.0)", () => {
    const commits = [
      { hash: "1", timestamp: NOW - 100, files: ["a.ts", "b.ts"] },
      { hash: "2", timestamp: NOW - 50, files: ["a.ts", "b.ts"] },
      { hash: "3", timestamp: NOW, files: ["a.ts", "b.ts"] },
    ];

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    expect(edges).toHaveLength(1);
    expect(edges[0].file1).toBe("a.ts");
    expect(edges[0].file2).toBe("b.ts");
    expect(edges[0].jaccard).toBe(1.0);
    expect(edges[0].coChangeCount).toBe(3);
    expect(edges[0].lastCoChangeTimestamp).toBe(NOW);
  });

  it("correctly rejects asymmetric pairs via Jaccard", () => {
    const commits = [];
    for (let i = 0; i < 100; i++) {
      commits.push({ hash: `a${i}`, timestamp: NOW - i, files: ["a.ts"] });
    }
    for (let i = 0; i < 5; i++) {
      const files = i < 3 ? ["a.ts", "b.ts"] : ["b.ts"];
      commits.push({ hash: `b${i}`, timestamp: NOW - i, files });
    }

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    const pair = edges.find(
      (e) => (e.file1 === "a.ts" && e.file2 === "b.ts") || (e.file1 === "b.ts" && e.file2 === "a.ts"),
    );
    expect(pair).toBeUndefined();
  });

  it("creates 3 edges from a 3-file commit", () => {
    const commits = [
      { hash: "1", timestamp: NOW - 100, files: ["a.ts", "b.ts", "c.ts"] },
      { hash: "2", timestamp: NOW - 50, files: ["a.ts", "b.ts", "c.ts"] },
      { hash: "3", timestamp: NOW, files: ["a.ts", "b.ts", "c.ts"] },
    ];

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    expect(edges).toHaveLength(3);
  });

  it("allows 2 co-changes in young repos (adaptive threshold)", () => {
    const commits = [
      { hash: "1", timestamp: NOW - 50, files: ["a.ts", "b.ts"] },
      { hash: "2", timestamp: NOW, files: ["a.ts", "b.ts"] },
    ];

    // 2 commits = young repo → minCoChanges drops to 2
    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    expect(edges).toHaveLength(1);
  });

  it("filters by minimum co-change count in mature repos", () => {
    // 30+ commits = mature repo → requires MIN_CO_CHANGES (3)
    const commits = [
      { hash: "1", timestamp: NOW - 50, files: ["a.ts", "b.ts"] },
      { hash: "2", timestamp: NOW, files: ["a.ts", "b.ts"] },
      // Pad to 30 commits with unrelated files to cross the threshold
      ...Array.from({ length: 28 }, (_, i) => ({
        hash: `pad${i}`,
        timestamp: NOW - i * 10,
        files: [`other${i}.ts`],
      })),
    ];

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    // a.ts and b.ts only co-changed 2 times — below the mature threshold of 3
    expect(edges).toHaveLength(0);
  });

  it("skips large commits (> maxFilesPerCommit)", () => {
    const largeFiles = Array.from({ length: 35 }, (_, i) => `file${i}.ts`);
    const commits = [
      { hash: "1", timestamp: NOW - 200, files: largeFiles },
      { hash: "2", timestamp: NOW - 100, files: ["a.ts", "b.ts"] },
      { hash: "3", timestamp: NOW - 50, files: ["a.ts", "b.ts"] },
      { hash: "4", timestamp: NOW, files: ["a.ts", "b.ts"] },
    ];

    const { edges, commitsFilteredBySize } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    expect(commitsFilteredBySize).toBe(1);
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes hub files (> threshold appearance rate)", () => {
    const commits = [];
    for (let i = 0; i < 10; i++) {
      const files = i < 8 ? ["hub.ts", `file${i}.ts`] : [`file${i}.ts`, `other${i}.ts`];
      commits.push({ hash: `${i}`, timestamp: NOW - i, files });
    }
    for (let i = 10; i < 13; i++) {
      commits.push({ hash: `${i}`, timestamp: NOW - i, files: ["file0.ts", "file1.ts"] });
    }

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    for (const edge of edges) {
      expect(edge.file1).not.toBe("hub.ts");
      expect(edge.file2).not.toBe("hub.ts");
    }
  });

  it("uses lenient hub threshold for young repos (< minHubCommits)", () => {
    const commits = [];
    for (let i = 0; i < 20; i++) {
      const files = i < 15 ? ["types.ts", `file${i % 3}.ts`] : [`file${i % 3}.ts`];
      commits.push({ hash: `${i}`, timestamp: NOW - i, files });
    }

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    const hasTypes = edges.some((e) => e.file1 === "types.ts" || e.file2 === "types.ts");
    expect(hasTypes).toBe(true);
  });

  it("returns empty for single-file commits", () => {
    const commits = [
      { hash: "1", timestamp: NOW - 100, files: ["a.ts"] },
      { hash: "2", timestamp: NOW - 50, files: ["b.ts"] },
      { hash: "3", timestamp: NOW, files: ["c.ts"] },
    ];

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    expect(edges).toHaveLength(0);
  });

  it("filters out pairs with no recent co-change (recency filter)", () => {
    // All co-changes happened > 180 days ago relative to newest commit
    const oldTimestamp = NOW - 200 * 86400; // 200 days ago
    const commits = [
      { hash: "1", timestamp: oldTimestamp, files: ["a.ts", "b.ts"] },
      { hash: "2", timestamp: oldTimestamp + 100, files: ["a.ts", "b.ts"] },
      { hash: "3", timestamp: oldTimestamp + 200, files: ["a.ts", "b.ts"] },
      // Recent commit but only touches a.ts alone
      { hash: "4", timestamp: NOW, files: ["a.ts"] },
    ];

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    // The a-b pair last co-changed 200 days ago, but newest commit is NOW
    // recencyCutoff = NOW - 180 days. Old pair (200d ago) should be excluded.
    const abEdge = edges.find((e) => e.file1 === "a.ts" && e.file2 === "b.ts");
    expect(abEdge).toBeUndefined();
  });

  it("keeps pairs with at least one recent co-change", () => {
    const oldTimestamp = NOW - 60 * 86400;
    const commits = [
      { hash: "1", timestamp: oldTimestamp, files: ["a.ts", "b.ts"] },
      { hash: "2", timestamp: oldTimestamp + 100, files: ["a.ts", "b.ts"] },
      // One recent co-change
      { hash: "3", timestamp: NOW, files: ["a.ts", "b.ts"] },
    ];

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    const abEdge = edges.find((e) => e.file1 === "a.ts" && e.file2 === "b.ts");
    expect(abEdge).toBeDefined();
    expect(abEdge!.lastCoChangeTimestamp).toBe(NOW);
  });
});

// ─── detectClusters ──────────────────────────────────────────────────────────

describe("detectClusters", () => {
  it("detects a 3-file clique as a cluster", () => {
    const edges = [
      makeEdge("a.ts", "b.ts", 5, 8, 7),
      makeEdge("a.ts", "c.ts", 5, 8, 7),
      makeEdge("b.ts", "c.ts", 5, 7, 7),
    ];

    const clusters = detectClusters(edges);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("detects a 4-file clique", () => {
    const edges = [
      makeEdge("a.ts", "b.ts", 5, 8, 7),
      makeEdge("a.ts", "c.ts", 5, 8, 7),
      makeEdge("a.ts", "d.ts", 5, 8, 7),
      makeEdge("b.ts", "c.ts", 5, 7, 7),
      makeEdge("b.ts", "d.ts", 5, 7, 7),
      makeEdge("c.ts", "d.ts", 5, 7, 7),
    ];

    const clusters = detectClusters(edges);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  it("does not cluster when pair is missing (incomplete clique)", () => {
    // a-b, a-c exist but b-c is missing → not a 3-clique
    const edges = [makeEdge("a.ts", "b.ts", 5, 8, 7), makeEdge("a.ts", "c.ts", 5, 8, 7)];

    const clusters = detectClusters(edges);
    expect(clusters).toHaveLength(0);
  });

  it("returns empty for fewer than 3 connected files", () => {
    const edges = [makeEdge("a.ts", "b.ts", 5, 8, 7)];

    const clusters = detectClusters(edges);
    expect(clusters).toHaveLength(0);
  });

  it("detects multiple separate clusters", () => {
    // Cluster 1: a, b, c
    // Cluster 2: x, y, z
    const edges = [
      makeEdge("a.ts", "b.ts", 5, 8, 7),
      makeEdge("a.ts", "c.ts", 5, 8, 7),
      makeEdge("b.ts", "c.ts", 5, 7, 7),
      makeEdge("x.ts", "y.ts", 4, 6, 5),
      makeEdge("x.ts", "z.ts", 4, 6, 5),
      makeEdge("y.ts", "z.ts", 4, 5, 5),
    ];

    const clusters = detectClusters(edges);
    expect(clusters).toHaveLength(2);
  });
});

// ─── generateCoChangeRules ───────────────────────────────────────────────────

describe("generateCoChangeRules", () => {
  it("emits one cluster rule instead of 3 symmetric individual rules", () => {
    // 3-file cluster: a, b, c all co-change with each other
    const edges = [
      makeEdge("src/a.ts", "src/b.ts", 10, 15, 12),
      makeEdge("src/a.ts", "src/c.ts", 9, 15, 11),
      makeEdge("src/b.ts", "src/c.ts", 8, 12, 11),
    ];

    const rules = generateCoChangeRules(edges);
    expect(rules).toHaveLength(1);
    expect(rules[0].trigger).toContain("any of");
    expect(rules[0].trigger).toContain("src/a.ts");
    expect(rules[0].trigger).toContain("src/b.ts");
    expect(rules[0].trigger).toContain("src/c.ts");
    expect(rules[0].source).toContain("cluster");
  });

  it("emits cluster + individual rules for mixed topology", () => {
    // Cluster: a, b, c
    // Individual: d has edges to e and f (not a cluster)
    const edges = [
      makeEdge("a.ts", "b.ts", 10, 15, 12),
      makeEdge("a.ts", "c.ts", 9, 15, 11),
      makeEdge("b.ts", "c.ts", 8, 12, 11),
      makeEdge("d.ts", "e.ts", 6, 8, 7),
      makeEdge("d.ts", "f.ts", 5, 8, 6),
    ];

    const rules = generateCoChangeRules(edges);
    const clusterRules = rules.filter((r) => r.source.includes("cluster"));
    const individualRules = rules.filter((r) => !r.source.includes("cluster"));
    expect(clusterRules).toHaveLength(1);
    expect(individualRules).toHaveLength(1);
    expect(individualRules[0].trigger).toContain("d.ts");
  });

  it("deduplicates against import-chain covered files", () => {
    const edges = [
      makeEdge("src/types.ts", "src/a.ts", 10, 15, 12),
      makeEdge("src/types.ts", "src/b.ts", 8, 15, 10),
      makeEdge("src/other.ts", "src/c.ts", 6, 8, 7),
      makeEdge("src/other.ts", "src/d.ts", 5, 8, 6),
    ];

    const covered = new Set(["src/types.ts"]);
    const rules = generateCoChangeRules(edges, covered);

    const triggerFiles = rules.map((r) => r.trigger);
    expect(triggerFiles.some((t) => t.includes("types.ts"))).toBe(false);
  });

  it("caps at maxRules", () => {
    const edges: CoChangeEdge[] = [];
    for (let i = 0; i < 10; i++) {
      edges.push(makeEdge(`file${i}.ts`, `partner${i}a.ts`, 5, 8, 7));
      edges.push(makeEdge(`file${i}.ts`, `partner${i}b.ts`, 4, 8, 6));
    }

    const rules = generateCoChangeRules(edges, undefined, 3);
    expect(rules.length).toBeLessThanOrEqual(3);
  });

  it("shows 'and N more' for many individual partners", () => {
    const edges = [
      makeEdge("src/core.ts", "src/a.ts", 10, 15, 12),
      makeEdge("src/core.ts", "src/b.ts", 9, 15, 11),
      makeEdge("src/core.ts", "src/c.ts", 8, 15, 10),
      makeEdge("src/core.ts", "src/d.ts", 7, 15, 9),
      makeEdge("src/core.ts", "src/e.ts", 6, 15, 8),
    ];

    const rules = generateCoChangeRules(edges);
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toContain("and 2 more");
  });

  it("returns empty for no edges", () => {
    expect(generateCoChangeRules([])).toEqual([]);
  });
});

// ─── Integration ─────────────────────────────────────────────────────────────

describe("integration", () => {
  it("parseGitLog + computeCoChangeEdges produces valid pipeline", () => {
    const raw = [
      "COMMIT:aaa 1700000000",
      "M\tsrc/types.ts",
      "M\tsrc/formatter.ts",
      "",
      "COMMIT:bbb 1700086400",
      "M\tsrc/types.ts",
      "M\tsrc/formatter.ts",
      "M\tsrc/parser.ts",
      "",
      "COMMIT:ccc 1700172800",
      "M\tsrc/types.ts",
      "M\tsrc/formatter.ts",
      "",
      "COMMIT:ddd 1700259200",
      "M\tsrc/types.ts",
      "M\tsrc/parser.ts",
      "",
      "COMMIT:eee 1700345600",
      "M\tsrc/parser.ts",
      "",
      "COMMIT:fff 1700432000",
      "M\tsrc/types.ts",
      "M\tsrc/formatter.ts",
      "",
      "COMMIT:ggg 1700518400",
      "M\tsrc/types.ts",
      "M\tsrc/formatter.ts",
      "",
      "COMMIT:hhh 1700604800",
      "M\tsrc/types.ts",
      "M\tsrc/formatter.ts",
      "",
      "COMMIT:iii 1700691200",
      "M\tsrc/types.ts",
      "M\tsrc/formatter.ts",
      "",
      "COMMIT:jjj 1700777600",
      "M\tsrc/types.ts",
      "M\tsrc/formatter.ts",
      "",
    ].join("\n");

    const commits = parseGitLog(raw);
    expect(commits.length).toBe(10);

    const { edges } = computeCoChangeEdges(commits, 30, 0.7, 50, []);
    const typesFormatter = edges.find(
      (e) =>
        (e.file1 === "src/formatter.ts" && e.file2 === "src/types.ts") ||
        (e.file1 === "src/types.ts" && e.file2 === "src/formatter.ts"),
    );
    expect(typesFormatter).toBeDefined();
    expect(typesFormatter!.coChangeCount).toBe(8);
    expect(typesFormatter!.jaccard).toBeGreaterThan(0.5);
  });

  it("handles empty commit list gracefully", () => {
    const commits = parseGitLog("");
    expect(commits).toEqual([]);
    const { edges } = computeCoChangeEdges([], 30, 0.7, 50, []);
    expect(edges).toEqual([]);
  });

  it("full pipeline: cluster + individual rules from realistic data", () => {
    // 4 detectors always change together (cluster)
    // types.ts + formatter.ts change together (individual pair)
    const edges = [
      // Cluster: 4 detectors
      makeEdge("src/detectors/a.ts", "src/detectors/b.ts", 8, 8, 8),
      makeEdge("src/detectors/a.ts", "src/detectors/c.ts", 8, 8, 8),
      makeEdge("src/detectors/a.ts", "src/detectors/d.ts", 8, 8, 8),
      makeEdge("src/detectors/b.ts", "src/detectors/c.ts", 8, 8, 8),
      makeEdge("src/detectors/b.ts", "src/detectors/d.ts", 8, 8, 8),
      makeEdge("src/detectors/c.ts", "src/detectors/d.ts", 8, 8, 8),
      // Individual pairs
      makeEdge("src/types.ts", "src/formatter.ts", 10, 15, 12),
      makeEdge("src/types.ts", "src/parser.ts", 8, 15, 10),
    ];

    const rules = generateCoChangeRules(edges);

    const clusterRules = rules.filter((r) => r.source.includes("cluster"));
    const individualRules = rules.filter((r) => !r.source.includes("cluster"));

    // Should get 1 cluster rule for detectors (not 4 symmetric rules)
    expect(clusterRules).toHaveLength(1);
    expect(clusterRules[0].trigger).toContain("src/detectors/a.ts");
    expect(clusterRules[0].trigger).toContain("src/detectors/d.ts");

    // Should get 1 individual rule for types.ts
    expect(individualRules).toHaveLength(1);
    expect(individualRules[0].trigger).toContain("src/types.ts");
  });
});
