# synaps

Codebase intelligence for AI coding agents. Analyzes TypeScript/JavaScript codebases and serves actionable intelligence via MCP.

[![npm version](https://img.shields.io/npm/v/synaps)](https://www.npmjs.com/package/synaps)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/synaps)](https://nodejs.org)

## What It Does

Gives AI coding agents deep understanding of your codebase — not just what files exist, but how they connect, what conventions to follow, and what breaks when you change something. Combines AST analysis, git history mining, and import graph intelligence to answer questions no other tool can:

- **"What files should I also check when modifying `src/types.ts`?"** → Import dependents, co-change partners from git history, implicit coupling (files that change together without import relationships), and affected execution flows.
- **"Which specific files import `Convention` from `src/types.ts`?"** → 25 files (not all 98 importers of the file — only the ones using that symbol).
- **"What caused this test failure?"** → Ranked suspect files with confidence assessment, validated on 95 real bug-fix commits across 10 repos.
- **"What patterns should I follow?"** → 13 convention detectors covering error handling, async patterns, state management, API patterns, hooks, testing, and more.

## Quick Start

```bash
# MCP server for Claude Code
claude mcp add autodocs -- npx synaps serve

# Install Claude Code hooks (automatic search augmentation)
npx synaps setup-hooks

# Or generate a focused AGENTS.md (no API key needed)
npx synaps init
```

## MCP Tools (16)

| Tool | What It Returns |
|------|----------------|
| `get_commands` | Build, test, lint commands with exact flags |
| `get_architecture` | Directory structure, entry points, execution flows |
| `get_conventions` | DO/DON'T rules from 13 detectors (error handling, async, state management, API patterns, hooks, testing, file naming, import ordering, frameworks, databases, data fetching, build tools) |
| `get_workflow_rules` | File coupling and co-change patterns |
| `get_contribution_guide` | How to add code, with inline examples and registration steps |
| `get_exports` | Public API with resolved TypeScript types (parameter types, return types) |
| `analyze_impact` | Blast radius: importers, callers, co-change partners, implicit coupling, co-change clusters, git history metadata |
| `plan_change` | Full change plan: dependents, co-changes, implicit coupling, execution flows, registration/barrel updates, tests. **With optional `symbols` parameter: narrows dependents to files importing specific symbols.** |
| `get_test_info` | Test file path + exact per-file run command |
| `auto_register` | Exact code insertions for registration + barrel updates |
| `review_changes` | Pattern compliance: suffix, imports, registration, barrel, tests |
| `diagnose` | Root cause analysis with confidence level (high/medium/low), import path traces, and 7 scoring signals |
| `search` | Find symbols, files, and conventions by name or concept — searches public API, internal functions, file paths, and conventions with call graph enrichment |
| `rename` | Find all references to a symbol for safe renaming — definition, imports, re-exports, call sites with checklist |
| `get_module_doc` | Structured per-directory documentation: files, exports, dependencies, dependents, call graph, flows, co-change partners, contribution patterns |
| `list_packages` | Monorepo package inventory |

Every tool response includes **next-step hints** guiding the agent to the logical next action.

### MCP Resources (5)

| Resource | URI | Content |
|----------|-----|---------|
| Conventions | `autodocs://conventions` | DO/DON'T rules from all detectors |
| Processes | `autodocs://processes` | Execution flows with confidence scores |
| Clusters | `autodocs://clusters` | Co-change file groups (cliques) |
| Packages | `autodocs://packages` | Package inventory with types and entry points |
| Schema | `autodocs://schema` | Analysis data model reference |

### MCP Prompts (2)

| Prompt | Description |
|--------|-------------|
| `analyze-impact` | Guided workflow: identify changed files → plan_change → check clusters → summarize blast radius |
| `onboard` | Guided workflow: commands → architecture → conventions → schema overview |

### Multi-Repo Support

Serve multiple repositories from a single MCP server:
```bash
claude mcp add autodocs -- npx synaps serve /path/to/repo1 /path/to/repo2
```
All tools accept an optional `repo` parameter. Single-repo usage is unchanged.

## What Makes It Different

### Git Co-Change Intelligence
Mines commit history using Jaccard similarity to find files that frequently change together. Produces workflow rules ("when modifying X, also check Y") and **implicit coupling** — file pairs that co-change but have no import relationship. This catches the "forgotten file" that static analysis misses.

### Convention Detection (13 Detectors)
Extracts real coding patterns from AST analysis, not configured rules:
- Error handling: custom error classes, Result/Either patterns, typed error hierarchies
- Async patterns: Promise.all usage, sequential-await-in-loops detection, AbortController
- State management: Redux, Zustand, Jotai, MobX, Signals, Context API (reports all, not just dominant)
- API patterns: Express, Fastify, Hono, NestJS, tRPC, GraphQL (framework-aware, not directory heuristics)
- Plus: hooks, testing, file naming, import ordering, web frameworks, databases, data fetching, build tools

### Symbol-Level Filtering
```
plan_change({ files: ["src/types.ts"], symbols: ["Convention"] })
```
Narrows 98 dependents to 25 — only files that actually import `Convention`. Every other tool shows all dependents regardless of which symbol you're changing.

### Type-Aware Analysis
Opt-in `--type-checking` creates a TypeScript Program for resolved parameter types and return types:
```
analyze(options: Partial<ResolvedConfig> & { packages: string[] }): Promise<StructuredAnalysis>
```
Not text extraction — actual TypeChecker resolution through re-export chains.

### Execution Flow Tracing
Detects execution paths from entry points through the call graph:
```
runPipeline → analyzePackage → buildSymbolGraph → computeImpactRadius (4 steps, 4 files)
```
Scored by co-change confidence — flows through files that frequently change together are higher confidence.

### Validated Diagnose Tool
Tested against **95 real bug-fix commits across 10 repos**:
- Unit-test repos: **83% recall@3** (root cause in top 3 suspects)
- All repos: **47% recall@3**, **33% precision@1**
- Confidence assessment based on signal quality and score discrimination

### Claude Code Hooks
```bash
npx synaps setup-hooks
```
Installs PreToolUse + PostToolUse hooks:
- **PreToolUse**: When you grep for "validateUser", automatically shows callers, co-change partners, and execution flows alongside results
- **PostToolUse**: After `git commit`, detects when analysis cache is stale

## Claude Code Setup

```bash
# Add MCP server
claude mcp add autodocs -- npx synaps serve

# Install hooks for automatic search augmentation
npx synaps setup-hooks
```

With `--type-checking` for resolved TypeScript types:
```bash
claude mcp add autodocs -- npx synaps serve --type-checking
```

## AGENTS.md Generation

For tools without MCP support:

```bash
npx synaps init                         # Focused (~300 tokens, no API key)
npx synaps init --full                  # Comprehensive (needs API key)
```

Research-backed: focused context files improve AI accuracy by +4% and reduce runtime by 29%. LLM-generated comprehensive files hurt by -2%.

## CLI Reference

```
synaps init [--full]                 Generate AGENTS.md
synaps serve [path] [options]        Start MCP server
synaps setup-hooks                   Install Claude Code hooks
synaps check                         Staleness detection for CI
synaps analyze [paths...] [options]  Analyze specific packages

Options:
  --type-checking    Enable resolved TypeScript types (requires tsconfig.json)
  --minimal          Focused output (<500 tokens, default for init)
  --full             Comprehensive output (requires ANTHROPIC_API_KEY)
  --format, -f       json | agents.md | claude.md | cursorrules
  --verbose, -v      Timing and analysis details
  --dry-run          Print to stdout (no file writes)
```

## How It Works

18-stage analysis pipeline:

1. **File Discovery** → git ls-files with .gitignore respect
2. **AST Parsing** → TypeScript Compiler API for exports, imports, call references
3. **Symbol Graph** → barrel resolution, re-export chains, call graph construction
4. **Import Chain** → file-to-file coupling with confidence scores
5. **Tier Classification** → public API (T1), internal (T2), test/generated (T3)
6. **Type Enrichment** → optional ts.Program for resolved parameter/return types
7. **Convention Extraction** → 13 detectors with structured confidence metrics
8. **Git History Mining** → co-change mining with Jaccard similarity, adaptive thresholds
9. **Implicit Coupling** → co-change pairs with no import relationship
10. **Execution Flow Tracing** → entry point scoring, spine-first BFS, co-change validation
11. **Impact Classification** → high/medium/low impact scoring on conventions
12. **Workspace Auto-Detection** → monorepo roots expand to workspace packages

5 production dependencies. No native bindings, no graph database, no WASM. Installs instantly.

## Stats

- 770 tests across 53 files
- 16 MCP tools + 5 resources + 2 prompts
- 13 convention detectors
- 95-commit diagnose validation corpus (10 repos)
- 10 execution flows detected on medium codebases
- Zero type errors, zero technology hallucinations

## Library API

```typescript
import { analyze, generateMinimalAgentsMd } from 'synaps';

const analysis = await analyze({
  packages: ['./'],
  typeChecking: true,  // optional: resolved TypeScript types
});

const agentsMd = generateMinimalAgentsMd(analysis);
```

## Contributing

```bash
git clone https://github.com/msiric/synaps.git
cd synaps
npm install
npm test          # 713 tests
npm run typecheck # Zero errors
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow.

## License

[MIT](LICENSE)
