// src/benchmark/pr-task-gen.ts — Generate task prompts from mined commits
// Derives fair, deliberately vague prompts that test whether AGENTS.md
// helps with file placement and convention adherence.

import ts from "typescript";
import { basename, extname } from "node:path";
import type { MinedTask } from "./pr-miner.js";

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a task prompt from a mined commit.
 * Strips directory/location hints and implementation-specific details
 * to keep the task fair across conditions.
 */
export function generateTaskPrompt(
  task: MinedTask,
  packageName: string,
): string {
  const message = task.commitMessage;
  const file = task.groundTruth;

  // Try to use the commit message if it's descriptive enough
  const cleaned = cleanCommitMessage(message);
  if (cleaned.length >= 30) {
    return buildPrompt(cleaned, packageName);
  }

  // Fall back to deriving from the file's exports
  const derived = deriveFromFile(file.content, file.filename);
  if (derived) {
    return buildPrompt(derived, packageName);
  }

  // Last resort: generic prompt from filename
  const name = basename(file.filename, extname(file.filename));
  const humanName = name.replace(/[-_]/g, " ");
  return buildPrompt(
    `Add a new module for ${humanName} functionality`,
    packageName,
  );
}

// ─── Prompt Construction ────────────────────────────────────────────────────

function buildPrompt(description: string, packageName: string): string {
  // Capitalize first letter
  const desc = description.charAt(0).toUpperCase() + description.slice(1);

  return (
    `${desc.endsWith(".") ? desc : desc + "."}\n\n` +
    `This is for the ${packageName} project. ` +
    `Follow the project's conventions for file naming, imports, exports, and code style. ` +
    `Include the implementation file and any necessary updates to barrel/index files.`
  );
}

// ─── Commit Message Cleaning ────────────────────────────────────────────────

/**
 * Clean a commit message for use as a task prompt.
 * Strips:
 * - Conventional commit prefixes (feat:, fix:, etc.)
 * - Directory/path references (to src/utils, in packages/auth)
 * - Issue/PR references (#123)
 * - Overly specific implementation details
 */
export function cleanCommitMessage(message: string): string {
  let cleaned = message;

  // Strip conventional commit prefixes
  cleaned = cleaned.replace(/^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\(.+?\))?:\s*/i, "");

  // Strip issue/PR references
  cleaned = cleaned.replace(/\s*\(#\d+\)\s*$/, "");
  cleaned = cleaned.replace(/#\d+/g, "");

  // Strip directory/path hints (e.g., "to src/utils", "in packages/auth")
  cleaned = cleaned.replace(/\s+(to|in|at|from|under)\s+[a-z]+\/[a-zA-Z0-9_\-\/]+/g, "");

  // Strip filename references (e.g., "add auth-service.ts")
  cleaned = cleaned.replace(/\s+[a-z][a-z0-9\-_]*\.(ts|tsx|js|jsx)\b/gi, "");

  // Strip leading/trailing whitespace and common noise words
  cleaned = cleaned.replace(/^\s*(add|create|implement|introduce)\s+/i, "Add ");

  return cleaned.trim();
}

// ─── File Analysis ──────────────────────────────────────────────────────────

/**
 * Derive a task description from the file's exports and structure.
 */
function deriveFromFile(content: string, filename: string): string | null {
  const sourceFile = ts.createSourceFile(
    filename,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  const exports = extractExports(sourceFile);
  if (exports.length === 0) return null;

  const primary = exports[0];
  const kind = primary.kind;
  const name = primary.name;

  if (!name) return null;

  const humanName = camelToSpaces(name);

  switch (kind) {
    case "function":
      return `Add a new utility function for ${humanName}`;
    case "class":
      return `Add a new ${humanName} class`;
    case "interface":
    case "type":
      return `Add type definitions for ${humanName}`;
    case "const":
    case "variable":
      return `Add a ${humanName} module`;
    default:
      return `Add a new module for ${humanName}`;
  }
}

interface ExportInfo {
  name: string;
  kind: string;
}

function extractExports(sourceFile: ts.SourceFile): ExportInfo[] {
  const exports: ExportInfo[] = [];

  ts.forEachChild(sourceFile, (node) => {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) return;

    if (ts.isFunctionDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: "function" });
    } else if (ts.isClassDeclaration(node) && node.name) {
      exports.push({ name: node.name.text, kind: "class" });
    } else if (ts.isInterfaceDeclaration(node)) {
      exports.push({ name: node.name.text, kind: "interface" });
    } else if (ts.isTypeAliasDeclaration(node)) {
      exports.push({ name: node.name.text, kind: "type" });
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          exports.push({ name: decl.name.text, kind: "const" });
        }
      }
    }
  });

  return exports;
}

function camelToSpaces(name: string): string {
  // CamelCase → "camel case", kebab-case → "kebab case"
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
}
