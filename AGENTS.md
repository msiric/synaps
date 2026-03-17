# synaps

CLI tool — Codebase intelligence engine for generating AI context files

## Tech Stack

node 18.18.0 | typescript 5.4.0 | zod 4.3.6 | vitest 2.0.0

- TypeScript 5.4 — satisfies keyword, const type parameters available
- Zod 4.3.6 — schema validation library

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build |
| `npm run test` | Test |
| `npm run test:watch` | Test (watch) |
| `npm run dev` | Start |
| `npm run typecheck` | package.json scripts.typecheck |

## Architecture

**Type:** cli
**Entry point:** `src/index.ts`

Key directories (non-exhaustive — explore the source tree for additional directories):

- **Feature: benchmark** (`src/benchmark/`, 12 files)
- **Feature: detectors** (`src/detectors/`, 8 files)
- **Feature: llm** (`src/llm/`): HierarchicalOutput
- **Feature: mcp** (`src/mcp/`, 5 files)
- **Feature: templates** (`src/templates/`, 3 files)

Plus 1 standard directories (src/, lib/, etc.) with conventional purposes.

## Workflow Rules

**After modifying source files**
Run `npm run test` to verify changes

**When modifying `src/types.ts`**
Also check: `src/analysis-builder.ts` (17 symbols), `src/mcp/queries.ts` (12 symbols), `src/ast-parser.ts` (8 symbols), and 12 more

**When modifying any of: `src/dependency-analyzer.ts`, `src/pipeline.ts`, `src/templates/agents-md.ts`, `src/types.ts`**
Check all files in this co-change cluster — they frequently change together

**When modifying any of: `src/convention-extractor.ts`, `src/detectors/build-tool.ts`, `src/detectors/data-fetching.ts`, `src/detectors/database.ts`, `src/detectors/web-framework.ts`**
Check all files in this co-change cluster — they frequently change together

**When modifying any of: `src/config.ts`, `src/index.ts`, `src/llm-adapter.ts`**
Check all files in this co-change cluster — they frequently change together

**When modifying `src/output-validator.ts`**
Also check: `test/wave2-improvements.test.ts` (co-changed in 100% of its commits), `src/dependency-analyzer.ts` (co-changed in 75% of its commits), `src/templates/agents-md.ts` (co-changed in 57% of its commits), and 1 more

**When modifying `src/llm/adapter.ts`**
Also check: `src/llm/hierarchical.ts` (co-changed in 100% of its commits), `src/llm/client.ts` (co-changed in 100% of its commits), `src/existing-docs.ts` (co-changed in 75% of its commits)

## How to Add New Code

### benchmark

Example: `src/benchmark/code-generator.ts`

1. Create `{name}.ts` in `src/benchmark/`
1. Add re-export to `src/index.ts`

### bin

Example: `src/bin/synaps.ts`

1. Create `{name}.ts` in `src/bin/`
1. Import `analyze, format, formatDeterministic, formatAsHierarchy, formatHierarchicalDeterministic` from `../index.js` (4/5 siblings)
1. Import `OutputFormat, StructuredAnalysis, ResolvedConfig` from `../types.js` (4/5 siblings)
1. Add re-export to `src/index.ts`

### Detector

Example: `src/detectors/build-tool.ts`

1. Create `{name}.ts` in `src/detectors/`
1. Import `Convention, ConventionDetector, DetectorContext, ParsedFile` from `../types.js` (8/8 siblings)
1. Import `buildConfidence, sourceParsedFiles` from `../convention-extractor.js` (8/8 siblings)
1. Export as `{name}Detector` (naming convention)
1. Register in `src/convention-extractor.ts`
1. Add re-export to `src/index.ts`

### llm

Example: `src/llm/hierarchical.ts`

1. Create `{name}.ts` in `src/llm/`
1. Import `StructuredAnalysis, ResolvedConfig, PackageAnalysis` from `../types.js` (4/5 siblings)
1. Add re-export to `src/index.ts`

### mcp

Example: `src/mcp/cache.ts`

1. Create `{name}.ts` in `src/mcp/`
1. Import `StructuredAnalysis, PackageAnalysis, CommandSet, PackageArchitecture, FileImportEdge` from `../types.js` (4/5 siblings)
1. Add re-export to `src/index.ts`

### Template

Example: `src/templates/agents-md.ts`

1. Create `{name}.ts` in `src/templates/`
1. Export as `{name}Template` (naming convention)
1. Register in `src/llm/template-selector.ts`
1. Add re-export to `src/index.ts`

## Key Dependencies

**External:**
- `node:path` (51 imports)
- `node:fs` (27 imports)
- `node:child_process` (6 imports)
- `typescript` (5 imports)
- `node:os` (2 imports)
- `picomatch` (1 imports)
- `@modelcontextprotocol/sdk` (1 imports)
- `zod` (1 imports)

## Change Impact

High-impact functions — changes to these affect many callers:

| Function | File | Callers | Impact |
|----------|------|--------:|--------|
| `callLLMWithRetry` | `src/llm/client.ts` | 14 | High — used by many modules |
| `buildConfidence` | `src/convention-extractor.ts` | 8 | High — used by many modules |
| `formatArchitectureFallback` | `src/deterministic-formatter.ts` | 6 | Moderate — multiple callers |
| `generateDeterministicAgentsMd` | `src/deterministic-formatter.ts` | 5 | Moderate — multiple callers |
| `extractReadmeContext` | `src/existing-docs.ts` | 5 | Moderate — multiple callers |

Complex functions — these call many other functions:

| Function | File | Calls | Complexity |
|----------|------|------:|------------|
| `formatHierarchicalDeterministic` | `src/index.ts` | 9 | Complex — many dependencies |
| `runPipeline` | `src/pipeline.ts` | 9 | Complex — many dependencies |
| `orchestrateBenchmark` | `src/benchmark/runner.ts` | 8 | Complex — many dependencies |

## Team Knowledge

_synaps detected these patterns but needs your input:_

- [ ] The codebase has 76 cross-file call relationships. Are there changes that require updating multiple files together?
- [ ] Are there CLI-specific behaviors, flags, or output formats that AI tools should know about?
- [ ] What's the contribution workflow? (branch naming, commit conventions, PR process, review requirements)
- [ ] Are there ordering requirements between commands? (e.g., build before test, lint before commit)
- [ ] What's the testing philosophy? (unit vs integration, what needs tests, coverage expectations)

_Replace the checkboxes above with your answers to help AI tools understand this project._
