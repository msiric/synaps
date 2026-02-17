// examples/plugins/telemetry-detector.ts — Example plugin: Telemetry Pattern Detector
// This is a reference implementation showing how to write a custom detector plugin.
// Previously part of the core engine, moved to plugin form in W5-C2.
//
// Usage:
//   npx tsx src/bin/autodocs-engine.ts analyze . --plugin ./examples/plugins/telemetry-detector.ts
//
// Or add to package.json:
//   { "autodocs": { "plugins": ["./examples/plugins/telemetry-detector.ts"] } }

import type { DetectorPlugin } from "../../src/plugin-loader.js";
import type { Convention, ConventionConfidence } from "../../src/types.js";

const telemetryDetectorPlugin: DetectorPlugin = {
  name: "telemetry-patterns",
  version: "1.0.0",
  dependencies: [], // No specific dependency requirement

  detect(files, _tiers, _warnings, _context) {
    const conventions: Convention[] = [];

    // Detect telemetry/instrumentation patterns
    const telemetryPatterns = [
      { pattern: /scenario\s*[:=]/i, name: "scenario" },
      { pattern: /logger\./i, name: "logger" },
      { pattern: /telemetry\./i, name: "telemetry" },
      { pattern: /trackEvent/i, name: "trackEvent" },
      { pattern: /sendTelemetry/i, name: "sendTelemetry" },
    ];

    let filesWithTelemetry = 0;
    const detectedPatterns = new Set<string>();

    for (const f of files) {
      if (f.isTestFile || f.isGeneratedFile) continue;

      // Check imports for telemetry modules
      const hasTelemetryImport = f.imports.some((imp) =>
        imp.moduleSpecifier.includes("telemetry") ||
        imp.moduleSpecifier.includes("logging") ||
        imp.moduleSpecifier.includes("instrumentation"),
      );

      if (hasTelemetryImport) {
        filesWithTelemetry++;
      }

      // Check call references for telemetry patterns
      for (const { pattern, name } of telemetryPatterns) {
        for (const ref of f.callReferences) {
          if (pattern.test(ref.calleeName)) {
            detectedPatterns.add(name);
          }
        }
      }
    }

    const totalSource = files.filter((f) => !f.isTestFile && !f.isGeneratedFile).length;

    if (filesWithTelemetry > 0) {
      conventions.push({
        category: "ecosystem",
        name: "Telemetry instrumentation",
        description: `${filesWithTelemetry} files import telemetry modules. Patterns: ${[...detectedPatterns].join(", ") || "custom"}`,
        confidence: conf(filesWithTelemetry, totalSource),
        examples: [...detectedPatterns].slice(0, 3),
      });
    }

    return conventions;
  },
};

function conf(matched: number, total: number): ConventionConfidence {
  const percentage = total > 0 ? Math.round((matched / total) * 100) : 0;
  return { matched, total, percentage, description: `${matched} of ${total} (${percentage}%)` };
}

export default telemetryDetectorPlugin;
