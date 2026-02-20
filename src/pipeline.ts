// src/pipeline.ts — Pipeline Orchestrator
// Errata applied: E-31 (publicAPI before Architecture Detector), E-39 (warnings to all modules)

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
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
import { extractExamples } from "./example-extractor.js";
import { generateDependencyDiagram } from "./mermaid-generator.js";
import { detectMetaTool } from "./meta-tool-detector.js";
import { computeImportChain, generateImportChainRules } from "./import-chain.js";

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
  let crossPackage: import("./types.js").CrossPackageAnalysis | undefined;
  let workspaceCommands: import("./types.js").WorkspaceCommand[] = [];
  let rootCommands: import("./types.js").CommandSet | undefined;

  if (packageAnalyses.length > 1) {
    vlog(verbose, `Running cross-package analysis for ${packageAnalyses.length} packages...`);
    rootCommands = config.rootDir
      ? extractCommands(config.rootDir, undefined, warnings)
      : undefined;
    crossPackage = analyzeCrossPackage(packageAnalyses, rootCommands);
    if (crossPackage) {
      vlog(verbose, `  Dependency edges: ${crossPackage.dependencyGraph.length}`);
      vlog(verbose, `  Shared conventions: ${crossPackage.sharedConventions.length}`);
      vlog(verbose, `  Divergent conventions: ${crossPackage.divergentConventions.length}`);
    }

    // W5-C3: Generate Mermaid dependency diagram
    if (crossPackage && crossPackage.dependencyGraph.length > 0) {
      const mermaidDiagram = generateDependencyDiagram(packageAnalyses, crossPackage.dependencyGraph);
      if (mermaidDiagram) {
        crossPackage.mermaidDiagram = mermaidDiagram;
        vlog(verbose, `  Mermaid diagram: ${crossPackage.dependencyGraph.length} edges rendered`);
      }
    }

    // W3-1: Workspace-wide command scanning (multi-package only)
    if (config.rootDir) {
      const analyzedPkgNames = new Set(packageAnalyses.map((p) => p.name));
      workspaceCommands = scanWorkspaceCommands(config.rootDir, warnings, analyzedPkgNames);
      if (workspaceCommands.length > 0) {
        vlog(verbose, `  Workspace commands: ${workspaceCommands.length} operational commands found`);
        if (crossPackage) {
          crossPackage.workspaceCommands = workspaceCommands;
        }
      }
    }
  }

  // Workflow rule generation — runs for ALL analyses (single and multi-package)
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
  // Add import-chain rules (from file-to-file coupling analysis)
  const importChainRules = generateImportChainRules(
    packageAnalyses.flatMap((p) => p.importChain ?? []),
  );
  if (importChainRules.length > 0) {
    vlog(verbose, `Import chain rules: ${importChainRules.length} high-coupling rules generated`);
    workflowRules.push(...importChainRules);
  }

  if (workflowRules.length > 0) {
    vlog(verbose, `Workflow rules: ${workflowRules.length} total rules generated`);
    // For single-package, create a minimal crossPackage to hold the rules
    if (!crossPackage) {
      crossPackage = {
        dependencyGraph: [],
        sharedConventions: [],
        divergentConventions: [],
        sharedAntiPatterns: [],
        workflowRules,
      };
    } else {
      crossPackage.workflowRules = workflowRules;
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

  // Compute file-to-file import coupling before symbolGraph is discarded
  const importChain = computeImportChain(symbolGraph, pkgPath, warnings);
  if (importChain.length > 0) {
    vlog(verbose, `  Import chain: ${importChain.length} high-coupling file pairs`);
  }

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

  // Collect all imported module specifiers from source files for import-verified framework detection
  // Excludes type-only imports — they don't indicate runtime framework usage
  const allImportedModules = new Set<string>();
  for (const pf of parsed) {
    for (const imp of pf.imports) {
      if (imp.isTypeOnly) continue;
      const spec = imp.moduleSpecifier;
      if (spec.startsWith(".") || spec.startsWith("/")) continue;
      const parts = spec.split("/");
      const basePkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      allImportedModules.add(basePkg);
    }
  }

  const dependencyInsights = analyzeDependencies(pkgPath, config.rootDir, warnings, allImportedModules);
  vlog(verbose, `  Dependencies: ${dependencyInsights.frameworks.length} frameworks, runtime=${dependencyInsights.runtime.map((r) => r.name).join("+") || "node"}`);

  // Meta-tool detection (before conventions — informs format-time reclassification)
  let pkgJsonRaw: Record<string, unknown> | null = null;
  try {
    pkgJsonRaw = JSON.parse(readFileSync(join(pkgPath, "package.json"), "utf-8"));
  } catch { /* no package.json */ }

  const metaToolResult = (!config.noMetaTool && pkgJsonRaw)
    ? detectMetaTool({
        parsedFiles: parsed,
        tiers,
        dependencies: (pkgJsonRaw.dependencies ?? {}) as Record<string, string>,
        devDependencies: (pkgJsonRaw.devDependencies ?? {}) as Record<string, string>,
        peerDeps: (pkgJsonRaw.peerDependencies ?? {}) as Record<string, string>,
        threshold: config.metaToolThreshold,
      }, warnings)
    : { isMetaTool: false, signal: "none" as const, supportedFamilies: [] as string[], coreFamilies: [] as string[] };

  if (metaToolResult.isMetaTool) {
    vlog(verbose, `  Meta-tool: ${metaToolResult.signal} (${metaToolResult.supportedFamilies.length} families, core: ${metaToolResult.coreFamilies.join(", ") || "none"})`);
  }

  // Read root devDeps for test framework fallback in monorepos
  let rootDevDeps: Record<string, string> | undefined;
  if (config.rootDir) {
    try {
      const rootPkg = JSON.parse(readFileSync(join(config.rootDir, "package.json"), "utf-8"));
      rootDevDeps = rootPkg.devDependencies;
    } catch {
      // skip
    }
  }

  // W2-3: Pass dependency and config context to convention detectors
  const conventions = extractConventions(
    parsed,
    tiers,
    config.conventions.disable,
    warnings,
    { dependencies: dependencyInsights, config: configAnalysis, rootDevDeps },
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
  if (metaToolResult.isMetaTool) {
    role.summary += ` — integrates with ${metaToolResult.supportedFamilies.length} framework ecosystems`;
  }
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

  // W5-C1: Extract usage examples from test files
  const examples = extractExamples(publicAPI, parsed, pkgPath, 10, warnings);
  if (examples.length > 0) {
    vlog(verbose, `  Usage examples: ${examples.length} extracted from test files`);
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
    importChain: importChain.length > 0 ? importChain : undefined,
    patternFingerprints: patternFingerprints.length > 0 ? patternFingerprints : undefined,
    examples: examples.length > 0 ? examples : undefined,
    isMetaTool: metaToolResult.isMetaTool || undefined,
    metaToolInfo: metaToolResult.isMetaTool ? {
      signal: metaToolResult.signal as "peer-dependencies" | "dep-placement" | "family-count",
      supportedFamilies: metaToolResult.supportedFamilies,
      coreFamilies: metaToolResult.coreFamilies,
    } : undefined,
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
      const newCmd = {
        run: `${prefix} ${taskName}`,
        source: `${buildTool.configFile} tasks.${taskName}`,
      };
      if (cmdField === "build") commands.build = newCmd;
      else if (cmdField === "test") commands.test = newCmd;
      else if (cmdField === "lint") commands.lint = newCmd;
      else if (cmdField === "start") commands.start = newCmd;
    }
  }
}
