import { basename } from "node:path";
import type { Convention, ConventionDetector } from "../types.js";
import { sourceParsedFiles, buildConfidence } from "../convention-extractor.js";

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;

export const fileNamingDetector: ConventionDetector = (files, tiers, _warnings) => {
  const conventions: Convention[] = [];
  const sourceFiles = sourceParsedFiles(files, tiers);
  if (sourceFiles.length === 0) return conventions;

  let kebab = 0, camel = 0, pascal = 0;
  const total = sourceFiles.length;

  for (const f of sourceFiles) {
    const name = basename(f.relativePath).replace(/\.[^.]+$/, "");
    if (name === "index") continue; // Skip index files
    if (KEBAB_CASE.test(name)) kebab++;
    else if (PASCAL_CASE.test(name)) pascal++;
    else if (CAMEL_CASE.test(name)) camel++;
  }

  const nonIndex = total - sourceFiles.filter((f) => basename(f.relativePath).startsWith("index.")).length;
  if (nonIndex === 0) return conventions;

  // E-26: Report dominant pattern even below threshold
  const patterns = [
    { name: "kebab-case", count: kebab },
    { name: "PascalCase", count: pascal },
    { name: "camelCase", count: camel },
  ].sort((a, b) => b.count - a.count);

  const dominant = patterns[0];
  const pct = Math.round((dominant.count / nonIndex) * 100);

  if (pct >= 80) {
    conventions.push({
      category: "file-naming",
      name: `${dominant.name} filenames`,
      description: `Source files use ${dominant.name} naming convention`,
      confidence: buildConfidence(dominant.count, nonIndex),
      examples: sourceFiles
        .map((f) => basename(f.relativePath))
        .filter((n) => !n.startsWith("index."))
        .slice(0, 3),
    });
  } else if (pct >= 40) {
    const secondPct = Math.round((patterns[1].count / nonIndex) * 100);
    conventions.push({
      category: "file-naming",
      name: "Mixed file naming",
      description: `Mixed: ${dominant.name} (${pct}%), ${patterns[1].name} (${secondPct}%)`,
      confidence: buildConfidence(dominant.count, nonIndex),
      examples: sourceFiles
        .map((f) => basename(f.relativePath))
        .filter((n) => !n.startsWith("index."))
        .slice(0, 3),
    });
  }

  // Extension split
  const tsx = sourceFiles.filter((f) => f.relativePath.endsWith(".tsx")).length;
  const ts = sourceFiles.filter((f) => f.relativePath.endsWith(".ts")).length;
  if (tsx > 0 && ts > 0) {
    conventions.push({
      category: "file-naming",
      name: ".tsx/.ts extension split",
      description: `.tsx for JSX components, .ts for logic`,
      confidence: buildConfidence(tsx + ts, total),
      examples: [`${tsx} .tsx files`, `${ts} .ts files`],
    });
  }

  return conventions;
};
