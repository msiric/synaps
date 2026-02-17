// src/output-validator.ts — W2-1: LLM Output Validation + Targeted Retry
// Cross-references LLM-generated output against structured analysis to catch
// hallucinated technologies, version mismatches, unknown symbols, budget overruns,
// and command mismatches. Composes a correction prompt for one retry if issues found.

import type {
  ValidationResult,
  ValidationIssue,
  PackageAnalysis,
  StructuredAnalysis,
} from "./types.js";

// ─── Technology keywords → NPM package names ────────────────────────────────

const TECH_KEYWORDS: Record<string, string[]> = {
  graphql: ["graphql", "@apollo/client", "apollo-server", "@graphql-codegen/cli", "graphql-tag", "urql", "@urql/core"],
  redux: ["redux", "@reduxjs/toolkit", "react-redux"],
  mobx: ["mobx", "mobx-react", "mobx-react-lite"],
  express: ["express"],
  fastify: ["fastify"],
  prisma: ["prisma", "@prisma/client"],
  drizzle: ["drizzle-orm"],
  typeorm: ["typeorm"],
  sequelize: ["sequelize"],
  apollo: ["@apollo/client", "apollo-server", "@apollo/server"],
  trpc: ["@trpc/server", "@trpc/client", "@trpc/react-query"],
  tailwind: ["tailwindcss"],
  "styled-components": ["styled-components"],
  emotion: ["@emotion/react", "@emotion/styled"],
  zustand: ["zustand"],
  jotai: ["jotai"],
  recoil: ["recoil"],
  swr: ["swr"],
  "react-query": ["@tanstack/react-query", "react-query"],
  webpack: ["webpack"],
  vite: ["vite"],
  esbuild: ["esbuild"],
  rollup: ["rollup"],
};

// ─── Version reference patterns ──────────────────────────────────────────────

const VERSION_PATTERNS: Array<{ regex: RegExp; packageName: string }> = [
  { regex: /next\.?js\s+(\d+[\d.]*)/gi, packageName: "next" },
  { regex: /react\s+(\d+[\d.]*)/gi, packageName: "react" },
  { regex: /typescript\s+(\d+[\d.]*)/gi, packageName: "typescript" },
  { regex: /vue\s+(\d+[\d.]*)/gi, packageName: "vue" },
  { regex: /angular\s+(\d+[\d.]*)/gi, packageName: "@angular/core" },
  { regex: /svelte\s+(\d+[\d.]*)/gi, packageName: "svelte" },
  { regex: /hono\s+(\d+[\d.]*)/gi, packageName: "hono" },
  { regex: /express\s+(\d+[\d.]*)/gi, packageName: "express" },
  { regex: /node\.?js?\s+(\d+[\d.]*)/gi, packageName: "node" },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate LLM-generated output against structured analysis.
 * Returns issues and a correction prompt if any are found.
 */
export function validateOutput(
  output: string,
  analysis: StructuredAnalysis | PackageAnalysis,
  format: "root" | "package-detail",
): ValidationResult {
  const issues: ValidationIssue[] = [];

  const packages = isStructuredAnalysis(analysis) ? analysis.packages : [analysis];

  // Collect all known deps across all packages
  const allDeps = new Set<string>();
  const allFrameworks = new Map<string, string>(); // name → version
  const allPublicAPI = new Set<string>();
  const allCommands: string[] = [];

  for (const pkg of packages) {
    // External dependencies
    for (const dep of pkg.dependencies.external) {
      allDeps.add(dep.name);
    }
    // Frameworks from dependency insights
    if (pkg.dependencyInsights) {
      for (const fw of pkg.dependencyInsights.frameworks) {
        allDeps.add(fw.name);
        allFrameworks.set(fw.name, fw.version);
      }
      if (pkg.dependencyInsights.testFramework) {
        allDeps.add(pkg.dependencyInsights.testFramework.name);
      }
      if (pkg.dependencyInsights.bundler) {
        allDeps.add(pkg.dependencyInsights.bundler.name);
      }
    }
    // Public API symbols
    for (const entry of pkg.publicAPI) {
      allPublicAPI.add(entry.name);
    }
    // Commands
    if (pkg.commands.build) allCommands.push(pkg.commands.build.run);
    if (pkg.commands.test) allCommands.push(pkg.commands.test.run);
    if (pkg.commands.lint) allCommands.push(pkg.commands.lint.run);
    if (pkg.commands.start) allCommands.push(pkg.commands.start.run);
    for (const cmd of pkg.commands.other) allCommands.push(cmd.run);
    // Include variants
    for (const cmd of [pkg.commands.build, pkg.commands.test, pkg.commands.lint, pkg.commands.start]) {
      if (cmd?.variants) {
        for (const v of cmd.variants) allCommands.push(v.run);
      }
    }
  }

  // W3-1: Also include workspace commands and root commands from cross-package analysis
  if (isStructuredAnalysis(analysis) && analysis.crossPackage) {
    if (analysis.crossPackage.workspaceCommands) {
      for (const cmd of analysis.crossPackage.workspaceCommands) {
        allCommands.push(cmd.run);
      }
    }
    if (analysis.crossPackage.rootCommands) {
      const rc = analysis.crossPackage.rootCommands;
      if (rc.build) allCommands.push(rc.build.run);
      if (rc.test) allCommands.push(rc.test.run);
      if (rc.lint) allCommands.push(rc.lint.run);
      if (rc.start) allCommands.push(rc.start.run);
      for (const cmd of rc.other) allCommands.push(cmd.run);
    }
  }

  // Check 1: Technology cross-reference
  checkTechnologyCrossRef(output, allDeps, issues);

  // Check 2: Version consistency
  checkVersionConsistency(output, allFrameworks, packages, issues);

  // Check 3: Symbol verification (only for package-detail format)
  if (format === "package-detail" && allPublicAPI.size > 0) {
    checkSymbolVerification(output, allPublicAPI, issues);
  }

  // Check 4: Budget check (package-detail only)
  if (format === "package-detail") {
    checkBudget(output, issues);
  }

  // Check 5: Command verification
  checkCommandVerification(output, allCommands, issues);

  // Compose correction prompt
  const errors = issues.filter((i) => i.severity === "error");
  let correctionPrompt: string | undefined;
  if (errors.length > 0) {
    correctionPrompt = composeCorrectionPrompt(output, errors);
  }

  return {
    isValid: errors.length === 0,
    issues,
    correctionPrompt,
  };
}

// ─── Check 1: Technology Cross-Reference ────────────────────────────────────

function checkTechnologyCrossRef(
  output: string,
  allDeps: Set<string>,
  issues: ValidationIssue[],
): void {
  const outputLower = output.toLowerCase();

  for (const [keyword, packageNames] of Object.entries(TECH_KEYWORDS)) {
    // Check if keyword appears in output
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "gi");
    if (!regex.test(outputLower)) continue;

    // Check if any of the associated packages are in deps
    const hasPackage = packageNames.some((pkg) => allDeps.has(pkg));
    if (hasPackage) continue;

    // False positive guards: skip if the keyword is just part of another word
    // or in a negation context ("not GraphQL", "no GraphQL")
    const negationRegex = new RegExp(`(not|no|without|instead of|rather than)\\s+${escapeRegex(keyword)}`, "gi");
    if (negationRegex.test(outputLower)) continue;

    issues.push({
      severity: "error",
      type: "hallucinated_technology",
      message: `Output mentions "${keyword}" but no matching package (${packageNames.join(", ")}) found in dependencies`,
      suggestion: `Remove references to "${keyword}" or replace with the actual technology used`,
    });
  }
}

// ─── Check 2: Version Consistency ────────────────────────────────────────────

function checkVersionConsistency(
  output: string,
  allFrameworks: Map<string, string>,
  packages: PackageAnalysis[],
  issues: ValidationIssue[],
): void {
  for (const { regex, packageName } of VERSION_PATTERNS) {
    // Reset regex state
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(output)) !== null) {
      const mentionedVersion = match[1];
      let actualVersion: string | undefined;

      // Check frameworks
      actualVersion = allFrameworks.get(packageName);

      // Check runtime for node
      if (!actualVersion && packageName === "node") {
        for (const pkg of packages) {
          const runtime = pkg.dependencyInsights?.runtime.find((r) => r.name === "node");
          if (runtime) {
            actualVersion = runtime.version;
            break;
          }
        }
      }

      if (!actualVersion) continue;

      const mentionedMajor = parseInt(mentionedVersion.split(".")[0], 10);
      const actualMajor = parseInt(actualVersion.split(".")[0], 10);

      if (isNaN(mentionedMajor) || isNaN(actualMajor)) continue;

      if (mentionedMajor !== actualMajor) {
        issues.push({
          severity: "error",
          type: "version_mismatch",
          message: `Output says "${match[0].trim()}" but project uses ${packageName} ${actualVersion} (major version ${actualMajor})`,
          suggestion: `Replace with ${packageName} ${actualVersion}`,
        });
      }
    }
  }
}

// ─── Check 3: Symbol Verification ───────────────────────────────────────────

function checkSymbolVerification(
  output: string,
  allPublicAPI: Set<string>,
  issues: ValidationIssue[],
): void {
  // Extract backtick-quoted identifiers that look like function/hook names
  const symbolRegex = /`(use[A-Z]\w+|[a-z]\w+(?:Handler|Manager|Service|Controller|Provider|Factory))`/g;
  let match: RegExpExecArray | null;
  const checked = new Set<string>();

  while ((match = symbolRegex.exec(output)) !== null) {
    const symbol = match[1];
    if (checked.has(symbol)) continue;
    checked.add(symbol);

    // Allow partial matches — output might abbreviate
    const hasMatch = allPublicAPI.has(symbol) ||
      [...allPublicAPI].some((api) => api.includes(symbol) || symbol.includes(api));

    if (!hasMatch && allPublicAPI.size > 5) {
      issues.push({
        severity: "warning",
        type: "unknown_symbol",
        message: `Output mentions \`${symbol}\` which doesn't appear in the public API`,
        suggestion: `Verify this symbol exists or remove the reference`,
      });
    }
  }
}

// ─── Check 4: Budget ─────────────────────────────────────────────────────────

function checkBudget(
  output: string,
  issues: ValidationIssue[],
): void {
  const lineCount = output.split("\n").length;
  if (lineCount > 120) {
    issues.push({
      severity: "error",
      type: "budget_exceeded",
      message: `Package detail file is ${lineCount} lines — target is 60-90 lines`,
      suggestion: `Compress the Public API section to show only top 15 exports by import count. Remove redundant descriptions.`,
    });
  }
}

// ─── Check 5: Command Verification ──────────────────────────────────────────

function checkCommandVerification(
  output: string,
  allCommands: string[],
  issues: ValidationIssue[],
): void {
  if (allCommands.length === 0) return;

  // Extract command-like patterns from output
  const cmdRegex = /`((?:npm|yarn|pnpm|bun|turbo|nx|npx)\s+(?:run\s+)?[\w:.-]+(?:\s+[\w:.-]+)*)`/g;
  let match: RegExpExecArray | null;
  const checked = new Set<string>();

  while ((match = cmdRegex.exec(output)) !== null) {
    const cmd = match[1];
    if (checked.has(cmd)) continue;
    checked.add(cmd);

    // Check if this command is in the known commands
    const isKnown = allCommands.some((known) =>
      known === cmd || cmd.includes(known) || known.includes(cmd),
    );

    if (!isKnown) {
      issues.push({
        severity: "warning",
        type: "command_mismatch",
        message: `Output includes command \`${cmd}\` which doesn't match any analyzed command`,
        suggestion: `Known commands: ${allCommands.slice(0, 5).map((c) => `\`${c}\``).join(", ")}`,
      });
    }
  }
}

// ─── Correction Prompt Composition ───────────────────────────────────────────

function composeCorrectionPrompt(
  output: string,
  errors: ValidationIssue[],
): string {
  const corrections = errors.map((e, i) =>
    `${i + 1}. [${e.type}] ${e.message}${e.suggestion ? `\n   Fix: ${e.suggestion}` : ""}`,
  ).join("\n");

  return `The following AGENTS.md output has ${errors.length} issue(s) that need correction:

${corrections}

Original output:
${output}

Please output the CORRECTED version. Fix ONLY the flagged issues — preserve everything else. Do NOT add explanations, just output the corrected markdown.`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStructuredAnalysis(
  a: StructuredAnalysis | PackageAnalysis,
): a is StructuredAnalysis {
  return "packages" in a && Array.isArray((a as any).packages);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
