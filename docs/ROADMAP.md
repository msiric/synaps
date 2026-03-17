# Roadmap

## Current State (v0.10.2, 2026-03-16)

**730 tests. 14 MCP tools. 13 convention detectors. Zero type errors.**

- **MCP server** — 14 tools with search, blast radius, co-change analysis, execution flows, diagnose, and next-step hints
- **Flagship tools**: `plan_change` (import graph + co-change + implicit coupling + registration checklist), `diagnose` (7-signal root cause analysis, 83% R@3 on unit-test repos), `search` (cross-data-source symbol/file/convention discovery)
- **PreToolUse/PostToolUse hooks** — Automatic search augmentation across 5 data sources when agents use Grep/Glob/Bash
- **CJS support** — CommonJS call graph edges (Fastify: 0→25 edges, 0→5 flows)
- **Type-aware analysis** — Opt-in `--type-checking` for resolved TypeScript parameter/return types
- **Minimal mode** (`--minimal`) — <500 token AGENTS.md matching developer-written file characteristics
- **Staleness detection** — `check` command for CI pipelines
- **Published on npm** — `npx synaps serve` / `npx synaps init`

### What was built (Sessions 1-5)

| Version | Key Features |
|---------|-------------|
| 0.1.0 | AST parsing, convention detection (9 detectors), command extraction, tier classification |
| 0.5.0 | MCP server (8 tools), git co-change mining (Jaccard), benchmark system, inferability scoring |
| 0.6.0 | plan_change, get_test_info, minimal mode, PR-based benchmark v2, MCP tool improvements |
| 0.7.0 | auto_register, review_changes (closed self-correction loop) |
| 0.8.0 | diagnose tool (5 scoring signals, call graph bonus) |
| 0.9.2 | Session telemetry, MCP integration tests, diagnose hardening, security hardening |
| 0.10.0 | Execution flows, symbol-level filtering, hooks, 4 new detectors (13 total), implicit coupling, type-aware analysis, diagnose v2 (7 signals, bi-modal decay, confidence assessment, 95-commit corpus) |
| 0.10.1 | CJS call graph support, lint cleanup |
| 0.10.2 | `search` tool (14th), `analyze_impact` enrichment (implicit coupling, clusters, git metadata), hook augmentation (5 data sources) |

### Dogfooding results (6 repos)

| Repo | Type | Files | Call Graph | Flows | Verdict |
|------|------|:-----:|:----------:|:-----:|---------|
| synaps | TS library | 140 | 93 | 10 | Excellent |
| knip | TS CLI monorepo | 881 | 370 | 21 | Excellent |
| valibot | TS validation lib | 1,043 | 345 | 22 | Excellent |
| ofetch | Small TS library | 10 | 8 | 0 | Correct (below threshold) |
| create-t3-app | Next.js template | 149 | 5 | 0 | Correct (template) |
| fastify | JS web framework | 252 | 25 | 5 | Good (after CJS fix) |

---

## Priorities

### 1. Get Users (Now)

The 6-model brainstorm was unanimous: ship and get real users. The engine has been feature-complete since v0.8.0; everything since then is refinement. Without users, we're optimizing in the dark.

- [ ] **Blog post**: "What We Learned Measuring AGENTS.md Effectiveness" — lead with negative findings (-2% for LLM-generated), pivot to MCP-first approach. Content is written in research docs; needs assembly.
- [ ] **HN launch**: Show HN with honest benchmark data (14/20 positive, 4 neutral, 2 negative)
- [ ] **GitHub Action** wrapping `check` command for drift detection — the clearest path to recurring value
- [ ] **Publish 0.10.2** — search tool + analyze_impact enrichment + hook improvements are committed but not yet on npm

### 2. Validate (Next, once users exist)

- [ ] Analyze telemetry — which tools get called? Infrastructure exists (`--telemetry` flag, JSONL logging to `~/.autodocs/telemetry/`)
- [ ] Measure retention — do users keep it in their workflow?
- [ ] Identify unused tools (candidates for removal or merging)
- [ ] Collect qualitative feedback — what's useful, what's missing, what's confusing?

### 3. Harden (Parallel with user feedback)

- [ ] **Test coverage** 730→1,000+ — Focus: query functions (`getCoChangesForFile`, `getImplicitCouplingForFile` have zero direct tests), hook edge cases, execution flow edge cases, new detectors
- [ ] **Diagnose accuracy** 47% R@3 → 60%+ — Expand 95-commit corpus to 200+, add callback/registration detection in scoring
- [ ] **Convention enforcement in CI** — `synaps check --conventions` command. Detects convention drift (new files violating established patterns). Every brainstorm model identified convention detection as the strongest technical moat.

### 4. Expand (Driven by user feedback)

- [ ] **MCP Resources** — Expose static data (package list, convention summary, cluster list) as MCP Resources instead of requiring tool calls. Cheaper for agents.
- [ ] **Evaluation harness** — Measure whether tools actually help agents succeed at real tasks (not just accuracy benchmarks)
- [ ] **Additional tools**: `check_registration(filePath)`, `get_dependency_path(fileA, fileB)`, `get_recent_changes(dir?, days?)`  — build only if usage data shows demand
- [ ] **HTTP transport** for MCP server (currently STDIO only)

### 5. Future (Large efforts, clear signals needed)

- [ ] **Language boundary extraction** — Extract `LanguageParser` interface from ast-parser.ts before adding new languages
- [ ] **Python support** — Tree-sitter parser (4-5 week effort, architecture 70% ready)
- [ ] **Session memory** — Learn project-specific workflow patterns over time
- [ ] **Rename/refactor tool** — Graph + text search coordinated multi-file rename (inspired by GitNexus)

---

## Decision Log

| Decision | Rationale | Date |
|----------|-----------|------|
| MCP server is the primary product | Static AGENTS.md can hurt (-2% per research). Dynamic, task-specific queries solve this. 6/6 brainstorm models agreed. | 2026-02-23 |
| Substring search over BM25 | 0.064ms per search on 947 items. BM25 indexing adds complexity for zero performance gain at our scale. | 2026-03-16 |
| Enhance `analyze_impact` over new `get_coupling` tool | `analyze_impact(scope: "cochanges")` already covers 80%. Added implicit coupling + clusters + metadata to existing tool. Follows adversarial advice: "stay at fewer tools." | 2026-03-16 |
| 14 tools (added `search`) | Search is fundamentally different from analysis — it enables discovery. Every other tool requires knowing a file/function already. GitNexus has `query` as a core tool (1 of 7). | 2026-03-16 |
| Co-change mining as key differentiator | GitNexus has zero git history analysis. No Jaccard, no co-change, no implicit coupling. This is our strongest unique signal. | 2026-03-16 |
| Spine-first BFS over fixed branching | GitNexus uses maxBranching=4 which truncates pipeline orchestrators (15+ callees). Spine-first traces the full primary chain. | 2026-03-15 |
| Deterministic output over LLM generation | LLM-generated context hurts -2% (arxiv 2602.11988). 13/15 output sections are code-generated. | 2026-02-23 |
| Minimal AGENTS.md as default | Research: focused files +4%, -29% runtime. Comprehensive files -2%. | 2026-02-23 |
| 5 production dependencies | No native bindings, no graph database, no WASM. Installs instantly. GitNexus has 21+ deps. | 2026-02-15 |

## Research Findings

The product direction is grounded in peer-reviewed research:
- Developer-written focused AGENTS.md: **+4% accuracy, -29% runtime** ([arxiv 2601.20404](https://arxiv.org/abs/2601.20404))
- LLM-generated comprehensive AGENTS.md: **-0.5% to -2%** ([arxiv 2602.11988](https://arxiv.org/abs/2602.11988))
- Only correctly-selected, curated summaries help; unfiltered context hurts ([arxiv 2602.08316](https://arxiv.org/abs/2602.08316))
- Graph-guided RCA improves accuracy 3.8x (PRAXIS paper — validates diagnose tool approach)

Full research synthesis: [docs/research/RESEARCH-CONTEXT-FILES-2026.md](research/RESEARCH-CONTEXT-FILES-2026.md)
