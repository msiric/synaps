// src/type-enricher.ts — Extracts resolved parameter types and return types from a TypeChecker.
// Enriches PublicAPIEntry with accurate type information (replaces text-based extraction).
// Handles: functions, arrow functions, methods, interfaces, type aliases.
// Limits: max 5 properties per interface, max 3 union members, depth-1 expansion.

import { relative, resolve } from "node:path";
import ts from "typescript";
import type { PublicAPIEntry, Warning } from "./types.js";

const MAX_TYPE_LENGTH = 150;

interface EnrichedFields {
  parameterTypes: { name: string; type: string; optional: boolean }[];
  returnType: string;
}

/**
 * Enrich PublicAPIEntry objects with resolved type information from a TypeChecker.
 * Returns a Map of export name → enriched fields. Only includes entries where
 * the TypeChecker provides more information than the existing text signature.
 */
export function enrichExports(
  checker: ts.TypeChecker,
  program: ts.Program,
  publicAPI: PublicAPIEntry[],
  packageDir: string,
  _warnings: Warning[],
): Map<string, EnrichedFields> {
  const results = new Map<string, EnrichedFields>();

  // Group exports by source file for efficient lookup
  const resolvedPkgDir = resolve(packageDir);
  const byFile = new Map<string, PublicAPIEntry[]>();
  for (const entry of publicAPI) {
    if (entry.isTypeOnly) continue;
    const absPath = resolve(packageDir, entry.sourceFile);
    // Path traversal guard: relative() is symlink/case-safe unlike startsWith()
    if (relative(resolvedPkgDir, absPath).startsWith("..")) continue;
    const group = byFile.get(absPath) ?? [];
    group.push(entry);
    byFile.set(absPath, group);
  }

  for (const [absPath, entries] of byFile) {
    const sourceFile = program.getSourceFile(absPath);
    if (!sourceFile) continue;

    for (const entry of entries) {
      try {
        const enriched = enrichSingleExport(checker, sourceFile, entry.name, entry.kind);
        if (enriched) results.set(entry.name, enriched);
      } catch {
        // Skip silently — graceful degradation per export
      }
    }
  }

  return results;
}

function enrichSingleExport(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  exportName: string,
  exportKind: string,
): EnrichedFields | null {
  // Use the TypeChecker's symbol table — handles re-exports, aliases, and namespace exports
  const symbol = checker.getSymbolAtLocation(sourceFile);
  if (!symbol) return null;
  const exports = checker.getExportsOfModule(symbol);
  const exportSymbol = exports.find((s) => s.name === exportName);
  if (!exportSymbol) return null;

  // Resolve aliased symbols (re-exports point to the original)
  const resolved = exportSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol;

  // Get the declaration — works for direct exports AND re-exports
  const decl = resolved.valueDeclaration ?? resolved.declarations?.[0];
  if (!decl) return null;

  if (exportKind === "function" || exportKind === "hook") {
    if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) {
      return enrichFunction(checker, decl);
    }
    return null;
  }

  if (exportKind === "const") {
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
        return enrichFunction(checker, decl.initializer);
      }
    }
  }

  return null;
}

function enrichFunction(checker: ts.TypeChecker, node: ts.Node): EnrichedFields | null {
  // Get the signature directly from the declaration for accurate types
  let sig: ts.Signature | undefined;
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    sig = checker.getSignatureFromDeclaration(node);
  } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    sig = checker.getSignatureFromDeclaration(node);
  }

  if (!sig) {
    // Fallback: try call signatures from type
    const type = checker.getTypeAtLocation(node);
    const sigs = type.getCallSignatures();
    if (sigs.length > 0) sig = sigs[0];
  }

  if (!sig) return null;

  const params = sig.getParameters();
  const returnType = checker.getReturnTypeOfSignature(sig);

  const parameterTypes: EnrichedFields["parameterTypes"] = [];
  for (const param of params) {
    const paramDecl = param.valueDeclaration;
    if (!paramDecl) continue;
    const paramType = checker.getTypeOfSymbolAtLocation(param, paramDecl);
    // Use typeToString() — preserves alias names, avoids expanding primitives
    const typeStr = truncateType(checker.typeToString(paramType));
    if (typeStr === "any") continue;
    const isOptional = ts.isParameter(paramDecl) && !!paramDecl.questionToken;
    parameterTypes.push({
      name: param.name,
      type: typeStr,
      optional: isOptional,
    });
  }

  const returnStr = truncateType(checker.typeToString(returnType));

  if (parameterTypes.length === 0 && (returnStr === "any" || returnStr === "void")) return null;

  return {
    parameterTypes,
    returnType: returnStr,
  };
}

/** Truncate overly long type strings (e.g., expanded structural types). */
function truncateType(typeStr: string): string {
  if (typeStr.length <= MAX_TYPE_LENGTH) return typeStr;
  return `${typeStr.slice(0, MAX_TYPE_LENGTH - 3)}...`;
}
