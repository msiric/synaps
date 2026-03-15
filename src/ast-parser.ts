// src/ast-parser.ts — Module 2: AST Parser
// Errata applied: E-17 (hybrid AST/regex), E-18 (CJS), E-19 (syntax errors),
//                 E-20 (.js→.ts mapping), E-21 (path traversal boundary)

import { readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import ts from "typescript";
import type {
  CallReference,
  ContentSignals,
  ExportEntry,
  ImportEntry,
  ParsedFile,
  SymbolKind,
  Warning,
} from "./types.js";
import { FileNotFoundError } from "./types.js";

/**
 * Parse a single file into a structured representation of its exports, imports, and signals.
 */
export function parseFile(filePath: string, packageDir: string, warnings: Warning[] = []): ParsedFile {
  const relPath = relative(packageDir, filePath);
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileNotFoundError(filePath, err);
    }
    throw err;
  }

  const lineCount = content.split("\n").length;
  if (lineCount > 10_000) {
    warnings.push({
      level: "info",
      module: "ast-parser",
      message: `File ${relPath} is ${lineCount} lines — analysis may be imprecise for very large files.`,
      file: filePath,
    });
  }

  const ext = extname(filePath).toLowerCase();
  const scriptKind =
    ext === ".tsx"
      ? ts.ScriptKind.TSX
      : ext === ".jsx"
        ? ts.ScriptKind.JSX
        : ext === ".js"
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);

  // E-19: Syntax error detection
  let hasSyntaxErrors = false;
  const diagnostics = (sourceFile as any).parseDiagnostics;
  if (diagnostics?.length > 0) {
    const errors = diagnostics.filter((d: any) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
      hasSyntaxErrors = true;
      warnings.push({
        level: "warn",
        module: "ast-parser",
        message: `File ${relPath} has ${errors.length} syntax error(s) — analysis may be incomplete.`,
        file: filePath,
      });
    }
  }

  const isTestFile = /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(relPath) || relPath.includes("__tests__/");
  const isGeneratedFile = detectGeneratedFile(relPath, content);
  const hasJSX = ext === ".tsx" || ext === ".jsx";

  // Extract imports first — needed for React check in export classification
  const imports = extractImports(sourceFile);

  // Fix B: Determine if this file imports from React (for hook classification)
  const hasReactImport = imports.some(
    (imp) =>
      imp.moduleSpecifier === "react" ||
      imp.moduleSpecifier === "react-dom" ||
      imp.moduleSpecifier === "preact" ||
      imp.moduleSpecifier === "preact/hooks" ||
      imp.moduleSpecifier === "preact/compat",
  );

  // Extract exports and content signals via AST walk
  const exports = extractExports(sourceFile, hasReactImport);
  const contentSignals = computeContentSignals(content, sourceFile);

  // E-18: CJS detection
  const hasCJS = detectCJS(sourceFile, content);

  // E-18: If CJS patterns detected, map to export/import entries
  if (hasCJS) {
    mergeCJSPatterns(sourceFile, exports, imports, content);
  }

  // Improvement 3: Extract call references (which imported symbols are called from exported functions)
  const callReferences = extractCallReferences(sourceFile, exports, imports);

  return {
    relativePath: relPath,
    exports,
    imports,
    contentSignals,
    lineCount,
    isTestFile,
    isGeneratedFile,
    hasJSX,
    hasCJS,
    hasSyntaxErrors,
    callReferences,
  };
}

function detectGeneratedFile(relPath: string, content: string): boolean {
  if (relPath.includes(".graphql.interface.")) return true;

  const first500 = content.slice(0, 500);
  if (first500.includes("@ts-nocheck") && first500.includes("eslint-disable")) {
    return true;
  }

  const firstLines = content.split("\n", 10).join("\n").toLowerCase();
  if (
    firstLines.includes("automatically generated") ||
    firstLines.includes("auto-generated") ||
    firstLines.includes("do not edit")
  ) {
    return true;
  }

  return false;
}

// ─── Export Extraction ───────────────────────────────────────────────────────

function extractExports(sourceFile: ts.SourceFile, hasReactImport: boolean = false): ExportEntry[] {
  const exports: ExportEntry[] = [];

  for (const stmt of sourceFile.statements) {
    // export { X } from "./other" or export { X }
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const spec of stmt.exportClause.elements) {
          const exportedName = spec.name.text;
          const localName = spec.propertyName?.text; // E-10: aliased exports
          exports.push({
            name: exportedName,
            localName: localName !== exportedName ? localName : undefined,
            kind: "unknown",
            isReExport: !!stmt.moduleSpecifier,
            isTypeOnly: stmt.isTypeOnly || spec.isTypeOnly,
            reExportSource: stmt.moduleSpecifier ? (stmt.moduleSpecifier as ts.StringLiteral).text : undefined,
          });
        }
      } else if (!stmt.exportClause && stmt.moduleSpecifier) {
        // export * from "./mod"
        exports.push({
          name: "*",
          kind: "unknown",
          isReExport: true,
          isTypeOnly: stmt.isTypeOnly,
          reExportSource: (stmt.moduleSpecifier as ts.StringLiteral).text,
        });
      } else if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
        // export * as ns from "./mod"
        exports.push({
          name: stmt.exportClause.name.text,
          kind: "namespace",
          isReExport: true,
          isTypeOnly: stmt.isTypeOnly,
          reExportSource: stmt.moduleSpecifier ? (stmt.moduleSpecifier as ts.StringLiteral).text : undefined,
        });
      }
      continue;
    }

    // export default ...
    if (ts.isExportAssignment(stmt)) {
      exports.push({
        name: "default",
        kind: "unknown",
        isReExport: false,
        isTypeOnly: false,
      });
      continue;
    }

    // Statements with export modifier
    if (!ts.canHaveModifiers(stmt)) continue;
    const modifiers = ts.getModifiers(stmt);
    const hasExport = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const hasDefault = modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (!hasExport) continue;

    if (ts.isFunctionDeclaration(stmt)) {
      const name = hasDefault ? "default" : (stmt.name?.text ?? "default");
      exports.push({
        name,
        kind: classifyFunctionKind(name, hasReactImport),
        isReExport: false,
        isTypeOnly: false,
        signature: extractFunctionSignature(stmt),
        jsDocComment: extractJSDoc(stmt),
      });
    } else if (ts.isClassDeclaration(stmt)) {
      const name = hasDefault ? "default" : (stmt.name?.text ?? "default");
      exports.push({
        name,
        kind: "class",
        isReExport: false,
        isTypeOnly: false,
        jsDocComment: extractJSDoc(stmt),
      });
    } else if (ts.isInterfaceDeclaration(stmt)) {
      exports.push({
        name: stmt.name.text,
        kind: "interface",
        isReExport: false,
        isTypeOnly: true,
        jsDocComment: extractJSDoc(stmt),
      });
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      exports.push({
        name: stmt.name.text,
        kind: "type",
        isReExport: false,
        isTypeOnly: true,
        jsDocComment: extractJSDoc(stmt),
      });
    } else if (ts.isEnumDeclaration(stmt)) {
      exports.push({
        name: stmt.name.text,
        kind: "enum",
        isReExport: false,
        isTypeOnly: false,
        jsDocComment: extractJSDoc(stmt),
      });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const kind = classifyVariableKind(name, decl, hasReactImport);
        const sig =
          kind === "function" || kind === "hook" || kind === "component" ? extractArrowSignature(decl) : undefined;
        exports.push({
          name,
          kind,
          isReExport: false,
          isTypeOnly: false,
          signature: sig,
          jsDocComment: extractJSDoc(stmt),
        });
      }
    }
  }

  return exports;
}

function classifyFunctionKind(name: string, hasReactImport: boolean = false): SymbolKind {
  // Fix B: Only classify as "hook" if the file imports from React/Preact
  if (name.startsWith("use") && name.length > 3 && name[3] === name[3].toUpperCase()) {
    return hasReactImport ? "hook" : "function";
  }
  if (name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
    return "component";
  }
  return "function";
}

function classifyVariableKind(name: string, decl: ts.VariableDeclaration, hasReactImport: boolean = false): SymbolKind {
  if (!decl.initializer) return "const";

  // Check for React.memo, memo, forwardRef
  if (ts.isCallExpression(decl.initializer)) {
    const callText = decl.initializer.expression.getText();
    if (
      callText === "React.memo" ||
      callText === "memo" ||
      callText === "React.forwardRef" ||
      callText === "forwardRef"
    ) {
      return "component";
    }
  }

  // Arrow function or function expression
  if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
    return classifyFunctionKind(name, hasReactImport);
  }

  return "const";
}

function extractFunctionSignature(decl: ts.FunctionDeclaration | ts.MethodDeclaration): string {
  const params = decl.parameters
    .map((p) => {
      const name = p.name.getText();
      const type = p.type ? p.type.getText() : "unknown";
      const optional = p.questionToken ? "?" : "";
      return `${name}${optional}: ${type}`;
    })
    .join(", ");
  const returnType = decl.type ? decl.type.getText() : "unknown";
  return `(${params}) => ${returnType}`;
}

function extractArrowSignature(decl: ts.VariableDeclaration): string | undefined {
  if (!decl.initializer) return undefined;

  let func: ts.ArrowFunction | ts.FunctionExpression | undefined;

  if (ts.isArrowFunction(decl.initializer)) {
    func = decl.initializer;
  } else if (ts.isFunctionExpression(decl.initializer)) {
    func = decl.initializer;
  } else if (ts.isCallExpression(decl.initializer)) {
    // e.g., React.memo(() => { ... })
    const arg = decl.initializer.arguments[0];
    if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
      func = arg;
    }
  }

  if (!func) return undefined;

  const params = func.parameters
    .map((p) => {
      const name = p.name.getText();
      const type = p.type ? p.type.getText() : "unknown";
      const optional = p.questionToken ? "?" : "";
      return `${name}${optional}: ${type}`;
    })
    .join(", ");
  const returnType = func.type ? func.type.getText() : "unknown";
  return `(${params}) => ${returnType}`;
}

function extractJSDoc(node: ts.Node): string | undefined {
  const jsDocNodes = (node as any).jsDoc;
  if (!jsDocNodes || jsDocNodes.length === 0) return undefined;
  const comment = jsDocNodes[0].comment;
  if (typeof comment === "string") return comment;
  // NodeArray of JSDocComment parts
  if (Array.isArray(comment)) {
    return comment.map((c: any) => c.text ?? "").join("");
  }
  return undefined;
}

// ─── Import Extraction ───────────────────────────────────────────────────────

function extractImports(sourceFile: ts.SourceFile): ImportEntry[] {
  const imports: ImportEntry[] = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const moduleSpecifier = stmt.moduleSpecifier.text;
    const importedNames: string[] = [];
    let isTypeOnly = stmt.importClause?.isTypeOnly ?? false;

    if (stmt.importClause) {
      // Default import
      if (stmt.importClause.name) {
        importedNames.push(stmt.importClause.name.text);
      }
      // Named imports
      if (stmt.importClause.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
        for (const spec of stmt.importClause.namedBindings.elements) {
          importedNames.push(spec.name.text);
          if (spec.isTypeOnly) isTypeOnly = true;
        }
      }
      // Namespace import
      if (stmt.importClause.namedBindings && ts.isNamespaceImport(stmt.importClause.namedBindings)) {
        importedNames.push(`* as ${stmt.importClause.namedBindings.name.text}`);
      }
    }

    imports.push({ moduleSpecifier, importedNames, isTypeOnly, isDynamic: false });
  }

  // Walk AST for dynamic imports
  walkForDynamicImports(sourceFile, imports);

  return imports;
}

function walkForDynamicImports(node: ts.Node, imports: ImportEntry[]): void {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length > 0 &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    imports.push({
      moduleSpecifier: node.arguments[0].text,
      importedNames: [],
      isTypeOnly: false,
      isDynamic: true,
    });
  }
  ts.forEachChild(node, (child) => walkForDynamicImports(child, imports));
}

// ─── Content Signals (E-17: Hybrid AST/regex) ───────────────────────────────

function computeContentSignals(content: string, sourceFile: ts.SourceFile): ContentSignals {
  // AST-based signals (E-17)
  let tryCatchCount = 0;
  let promiseAllCount = 0;
  let asyncFunctionCount = 0;
  let awaitInLoopCount = 0;
  const hookCounts: Record<string, number> = {
    useMemo: 0,
    useCallback: 0,
    useEffect: 0,
    useState: 0,
    useQuery: 0,
    useMutation: 0,
  };

  function walkForSignals(node: ts.Node, insideLoop = false): void {
    if (ts.isTryStatement(node)) {
      tryCatchCount++;
    }

    // Phase 1B: Async pattern signals
    if (
      (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      asyncFunctionCount++;
    }
    if (ts.isAwaitExpression(node) && insideLoop) {
      awaitInLoopCount++;
    }

    // Track if we're inside a loop for await-in-loop detection
    const isLoop =
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node);

    if (ts.isCallExpression(node)) {
      let calleeName: string | undefined;
      if (ts.isIdentifier(node.expression)) {
        calleeName = node.expression.text;
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        // Detect Promise.all/allSettled/race
        const obj = node.expression.expression;
        const method = node.expression.name.text;
        if (
          ts.isIdentifier(obj) &&
          obj.text === "Promise" &&
          (method === "all" || method === "allSettled" || method === "race")
        ) {
          promiseAllCount++;
        }
        calleeName = method;
      }
      if (calleeName && calleeName in hookCounts) {
        hookCounts[calleeName]++;
      }
    }
    ts.forEachChild(node, (child) => walkForSignals(child, insideLoop || isLoop));
  }
  walkForSignals(sourceFile);

  // Regex-based signals (E-17: keep — no clean AST equivalent)
  const jestMockCount = countMatches(content, /jest\.mock\s*\(/g);
  const hasDisplayName = /\.displayName\s*=/.test(content);
  const hasErrorBoundary = /ErrorBoundary/.test(content);

  return {
    tryCatchCount,
    useMemoCount: hookCounts.useMemo,
    useCallbackCount: hookCounts.useCallback,
    useEffectCount: hookCounts.useEffect,
    useStateCount: hookCounts.useState,
    useQueryCount: hookCounts.useQuery,
    useMutationCount: hookCounts.useMutation,
    promiseAllCount,
    asyncFunctionCount,
    awaitInLoopCount,
    jestMockCount,
    hasDisplayName,
    hasErrorBoundary,
  };
}

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) || []).length;
}

// ─── CJS Detection (E-18) ───────────────────────────────────────────────────

function detectCJS(sourceFile: ts.SourceFile, content: string): boolean {
  // Quick regex check first for performance
  if (!content.includes("module.exports") && !content.includes("exports.") && !content.includes("require(")) {
    return false;
  }

  let found = false;
  function walk(node: ts.Node): void {
    if (found) return;

    // module.exports = ... or exports.X = ...
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
      const left = node.expression.left;
      if (ts.isPropertyAccessExpression(left)) {
        if (ts.isIdentifier(left.expression) && left.expression.text === "module" && left.name.text === "exports") {
          found = true;
          return;
        }
        if (ts.isIdentifier(left.expression) && left.expression.text === "exports") {
          found = true;
          return;
        }
      }
    }

    // require(...)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      found = true;
      return;
    }

    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  return found;
}

/**
 * E-18: Merge CJS patterns into ESM-style export/import entries.
 * If file has BOTH ESM and CJS, prefer ESM (it's canonical).
 *
 * Handles three CJS export patterns:
 *   module.exports = { fn1, fn2 }  → named exports "fn1", "fn2"
 *   module.exports = identifier    → named export using identifier name
 *   exports.propName = value       → named export "propName"
 *
 * Handles CJS import destructuring:
 *   const { x, y } = require('./mod') → importedNames: ["x", "y"]
 *   const mod = require('./mod')       → importedNames: ["mod"] (whole-module)
 */
function mergeCJSPatterns(
  sourceFile: ts.SourceFile,
  exports: ExportEntry[],
  imports: ImportEntry[],
  _content: string,
): void {
  // If file already has ESM exports, skip CJS export mapping
  const hasESMExports = exports.length > 0;

  if (!hasESMExports) {
    function walkExports(node: ts.Node): void {
      if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
        const left = node.expression.left;
        const right = node.expression.right;

        if (ts.isPropertyAccessExpression(left)) {
          // module.exports = ...
          if (ts.isIdentifier(left.expression) && left.expression.text === "module" && left.name.text === "exports") {
            if (ts.isObjectLiteralExpression(right)) {
              // module.exports = { fn1, fn2, fn3 } → extract each property as named export
              for (const prop of right.properties) {
                if (ts.isShorthandPropertyAssignment(prop)) {
                  exports.push({ name: prop.name.text, kind: "function", isReExport: false, isTypeOnly: false });
                } else if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                  exports.push({ name: prop.name.text, kind: "function", isReExport: false, isTypeOnly: false });
                }
              }
            } else if (ts.isIdentifier(right)) {
              // module.exports = fastify → export the identifier name, not "default"
              exports.push({ name: right.text, kind: "function", isReExport: false, isTypeOnly: false });
            } else {
              // module.exports = someExpression → fallback to "default"
              exports.push({ name: "default", kind: "unknown", isReExport: false, isTypeOnly: false });
            }
          }
          // exports.propName = value
          else if (ts.isIdentifier(left.expression) && left.expression.text === "exports") {
            exports.push({ name: left.name.text, kind: "function", isReExport: false, isTypeOnly: false });
          }
        }
      }
      ts.forEachChild(node, walkExports);
    }
    walkExports(sourceFile);
  }

  // Map require() to import entries with destructured names
  function walkRequires(node: ts.Node): void {
    // Look for: const { x, y } = require('./mod') OR const mod = require('./mod')
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue;
        const call = decl.initializer;
        if (!ts.isIdentifier(call.expression) || call.expression.text !== "require") continue;
        if (call.arguments.length === 0 || !ts.isStringLiteral(call.arguments[0])) continue;

        const spec = call.arguments[0].text;
        const already = imports.some((i) => i.moduleSpecifier === spec && !i.isDynamic);
        if (already) continue;

        const importedNames: string[] = [];
        if (ts.isObjectBindingPattern(decl.name)) {
          // const { x, y } = require('./mod')
          for (const element of decl.name.elements) {
            if (ts.isIdentifier(element.name)) importedNames.push(element.name.text);
          }
        } else if (ts.isIdentifier(decl.name)) {
          // const mod = require('./mod') — whole module import
          importedNames.push(decl.name.text);
        }

        imports.push({ moduleSpecifier: spec, importedNames, isTypeOnly: false, isDynamic: false });
        return; // Don't recurse into this node
      }
    }

    // Fallback: bare require() calls not in variable declarations
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const spec = node.arguments[0].text;
      const already = imports.some((i) => i.moduleSpecifier === spec && !i.isDynamic);
      if (!already) {
        imports.push({ moduleSpecifier: spec, importedNames: [], isTypeOnly: false, isDynamic: false });
      }
    }

    ts.forEachChild(node, walkRequires);
  }
  walkRequires(sourceFile);
}

// ─── Call Reference Extraction (Improvement 3) ──────────────────────────────

/**
 * Extract call references: which imported symbols are called within exported function bodies.
 * Only tracks direct calls (identifier matches imported name).
 */
function extractCallReferences(
  sourceFile: ts.SourceFile,
  exports: ExportEntry[],
  imports: ImportEntry[],
): CallReference[] {
  // Build a map of imported names → module specifier
  const importedNameToModule = new Map<string, string>();
  for (const imp of imports) {
    for (const name of imp.importedNames) {
      // Skip namespace imports like "* as foo"
      if (name.startsWith("*")) continue;
      importedNameToModule.set(name, imp.moduleSpecifier);
    }
  }

  if (importedNameToModule.size === 0) return [];

  // Build a set of exported function names
  const exportedNames = new Set(
    exports.filter((e) => !e.isTypeOnly && e.name !== "*" && e.name !== "default").map((e) => e.name),
  );

  if (exportedNames.size === 0) return [];

  const callRefs: CallReference[] = [];

  // Walk top-level statements looking for exported function/variable declarations.
  // Handles BOTH ESM exports (export keyword) and CJS exports (name in exportedNames from module.exports).
  const scanned = new Set<string>();

  for (const stmt of sourceFile.statements) {
    // ESM: function/variable with export keyword
    if (ts.canHaveModifiers(stmt)) {
      const modifiers = ts.getModifiers(stmt);
      const hasExport = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (hasExport) {
        scanStatement(stmt, exportedNames, importedNameToModule, callRefs, scanned);
        continue;
      }
    }

    // CJS: function/variable whose name appears in exportedNames (from module.exports)
    // These don't have export keyword but are exported via module.exports = { fn }
    scanStatement(stmt, exportedNames, importedNameToModule, callRefs, scanned);
  }

  return callRefs;
}

/** Scan a top-level statement for exported function bodies and extract call references. */
function scanStatement(
  stmt: ts.Statement,
  exportedNames: Set<string>,
  importedNameToModule: Map<string, string>,
  callRefs: CallReference[],
  scanned: Set<string>,
): void {
  if (ts.isFunctionDeclaration(stmt) && stmt.name && exportedNames.has(stmt.name.text)) {
    if (scanned.has(stmt.name.text)) return;
    scanned.add(stmt.name.text);
    if (stmt.body) findCallsInBody(stmt.body, stmt.name.text, importedNameToModule, callRefs);
  } else if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !exportedNames.has(decl.name.text)) continue;
      if (scanned.has(decl.name.text)) continue;
      scanned.add(decl.name.text);
      if (!decl.initializer) continue;

      let funcBody: ts.Node | undefined;
      if (ts.isArrowFunction(decl.initializer)) funcBody = decl.initializer.body;
      else if (ts.isFunctionExpression(decl.initializer)) funcBody = decl.initializer.body;
      else if (ts.isCallExpression(decl.initializer)) {
        const arg = decl.initializer.arguments[0];
        if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) funcBody = arg.body;
      }
      if (funcBody) findCallsInBody(funcBody, decl.name.text, importedNameToModule, callRefs);
    }
  }
}

/**
 * Walk a function body to find call expressions that match imported symbols.
 */
function findCallsInBody(
  body: ts.Node,
  callerName: string,
  importedNameToModule: Map<string, string>,
  callRefs: CallReference[],
): void {
  const seen = new Set<string>(); // avoid duplicates per caller

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      let calleeName: string | undefined;

      if (ts.isIdentifier(node.expression)) {
        calleeName = node.expression.text;
      }
      // Don't follow property access (foo.bar()) — only direct calls

      if (calleeName && importedNameToModule.has(calleeName)) {
        const key = `${callerName}->${calleeName}`;
        if (!seen.has(key)) {
          seen.add(key);
          const moduleSpec = importedNameToModule.get(calleeName)!;
          callRefs.push({
            callerName,
            calleeName,
            calleeModule: moduleSpec,
            isInternal: moduleSpec.startsWith("."),
          });
        }
      }
    }

    ts.forEachChild(node, walk);
  }

  walk(body);
}
