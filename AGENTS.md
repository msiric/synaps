# autodocs-engine

CLI tool — Codebase intelligence engine for generating AI context files

## Tech Stack

node 18.18.0 | typescript 5.4.0 | vitest 2.0.0

- TypeScript 5.4 — satisfies keyword, const type parameters available

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build |
| `npm run test` | Test |
| `npm run test:watch` | Test (watch) |
| `npm run lint` | Lint |
| `npm run dev` | Start |
| `npm run typecheck` | package.json scripts.typecheck |

## Architecture

• Analyzes codebases to detect patterns and anti-patterns across multiple packages, deriving shared issues and classifying their impacts on the system

• Implements multiple specialized detectors that examine build tools, data fetching patterns, database usage, and file naming conventions with confidence scoring

• Processes and parses source files to extract structural information and build comprehensive analysis reports

• Generates hierarchical output formats with deterministic formatting for consistent documentation structure

• Provides command-line interface for initializing analysis workflows and executing cross-package examinations

• Combines detection results with confidence metrics to produce actionable insights about codebase architecture and potential improvements

## Workflow Rules

**After modifying source files**
Run `npm run test` to verify changes

**When modifying `src/types.ts`**
Also check: `src/analysis-builder.ts` (17 symbols), `src/ast-parser.ts` (8 symbols), `src/convention-extractor.ts` (7 symbols), and 9 more

## Domain Terminology

• **AGENTS.md files** - Documentation files that provide structured guidelines and context for AI coding assistants to understand project requirements, coding standards, and domain-specific knowledge.

• **Research-backed** - Documentation approaches validated through empirical studies on AI tool effectiveness and developer productivity metrics.

• **AI coding tools** - Automated programming assistants like GitHub Copilot, CodeT5, or similar machine learning models that generate or suggest code based on context.

## Public API

### Functions

- `analyze`: `(options: Partial<ResolvedConfig> & { packages: string[] }) => Promise<StructuredAnalysis>` — Analyze one or more packages and produce a StructuredAnalysis. This is the core intelligence engine  (5 imports)
- `validateOutput`: `(output: string, analysis: StructuredAnalysis | PackageAnalysis, format: "root" | "package-detail") => ValidationResult` — Validate LLM-generated output against structured analysis. Returns issues and a correction prompt if (4 imports)
- `validateBudget`: `(content: string) => BudgetReport` — Validate the instruction budget of generated content. Returns a report with rule count, budget usage (3 imports)
- `formatBudgetReport`: `(report: BudgetReport) => string` — Format budget report for verbose console output. (3 imports)
- `wrapWithDelimiters`: `(content: string) => string` — Wrap engine output in delimiters for first-time generation. (2 imports)
- `mergeWithExisting`: `(existingContent: string, newEngineContent: string, _warnings: Warning[]) => string` — Merge new engine output with an existing AGENTS.md file. Preserves human-written content outside the (2 imports)
- `fingerprintTopExports`: `(publicAPI: PublicAPIEntry[], packageDir: string, topN: number, warnings: Warning[]) => PatternFingerprint[]` — Fingerprint the top N public API exports by analyzing their function bodies. Returns fingerprints fo (2 imports)
- `diffAnalyses`: `(current: StructuredAnalysis, previous: StructuredAnalysis) => AnalysisDiff` — Compare two StructuredAnalysis snapshots and produce a diff report. Operates on the first package in (2 imports)
- `formatDeterministic`: `(analysis: StructuredAnalysis, config: Pick<ResolvedConfig, "output" | "llm">, rootDir?: string) => Promise<string>` — Format using deterministic code for 13 sections + micro-LLM for synthesis. Default mode for agents.m (2 imports)
- `formatHierarchicalDeterministic`: `(analysis: StructuredAnalysis, config: Pick<ResolvedConfig, "output" | "llm">) => Promise<import("./llm-adapter.js").Hie` — Format hierarchical output using deterministic code + micro-LLM for synthesis. Eliminates hallucinat (2 imports)
- `readExistingAgentsMd`: `(packageDir: string) => string | undefined` — Read existing AGENTS.md content, or return undefined if not found. (1 imports)
- `format`: `(analysis: StructuredAnalysis, config: Pick<ResolvedConfig, "output" | "llm">) => Promise<string>` — Format a StructuredAnalysis into a context file string. For "json" format, no LLM call is made. For  (1 imports)
- `formatAsHierarchy`: `(analysis: StructuredAnalysis, config: Pick<ResolvedConfig, "output" | "llm">) => Promise<import("./llm-adapter.js").Hie` — Format a StructuredAnalysis into hierarchical output: root AGENTS.md + per-package detail files. Onl (1 imports)

### Types

- `OutputFormat` (3 imports)
- `ConventionCategory` (1 imports)
- `PublicConfig` (1 imports)
- `SymbolKind` (1 imports)
- `RuleImpact` (1 imports)

### Interfaces

- `Warning` (25 imports)
- `Convention` (18 imports)
- `PackageAnalysis` (15 imports)
- `StructuredAnalysis` (14 imports)
- `ResolvedConfig` (7 imports)
- `DetectorContext` (7 imports)
- `PublicAPIEntry` (6 imports)
- `CommandSet` (5 imports)
- `DependencyInsights` (5 imports)
- `DirectoryInfo` (3 imports)
- `AntiPattern` (3 imports)
- `ConfigAnalysis` (3 imports)
- `CallGraphEdge` (3 imports)
- `ConventionConfidence` (2 imports)
- `PackageArchitecture` (2 imports)
- `CrossPackageAnalysis` (2 imports)
- `PackageDependency` (2 imports)
- `Command` (1 imports)
- `FileInventory` (1 imports)
- `DependencySummary` (1 imports)
- _...and 10 more interfaces_

### Consts

- `ENGINE_VERSION` (3 imports)

## Key Dependencies

**External:**
- `node:path` (35 imports)
- `node:fs` (20 imports)
- `typescript` (2 imports)
- `node:child_process` (1 imports)
- `picomatch` (1 imports)
- `node:os` (1 imports)

## Conventions

- **DO**: Source files use kebab-case naming convention (e.g., `analysis-builder.ts`)
- **DO**: Tests use Vitest (e.g., `24 test files`)
- **DO**: Tests use Vitest 2.0.0 (e.g., `24 test files detected`)

- **DON'T**: Do NOT use camelCase or PascalCase for filenames — 50 of 51 (98%) use kebab-case — the codebase exclusively uses kebab-case filenames

## Change Impact

High-impact functions — changes to these affect many callers:

| Function | File | Callers | Impact |
|----------|------|--------:|--------|
| `callLLMWithRetry` | `src/llm/client.ts` | 9 | High — used by many modules |
| `buildConfidence` | `src/convention-extractor.ts` | 8 | High — used by many modules |
| `formatArchitectureFallback` | `src/deterministic-formatter.ts` | 4 | Moderate — multiple callers |
| `serializeToMarkdown` | `src/llm/serializer.ts` | 4 | Moderate — multiple callers |
| `generateDeterministicAgentsMd` | `src/deterministic-formatter.ts` | 3 | Moderate — multiple callers |

Complex functions — these call many other functions:

| Function | File | Calls | Complexity |
|----------|------|------:|------------|
| `formatHierarchicalDeterministic` | `src/index.ts` | 7 | Complex — many dependencies |
| `runPipeline` | `src/pipeline.ts` | 7 | Complex — many dependencies |
| `formatDeterministic` | `src/index.ts` | 4 | Moderate complexity |

## Team Knowledge

_autodocs-engine detected these patterns but needs your input:_

- [ ] `src/detectors/` has 8 detectors files. What's the process for adding a new one?
- [ ] The codebase has 49 cross-file call relationships. Are there changes that require updating multiple files together?
- [ ] Are there CLI-specific behaviors, flags, or output formats that AI tools should know about?
- [ ] What's the contribution workflow? (branch naming, commit conventions, PR process, review requirements)
- [ ] Are there ordering requirements between commands? (e.g., build before test, lint before commit)
- [ ] What's the testing philosophy? (unit vs integration, what needs tests, coverage expectations)

_Replace the checkboxes above with your answers to help AI tools understand this project._
