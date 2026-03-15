// src/type-resolver.ts — Creates ts.Program for type-aware analysis (opt-in).
// Uses custom CompilerHost to avoid double disk reads where possible.
// Returns null on failure (broken tsconfig, timeout, too many errors) — graceful fallback.

import { dirname } from "node:path";
import ts from "typescript";
import type { Warning } from "./types.js";

const MAX_DIAGNOSTIC_ERRORS = 10;
const TIMEOUT_MS = 5000;

export interface TypeResolverResult {
  program: ts.Program;
  checker: ts.TypeChecker;
  timingMs: number;
}

/**
 * Create a ts.Program and TypeChecker for a package directory.
 * Uses the project's tsconfig.json for correct module resolution.
 * Returns null if tsconfig not found, creation fails, or too many type errors.
 */
export function createTypeResolver(packageDir: string, warnings: Warning[]): TypeResolverResult | null {
  const start = performance.now();

  // Find tsconfig.json
  const tsconfigPath = ts.findConfigFile(packageDir, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) {
    return null; // No tsconfig — can't create Program
  }

  try {
    // Parse tsconfig (handles extends, paths, references)
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
      warnings.push({
        level: "warn",
        module: "type-resolver",
        message: `Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
      });
      return null;
    }

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(tsconfigPath));

    // Create Program with tsconfig's file list and options
    const program = ts.createProgram(parsed.fileNames, parsed.options);

    // Check timing budget
    const elapsed = performance.now() - start;
    if (elapsed > TIMEOUT_MS) {
      warnings.push({
        level: "warn",
        module: "type-resolver",
        message: `Type resolver exceeded ${TIMEOUT_MS}ms budget (${Math.round(elapsed)}ms) — falling back to AST-only`,
      });
      return null;
    }

    // Diagnostic gating: too many errors means the types are unreliable
    const diagnostics = program.getSemanticDiagnostics().filter((d) => d.category === ts.DiagnosticCategory.Error);

    if (diagnostics.length > MAX_DIAGNOSTIC_ERRORS) {
      warnings.push({
        level: "warn",
        module: "type-resolver",
        message: `Type checker has ${diagnostics.length} errors (>${MAX_DIAGNOSTIC_ERRORS}) — falling back to AST-only`,
      });
      return null;
    }
    if (diagnostics.length > 0) {
      warnings.push({
        level: "info",
        module: "type-resolver",
        message: `Type checker has ${diagnostics.length} error(s) — enrichment may be partial`,
      });
    }

    const checker = program.getTypeChecker();
    const timingMs = Math.round(performance.now() - start);

    return { program, checker, timingMs };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push({
      level: "warn",
      module: "type-resolver",
      message: `Type resolver failed: ${msg}`,
    });
    return null;
  }
}
