# Session Handoff: synaps Development Session

## Date: 2026-02-22 to 2026-02-23
## Status: Ready for continued development

---

## What This Project Is

TypeScript codebase intelligence engine that generates AGENTS.md context files for AI coding tools (Claude Code, Cursor, Copilot). Analyzes code via AST parsing (18-stage pipeline) and produces deterministic output — conventions, commands, architecture, change impact, co-change patterns, contribution recipes.

**Version:** 0.5.0 (not yet published to npm)
**Tests:** 439 passing, 0 type errors
**Lines:** ~17K across 60+ modules
**Dependencies:** 5 production (typescript, mri, picomatch, @modelcontextprotocol/sdk, zod)

---

## What Was Built This Session

### 1. Git Co-change Analysis (`src/git-history.ts`)
Mines git log to identify file pairs that frequently change together. Uses Jaccard similarity with cluster detection, recency filtering (45-day window), hub-file exclusion, and large-commit filtering. Produces workflow rules: "When modifying X → also check Y."

### 2. Benchmark System (`src/benchmark/`)
A/B/C/N benchmark measuring whether AGENTS.md helps AI tools:
- A (Treatment): AGENTS.md + sibling source files
- B (Realistic Control): sibling source files only
- C (Impoverished): directory listing only
- N (Negative Control): shuffled AGENTS.md

Three task types: pattern adherence, command accuracy, architecture placement. 20 repos benchmarked with verified clean data.

### 3. MCP Server (`src/mcp/`)
Live codebase intelligence API via Model Context Protocol. 8 tools:
- get_commands, get_architecture, analyze_impact, get_workflow_rules (P0)
- list_packages (P0), get_contribution_guide, get_exports (P1)
- get_conventions (P2)

STDIO transport, eager background initialization, dirty-tree cache invalidation, typed errors, per-tool telemetry.

### 4. Inferability Score (`src/inferability.ts`)
Computes how "inferable" a repo's patterns are from source code alone. Used to gate which AGENTS.md sections to include. Factors: directory obviousness, naming consistency, pattern uniqueness, registration complexity.

### 5. Workspace Directory Filter (`src/contribution-patterns.ts`)
Filters out workspace-level directories (packages/, apps/, dev/) from contribution patterns. These directories contain subdirectories, not source files, and generate useless patterns that hurt AI performance.

---

## Benchmark Results (20 Repos, Post-Fix)

**Distribution: 14/20 positive (70%), 4/20 neutral (20%), 2/20 negative (10%)**

### Per-Type Averages
- Commands: +2.6% average (never hurts — safest section)
- Architecture: +20.2% average (highest value when available)
- Patterns: variable (+59% to -50% — repo-dependent)

### Key Results (Post workspace filter fix)
| Repo | Delta | Type |
|------|:---:|---|
| zod | +50.0% | Validation library |
| medusa | +41.5% | E-commerce API |
| Vercel AI | +29.3% | SDK monorepo |
| knip | +18.3% | CLI meta-tool |
| radix-ui | +16.5% | Component library |
| puppeteer | +14.8% | Browser automation |
| vitest | +13.2% | Testing framework |
| astro | +11.3% | Framework |
| sanity | +6.5% | CMS monorepo (was -19.8% before fix) |
| cal.com | +0.0% | Full-stack SaaS (was -17.8% before fix) |
| excalidraw | +0.0% | UI app (was -17.8% before fix) |
| nitro | **-20.0%** | Server framework (still negative) |
| mcp-sdk | **-8.5%** | SDK (still negative) |

Full data: `BENCHMARK-RESULTS-20-REPOS.md`

---

## Root Cause Analysis

### Why AGENTS.md hurts some repos (identified and mostly fixed)

**Primary cause (fixed):** Workspace-level directories (packages/, apps/, dev/) were generating useless contribution patterns. "Add a function to packages/" is nonsensical — packages/ contains entire npm packages. Fix: filter directories where >50% of files are deeply nested.

**Secondary cause (remaining, 2 repos):** For repos with standard, obvious structures (nitro, mcp-sdk), ANY AGENTS.md content adds token overhead that dilutes the source code signal. The AI performs better with LESS context. Even with pattern sections stripped (inferability rec=skip), the architecture/commands sections add ~200-400 tokens that don't provide novel information.

**Evidence from nitro:** On `pattern-src-config--import-ordering` task:
- A (AGENTS.md): 0% — AI generated nothing
- B (Source only): 100% — perfect placement
- C (Dir listing only): 100% — also perfect
- N (Shuffled): 0% — also failed

Both real and shuffled AGENTS.md caused failure. Source code alone was sufficient.

Root cause analysis: `BENCHMARK-ANALYSIS-ROOT-CAUSE.md`

---

## What's NOT Yet Done

### Remaining engine issues
1. **Nitro (-20%) and mcp-sdk (-8.5%)** still negative. For these repos, any AGENTS.md content is net-negative because their structures are fully discoverable from source. Options:
   - Accept the 10% negative rate and document it
   - Make "skip" recommendation suppress ALL AGENTS.md output (not just patterns)
   - Investigate if the benchmark itself is unfair to these repos

### Pre-launch items
1. **npm publish** — package.json is configured, tarball verified, but not published yet
2. **NEXT-STEPS.md** needs updating with post-fix findings
3. **Blog post** not written yet
4. **MCP server benchmark** — we proved accuracy (22 tests) but haven't measured whether MCP tools improve AI coding outcomes vs static AGENTS.md

### Deferred features (from roadmap)
- HTTP transport for MCP server
- Disk cache for analysis persistence
- Multi-language support (Python, Go)
- MCP tool response benchmark (inject tool response vs no tool response)
- Adaptive emission (use inferability score to dynamically choose output)

---

## Key Files

| File | Purpose |
|------|---------|
| `src/pipeline.ts` | 18-stage analysis orchestrator |
| `src/types.ts` | All shared types (500+ lines) |
| `src/deterministic-formatter.ts` | 16-section AGENTS.md output assembly |
| `src/mcp/server.ts` | MCP server factory + tool registration |
| `src/mcp/tools.ts` | 8 tool handler implementations |
| `src/mcp/cache.ts` | Analysis cache with dirty-tree detection |
| `src/git-history.ts` | Co-change analysis (Jaccard, clusters) |
| `src/inferability.ts` | Inferability scoring for adaptive output |
| `src/contribution-patterns.ts` | Pattern detection (with workspace filter) |
| `src/benchmark/` | Benchmark system (7 modules) |
| `BENCHMARK-RESULTS-20-REPOS.md` | Verified 20-repo benchmark data |
| `BENCHMARK-ANALYSIS-ROOT-CAUSE.md` | Root cause analysis of negative repos |
| `MCP-SERVER-PLAN.md` | MCP server design (v3, post-adversarial review) |
| `IMPROVEMENT-PLAN.md` | Engine improvement plan |
| `NEXT-STEPS.md` | Priority action items (needs updating) |

---

## Development Process Used

This session used a rigorous process:
1. **Build feature** with tests
2. **Benchmark** on real repos to measure impact
3. **Adversarial review** by 4-5 AI models before shipping critical features
4. **Iterate** based on data, not assumptions
5. **Document** everything transparently, including negative results

All adversarial review prompts and results are saved as .md files at the repo root.

---

## How to Resume

1. Read `AGENTS.md` (self-generated) for codebase overview
2. Read this file for session context
3. Read `BENCHMARK-RESULTS-20-REPOS.md` for current benchmark state
4. Read `BENCHMARK-ANALYSIS-ROOT-CAUSE.md` for root cause understanding
5. Run `npm test` to verify 439 tests pass
6. Run `npm run typecheck` to verify 0 type errors

The MCP server can be tested with:
```bash
claude mcp add --transport stdio autodocs -- npx tsx src/bin/synaps.ts serve
```

Benchmarks require an Anthropic API key:
```bash
ANTHROPIC_API_KEY=... npx tsx src/bin/synaps.ts benchmark . --quick
```
