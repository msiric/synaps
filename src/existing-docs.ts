// src/existing-docs.ts — Improvement 4: Existing Documentation Awareness
// Part A: Detect existing documentation files
// Part B: Merge mode — preserve human-written sections across regenerations

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExistingDocs, Warning } from "./types.js";

// ─── Part A: Detection ──────────────────────────────────────────────────────

/**
 * Detect existing documentation files in a package directory.
 */
export function detectExistingDocs(
  packageDir: string,
  _warnings: Warning[] = [],
): ExistingDocs {
  const result: ExistingDocs = {
    hasReadme: false,
    hasAgentsMd: false,
    hasClaudeMd: false,
    hasCursorrules: false,
    hasContributing: false,
  };

  // README variants
  for (const name of ["README.md", "readme.md", "Readme.md", "README.MD"]) {
    if (existsSync(join(packageDir, name))) {
      result.hasReadme = true;
      break;
    }
  }

  // AGENTS.md
  for (const name of ["AGENTS.md", "agents.md"]) {
    const path = join(packageDir, name);
    if (existsSync(path)) {
      result.hasAgentsMd = true;
      result.agentsMdPath = path;
      break;
    }
  }

  // CLAUDE.md
  for (const name of ["CLAUDE.md", "claude.md"]) {
    const path = join(packageDir, name);
    if (existsSync(path)) {
      result.hasClaudeMd = true;
      result.claudeMdPath = path;
      break;
    }
  }

  // .cursorrules
  if (existsSync(join(packageDir, ".cursorrules"))) {
    result.hasCursorrules = true;
  }

  // CONTRIBUTING.md
  for (const name of ["CONTRIBUTING.md", "contributing.md"]) {
    if (existsSync(join(packageDir, name))) {
      result.hasContributing = true;
      break;
    }
  }

  return result;
}

// ─── Part A2: README Context Extraction ─────────────────────────────────────

/**
 * Read the first paragraph of README.md for domain context.
 * Returns the first non-empty paragraph (up to 500 chars) after the title.
 * Searches packageDir first, then rootDir if provided.
 */
export function extractReadmeContext(
  packageDir: string,
  rootDir?: string,
): string | undefined {
  const dirs = rootDir ? [packageDir, rootDir] : [packageDir];

  for (const dir of dirs) {
    for (const name of ["README.md", "readme.md", "Readme.md", "README.MD"]) {
      const path = join(dir, name);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, "utf-8");
          const paragraph = extractFirstParagraph(content);
          if (paragraph) return paragraph;
        } catch { continue; }
      }
    }
  }
  return undefined;
}

/**
 * Extract contributing context from CONTRIBUTING.md.
 * Returns up to 1000 chars of meaningful content for micro-LLM synthesis.
 * Searches: CONTRIBUTING.md, contributing.md, .github/CONTRIBUTING.md
 */
export function extractContributingContext(
  packageDir: string,
  rootDir?: string,
): string | undefined {
  const dirs = rootDir ? [packageDir, rootDir] : [packageDir];

  for (const dir of dirs) {
    for (const name of [
      "CONTRIBUTING.md", "contributing.md",
      join(".github", "CONTRIBUTING.md"), join(".github", "contributing.md"),
    ]) {
      const path = join(dir, name);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, "utf-8");
          const context = extractMarkdownContent(content, 1000);
          if (context && context.length >= 50) return context;
        } catch { continue; }
      }
    }
  }
  return undefined;
}

/**
 * Extract meaningful content from markdown, skipping HTML, badges, and headings.
 * Returns up to `maxChars` characters of prose content.
 */
function extractMarkdownContent(markdown: string, maxChars: number): string | undefined {
  const lines = markdown.split("\n");
  let inHtmlBlock = false;
  const contentLines: string[] = [];
  let totalChars = 0;

  for (const line of lines) {
    if (totalChars >= maxChars) break;
    const trimmed = line.trim();

    if (!inHtmlBlock && /^<[a-zA-Z]/.test(trimmed) && !trimmed.includes("</")) {
      inHtmlBlock = true;
      continue;
    }
    if (inHtmlBlock) {
      if (/<\/[a-zA-Z]+>/.test(trimmed)) inHtmlBlock = false;
      continue;
    }

    if (/^<[a-zA-Z/]/.test(trimmed)) continue;
    if (/^\[?!\[/.test(trimmed)) continue;
    if (trimmed === "") { contentLines.push(""); continue; }
    if (trimmed.length < 10) continue;

    // Keep headings (they provide structure for the LLM) and prose
    contentLines.push(trimmed);
    totalChars += trimmed.length;
  }

  const result = contentLines.join("\n").slice(0, maxChars).trim();
  return result || undefined;
}

/**
 * Extract the first meaningful paragraph from markdown content.
 * Skips titles (#), badges ([![), ALL HTML tags/blocks, and empty lines.
 * A "meaningful paragraph" is a line of plain text (not markup) that
 * contains at least 20 characters of actual content.
 */
function extractFirstParagraph(markdown: string): string | undefined {
  const lines = markdown.split("\n");
  let inHtmlBlock = false;
  let inParagraph = false;
  const paragraphLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Track HTML block boundaries (e.g., <div>...</div>, <h1>...</h1>)
    if (!inHtmlBlock && /^<[a-zA-Z]/.test(trimmed) && !trimmed.includes("</")) {
      inHtmlBlock = true;
      continue;
    }
    if (inHtmlBlock) {
      if (/<\/[a-zA-Z]+>/.test(trimmed)) inHtmlBlock = false;
      continue;
    }

    // Skip single-line HTML tags, markdown headings, badges, images
    if (/^<[a-zA-Z/]/.test(trimmed)) continue;
    if (trimmed.startsWith("#")) continue;
    if (/^\[?!\[/.test(trimmed)) continue;
    if (/^\[!\[/.test(trimmed)) continue;
    if (trimmed === "" && !inParagraph) continue;
    if (trimmed === "" && inParagraph) break;

    // Must look like actual prose (not just a URL, badge text, or short label)
    if (!inParagraph && trimmed.length < 20) continue;

    inParagraph = true;
    paragraphLines.push(trimmed);
  }

  const result = paragraphLines.join(" ").slice(0, 500);
  return result || undefined;
}

// ─── Part B: Merge Mode ─────────────────────────────────────────────────────

const AUTODOCS_START = "<!-- autodocs:start -->";
const AUTODOCS_END = "<!-- autodocs:end -->";

/**
 * Wrap engine output in delimiters for first-time generation.
 */
export function wrapWithDelimiters(content: string): string {
  return [
    AUTODOCS_START,
    content,
    AUTODOCS_END,
    "",
    "## Team Knowledge",
    "_Add your context here — this section is preserved across regenerations._",
  ].join("\n");
}

/**
 * Merge new engine output with an existing AGENTS.md file.
 * Preserves human-written content outside the autodocs delimiters.
 *
 * If the existing file has delimiters:
 *   Replace content between <!-- autodocs:start --> and <!-- autodocs:end -->.
 *
 * If the existing file has no delimiters:
 *   Append engine output below existing content with a separator.
 */
export function mergeWithExisting(
  existingContent: string,
  newEngineContent: string,
  _warnings: Warning[] = [],
): string {
  const startIdx = existingContent.indexOf(AUTODOCS_START);
  const endIdx = existingContent.indexOf(AUTODOCS_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Has delimiters — replace the section between them
    const before = existingContent.slice(0, startIdx);
    const after = existingContent.slice(endIdx + AUTODOCS_END.length);

    return before + AUTODOCS_START + "\n" + newEngineContent + "\n" + AUTODOCS_END + after;
  }

  // No delimiters — append with separator
  return [
    existingContent.trimEnd(),
    "",
    "---",
    "",
    AUTODOCS_START,
    newEngineContent,
    AUTODOCS_END,
  ].join("\n");
}

/**
 * Read existing AGENTS.md content, or return undefined if not found.
 */
export function readExistingAgentsMd(packageDir: string): string | undefined {
  for (const name of ["AGENTS.md", "agents.md"]) {
    const path = join(packageDir, name);
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
