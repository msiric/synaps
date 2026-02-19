import { basename } from "node:path";
import type { Convention, ConventionDetector, ParsedFile } from "../types.js";
import { sourceParsedFiles, buildConfidence } from "../convention-extractor.js";

export const hookPatternDetector: ConventionDetector = (files, tiers, _warnings) => {
  const conventions: Convention[] = [];
  const sourceFiles = sourceParsedFiles(files, tiers);

  const hookFiles: ParsedFile[] = [];
  const hookNames: string[] = [];

  for (const f of sourceFiles) {
    const hooks = f.exports.filter((e) => e.kind === "hook");
    if (hooks.length > 0) {
      hookFiles.push(f);
      hookNames.push(...hooks.map((h) => h.name));
    }
  }

  if (hookFiles.length === 0) return conventions;

  // Hook count convention
  conventions.push({
    category: "hooks",
    name: "Custom hooks",
    description: `Package exports ${hookNames.length} custom hooks`,
    confidence: buildConfidence(hookNames.length, hookNames.length),
    examples: hookNames.slice(0, 3),
  });

  // Return type analysis
  let returnObj = 0, returnArr = 0, returnVoid = 0;
  for (const f of hookFiles) {
    for (const exp of f.exports) {
      if (exp.kind !== "hook" || !exp.signature) continue;
      const returnType = exp.signature.split("=>").pop()?.trim() ?? "";
      if (returnType.startsWith("{") || returnType.startsWith("Record")) returnObj++;
      else if (returnType.startsWith("[")) returnArr++;
      else if (returnType === "void") returnVoid++;
      else returnObj++; // named types typically are objects
    }
  }

  if (returnObj > 0 && returnArr === 0 && returnVoid === 0) {
    conventions.push({
      category: "hooks",
      name: "Hooks return objects",
      description: `Hooks return objects with named properties (not arrays)`,
      confidence: buildConfidence(returnObj, returnObj + returnArr + returnVoid),
      examples: hookNames.slice(0, 2).map((n) => `${n} returns { ... }`),
    });
  }

  // Co-located tests
  const allFiles = new Set(files.map((f) => f.relativePath));
  let coLocated = 0;
  for (const hf of hookFiles) {
    const base = hf.relativePath.replace(/\.[^.]+$/, "");
    const testExists =
      allFiles.has(`${base}.test.ts`) ||
      allFiles.has(`${base}.test.tsx`) ||
      allFiles.has(`${base}.spec.ts`);
    if (testExists) coLocated++;
  }

  if (coLocated > 0) {
    conventions.push({
      category: "hooks",
      name: "Co-located hook tests",
      description: `Hook files have co-located test files`,
      confidence: buildConfidence(coLocated, hookFiles.length),
      examples: hookFiles.slice(0, 2).map((f) => `${basename(f.relativePath)} + .test.ts`),
    });
  }

  // Aggregate React hook usage
  let useMemo = 0, useCallback = 0, useEffect = 0, useState = 0;
  for (const f of sourceFiles) {
    useMemo += f.contentSignals.useMemoCount;
    useCallback += f.contentSignals.useCallbackCount;
    useEffect += f.contentSignals.useEffectCount;
    useState += f.contentSignals.useStateCount;
  }

  const hookUsage = [
    { name: "useMemo", count: useMemo },
    { name: "useCallback", count: useCallback },
    { name: "useEffect", count: useEffect },
    { name: "useState", count: useState },
  ].filter((h) => h.count > 0);

  if (hookUsage.length > 0) {
    const total = hookUsage.reduce((s, h) => s + h.count, 0);
    conventions.push({
      category: "hooks",
      name: "React hook usage distribution",
      description: `React hooks used across source files`,
      confidence: buildConfidence(total, total),
      examples: hookUsage.map((h) => `${h.name}: ${h.count}`),
    });
  }

  return conventions;
};
