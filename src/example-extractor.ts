// src/example-extractor.ts — W5-C1: Extract usage examples from test files
// For each public API export, find test files that import it and extract
// 3-7 line usage snippets from test blocks.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ParsedFile, PublicAPIEntry, UsageExample, Warning } from "./types.js";

/**
 * Extract usage examples from test files for public API exports.
 * For each export, finds test files that import it and extracts short usage snippets.
 */
export function extractExamples(
  publicAPI: PublicAPIEntry[],
  parsedFiles: ParsedFile[],
  packageDir: string,
  maxExamples: number = 10,
  warnings: Warning[] = [],
): UsageExample[] {
  const examples: UsageExample[] = [];

  // Build a map of test files and what they import
  const testFiles = parsedFiles.filter((f) => f.isTestFile);
  if (testFiles.length === 0) return examples;

  // For each public export, find test files that import it
  for (const entry of publicAPI) {
    if (examples.length >= maxExamples) break;
    if (entry.isTypeOnly || entry.kind === "type" || entry.kind === "interface") continue;

    for (const testFile of testFiles) {
      if (examples.length >= maxExamples) break;

      // Check if this test file imports the export
      const imports = testFile.imports.some((imp) =>
        imp.importedNames.includes(entry.name),
      );
      if (!imports) continue;

      // Try to extract a snippet from the test file
      const snippet = extractSnippetFromTestFile(
        entry.name,
        testFile.relativePath,
        packageDir,
        warnings,
      );
      if (snippet) {
        examples.push({
          exportName: entry.name,
          testFile: testFile.relativePath,
          snippet: snippet.code,
          context: snippet.context,
        });
        break; // One example per export is sufficient
      }
    }
  }

  return examples;
}

interface SnippetResult {
  code: string;
  context: string;
}

/**
 * Read a test file and extract a usage snippet for a given export name.
 * Looks for test blocks (it/test) that call the export and extracts 3-7 lines.
 */
function extractSnippetFromTestFile(
  exportName: string,
  testRelPath: string,
  packageDir: string,
  warnings: Warning[],
): SnippetResult | null {
  let content: string;
  try {
    content = readFileSync(resolve(packageDir, testRelPath), "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");

  // Find test blocks that mention the export
  const testBlockRegex = /^\s*(?:it|test)\s*\(\s*["'`](.+?)["'`]/;
  let bestSnippet: SnippetResult | null = null;

  for (let i = 0; i < lines.length; i++) {
    const match = testBlockRegex.exec(lines[i]);
    if (!match) continue;

    const testName = match[1];

    // Look for the export name usage within this test block
    // Scan from the test block start to find the usage and extract context
    const blockLines: string[] = [];
    let braceDepth = 0;
    let foundExport = false;
    let exportLineIdx = -1;

    for (let j = i; j < lines.length && j < i + 50; j++) {
      const line = lines[j];
      braceDepth += countChar(line, "{") - countChar(line, "}");

      if (line.includes(exportName) && !testBlockRegex.test(line)) {
        foundExport = true;
        if (exportLineIdx === -1) exportLineIdx = blockLines.length;
      }

      blockLines.push(line);

      if (braceDepth <= 0 && j > i) break;
    }

    if (!foundExport || exportLineIdx === -1) continue;

    // Extract 3-7 lines centered around the first usage of the export
    const start = Math.max(0, exportLineIdx - 1);
    const end = Math.min(blockLines.length, exportLineIdx + 6);
    const snippetLines = blockLines.slice(start, end);

    // Clean up: strip outer test boilerplate
    const cleaned = snippetLines
      .map((l) => l.replace(/^\s{2,4}/, "")) // reduce indent
      .filter((l) => !l.match(/^\s*(?:it|test|describe)\s*\(/)) // remove test framework calls
      .filter((l) => l.trim().length > 0)
      .slice(0, 7);

    if (cleaned.length >= 2) {
      const snippet = cleaned.join("\n");
      if (!bestSnippet || snippet.length < bestSnippet.code.length) {
        bestSnippet = {
          code: snippet,
          context: `From test: "${testName}"`,
        };
      }
    }
  }

  return bestSnippet;
}

function countChar(s: string, c: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === c) count++;
  }
  return count;
}
