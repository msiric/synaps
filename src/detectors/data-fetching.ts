// src/detectors/data-fetching.ts — W2-3: Data Fetching Pattern Detector
// CRITICAL: Checks WHERE useQuery/useMutation is imported from to prevent
// the GraphQL hallucination. If useQuery comes from @tanstack/react-query,
// the project does NOT use GraphQL for data fetching.

import type { Convention, ConventionConfidence, ConventionDetector, DetectorContext } from "../types.js";

export const dataFetchingDetector: ConventionDetector = (files, _tiers, _warnings, _context) => {
  const conventions: Convention[] = [];

  // Collect all import sources for query/mutation hooks across all files
  const queryImports = new Map<string, number>(); // module → count
  const mutationImports = new Map<string, number>();

  for (const f of files) {
    for (const imp of f.imports) {
      if (imp.isTypeOnly) continue;
      for (const name of imp.importedNames) {
        if (name === "useQuery" || name === "useSuspenseQuery" || name === "useInfiniteQuery") {
          queryImports.set(imp.moduleSpecifier, (queryImports.get(imp.moduleSpecifier) ?? 0) + 1);
        }
        if (name === "useMutation" || name === "useSuspenseMutation") {
          mutationImports.set(imp.moduleSpecifier, (mutationImports.get(imp.moduleSpecifier) ?? 0) + 1);
        }
      }
    }
  }

  if (queryImports.size === 0 && mutationImports.size === 0) return conventions;

  // Merge all sources for analysis
  const allSources = new Map<string, number>();
  for (const [source, count] of queryImports) {
    allSources.set(source, (allSources.get(source) ?? 0) + count);
  }
  for (const [source, count] of mutationImports) {
    allSources.set(source, (allSources.get(source) ?? 0) + count);
  }

  // Classify by import source
  const totalUsages = [...allSources.values()].reduce((a, b) => a + b, 0);

  // Check known libraries (order matters — more specific first)
  if (allSources.has("@apollo/client") || allSources.has("@apollo/react-hooks")) {
    const count = (allSources.get("@apollo/client") ?? 0) + (allSources.get("@apollo/react-hooks") ?? 0);
    conventions.push({
      category: "ecosystem",
      name: "Apollo Client (GraphQL)",
      description: `Uses Apollo Client for GraphQL data fetching (useQuery/useMutation from @apollo/client)`,
      confidence: conf(count, totalUsages),
      examples: [`${count} Apollo hook imports`],
    });
  }

  if (allSources.has("@tanstack/react-query") || allSources.has("react-query")) {
    const count = (allSources.get("@tanstack/react-query") ?? 0) + (allSources.get("react-query") ?? 0);
    conventions.push({
      category: "ecosystem",
      name: "TanStack Query data fetching",
      description: `Uses TanStack Query (NOT GraphQL) for data fetching. useQuery/useMutation are from @tanstack/react-query.`,
      confidence: conf(count, totalUsages),
      examples: [`${count} TanStack Query hook imports`],
    });
  }

  if (allSources.has("@trpc/react-query") || allSources.has("@trpc/client")) {
    const count = (allSources.get("@trpc/react-query") ?? 0) + (allSources.get("@trpc/client") ?? 0);
    conventions.push({
      category: "ecosystem",
      name: "tRPC data fetching",
      description: `Uses tRPC + TanStack Query for type-safe data fetching (NOT GraphQL)`,
      confidence: conf(count, totalUsages),
      examples: [`${count} tRPC hook imports`],
    });
  }

  if (allSources.has("swr")) {
    const count = allSources.get("swr") ?? 0;
    conventions.push({
      category: "ecosystem",
      name: "SWR data fetching",
      description: `Uses SWR for data fetching`,
      confidence: conf(count, totalUsages),
      examples: [`${count} SWR imports`],
    });
  }

  if (allSources.has("urql") || allSources.has("@urql/core")) {
    const count = (allSources.get("urql") ?? 0) + (allSources.get("@urql/core") ?? 0);
    conventions.push({
      category: "ecosystem",
      name: "URQL (GraphQL)",
      description: `Uses URQL for GraphQL data fetching`,
      confidence: conf(count, totalUsages),
      examples: [`${count} URQL imports`],
    });
  }

  // Check for oRPC
  for (const source of allSources.keys()) {
    if (source.includes("orpc") || source.includes("@orpc")) {
      const count = allSources.get(source) ?? 0;
      conventions.push({
        category: "ecosystem",
        name: "oRPC data fetching",
        description: `Uses oRPC for type-safe RPC data fetching (NOT GraphQL)`,
        confidence: conf(count, totalUsages),
        examples: [`${count} oRPC hook imports from ${source}`],
      });
    }
  }

  // If none of the known libraries matched, check for unknown sources
  const knownSources = new Set([
    "@apollo/client", "@apollo/react-hooks",
    "@tanstack/react-query", "react-query",
    "@trpc/react-query", "@trpc/client",
    "swr", "urql", "@urql/core",
  ]);
  const unknownSources = [...allSources.keys()].filter((s) =>
    !knownSources.has(s) && !s.includes("orpc") && !s.includes("@orpc"),
  );

  if (unknownSources.length > 0 && conventions.length === 0) {
    conventions.push({
      category: "ecosystem",
      name: "Custom data fetching hooks",
      description: `Uses useQuery/useMutation hooks from custom or unknown source(s): ${unknownSources.join(", ")}. Do NOT assume GraphQL.`,
      confidence: conf(totalUsages, totalUsages),
      examples: unknownSources.map((s) => `imported from ${s}`),
    });
  }

  return conventions;
};

function conf(matched: number, total: number): ConventionConfidence {
  const percentage = total > 0 ? Math.round((matched / total) * 100) : 0;
  return { matched, total, percentage, description: `${matched} of ${total} (${percentage}%)` };
}
