// src/pattern-fingerprinter.ts — W2-2: Pattern Fingerprinting (W5-B3: Simplified)
// For the top N exports (by import count), analyze the function body AST to
// extract concrete patterns: actual parameter names, return value keys, internal calls.
// W5-B3: Removed abstract shapes (error pattern, async pattern, complexity).
// Produces 1-line summaries per export with concrete details.

import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import ts from "typescript";
import type { PatternFingerprint, PublicAPIEntry, Warning } from "./types.js";

/**
 * Fingerprint the top N public API exports by analyzing their function bodies.
 * Returns fingerprints for exports where the source file can be parsed and
 * the function body can be found.
 */
export function fingerprintTopExports(
  publicAPI: PublicAPIEntry[],
  packageDir: string,
  topN: number = 5,
  warnings: Warning[] = [],
): PatternFingerprint[] {
  // Select top N non-type exports by import count
  const candidates = publicAPI
    .filter((e) => !e.isTypeOnly && e.kind !== "type" && e.kind !== "interface" && e.kind !== "enum")
    .sort((a, b) => (b.importCount ?? 0) - (a.importCount ?? 0))
    .slice(0, topN);

  if (candidates.length === 0) return [];

  // Group by source file to parse each file once
  const byFile = new Map<string, PublicAPIEntry[]>();
  for (const entry of candidates) {
    const file = entry.sourceFile;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(entry);
  }

  const fingerprints: PatternFingerprint[] = [];

  for (const [relFile, entries] of byFile) {
    const absPath = resolve(packageDir, relFile);
    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const ext = extname(absPath).toLowerCase();
    const scriptKind =
      ext === ".tsx" ? ts.ScriptKind.TSX :
      ext === ".jsx" ? ts.ScriptKind.JSX :
      ext === ".js" ? ts.ScriptKind.JS :
      ts.ScriptKind.TS;

    const sourceFile = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, scriptKind);

    for (const entry of entries) {
      try {
        const fp = fingerprintExport(sourceFile, entry, relFile);
        if (fp) fingerprints.push(fp);
      } catch (err) {
        warnings.push({
          level: "info",
          module: "pattern-fingerprinter",
          message: `Could not fingerprint ${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return fingerprints;
}

/**
 * Analyze a single exported function/hook/component to produce a PatternFingerprint.
 * W5-B3: Simplified — only extracts params, return shape, internal calls.
 */
function fingerprintExport(
  sourceFile: ts.SourceFile,
  entry: PublicAPIEntry,
  relFile: string,
): PatternFingerprint | null {
  const funcInfo = findExportedFunction(sourceFile, entry.name);
  if (!funcInfo) return null;

  const { params, body, returnType } = funcInfo;

  const parameterShape = analyzeParameterShape(params);
  const returnShape = returnType
    ? returnType.getText()
    : analyzeReturnShape(body);
  const internalCalls = extractInternalCalls(body);

  const summary = composeSummary(entry, parameterShape, returnShape, internalCalls);

  return {
    exportName: entry.name,
    sourceFile: relFile,
    parameterShape,
    returnShape,
    internalCalls,
    // W5-B3: Deprecated fields kept for backward compatibility, set to defaults
    errorPattern: "none",
    asyncPattern: "sync",
    complexity: "simple",
    summary,
  };
}

// ---- Find exported function in AST ----

interface FuncInfo {
  params: ts.NodeArray<ts.ParameterDeclaration>;
  body: ts.Node;
  returnType: ts.TypeNode | undefined;
}

function findExportedFunction(sourceFile: ts.SourceFile, name: string): FuncInfo | null {
  for (const stmt of sourceFile.statements) {
    if (!ts.canHaveModifiers(stmt)) continue;
    const modifiers = ts.getModifiers(stmt);
    const hasExport = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExport) continue;

    // export function foo(...)
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name && stmt.body) {
      return {
        params: stmt.parameters,
        body: stmt.body,
        returnType: stmt.type,
      };
    }

    // export const foo = (...) => ...
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
        if (!decl.initializer) continue;

        let func: ts.ArrowFunction | ts.FunctionExpression | undefined;

        if (ts.isArrowFunction(decl.initializer)) {
          func = decl.initializer;
        } else if (ts.isFunctionExpression(decl.initializer)) {
          func = decl.initializer;
        } else if (ts.isCallExpression(decl.initializer)) {
          // React.memo(() => ...) or similar wrapper
          const arg = decl.initializer.arguments[0];
          if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
            func = arg;
          }
        }

        if (func) {
          return {
            params: func.parameters,
            body: func.body,
            returnType: func.type,
          };
        }
      }
    }
  }
  return null;
}

// ---- Parameter Shape Analysis ----

function analyzeParameterShape(params: ts.NodeArray<ts.ParameterDeclaration>): string {
  if (params.length === 0) return "no params";

  if (params.length === 1) {
    const param = params[0];
    // Destructured object: ({ foo, bar })
    if (ts.isObjectBindingPattern(param.name)) {
      const props = param.name.elements.map((e) => e.name.getText());
      return `{ ${props.join(", ")} }`;
    }
    // Object type annotation
    if (param.type && ts.isTypeLiteralNode(param.type)) {
      const props = param.type.members
        .filter(ts.isPropertySignature)
        .map((m) => m.name?.getText() ?? "?");
      return `{ ${props.join(", ")} }`;
    }
    // Type reference (e.g., Options, Config)
    if (param.type && ts.isTypeReferenceNode(param.type)) {
      return `${param.name.getText()}: ${param.type.getText()}`;
    }
    return `${param.name.getText()}: ${param.type?.getText() ?? "unknown"}`;
  }

  return `(${params.map((p) => p.name.getText()).join(", ")})`;
}

// ---- Return Shape Analysis ----

function analyzeReturnShape(body: ts.Node): string {
  const returnExprs: string[] = [];

  function walk(node: ts.Node): void {
    if (ts.isReturnStatement(node) && node.expression) {
      // Object literal return
      if (ts.isObjectLiteralExpression(node.expression)) {
        const props = node.expression.properties
          .map((p) => {
            if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
              return p.name?.getText() ?? "?";
            }
            if (ts.isSpreadAssignment(p)) return "...spread";
            return "?";
          });
        returnExprs.push(`{ ${props.join(", ")} }`);
        return;
      }
      // JSX return
      if (ts.isJsxElement(node.expression) || ts.isJsxSelfClosingElement(node.expression) || ts.isJsxFragment(node.expression)) {
        returnExprs.push("JSX.Element");
        return;
      }
      // Parenthesized JSX
      if (ts.isParenthesizedExpression(node.expression)) {
        const inner = node.expression.expression;
        if (ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner) || ts.isJsxFragment(inner)) {
          returnExprs.push("JSX.Element");
          return;
        }
      }
      returnExprs.push("value");
    }
    ts.forEachChild(node, walk);
  }
  walk(body);

  if (returnExprs.length === 0) return "void";
  const unique = [...new Set(returnExprs)];
  return unique[0];
}

// ---- Internal Calls ----

function extractInternalCalls(body: ts.Node): string[] {
  const calls = new Set<string>();

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        calls.add(node.expression.text);
      } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
        const name = node.expression.name.text;
        const obj = node.expression.expression;
        if (ts.isIdentifier(obj)) {
          calls.add(`${obj.text}.${name}`);
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(body);

  return [...calls].slice(0, 15);
}

// ---- Summary Composition ----

function composeSummary(
  entry: PublicAPIEntry,
  parameterShape: string,
  returnShape: string,
  internalCalls: string[],
): string {
  const kind = entry.kind === "hook" ? "Custom hook" :
    entry.kind === "component" ? "React component" :
    entry.kind === "function" ? "Function" : "Export";

  const paramPart = parameterShape === "no params" ? "" : ` accepting ${parameterShape}`;
  const callPart = internalCalls.length > 0
    ? `, uses ${internalCalls.slice(0, 4).join(", ")}`
    : "";
  const returnPart = returnShape !== "void" ? `, returns ${returnShape}` : "";

  return `${kind}${paramPart}${callPart}${returnPart}`;
}
