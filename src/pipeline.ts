// src/pipeline.ts — Pipeline Orchestrator
// Errata applied: E-31 (publicAPI before Architecture Detector), E-39 (warnings to all modules)

import { basename } from "node:path";
import type {
  ResolvedConfig,
  StructuredAnalysis,
  PackageAnalysis,
  Warning,
  TierInfo,
} from "./types.js";
import { discoverFiles } from "./file-discovery.js";
import { parseFile } from "./ast-parser.js";
import { buildSymbolGraph } from "./symbol-graph.js";
import { classifyTiers } from "./tier-classifier.js";
import { extractConventions } from "./convention-extractor.js";
import { extractCommands, scanWorkspaceCommands } from "./command-extractor.js";
import { detectArchitecture } from "./architecture-detector.js";
import { buildPublicAPI, buildPackageAnalysis, buildStructuredAnalysis } from "./analysis-builder.js";
import { analyzeCrossPackage } from "./cross-package.js";
import { inferRole } from "./role-inferrer.js";
import { deriveAntiPatterns } from "./anti-pattern-detector.js";
import { detectContributionPatterns } from "./contribution-patterns.js";
import { classifyImpacts } from "./impact-classifier.js";
import { analyzeConfig } from "./config-analyzer.js";
import { generateWorkflowRules } from "./workflow-rules.js";
import { fingerprintTopExports } from "./pattern-fingerprinter.js";
import { analyzeDependencies } from "./dependency-analyzer.js";
import { detectExistingDocs } from "./existing-docs.js";

/** Verbose logger — writes to stderr only when verbose is enabled. */
function vlog(verbose: boolean, msg: string): void {
  if (verbose) process.stderr.write(`[INFO] ${msg}\n`);
}

/**
 * Run the full analysis pipeline for all packages.
 */
export async function runPipeline(
  config: ResolvedConfig,
): Promise<StructuredAnalysis> {
  const warnings: Warning[] = [];
  const startTime = performance.now();
  const packageAnalyses: PackageAnalysis[] = [];
  const verbose = config.verbose;

  for (const pkgPath of config.packages) {
    try {
      const analysis = analyzePackage(pkgPath, config, warnings);
      packageAnalyses.push(analysis);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push({
        level: "error",
        module: "pipeline",
        message: `Failed to analyze ${pkgPath}: ${msg}`,
      });
    }
  }

  // Cross-package analysis (if >1 package)
  let crossPackage;
  if (packageAnalyses.length > 1) {
    vlog(verbose, `Running cross-package analysis for ${packageAnalyses.length} packages...`);
    const rootCommands = config.rootDir
      ? extractCommands(config.rootDir, undefined, warnings)
      : undefined;
    crossPackage = analyzeCrossPackage(packageAnalyses, rootCommands);
    if (crossPackage) {
      vlog(verbose, `  Dependency edges: ${crossPackage.dependencyGraph.length}`);
      vlog(verbose, `  Shared conventions: ${crossPackage.sharedConventions.length}`);
      vlog(verbose, `  Divergent conventions: ${crossPackage.divergentConventions.length}`);
    }

    // W3-1: Workspace-wide command scanning
    if (config.rootDir) {
      const workspaceCommands = scanWorkspaceCommands(config.rootDir, warnings);
      if (workspaceCommands.length > 0) {
        vlog(verbose, `  Workspace commands: ${workspaceCommands.length} operational commands found`);
        if (crossPackage) {
          crossPackage.workspaceCommands = workspaceCommands;
        }
      }

      // W3-2: Workflow rule generation
      const firstConfig = packageAnalyses.find((p) => p.configAnalysis)?.configAnalysis;
      const workflowRules = generateWorkflowRules({
        workspaceCommands,
        rootCommands,
        packageCommands: packageAnalyses.map((p) => ({
          packageName: p.name,
          commands: p.commands,
        })),
        configAnalysis: firstConfig,
        allDependencyInsights: packageAnalyses
          .map((p) => p.dependencyInsights)
          .filter((d): d is import("./types.js").DependencyInsights => d != null),
        allConventions: packageAnalyses.flatMap((p) => p.conventions),
      });
      if (workflowRules.length > 0) {
        vlog(verbose, `  Workflow rules: ${workflowRules.length} technology-specific rules generated`);
        if (crossPackage) {
          crossPackage.workflowRules = workflowRules;
        }
      }
    }
  }

  const totalMs = Math.round(performance.now() - startTime);
  vlog(verbose, `Total analysis time: ${totalMs}ms`);

  return buildStructuredAnalysis(
    packageAnalyses,
    crossPackage,
    config,
    warnings,
    startTime,
  );
}

function analyzePackage(
  pkgPath: string,
  config: ResolvedConfig,
  warnings: Warning[],
): PackageAnalysis {
  const verbose = config.verbose;
  const pkgStart = performance.now();
  vlog(verbose, `Analyzing ${basename(pkgPath)}...`);

  // Step 1: File Discovery (E-39: pass warnings)
  const files = discoverFiles(pkgPath, config.exclude, warnings);

  // Step 2: AST Parser (E-39: pass warnings)
  const parsed = files
    .map((f) => {
      try {
        return parseFile(f, pkgPath, warnings);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({
          level: "warn",
          module: "ast-parser",
          message: msg,
          file: f,
        });
        return null;
      }
    })
    .filter(Boolean) as import("./types.js").ParsedFile[];

  // Step 3: Symbol Graph Builder (E-39: pass warnings)
  const symbolGraph = buildSymbolGraph(parsed, pkgPath, warnings);

  // Step 4: Tier Classifier
  const tiers = classifyTiers(parsed, symbolGraph, symbolGraph.barrelFile);

  // Verbose: tier counts
  if (verbose) {
    let t1 = 0, t2 = 0, t3 = 0;
    for (const [, info] of tiers) {
      if (info.tier === 1) t1++;
      else if (info.tier === 2) t2++;
      else t3++;
    }
    vlog(verbose, `  Files discovered: ${parsed.length} (${t1} T1, ${t2} T2, ${t3} T3)`);
  }

  // E-31: Compute publicAPI BEFORE Architecture Detector
  const publicAPI = buildPublicAPI(
    symbolGraph,
    parsed,
    config.maxPublicAPIEntries,
    warnings,
  );
  vlog(verbose, `  Public API: ${publicAPI.length} exports`);

  // Steps 5-7: Run analysis modules (E-39: pass warnings)
  // Improvement 1 & 2: Config and dependency analysis needed before convention extraction
  // (moved up so detectors can use context)
  const configAnalysis = analyzeConfig(pkgPath, config.rootDir, warnings);
  vlog(verbose, `  Config: build=${configAnalysis.buildTool?.name ?? "none"}, linter=${configAnalysis.linter?.name ?? "none"}, formatter=${configAnalysis.formatter?.name ?? "none"}`);

  const dependencyInsights = analyzeDependencies(pkgPath, config.rootDir, warnings);
  vlog(verbose, `  Dependencies: ${dependencyInsights.frameworks.length} frameworks, runtime=${dependencyInsights.runtime.map((r) => r.name).join("+") || "node"}`);

  // W2-3: Pass dependency and config context to convention detectors
  const conventions = extractConventions(
    parsed,
    tiers,
    config.conventions.disable,
    warnings,
    { dependencies: dependencyInsights, config: configAnalysis },
  );
  vlog(verbose, `  Conventions: ${conventions.length} detected`);

  // Improvement 4: Existing docs detection
  const existingDocs = detectExistingDocs(pkgPath, warnings);
  if (existingDocs.hasAgentsMd || existingDocs.hasClaudeMd) {
    vlog(verbose, `  Existing docs: ${existingDocs.hasAgentsMd ? "AGENTS.md" : ""}${existingDocs.hasClaudeMd ? " CLAUDE.md" : ""}`);
  }

  const commands = extractCommands(pkgPath, config.rootDir, warnings);

  // Improvement 1 integration: Override commands with build tool info (turbo, nx)
  if (configAnalysis.buildTool && configAnalysis.buildTool.name !== "none") {
    adjustCommandsForBuildTool(commands, configAnalysis.buildTool, warnings);
  }

  const cmdList = [
    commands.build && "build",
    commands.test && "test",
    commands.lint && "lint",
    commands.start && "start",
  ].filter(Boolean);
  vlog(verbose, `  Commands: ${commands.packageManager} (${cmdList.join(", ") || "none"})`);

  const architecture = detectArchitecture(
    parsed,
    pkgPath,
    publicAPI,
    symbolGraph.barrelFile,
    warnings,
  );

  // Enhancement 1: Role inference
  const partialAnalysis = buildPackageAnalysis(
    pkgPath,
    config.rootDir,
    parsed,
    symbolGraph,
    tiers,
    conventions,
    commands,
    architecture,
    publicAPI,
    warnings,
  );
  const role = inferRole(partialAnalysis);
  vlog(verbose, `  Role: ${role.summary}`);

  // Enhancement 3: Anti-pattern derivation
  const antiPatterns = deriveAntiPatterns(conventions);
  vlog(verbose, `  Anti-patterns: ${antiPatterns.length} derived`);

  // Enhancement 4: Contribution patterns
  const contributionPatterns = detectContributionPatterns(
    parsed,
    publicAPI,
    tiers,
    architecture.directories,
    symbolGraph.barrelFile,
  );
  vlog(verbose, `  Contribution patterns: ${contributionPatterns.length} detected`);

  // Impact classification
  const classified = classifyImpacts(conventions, antiPatterns);
  vlog(verbose, `  Impact: ${classified.conventions.filter((c) => c.impact === "high").length} high, ${classified.conventions.filter((c) => c.impact === "medium").length} medium, ${classified.conventions.filter((c) => c.impact === "low").length} low`);

  // Improvement 3: Call graph logging
  if (symbolGraph.callGraph.length > 0) {
    vlog(verbose, `  Call graph: ${symbolGraph.callGraph.length} edges`);
  }

  // W2-2: Pattern fingerprinting for top exports
  const patternFingerprints = fingerprintTopExports(publicAPI, pkgPath, 5, warnings);
  if (patternFingerprints.length > 0) {
    vlog(verbose, `  Pattern fingerprints: ${patternFingerprints.length} exports analyzed`);
  }

  const pkgMs = Math.round(performance.now() - pkgStart);
  vlog(verbose, `  Analysis time: ${pkgMs}ms`);

  return {
    ...partialAnalysis,
    conventions: classified.conventions,
    role,
    antiPatterns: classified.antiPatterns,
    contributionPatterns,
    configAnalysis,
    dependencyInsights,
    existingDocs,
    callGraph: symbolGraph.callGraph.length > 0 ? symbolGraph.callGraph : undefined,
    patternFingerprints: patternFingerprints.length > 0 ? patternFingerprints : undefined,
  };
}

/**
 * Improvement 1: Adjust commands based on detected build tool (turbo, nx).
 * If turbo.json defines tasks like "build", "test", "lint", "dev",
 * use "turbo run <task>" instead of "<pm> run <script>".
 */
function adjustCommandsForBuildTool(
  commands: import("./types.js").CommandSet,
  buildTool: NonNullable<import("./types.js").ConfigAnalysis["buildTool"]>,
  _warnings: import("./types.js").Warning[],
): void {
  if (buildTool.name !== "turbo" && buildTool.name !== "nx") return;

  const prefix = buildTool.name === "turbo" ? "turbo run" : "nx run";
  const taskSet = new Set(buildTool.taskNames);

  const mapping: Record<string, keyof Pick<import("./types.js").CommandSet, "build" | "test" | "lint" | "start">> = {
    build: "build",
    test: "test",
    lint: "lint",
    dev: "start",
    start: "start",
  };

  for (const [taskName, cmdField] of Object.entries(mapping)) {
    if (!taskSet.has(taskName)) continue;
    const existing = commands[cmdField];
    if (existing) {
      // Keep the existing as a variant, use turbo as primary
      const turboCmd = `${prefix} ${taskName}`;
      if (existing.run !== turboCmd) {
        if (!existing.variants) existing.variants = [];
        existing.variants.push({ name: "package-level", run: existing.run });
        existing.run = turboCmd;
        existing.source = `${buildTool.configFile} tasks.${taskName}`;
      }
    } else {
      // Create new command from turbo task
      (commands as any)[cmdField] = {
        run: `${prefix} ${taskName}`,
        source: `${buildTool.configFile} tasks.${taskName}`,
      };
    }
  }
}
