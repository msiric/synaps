# autodocs-engine

Generate research-backed AGENTS.md files that AI coding tools actually follow.

[![npm version](https://img.shields.io/npm/v/autodocs-engine)](https://www.npmjs.com/package/autodocs-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/msiric/autodocs-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/msiric/autodocs-engine/actions)
[![Node.js](https://img.shields.io/node/v/autodocs-engine)](https://nodejs.org)

## Why

90% of engineering teams use AI coding tools. 65% say AI misses critical project context.

AGENTS.md files fix this — they tell AI tools your project's commands, conventions, and architecture up front. But today they're all hand-written, incomplete, and drift out of sync with the actual codebase.

autodocs-engine analyzes your TypeScript codebase and generates lean, prioritized context files. Based on [Vercel's research](https://vercel.com/blog/agents-md) showing that a single 8KB index file achieved 100% eval pass rates — outperforming detailed per-skill instructions — fewer, higher-quality rules beat comprehensive documentation.

## Quick Start

```bash
npx autodocs-engine init
```

That's it. Auto-detects your project structure (single package or monorepo), finds all workspace packages, and generates AGENTS.md. Zero flags required.

With an API key for richer output:

```bash
ANTHROPIC_API_KEY=sk-... npx autodocs-engine init
```

## What It Produces

**Hallucination-free output.** 14 of 16 AGENTS.md sections are generated deterministically from your code — no LLM involved, no fabricated technologies. Only the architecture summary and domain terminology use constrained micro-LLM calls.

**Root AGENTS.md (~80-120 lines):**
- Exact build/test/lint commands detected from your config files — not guessed
- Architecture described as capabilities, not file paths
- Workflow rules AI tools reliably follow (e.g., "Use Biome, not ESLint")
- Domain terminology AI can't infer from code alone
- Package guide for monorepos (which package to touch for what task)
- Supported frameworks section for meta-tools (Knip, ESLint configs, etc.)

**Per-package detail files** with public API surface, contribution patterns, and conventions split by impact level — what AI should follow vs. what linters already enforce.

## How It Works

Unlike tools that dump raw code into an LLM prompt, autodocs-engine uses a multi-stage pipeline:

1. **Parse** — Analyzes your codebase with the TypeScript Compiler API (AST parsing, not type checking — fast even on large repos)
2. **Classify** — Categorizes every file as Public API, Internal, or Generated noise
3. **Detect** — Finds conventions via 8 detectors (file naming, hooks, testing, data fetching, databases, web frameworks, build tools)
4. **Extract** — Pulls exact commands from package.json, lockfiles, and config files. Detects turbo.json, biome.json, tsconfig settings, and more
5. **Infer** — Determines package roles from export patterns, dependency graphs, and exact framework versions (e.g., "React 19 — use() hook available")
6. **Graph** — Builds a lightweight call graph tracking which exported functions call which
7. **Detect meta-tools** — Identifies packages that support multiple frameworks (like Knip, ESLint configs) and reclassifies their conventions
8. **Generate** — Produces a lean AGENTS.md with 14 deterministic sections + 2 micro-LLM synthesis sections

Analysis completes in under 2 seconds even for 3,700-file codebases. The LLM receives only narrowly-scoped data for the 2 synthesis sections — it literally cannot hallucinate technology names because it never sees them.

## Output Formats

| Format | Flag | Needs API Key? | Use Case |
|--------|------|---------------|----------|
| JSON | `--format json` (default) | No | CI pipelines, custom tooling |
| AGENTS.md | `--format agents.md` | Yes | Claude Code, Agentic tools |
| CLAUDE.md | `--format claude.md` | Yes | Claude Code (legacy format) |
| .cursorrules | `--format cursorrules` | Yes | Cursor IDE |

When `ANTHROPIC_API_KEY` is set and no `--format` is specified, defaults to `agents.md`.

## Multi-Package / Monorepo

For monorepos, `init` auto-detects workspace packages:

```bash
npx autodocs-engine init    # auto-detects from workspaces/pnpm-workspace.yaml
```

Or use `analyze` for explicit control:

```bash
npx autodocs-engine analyze packages/app packages/hooks packages/ui \
  --format agents.md --hierarchical --root .
```

Produces:
- **Root `AGENTS.md`** — Cross-package overview, dependency graph, workflow rules, shared conventions
- **Per-package detail files** — `packages/app.md`, `packages/hooks.md`, etc.

The root file stays lean. Package-specific detail lives in each package directory where AI tools discover it contextually.

## Tested On

| Repo | Stars | Files | Meta-Tool | Hallucinations | Time |
|------|------:|------:|-----------|---------------|------|
| [sanity-io/sanity](https://github.com/sanity-io/sanity) | 6K | 3,746 | No | None | 1.6s |
| [medusajs/medusa](https://github.com/medusajs/medusa) | 32K | 720 | No | None | 316ms |
| [vercel/ai](https://github.com/vercel/ai) | 22K | 355 | No | None | 331ms |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | 12K | 24 | No | None | 78ms |
| [webpro-nl/knip](https://github.com/webpro-nl/knip) | 10K | 2,427 | **Yes** (16 families) | None | 638ms |
| [unjs/nitro](https://github.com/unjs/nitro) | 10K | 469 | **Yes** (9 families) | None | 220ms |
| [openstatusHQ/openstatus](https://github.com/openstatusHQ/openstatus) | 8K | — | No | None | 5ms |
| [documenso/documenso](https://github.com/documenso/documenso) | 12K | 474 | No | None | 364ms |
| [Effect-TS/effect](https://github.com/Effect-TS/effect) | 13K | 958 | No | None | 1.0s |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | 117K | 386 | No | None | 406ms |

Zero technology hallucinations across all 10 repos. Zero false positives on meta-tool detection. Knip correctly identified as a meta-tool (16 framework ecosystems) with conventions reclassified to "Supported Frameworks."

## Configuration

Create an optional `autodocs.config.json` in your project root:

```json
{
  "exclude": ["**/vendor/**", "**/generated/**"],
  "maxPublicAPIEntries": 100,
  "conventions": {
    "disable": ["telemetry-patterns"]
  }
}
```

Most options are auto-detected. Zero config is the default and works well for the majority of projects.

## CLI Reference

```
autodocs-engine init                     Auto-detect and generate AGENTS.md
autodocs-engine analyze [paths...] [options]

Options:
  --format, -f         json | agents.md | claude.md | cursorrules
  --output, -o         Output directory (default: .)
  --config, -c         Path to config file
  --root               Monorepo root (for root-level command extraction)
  --hierarchical       Root + per-package output (default for multi-package)
  --flat               Single file even for multi-package
  --verbose, -v        Timing and budget validation details
  --merge              Preserve human-written sections when regenerating
  --no-meta-tool       Disable meta-tool detection
  --dry-run            Print analysis to stdout (no LLM, no file writes)
  --quiet, -q          Suppress warnings
```

## Library API

```typescript
import { analyze, formatDeterministic, formatHierarchicalDeterministic } from 'autodocs-engine';

// Step 1: Analyze (pure computation, no API key needed)
const analysis = await analyze({
  packages: ['./packages/my-pkg'],
  verbose: true,
});

// Step 2: Format as AGENTS.md (deterministic — recommended)
const agentsMd = await formatDeterministic(analysis, {
  output: { format: 'agents.md', dir: '.' },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});

// Step 2 (alt): Hierarchical output for monorepos
const hierarchy = await formatHierarchicalDeterministic(analysis, {
  output: { format: 'agents.md', dir: './output' },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});
// hierarchy.root — root AGENTS.md content
// hierarchy.packages — { filename, content }[]
```

All types are exported:

```typescript
import type {
  StructuredAnalysis,
  PackageAnalysis,
  Convention,
  CommandSet,
  PublicAPIEntry,
  CrossPackageAnalysis,
} from 'autodocs-engine';
```

## GitHub Action

Add to your workflow to get AGENTS.md analysis on every PR:

```yaml
# .github/workflows/autodocs.yml
name: AGENTS.md Analysis
on: [pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: msiric/autodocs-engine@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}  # optional
```

Posts a PR comment with detected commands, conventions, workflow rules, and public API summary. Updates the same comment on subsequent pushes (no spam).

## Backed by Research

This tool's design is informed by real-world research on AI context files:

- **[Vercel: AGENTS.md](https://vercel.com/blog/agents-md)** — An 8KB index file achieved 100% pass rate in agent evals, outperforming detailed per-skill instructions
- **[HumanLayer: Instruction Budget](https://humanlayer.dev/blog/agents-md)** — LLMs follow ~100-200 rules reliably; beyond that, compliance drops
- **[Builder.io: What AI Actually Follows](https://www.builder.io/blog/cursor-tips)** — Commands and concrete patterns outperform style guidelines

The engine enforces these findings: lean output, prioritized by impact, within the instruction budget.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

```bash
git clone https://github.com/msiric/autodocs-engine.git
cd autodocs-engine
npm install
npm test          # Run all 412+ tests
npm run typecheck # Type check
npm run build     # Build
```

## License

[MIT](LICENSE)
