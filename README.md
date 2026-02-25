# autodocs-engine

Deterministic codebase intelligence for AI coding tools.

[![npm version](https://img.shields.io/npm/v/autodocs-engine)](https://www.npmjs.com/package/autodocs-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/autodocs-engine)](https://nodejs.org)

## What It Does

Analyzes TypeScript/JavaScript codebases and extracts actionable intelligence — commands, conventions, file coupling patterns, contribution recipes, architecture — that AI coding tools need to write code that fits your project.

Two ways to use it:

1. **MCP Server** — Live codebase queries via Model Context Protocol. AI tools ask for exactly the context they need, on demand.
2. **AGENTS.md Generator** — Static context file for universal compatibility. Works with every tool that reads AGENTS.md, CLAUDE.md, or .cursorrules.

## Quick Start

```bash
# Generate a focused AGENTS.md (no API key needed)
npx autodocs-engine init

# Or start the MCP server for live queries
npx autodocs-engine serve
```

### MCP Server Setup (Claude Code)

```bash
claude mcp add autodocs -- npx autodocs-engine serve
```

This gives Claude Code 13 codebase intelligence tools:

| Tool | What It Returns |
|------|----------------|
| `get_commands` | Build, test, lint commands with exact flags |
| `get_architecture` | Directory structure, entry points, package type |
| `get_conventions` | DO/DON'T rules with confidence levels (filterable by category) |
| `get_workflow_rules` | File coupling and co-change patterns (filterable by file) |
| `get_contribution_guide` | How to add new code, with inline example snippets |
| `get_exports` | Public API with usage examples and parameter shapes |
| `analyze_impact` | Blast radius + importers + co-change partners for a file |
| `list_packages` | Monorepo package inventory |
| `plan_change` | Full change plan: dependents, co-changes, registrations, tests, checklist |
| `get_test_info` | Test file path + exact per-file run command for any source file |
| `auto_register` | Exact code insertions for registration files + barrel updates |
| `review_changes` | Pattern compliance check: suffix, imports, registration, barrel, tests |
| **`diagnose`** | **Root cause analysis: traces test failures to suspect files via import graph, git co-change, and call graph** |

## Why Minimal Mode?

Research shows comprehensive context files can actually **hurt** AI performance:

- LLM-generated AGENTS.md: **-0.5% to -2%** accuracy ([arxiv 2602.11988](https://arxiv.org/abs/2602.11988))
- Developer-written focused AGENTS.md: **+4%** accuracy, **-29% runtime** ([arxiv 2601.20404](https://arxiv.org/abs/2601.20404))

The difference: developer-written files are short, focused, and only include what the AI can't figure out on its own. That's exactly what `--minimal` generates.

**Minimal mode** (~200-450 tokens) includes only:
- Exact commands with flags (proven to help, never hurts)
- Workflow rules from git co-change analysis (patterns the AI can't discover from code)
- High-confidence conventions (only if ≥95% consistent and non-obvious)
- Non-obvious directories (with "non-exhaustive" qualifier to prevent anchoring)

**Full mode** (~1,500-2,500 tokens) adds public API, dependency graphs, all conventions, and architecture details. Use `--full` when you need comprehensive documentation.

## How It Works

Unlike tools that dump code into an LLM or pack everything into one file, autodocs-engine uses deterministic static analysis:

1. **Parse** — AST analysis via TypeScript Compiler API
2. **Detect** — 9 convention detectors (naming, hooks, testing, import ordering, frameworks, etc.)
3. **Extract** — Commands from package.json, turbo.json, biome.json, and 10+ config formats
4. **Graph** — Call graph, import chains, and git co-change analysis (Jaccard similarity)
5. **Score** — Inferability scoring decides what's worth including vs. what the AI already knows
6. **Generate** — 14/16 sections are deterministic (no LLM). Only architecture summary and domain terms use optional micro-LLM calls.

**No API key needed** for minimal mode or JSON output. The analysis is pure computation.

## Output Formats

```bash
npx autodocs-engine init                         # Focused AGENTS.md (~300 tokens, no API key)
npx autodocs-engine init --full                  # Comprehensive AGENTS.md (needs API key)
npx autodocs-engine analyze . --format json      # Raw analysis JSON
npx autodocs-engine analyze . --format claude.md # CLAUDE.md format
npx autodocs-engine analyze . --format cursorrules # .cursorrules format
```

## Monorepo Support

Auto-detects workspace packages from `pnpm-workspace.yaml`, `workspaces` field in package.json, `turbo.json`, or `nx.json`:

```bash
npx autodocs-engine init    # Works for monorepos too
```

For explicit control:

```bash
npx autodocs-engine analyze packages/app packages/hooks packages/ui \
  --format agents.md --hierarchical --root .
```

## Staleness Detection

Check if your AGENTS.md needs updating (for CI):

```bash
npx autodocs-engine check
```

Returns exit code 1 if conventions have drifted. Useful in CI pipelines to keep context files honest.

## Tested On

| Repo | Files | Time | Token Count (minimal) |
|------|------:|-----:|:-----:|
| autodocs-engine | 115 | 450ms | ~443 |
| vitest | 1,200+ | 1.2s | ~307 |
| nitro | 469 | 220ms | ~121 |
| sanity | 3,746 | 1.6s | — |
| medusa | 720 | 316ms | — |

569 tests. Zero type errors. 13 MCP tools. Zero technology hallucinations across all tested repos.

## Library API

```typescript
import { analyze, generateMinimalAgentsMd } from 'autodocs-engine';

// Analyze (pure computation, no API key)
const analysis = await analyze({ packages: ['./packages/my-pkg'] });

// Generate minimal AGENTS.md (no API key)
const minimal = generateMinimalAgentsMd(analysis);

// Or use the full deterministic format (optional API key for 2 LLM sections)
import { formatDeterministic } from 'autodocs-engine';
const full = await formatDeterministic(analysis, config);
```

## Configuration

Optional `autodocs.config.json`:

```json
{
  "exclude": ["**/vendor/**", "**/generated/**"],
  "conventions": { "disable": ["telemetry-patterns"] }
}
```

Most options are auto-detected. Zero config is the default.

## CLI Reference

```
autodocs-engine init [--full]              Generate AGENTS.md (minimal by default, no API key)
autodocs-engine serve [path]               Start MCP server
autodocs-engine check                      Check if AGENTS.md needs regeneration
autodocs-engine analyze [paths...] [options]

Options:
  --full             Comprehensive output (requires ANTHROPIC_API_KEY)
  --minimal          Focused output (<500 tokens, no API key needed — default for init)
  --telemetry        Enable session telemetry (writes to ~/.autodocs/telemetry/)
  --format, -f       json | agents.md | claude.md | cursorrules
  --output, -o       Output directory (default: .)
  --root             Monorepo root directory
  --hierarchical     Root + per-package output
  --merge            Preserve human-written sections when regenerating
  --verbose, -v      Timing details
  --dry-run          Print to stdout (no file writes)
```

## Contributing

```bash
git clone https://github.com/msiric/autodocs-engine.git
cd autodocs-engine
npm install
npm test          # 569 tests
npm run typecheck # Zero errors
npm run build
```

## License

[MIT](LICENSE)
