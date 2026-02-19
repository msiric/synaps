import type { Convention, ConventionDetector, ParsedFile } from "../types.js";
import { buildConfidence } from "../convention-extractor.js";

export const testPatternDetector: ConventionDetector = (files, _tiers, _warnings) => {
  const conventions: Convention[] = [];
  const testFiles = files.filter((f) => f.isTestFile);
  if (testFiles.length === 0) return conventions;

  // Framework detection
  let jest = 0, vitest = 0, rtl = 0;
  for (const f of testFiles) {
    const imports = f.imports.map((i) => i.moduleSpecifier);
    if (imports.some((m) => m === "vitest")) vitest++;
    if (f.contentSignals.jestMockCount > 0 || imports.some((m) => m.includes("jest"))) jest++;
    if (imports.some((m) => m.includes("@testing-library/react"))) rtl++;
  }

  const framework = vitest > jest ? "Vitest" : jest > 0 ? "Jest" : "Unknown";
  conventions.push({
    category: "testing",
    name: `${framework} test framework`,
    description: `Tests use ${framework}${rtl > 0 ? " + React Testing Library" : ""}`,
    confidence: buildConfidence(testFiles.length, testFiles.length),
    examples: [`${testFiles.length} test files`],
  });

  // Co-location
  const sourceFiles = new Set(
    files.filter((f) => !f.isTestFile && !f.isGeneratedFile).map((f) => f.relativePath),
  );
  let coLocated = 0;
  for (const tf of testFiles) {
    const base = tf.relativePath.replace(/\.(test|spec)\.[^.]+$/, "");
    const sourceExists = [".ts", ".tsx", ".js", ".jsx"].some((ext) =>
      sourceFiles.has(`${base}${ext}`),
    );
    if (sourceExists) coLocated++;
  }

  if (coLocated > 0) {
    const pct = Math.round((coLocated / testFiles.length) * 100);
    if (pct >= 50) {
      conventions.push({
        category: "testing",
        name: "Co-located tests",
        description: `Test files are co-located with source files`,
        confidence: buildConfidence(coLocated, testFiles.length),
        examples: [`${coLocated} of ${testFiles.length} tests co-located (${pct}%)`],
      });
    }
  }

  // jest.mock usage
  const totalMocks = testFiles.reduce((s, f) => s + f.contentSignals.jestMockCount, 0);
  if (totalMocks > 0) {
    conventions.push({
      category: "testing",
      name: "jest.mock() pattern",
      description: `Tests use jest.mock() for mocking dependencies`,
      confidence: buildConfidence(totalMocks, totalMocks),
      examples: [`${totalMocks} jest.mock() calls across test files`],
    });
  }

  return conventions;
};
