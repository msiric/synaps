# synaps

Codebase intelligence engine for AI coding tools

## Commands

Standard `npm` scripts — see `package.json` for details.

## Workflow Rules

- For linting and formatting → Use Biome (`npm run lint`), NOT ESLint or Prettier — they are not configured
- After modifying source files → Run `npm run test` to verify changes
- When modifying `src/types.ts` → Also check: `src/analysis-builder.ts` (17 symbols), `src/mcp/queries.ts` (13 symbols), `src/ast-parser.ts` (8 symbols), and 11 more
- When modifying `src/mcp/queries.ts` → Also check: `src/mcp/tools.ts` (co-changed in 44% of commits)
- When modifying `src/pipeline.ts` → Also check: `src/types.ts` (co-changed in 43% of commits)
- When modifying `src/bin/synaps.ts` → Also check: `src/config.ts` (co-changed in 64% of its commits), `src/index.ts` (co-changed in 57% of its commits)
- Never add Co-Authored-By or any AI attribution to git commits

## Conventions

- **DO**: Tests use Vitest (53 test files, 770 tests)
- **DO**: Use kebab-case for filenames (99% consistency)
- **DO**: Import Node builtins with `node:` protocol (e.g., `node:fs`, `node:path`)
- **DO**: Use typed error subclasses (ToolError, FileNotFoundError, LLMError)
- **DON'T**: Do NOT use camelCase or PascalCase for filenames
- **DON'T**: Do NOT use inline `new Error()` for domain errors — use typed error subclasses

## Key Directories (non-exhaustive)

- `src/benchmark/` — Feature: benchmark framework (A/B testing, PR-based, scoring)
- `src/detectors/` — Feature: 13 convention detectors (error-handling, async-patterns, state-management, api-patterns, + 9 more)
- `src/llm/` — Feature: LLM adapter, serializer, templates
- `src/mcp/` — Feature: MCP server (16 tools + 5 resources + 2 prompts), queries, cache, hooks
- `src/templates/` — Feature: AGENTS.md, CLAUDE.md, cursorrules templates
- `hooks/` — Claude Code PreToolUse/PostToolUse hook scripts
- `test/fixtures/diagnose-corpus/` — 95 bug-fix commits across 10 repos for diagnose validation

> **Example**: See `src/detectors/build-tool.ts` for the canonical detector pattern (register in `src/convention-extractor.ts`).

## Architecture

18-stage pipeline → StructuredAnalysis → MCP tools (16) + resources (5) + prompts (2) or AGENTS.md

Key modules:
- `src/pipeline.ts` — 18-stage orchestrator
- `src/execution-flow.ts` — Spine-first BFS execution flow tracing
- `src/implicit-coupling.ts` — Co-change × import graph cross-referencing
- `src/type-resolver.ts` + `src/type-enricher.ts` — Opt-in TypeScript type resolution
- `src/mcp/queries.ts` — Data access layer (all MCP tools query through this)
- `src/mcp/tools.ts` — 16 tool handlers with next-step hints
- `src/mcp/server.ts` — Tool/resource/prompt registration, multi-repo cache registry
- `src/git-history.ts` — Co-change mining with Jaccard similarity
