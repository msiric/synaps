// src/convention-extractor.ts — Module 5: Convention Extractor (orchestrator)
// Errata applied: E-26 (report dominant pattern below threshold),
//                 E-27 (structured confidence), E-28 (filter by tier)
// W2-3: Added ecosystem-specific detectors with DetectorContext support.
// W5-A: Removed 6 noisy detectors (import/export/component/error-handling/graphql/telemetry patterns).

import type {
  ParsedFile,
  TierInfo,
  Convention,
  ConventionDetector,
  DetectorContext,
  Warning,
} from "./types.js";
import type { DetectorPlugin } from "./plugin-loader.js";

import { fileNamingDetector } from "./detectors/file-naming.js";
import { hookPatternDetector } from "./detectors/hook-patterns.js";
import { testPatternDetector } from "./detectors/test-patterns.js";
// W2-3: Ecosystem-specific detectors
import { testFrameworkEcosystemDetector } from "./detectors/test-framework-ecosystem.js";
import { dataFetchingDetector } from "./detectors/data-fetching.js";
import { databaseDetector } from "./detectors/database.js";
import { webFrameworkDetector } from "./detectors/web-framework.js";
import { buildToolDetector } from "./detectors/build-tool.js";

const DETECTOR_REGISTRY: Record<string, ConventionDetector> = {
  // Core
  fileNaming: fileNamingDetector,
  hookPatterns: hookPatternDetector,
  testPatterns: testPatternDetector,
  // Ecosystem-specific (Wave 2)
  testFrameworkEcosystem: testFrameworkEcosystemDetector,
  dataFetching: dataFetchingDetector,
  database: databaseDetector,
  webFramework: webFrameworkDetector,
  buildTool: buildToolDetector,
};

/**
 * Run all convention detectors and collect results.
 * W2-3: Accepts optional DetectorContext for ecosystem-aware detectors.
 * W5-C2: Accepts optional plugins for org-specific detectors.
 */
export function extractConventions(
  parsedFiles: ParsedFile[],
  tiers: Map<string, TierInfo>,
  disabledDetectors: string[],
  warnings: Warning[] = [],
  context?: DetectorContext,
  plugins?: DetectorPlugin[],
): Convention[] {
  const conventions: Convention[] = [];
  const disabled = new Set(disabledDetectors);

  // Run built-in detectors
  for (const [name, detector] of Object.entries(DETECTOR_REGISTRY)) {
    if (disabled.has(name)) continue;

    try {
      const results = detector(parsedFiles, tiers, warnings, context);
      conventions.push(...results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push({
        level: "warn",
        module: "convention-extractor",
        message: `Detector "${name}" threw: ${msg}`,
      });
    }
  }

  // W5-C2: Run plugin detectors
  if (plugins && plugins.length > 0) {
    for (const plugin of plugins) {
      if (disabled.has(plugin.name)) continue;

      try {
        const results = plugin.detect(parsedFiles, tiers, warnings, context);
        conventions.push(...results);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({
          level: "warn",
          module: "convention-extractor",
          message: `Plugin "${plugin.name}" threw: ${msg}`,
        });
      }
    }
  }

  return conventions;
}

/**
 * E-28: Helper to filter to Tier 1 and Tier 2 source files only.
 */
export function sourceParsedFiles(
  files: ParsedFile[],
  tiers: Map<string, TierInfo>,
): ParsedFile[] {
  return files.filter((f) => {
    const t = tiers.get(f.relativePath);
    return t && t.tier !== 3;
  });
}
