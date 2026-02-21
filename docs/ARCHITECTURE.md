# Architecture

> autodocs-engine analyzes TypeScript/JavaScript codebases via AST parsing and generates lean AI context files (AGENTS.md, CLAUDE.md, .cursorrules) that AI coding tools follow.

## Pipeline

Analysis runs as a linear pipeline per package, then cross-package if multiple packages are provided.

### Per-Package Stages

| # | Stage | Module | Output |
|---|-------|--------|--------|
| 1 | File Discovery | `file-discovery.ts` | Sorted file list via `git ls-files` (or FS walk fallback) |
| 2 | AST Parsing | `ast-parser.ts` | `ParsedFile[]` — exports, imports, content signals, call refs |
| 3 | Symbol Graph | `symbol-graph.ts` | Barrel resolution, re-export chain following, cross-file call graph |
| 4 | Import Chain | `import-chain.ts` | File-to-file coupling from import graph (before symbol graph is discarded) |
| 5 | Tier Classification | `tier-classifier.ts` | Each file classified as T1 (public API), T2 (internal), T3 (test/generated) |
| 6 | Public API | `analysis-builder.ts` | `PublicAPIEntry[]` — ranked by kind priority + import count, capped |
| 7 | Config Analysis | `config-analyzer.ts` | TypeScript settings, build tool, linter, formatter, env vars |
| 8 | Dependency Analysis | `dependency-analyzer.ts` | Framework versions with guidance, runtime, test framework, bundler |
| 9 | Meta-Tool Detection | `meta-tool-detector.ts` | 3-signal cascade: peerDeps → dep-placement → family-count fallback |
| 10 | Convention Extraction | `convention-extractor.ts` | `Convention[]` via 8 detectors (file naming, hooks, testing, ecosystem) |
| 11 | Command Extraction | `command-extractor.ts` | `CommandSet` — build/test/lint/start with variants |
| 12 | Architecture Detection | `architecture-detector.ts` | Entry point, directory purposes, package type classification |
| 13 | Role Inference | `role-inferrer.ts` | Natural-language summary, purpose, "when to use" |
| 14 | Anti-Patterns | `anti-pattern-detector.ts` | "DO NOT" rules derived from strong conventions |
| 15 | Contribution Patterns | `contribution-patterns.ts` | Deep recipes: common imports, naming, registration detection |
| 16 | Impact Classification | `impact-classifier.ts` | Each convention/anti-pattern rated high/medium/low |
| 17 | Pattern Fingerprinting | `pattern-fingerprinter.ts` | Parameter shapes, return types, internal calls for top exports |
| 18 | Example Extraction | `example-extractor.ts` | Usage snippets from test files for public exports |

### Cross-Package (multi-package only)

| Module | Purpose |
|--------|---------|
| `cross-package.ts` | Dependency graph, shared/divergent conventions, shared anti-patterns |
| `command-extractor.ts` | Workspace-wide operational command scanning (db:\*, deploy:\*, etc.) |
| `workflow-rules.ts` | Technology-aware rules: "after schema change -> run db:generate" |
| `mermaid-generator.ts` | Mermaid dependency diagram with color-coded package types |

## Data Flow

```
PackagePath(s) + Config
        |
        v
  runPipeline(config)                              [src/pipeline.ts]
        |
        +-- per package --------------------------------+
        |   discoverFiles -> parseFile -> symbolGraph   |
        |   -> tiers -> publicAPI -> config -> deps     |
        |   -> conventions -> commands -> architecture  |
        |   -> role -> antiPatterns -> contributions    |
        |   -> impacts -> fingerprints -> examples      |
        |   = PackageAnalysis                           |
        +-----------------------------------------------+
        |
        +-- if multi-package: analyzeCrossPackage
        |   (dependency graph, shared conventions,
        |    workspace commands, workflow rules, mermaid)
        |
        v
  StructuredAnalysis (JSON)
        |
        +-- --format json -------> JSON.stringify()
        |
        +-- --format agents.md --> deterministic formatter  [13 sections in code]
        |                          + micro-LLM calls        [architecture + domain]
        |                          = assembleFinalOutput()
        |
        +-- --format claude.md --> full LLM with template
        +-- --format cursorrules -> full LLM with template
```

## Output Architecture

The default `agents.md` output uses a **70/30 deterministic model**:

- **13 sections generated in code** (zero hallucination by construction): title, summary, tech stack, commands table, package guide, workflow rules (technology + import-chain), how to add code (deep patterns), public API, dependencies, conventions, change impact (BFS), supported frameworks (meta-tools only), team knowledge prompts
- **3 sections synthesized by micro-LLM** with tightly-scoped inputs: architecture capabilities (directory names + exports + call graph), domain terminology (README first paragraph), contributing guidelines (CONTRIBUTING.md first 1000 chars)

For packages detected as meta-tools (via the 3-signal cascade), ecosystem conventions are reclassified at format time. Team Knowledge questions cross-reference against contribution patterns to skip redundant questions.

This architecture was adopted after benchmarking showed the full-LLM approach hallucinated technologies in 3/10 repos despite XML tags, temperature 0, and validation.

Legacy full-LLM mode is available via `--llm-synthesis full`.

## Module Inventory

| Module | Lines | Purpose |
|--------|------:|---------|
| `symbol-graph.ts` | 794 | Barrel resolution, re-export chains, cycle detection, call graph |
| `ast-parser.ts` | 777 | ESM + CJS export/import extraction, JSX, hooks, call references |
| `output-validator.ts` | 572 | Technology whitelist, version consistency, command verification |
| `deterministic-formatter.ts` | 561 | 13 AGENTS.md sections, assembly, architecture fallback |
| `types.ts` | 504 | All shared interfaces, constants, error classes |
| `config-analyzer.ts` | 426 | tsconfig, turbo, biome, eslint, prettier, justfile, env vars |
| `pipeline.ts` | 374 | Per-package orchestration, cross-package coordination |
| `analysis-builder.ts` | 342 | Public API ranking, file inventory, dependency summary |
| `command-extractor.ts` | 325 | Package manager detection, script resolution, workspace scan |
| `pattern-fingerprinter.ts` | 285 | Parameter/return shapes for top exports |
| `architecture-detector.ts` | 268 | Directory purposes, package type, file patterns |
| `bin/autodocs-engine.ts` | 264 | CLI entry point, arg parsing, file I/O |
| `dependency-analyzer.ts` | 263 | Framework versions, runtime detection, guidance |
| `config.ts` | 211 | Config file loading, CLI arg parsing, defaults |
| `meta-tool-detector.ts` | 175 | 3-signal cascade for analyzer/plugin package detection |
| `existing-docs.ts` | 250 | README + CONTRIBUTING.md extraction, merge mode, delimiter handling |
| `file-discovery.ts` | 190 | git ls-files, FS walk fallback, symlink handling |
| `role-inferrer.ts` | 173 | Domain signals, tech signals, role composition (prefers pkg description) |
| `contribution-patterns.ts` | 230 | Deep recipes: common imports, naming suffix, registration file detection |
| `workflow-rules.ts` | 158 | Technology-aware workflow rule generation |
| `import-chain.ts` | 120 | File-to-file coupling + "when modifying X → check Y" rules |
| `impact-radius.ts` | 160 | BFS on call graph for blast radius + complexity analysis |
| `example-extractor.ts` | 151 | Usage snippets from test files |
| `budget-validator.ts` | 150 | Rule counting, style rule detection, budget report |
| `plugin-loader.ts` | 134 | Plugin discovery and loading for custom detectors |
| `diff-analyzer.ts` | 134 | Snapshot comparison for CI-driven regeneration |
| `index.ts` | 134 | Library API: analyze(), format(), formatDeterministic() |
| `convention-extractor.ts` | 106 | Detector orchestration, plugin integration |
| `impact-classifier.ts` | 104 | Convention/anti-pattern impact rating |
| `cross-package.ts` | 100 | Multi-package convention merging, dependency graph |
| `anti-pattern-detector.ts` | 69 | "DO NOT" rule derivation from strong conventions |
| `mermaid-generator.ts` | 73 | Dependency diagram with package-type coloring |
| `tier-classifier.ts` | 36 | T1/T2/T3 file classification |
| **llm/** (5 files) | 886 | HTTP client, serializer, templates, hierarchical output |
| **detectors/** (8 files) | 718 | File naming, hooks, testing, data-fetching, database, web, build |
| **templates/** (3 files) | 402 | System prompts and format instructions per output format |
| **Total** | **~10,000** | |

## Type System

Core data hierarchy (see `src/types.ts`):

```
StructuredAnalysis
  +- meta: AnalysisMeta (engineVersion, analyzedAt, rootDir, config, timingMs)
  +- packages: PackageAnalysis[]
  |    +- name, version, description, relativePath
  |    +- files: FileInventory (total, byTier: {tier1, tier2, tier3}, byExtension)
  |    +- publicAPI: PublicAPIEntry[] (name, kind, signature, importCount)
  |    +- conventions: Convention[] (category, confidence, impact, examples)
  |    +- commands: CommandSet (packageManager, build, test, lint, start, other)
  |    +- architecture: PackageArchitecture (entryPoint, directories, packageType)
  |    +- dependencies: DependencySummary (internal, external with import counts)
  |    +- role: PackageRole (summary, purpose, whenToUse, inferredFrom)
  |    +- dependencyInsights: DependencyInsights (frameworks, runtime, testFramework)
  |    +- configAnalysis: ConfigAnalysis (typescript, buildTool, linter, formatter)
  |    +- antiPatterns, contributionPatterns, callGraph, patternFingerprints, examples
  +- crossPackage?: CrossPackageAnalysis
  |    +- dependencyGraph: PackageDependency[]
  |    +- sharedConventions, divergentConventions
  |    +- rootCommands, workspaceCommands, workflowRules
  |    +- mermaidDiagram
  +- warnings: Warning[] (level, module, message, file?)
```

## Key Design Decisions

1. **AST over regex.** Uses the TypeScript Compiler API (`ts.createSourceFile`) for parsing — not type-checking. Handles aliased exports, namespace re-exports, dynamic imports, mixed ESM/CJS, `.js->.ts` mapping, and circular re-export detection correctly. Fast even on large repos (<300ms for 400 files).

2. **Tiered file classification.** Files are T1 (exported from barrel / bin entry), T2 (internal), or T3 (test/generated noise). Only T1 files contribute to the public API section. Convention detectors filter to T1+T2 (no test files). This prevents output pollution.

3. **Deterministic-first output.** After discovering LLM formatting hallucinated in 3/10 benchmarks, 13 of 15 output sections were moved to code-based generation. The LLM receives narrowly-scoped data for the 2 synthesis sections and cannot hallucinate technologies because it never sees technology names.

4. **Structured convention confidence.** Every convention includes `{matched, total, percentage, description}` — not a vague label. Impact is classified as high/medium/low based on user research: commands and workflow rules are high, hooks patterns are medium, file naming style is low (linter's job).

5. **Monorepo scope isolation.** Per-package analysis reads ONLY the package's own `package.json` for dependencies. Root-level data (commands, build tools) flows through cross-package analysis, not into individual packages. Import-verified framework detection filters to frameworks actually imported by source files.
