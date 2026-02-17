// src/types.ts — ALL shared types for the Codebase Intelligence Engine
// Incorporates errata E-6 through E-13, E-39

// ─── Top-level output ────────────────────────────────────────────────────────

export interface StructuredAnalysis {
  meta: AnalysisMeta;
  packages: PackageAnalysis[];
  crossPackage?: CrossPackageAnalysis;
  warnings: Warning[];
}

export interface AnalysisMeta {
  engineVersion: string;
  analyzedAt: string;
  rootDir: string;
  config: PublicConfig; // E-6: Redacted config (no apiKey)
  timingMs: number;
}

// E-6: PublicConfig omits apiKey from serialized output
export type PublicConfig = Omit<ResolvedConfig, "llm"> & {
  llm: Omit<ResolvedConfig["llm"], "apiKey">;
};

export interface ResolvedConfig {
  packages: string[];
  exclude: string[];
  rootDir?: string;
  output: {
    format: OutputFormat;
    dir: string;
  };
  llm: {
    provider: "anthropic" | "openai" | "local";
    model: string;
    apiKey?: string;
    baseUrl?: string;
    maxOutputTokens: number; // E-7: default 4096
  };
  conventions: {
    disable: string[];
  };
  maxPublicAPIEntries: number; // E-13: default 100
  verbose: boolean;
}

export type OutputFormat = "json" | "agents.md" | "claude.md" | "cursorrules";

// ─── Warnings (E-39: passed to all modules) ─────────────────────────────────

export interface Warning {
  level: "info" | "warn" | "error";
  module: string;
  message: string;
  file?: string;
}

// ─── Per-package analysis ────────────────────────────────────────────────────

export interface PackageAnalysis {
  name: string;
  version: string;
  description: string;
  relativePath: string;
  files: FileInventory;
  publicAPI: PublicAPIEntry[];
  conventions: Convention[];
  commands: CommandSet;
  architecture: PackageArchitecture;
  dependencies: DependencySummary;
  role: PackageRole;
  antiPatterns: AntiPattern[];
  contributionPatterns: ContributionPattern[];
  configAnalysis?: ConfigAnalysis;
  dependencyInsights?: DependencyInsights;
  existingDocs?: ExistingDocs;
  callGraph?: CallGraphEdge[];
  patternFingerprints?: PatternFingerprint[];
  examples?: UsageExample[]; // W5-C1: Usage examples extracted from test files
}

// ─── Config Analysis (Improvement 1) ────────────────────────────────────────

export interface ConfigAnalysis {
  typescript?: {
    strict: boolean;
    target: string;
    module: string;
    moduleResolution: string;
    paths?: Record<string, string[]>;
    jsx?: string;
  };
  buildTool?: {
    name: "turbo" | "nx" | "lerna" | "none";
    taskNames: string[];
    configFile: string;
  };
  linter?: {
    name: "eslint" | "biome" | "none";
    configFile: string;
  };
  formatter?: {
    name: "prettier" | "biome" | "none";
    configFile: string;
  };
  taskRunner?: {
    name: "just" | "make" | "none";
    targets: string[];
    configFile: string;
  };
  envVars?: string[];
}

// ─── Dependency Insights (Improvement 2) ─────────────────────────────────────

export interface DependencyInsights {
  runtime: { name: string; version: string }[];
  frameworks: { name: string; version: string; guidance?: string }[];
  testFramework?: { name: string; version: string };
  bundler?: { name: string; version: string };
}

// ─── Existing Docs (Improvement 4) ──────────────────────────────────────────

export interface ExistingDocs {
  hasReadme: boolean;
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
  hasCursorrules: boolean;
  hasContributing: boolean;
  agentsMdPath?: string;
  claudeMdPath?: string;
}

// ─── Call Graph (Improvement 3) ──────────────────────────────────────────────

export interface CallReference {
  callerName: string;
  calleeName: string;
  calleeModule: string;
  isInternal: boolean;
}

export interface CallGraphEdge {
  from: string;
  to: string;
  fromFile: string;
  toFile: string;
}

export interface PackageRole {
  summary: string;
  purpose: string;
  whenToUse: string;
  inferredFrom: string[];
}

export interface AntiPattern {
  rule: string;
  reason: string;
  confidence: "high" | "medium";
  derivedFrom: string;
  impact?: RuleImpact; // Classified by what AI tools reliably follow
}

export interface ContributionPattern {
  type: string;
  directory: string;
  filePattern: string;
  testPattern?: string;
  exampleFile: string;
  steps: string[];
}

export interface FileInventory {
  total: number;
  byTier: {
    tier1: { count: number; lines: number; files: string[] };
    tier2: { count: number; lines: number; files: string[] };
    tier3: { count: number; lines: number }; // No file list — noise
  };
  byExtension: Record<string, number>;
}

// E-11: importCount added
export interface PublicAPIEntry {
  name: string;
  kind: SymbolKind;
  sourceFile: string;
  signature?: string;
  isTypeOnly: boolean;
  description?: string;
  importCount?: number; // E-11: how many files import this symbol
}

export type SymbolKind =
  | "function"
  | "hook"
  | "component"
  | "type"
  | "interface"
  | "class"
  | "enum"
  | "const"
  | "namespace" // E-24: for `export * as ns`
  | "unknown";

// E-12: Structured confidence
export interface ConventionConfidence {
  matched: number;
  total: number;
  percentage: number; // 0-100
  description: string; // human-readable: "34 of 34 files (100%)"
}

export type RuleImpact = "high" | "medium" | "low";

export interface Convention {
  category: ConventionCategory;
  name: string;
  description: string;
  confidence: ConventionConfidence; // E-12: structured, not string
  examples: string[];
  impact?: RuleImpact; // Classified by what AI tools reliably follow
}

// W5-A: Removed unused categories: imports, exports, components, error-handling, graphql, telemetry, state-management
export type ConventionCategory =
  | "file-naming"
  | "hooks"
  | "testing"
  | "ecosystem";

// ─── Commands ────────────────────────────────────────────────────────────────

export interface CommandSet {
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  build?: Command;
  test?: Command;
  lint?: Command;
  start?: Command;
  other: Command[];
}

export interface Command {
  run: string;
  source: string;
  variants?: { name: string; run: string }[];
}

// W3-1: Workspace-wide command scanning
export interface WorkspaceCommand {
  run: string;
  scriptName: string;
  packageName: string;
  packagePath: string;
  category: string;
}

// W3-2: Technology-aware workflow rules
export interface WorkflowRule {
  trigger: string;
  action: string;
  source: string;
  impact: "high";
}

// ─── Package architecture ────────────────────────────────────────────────────

export interface DirectoryInfo {
  path: string;
  purpose: string;
  fileCount: number;
  exports: string[];
  pattern?: string;
}

export interface PackageArchitecture {
  entryPoint: string;
  directories: DirectoryInfo[];
  // E-30: Updated union — removed org-specific types, added cli/server
  // W3-3: Added web-application, api-server
  packageType:
    | "react-components"
    | "hooks"
    | "library"
    | "cli"
    | "server"
    | "web-application"
    | "api-server"
    | "mixed"
    | "unknown";
  hasJSX: boolean;
}

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface DependencySummary {
  internal: string[];
  external: { name: string; importCount: number }[];
  totalUniqueDependencies: number;
}

// ─── Cross-package analysis ──────────────────────────────────────────────────

export interface CrossPackageAnalysis {
  dependencyGraph: PackageDependency[];
  sharedConventions: Convention[];
  divergentConventions: {
    convention: string;
    packages: { name: string; value: string }[];
  }[];
  rootCommands?: CommandSet; // E-8: optional
  sharedAntiPatterns: AntiPattern[];
  workspaceCommands?: WorkspaceCommand[]; // W3-1: commands from all workspace packages
  workflowRules?: WorkflowRule[]; // W3-2: technology-aware workflow rules
  mermaidDiagram?: string; // W5-C3: Mermaid dependency diagram
}

export interface PackageDependency {
  from: string;
  to: string;
  isDevOnly: boolean;
}

// ─── Internal types (not part of StructuredAnalysis output) ──────────────────

export interface ParsedFile {
  relativePath: string;
  exports: ExportEntry[];
  imports: ImportEntry[];
  contentSignals: ContentSignals;
  lineCount: number;
  isTestFile: boolean;
  isGeneratedFile: boolean;
  hasJSX: boolean;
  hasCJS: boolean; // E-18: CommonJS detection
  hasSyntaxErrors: boolean; // E-19: syntax error detection
  callReferences: CallReference[]; // Improvement 3: call graph tracking
}

// E-10: localName for aliased exports
export interface ExportEntry {
  name: string;
  localName?: string; // E-10: local name if different (e.g., `export { foo as bar }`)
  kind: SymbolKind;
  isReExport: boolean;
  isTypeOnly: boolean;
  reExportSource?: string;
  signature?: string;
  jsDocComment?: string;
}

export interface ImportEntry {
  moduleSpecifier: string;
  importedNames: string[];
  isTypeOnly: boolean;
  isDynamic: boolean;
}

// E-17: Hybrid AST/regex — AST-based signals and regex-based signals
export interface ContentSignals {
  // AST-based (E-17: computed via AST walking)
  tryCatchCount: number;
  useMemoCount: number;
  useCallbackCount: number;
  useEffectCount: number;
  useStateCount: number;
  useQueryCount: number;
  useMutationCount: number;

  // Regex-based (E-17: kept as regex — no clean AST equivalent)
  jestMockCount: number;
  hasDisplayName: boolean;
  hasErrorBoundary: boolean;
}

// E-9: barrelFile added to SymbolGraph
export interface SymbolGraph {
  barrelFile?: string; // E-9: relative path to barrel, or undefined
  barrelExports: ResolvedExport[];
  allExports: Map<string, ExportEntry[]>;
  importGraph: Map<string, ImportEntry[]>;
  barrelSourceFiles: Set<string>;
  callGraph: CallGraphEdge[]; // Improvement 3: cross-file call relationships
}

export interface ResolvedExport extends ExportEntry {
  definedIn: string;
}

export type TierInfo = { tier: 1 | 2 | 3; reason: string };

export interface DetectorContext {
  dependencies?: DependencyInsights;
  config?: ConfigAnalysis;
}

export type ConventionDetector = (
  files: ParsedFile[],
  tiers: Map<string, TierInfo>,
  warnings: Warning[],
  context?: DetectorContext,
) => Convention[];

// ─── Errors ──────────────────────────────────────────────────────────────────

export class FileNotFoundError extends Error {
  constructor(
    public readonly filePath: string,
    cause?: Error,
  ) {
    super(`File not found: ${filePath}`);
    this.name = "FileNotFoundError";
    if (cause) this.cause = cause;
  }
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

// ─── W2-1: Output Validation ─────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  correctionPrompt?: string;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  type: "hallucinated_technology" | "version_mismatch" | "unknown_symbol" | "budget_exceeded" | "command_mismatch";
  message: string;
  line?: number;
  suggestion?: string;
}

// ─── W2-2: Pattern Fingerprinting ────────────────────────────────────────────

export interface PatternFingerprint {
  exportName: string;
  sourceFile: string;
  parameterShape: string;
  returnShape: string;
  internalCalls: string[];
  errorPattern: string;
  asyncPattern: string;
  complexity: "simple" | "moderate" | "complex";
  summary: string;
}

// ─── W5-C1: Usage Examples from Tests ────────────────────────────────────────

export interface UsageExample {
  exportName: string;
  testFile: string;
  snippet: string;
  context: string;
}

// ─── W2-4: Diff Analysis ────────────────────────────────────────────────────

export interface AnalysisDiff {
  newExports: string[];
  removedExports: string[];
  changedConventions: string[];
  newConventions: string[];
  commandsChanged: boolean;
  dependencyChanges: {
    added: string[];
    removed: string[];
    majorVersionChanged: string[];
  };
  summary: string;
  needsUpdate: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const ENGINE_VERSION = "0.1.0";

export const DEFAULT_EXCLUDE_DIRS = [
  "node_modules",
  "dist",
  "lib",
  "build",
  "out",
  "coverage",
  "__mocks__",
  ".git",
  "generated-touchdown",
] as const;

export const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx)$/;
export const DTS_EXTENSION = /\.d\.(ts|tsx)$/;
