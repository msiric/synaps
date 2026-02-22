// src/benchmark/shuffler.ts — Shuffle AGENTS.md for negative control
// Scrambles import specifiers, export suffixes, and registration paths
// while preserving document structure. Tests whether correct content
// matters or if any structured document helps.

/**
 * Shuffle an AGENTS.md by scrambling specific patterns while preserving structure.
 * Uses a seeded approach for reproducibility.
 */
export function shuffleAgentsMd(agentsMd: string, seed: number = 42): string {
  let result = agentsMd;

  // 1. Scramble import specifiers in code blocks and inline code
  // Replace import paths with shuffled versions
  const importPaths = extractPatterns(result, /from\s+['"]([^'"]+)['"]/g);
  const shuffledPaths = seededShuffle([...importPaths], seed);
  let pathIdx = 0;
  result = result.replace(/from\s+['"]([^'"]+)['"]/g, (_match, path) => {
    const replacement = shuffledPaths[pathIdx % shuffledPaths.length] ?? path;
    pathIdx++;
    return `from '${replacement}'`;
  });

  // 2. Scramble export suffix mentions
  // Find words ending with common suffixes and rotate them
  const suffixes = ["Detector", "Provider", "Service", "Handler", "Controller", "Adapter", "Factory", "Builder"];
  const foundSuffixes = suffixes.filter(s => result.includes(s));
  if (foundSuffixes.length >= 2) {
    const rotated = [...foundSuffixes.slice(1), foundSuffixes[0]];
    for (let i = 0; i < foundSuffixes.length; i++) {
      // Use a placeholder to avoid double-replacement
      result = result.replace(new RegExp(foundSuffixes[i], "g"), `__SUFFIX_${i}__`);
    }
    for (let i = 0; i < foundSuffixes.length; i++) {
      result = result.replace(new RegExp(`__SUFFIX_${i}__`, "g"), rotated[i]);
    }
  }

  // 3. Scramble directory paths in "How to Add" section
  const dirPaths = extractPatterns(result, /`(src\/[a-z-]+\/)`/g);
  const shuffledDirs = seededShuffle([...dirPaths], seed + 1);
  let dirIdx = 0;
  result = result.replace(/`(src\/[a-z-]+\/)`/g, () => {
    const replacement = shuffledDirs[dirIdx % shuffledDirs.length] ?? "src/unknown/";
    dirIdx++;
    return `\`${replacement}\``;
  });

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractPatterns(text: string, regex: RegExp): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  const r = new RegExp(regex.source, regex.flags);
  while ((match = r.exec(text)) !== null) {
    if (match[1]) results.push(match[1]);
  }
  return [...new Set(results)]; // deduplicate
}

/**
 * Deterministic shuffle using a simple seeded PRNG.
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
