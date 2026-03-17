# Roadmap — synaps

Last updated: March 2026

## Where We Are

synaps is a TypeScript/JavaScript codebase intelligence engine with 13 MCP tools, 21K LOC, and 713 tests. It analyzes codebases via AST parsing + git history mining and serves intelligence to AI coding agents.

**Our differentiators vs competitors (GitNexus, Repomix, etc.):**
- Git co-change mining with Jaccard similarity — finds file coupling invisible to static analysis
- Implicit coupling detection — co-change pairs with no import relationship
- 13 convention detectors — error handling, async patterns, state management, API patterns
- Type-aware analysis — resolved TypeScript parameter/return types via ts.Program
- Symbol-level filtering — plan_change narrows 98 dependents to 25 for a specific symbol
- Validated diagnose tool — 95 bug-fix commits, 83% recall@3 on unit-test repos
- Co-change validated execution flows — flows scored by historical change correlation
- 5 production dependencies — no native bindings, no graph database, installs instantly

**What we shipped recently (not yet published or documented):**
- 4 new convention detectors (error handling, state management, async patterns, API patterns)
- Implicit coupling detection (pipeline-level)
- Type-aware analysis (opt-in --type-checking)
- Execution flow tracing (spine-first BFS with co-change confidence)
- Symbol-level filtering in plan_change
- Diagnose hardening (bi-modal decay, continuous weights, confidence assessment)
- Validation corpus (95 bug-fix commits across 10 repos)
- PreToolUse/PostToolUse hooks for Claude Code
- Next-step hints in all tool responses
- Confidence scores on all call graph and import chain edges
- Workspace auto-detection for monorepos
- Output completeness checks
- Adaptive git history mining (500→2000 commits)
- Security: SHA-256 cache hash, symlink-safe paths, ReDoS fixes

---

## Phase 1: Ship What We Built (Priority: NOW)

Everything below is complete in code but not published or documented.

### 1.1 Update Documentation
- [ ] Rewrite README.md to reflect current capabilities (13 tools, hooks, execution flows, symbol filtering)
- [ ] Update CLAUDE.md and AGENTS.md with new tool descriptions
- [ ] Document `--type-checking` flag
- [ ] Document `setup-hooks` command
- [ ] Document symbol-level filtering in plan_change
- [ ] Add CHANGELOG.md entries for all new features

### 1.2 Publish to npm
- [ ] Bump version (0.9.9 → 1.0.0 or 0.10.0 — decide based on breaking changes)
- [ ] Run full test suite on CI (Node 18/20/22 matrix)
- [ ] Verify npm publish includes hooks/ directory
- [ ] Test `npx synaps setup-hooks` after global install

### 1.3 Dogfood on Real Projects
- [ ] Run on 3 external repos (Express app, Next.js app, CLI tool)
- [ ] Verify hooks produce useful augmented context
- [ ] Verify execution flows make sense
- [ ] File bugs for anything broken

---

## Phase 2: Close the Gaps (Priority: HIGH)

Features where competitors are ahead and we should catch up.

### 2.1 Search Capability
**Why:** Without search, agents can't discover code — they can only analyze code they already know about. GitNexus has BM25 + semantic search. We have nothing.

**Approach:** BM25 full-text search over symbol names + file paths. No embeddings (YAGNI). New MCP tool: `search({ query: "authentication" })` returns matching functions, files, and their relationships.

**Effort:** Medium (new tool + index construction + query function)

### 2.2 Test Coverage Expansion
**Why:** 713 tests vs GitNexus's 1,146. Our hooks, execution flows, and new detectors need more edge case coverage.

**Approach:**
- Add more hook tests (Windows paths, concurrent calls, large snapshots)
- Add execution flow tests on real repo data (not just synthetic graphs)
- Add convention detector tests on 10+ real repos (false positive rate validation)

**Effort:** Medium (test-writing, no new features)

### 2.3 Evaluation Harness
**Why:** We validate algorithm accuracy (diagnose corpus) but don't measure whether our tools actually help agents succeed at real tasks.

**Approach:** Lightweight eval — not a full SWE-bench clone. Measure: does providing plan_change + conventions + diagnose help an agent make fewer multi-file mistakes? Test on 10 real modification tasks.

**Effort:** Large (framework + tasks + measurement + analysis)

---

## Phase 3: Deepen Our Advantage (Priority: MEDIUM)

Features that strengthen what's already unique about us.

### 3.1 Convention Enforcement in CI
**Why:** Our convention detectors are unique. A `check` command that fails CI when conventions drift is recurring value.

**Approach:** `synaps check --conventions` compares current conventions against a baseline. Reports new violations, drift, and regressions. GitHub Action wrapper.

**Effort:** Medium (baseline comparison logic + CI integration)

### 3.2 CommonJS Call Graph Support ✅ DONE
**Why:** Dogfooding on Fastify (255 JS files) produced 0 call graph edges. CJS `module.exports = { fn }` + `require('./mod').fn()` patterns don't get mapped by `buildCallGraph`, which relies on ESM export name matching.

**What was done:**
- Enhanced `mergeCJSPatterns` in `ast-parser.ts` to handle three CJS export patterns: `module.exports = { fn1, fn2 }` (named properties), `module.exports = identifier` (use identifier name), `exports.prop = value` (named export)
- Enhanced CJS import extraction: `const { x, y } = require('./mod')` now extracts destructured names as `importedNames`
- Added `scanStatement` helper in `extractCallReferences` to scan CJS-exported function bodies (no `export` keyword) for call references
- Result: Fastify 252 files → 25 call graph edges, 5 execution flows (was 0/0)

**Status:** Code complete, tests pass (713/713). Not yet committed or published.

### 3.3 Diagnose Accuracy Improvement
**Why:** 47% recall@3 overall, 83% on unit-test repos, 27% on integration-test repos. The corpus revealed that 100% of misses are files not in the import graph.

**Approach:**
- Expand corpus to 200+ commits across 20 repos
- Add callback/registration detection in AST parser (Express app.get handler → synthetic call edge)
- JSX component reference detection for React apps
- Test against corpus after each change

**Effort:** Large (AST parser changes + corpus expansion + validation)

### 3.3 Type-Aware plan_change
**Why:** Symbol-level filtering narrows 98→25 dependents. With resolved types, we could also show: "these files pass `Convention` to functions expecting `Convention & { impact: string }` — your type change will break them."

**Approach:** When `--type-checking` is enabled and `symbols` parameter is provided, resolve the type of each symbol and show type-level impact.

**Effort:** Large (TypeChecker integration with plan_change)

### 3.4 Co-Change Pattern Reporting
**Why:** We mine co-change data but only surface it in plan_change and diagnose. Developers would benefit from a dedicated "what files change together in this codebase?" view.

**Approach:** New MCP tool or resource: `get_coupling({ file: "src/types.ts" })` returns co-change partners sorted by Jaccard, with implicit coupling flagged. Could also show co-change clusters.

**Effort:** Small (query function exists, need tool wrapper + formatting)

---

## Phase 4: Expand Reach (Priority: LOWER)

Features that grow the addressable market.

### 4.0 Language Boundary Extraction (Prerequisite for any new language)
**Why:** The engine is deeply coupled to TypeScript/JavaScript at three levels: parser (ts.createSourceFile), data model (hasJSX, hasCJS, React hooks in ContentSignals), and detectors (all 13 detect TS/JS ecosystem patterns). Adding any new language without first extracting a clean boundary would require refactoring the pipeline.

**What's language-agnostic today (no changes needed):**
- Git history mining, implicit coupling, execution flows, impact radius
- Diagnose scoring, co-change confidence, plan_change, all MCP tools
- Hooks, output validator, workspace resolver

**What's TS/JS-coupled (needs abstraction):**
- `ast-parser.ts` → extract `LanguageParser` interface producing `ParsedFile`
- `ContentSignals` → split into universal signals (tryCatchCount, asyncFunctionCount) and language-specific (useMemoCount, jestMockCount, hasJSX)
- `convention-extractor.ts` → detectors registered per language, not globally
- `command-extractor.ts` → per-ecosystem (npm/pip/cargo/go)
- `dependency-analyzer.ts` → per-ecosystem
- `import-chain.ts` → per-language module resolution
- `SOURCE_EXTENSIONS` → per-language file patterns

**Approach:** Define `LanguageParser` interface + `LanguageDetectors` registry. Wrap existing TS/JS code behind these interfaces. Pipeline calls through the interface. No new language support in this step — just drawing the line.

**Effort:** Small-Medium (2-3 days, interface + wrapper + pipeline change)

**Audit summary (from coupling analysis):**
| Coupling Level | Files | What's Needed |
|---------------|-------|---------------|
| HARD (TypeScript Compiler API) | 5 files | New parser per language (Tree-sitter or native) |
| SOFT (TS/JS patterns) | 12 files | Language-specific implementations behind interface |
| NONE (language-agnostic) | 14 files | No changes ever |

### 4.1 Python Support
**Why:** Second most popular language for AI-assisted coding. GitNexus supports it; we don't.

**Prerequisite:** 4.0 (Language Boundary Extraction)

**Approach:** Tree-sitter for parsing, language-specific import resolver, convention detectors for Python patterns (PEP 8, type hints, decorator patterns, Django/Flask/FastAPI frameworks, pytest/unittest). Research already done (docs/research/).

**Components needed:**
- Parser: Tree-sitter Python → ParsedFile (~200 LOC)
- Import resolver: PEP 328 relative imports, `__init__.py`, PYTHONPATH (~150 LOC)
- Convention detectors: 6-8 Python-specific (Django, Flask, pytest, PEP 8, async, type hints) (~400 LOC)
- Command extractor: `pyproject.toml`, `setup.py`, `Makefile` (~100 LOC)
- Dependency analyzer: `requirements.txt`, `pyproject.toml`, `Pipfile` (~100 LOC)
- Config analyzer: `mypy.ini`, `pyproject.toml [tool.mypy]` (~80 LOC)
- Tests: All of the above (~500 LOC)

**Effort:** Large (4-5 weeks, ~1,500 LOC total)

**Trade-off vs GitNexus:** GitNexus uses Tree-sitter for all 13 languages with ~80% resolution accuracy. We'd use Tree-sitter for Python with our own convention detectors — aiming for ~90% accuracy with actionable convention detection (their gap).

### 4.2 Web UI for Exploration
**Why:** Visual exploration of the codebase graph helps developers understand architecture. GitNexus has a full React+Sigma.js UI.

**Approach:** Start minimal — a simple HTML page served by `synaps serve --web` that shows the import graph and execution flows. No React dependency.

**Effort:** Large (new frontend, even if minimal)

### 4.3 Persistent Storage
**Why:** Our in-memory analysis means re-analyzing on every MCP server start (1-2 seconds). GitNexus indexes once and queries forever via LadybugDB.

**Approach:** SQLite or JSON file cache with incremental updates. Only re-analyze files that changed since last analysis.

**Effort:** Large (cache invalidation, incremental pipeline)

### 4.4 Rename Tool
**Why:** GitNexus's multi-file rename using graph edges + text search is genuinely useful. We have the data (call graph + import chain) but no rename tool.

**Approach:** New MCP tool: `rename({ symbol: "oldName", newName: "newName", dryRun: true })`. Uses import chain + call graph to find all references, generates edit list.

**Effort:** Medium (graph traversal + text generation)

---

## Phase 5: Long-Term Vision (Priority: FUTURE)

### 5.1 Cross-Repo Intelligence
Analyze multiple related repos (monorepo packages, microservices) and show cross-repo dependencies, shared conventions, and coordinated change patterns.

### 5.2 Temporal Patterns
Track how conventions, coupling, and architecture change over time. "Your test coverage is declining" or "This module's coupling is increasing" as proactive alerts.

### 5.3 Learning from Agent Behavior
Track which MCP tools agents call, in what order, and whether the resulting code changes were correct. Use this to improve tool responses over time.

### 5.4 IDE Plugin
Native VS Code / JetBrains extension that shows autodocs intelligence inline — convention violations, coupling warnings, execution flow context — without requiring MCP.

---

## Decision Log

| Decision | Rationale | Date |
|----------|-----------|------|
| TypeScript/JavaScript only | Depth over breadth. Our unique signals (type resolution, convention detection) are TS/JS specific. | Feb 2026 |
| No graph database | 5 deps vs 28. In-memory analysis + disk cache snapshot is sufficient for TS/JS repo sizes. | Mar 2026 |
| Git co-change as core differentiator | No competitor mines commit history for file coupling. Validated on 95 bug-fix commits. | Mar 2026 |
| MCP server as primary product | Research shows static context files hurt on 30% of repos. Dynamic, task-specific queries are better. | Feb 2026 |
| Hooks via disk cache snapshot | MCP server writes JSON on analysis; hooks read it. No IPC, no daemon, <100ms response. | Mar 2026 |
| Spine-first BFS for execution flows | Fixed maxBranching=4 truncates pipeline orchestrators. Spine-first traces the full primary chain. | Mar 2026 |
| Diagnose confidence from signal quality | Not heuristic labels — computed from data richness and score discrimination. | Mar 2026 |
| Convention detection not Leiden clustering | Conventions are actionable ("use typed error subclasses"); clusters are descriptive ("Auth area"). | Mar 2026 |
| Language boundary before language support | Extract LanguageParser interface first (2-3 days), then add languages one at a time. Don't over-abstract upfront. | Mar 2026 |
| Tree-sitter for non-TS languages | TypeScript Compiler API gives 95% accuracy for TS/JS. Tree-sitter gives ~80% for other languages. Accept the trade-off per language. | Mar 2026 |
| CJS call graph fixed | Fastify 252 files: 0→25 call graph edges, 0→5 execution flows. Fix in ast-parser.ts mergeCJSPatterns + extractCallReferences. | Mar 2026 |

---

## Dogfooding Results (v0.10.0)

Tested on 5 external repos via published npm package + 1 self-analysis:

| Repo | Type | Files | Flows | Conventions | Implicit Coupling | Call Graph | Verdict |
|------|------|-------|-------|-------------|-------------------|------------|---------|
| synaps | TS library | 140 | 10 | 6 | 20 | 93 | Excellent |
| knip | TS CLI monorepo | 881 | 21 | 4 | 9 | 370 | Excellent |
| valibot | TS validation lib | 1,043 | 22 | 6 | 7 | 345 | Excellent |
| ofetch | Small TS library | 10 | 0 | 3 | 1 | 8 | Correct (below threshold) |
| create-t3-app | Next.js template | 149 | 0 | 6 | 0 | 5 | Correct (template, few calls) |
| fastify | JS web framework | 252 | 5 | 2 | 0 | 25 | Good — CJS fix applied |

**Bugs found and fixed during dogfooding:**
1. Hook augmentation only searched publicAPI — internal functions returned no context. Fixed by also searching call graph functions.
2. CJS call graph gap — Fastify (252 JS files) produced 0 call graph edges. Fixed by enhancing `mergeCJSPatterns` and `extractCallReferences` in ast-parser.ts. Now produces 25 edges and 5 execution flows.

**Key observations:**
- Engine excels on TypeScript repos with rich call graphs (20+ flows, meaningful coupling)
- Degrades gracefully on small repos and templates (no false positives)
- CJS-heavy JavaScript repos now produce meaningful call graphs after CJS fix (25 edges on Fastify)
- Convention detection accurate across all repos with zero false positives
- Workspace auto-detection works correctly on monorepos (4-6 packages found)

---

## Metrics to Track

| Metric | Current | Target | How to Measure |
|--------|---------|--------|---------------|
| Tests | 713 | 1,000+ | CI test count |
| Diagnose R@3 (unit-test repos) | 83% | 90%+ | Corpus validation |
| Diagnose R@3 (all repos) | 47% | 60%+ | Corpus expansion |
| Convention false positive rate | ~0% (5 repos tested) | <5% on 20 repos | Manual review |
| Execution flows per package | 10 (self) | 5-20 on 10 repos | Dogfooding |
| Hook augmentation latency | <100ms (design) | <200ms measured | Telemetry |
| npm weekly downloads | ~300 (last published) | 1,000+ | npm stats |
| MCP tool calls per session | Unknown | 5+ (target) | Session telemetry |

---

## What We're NOT Building

- **LLM-generated context files** — Research shows they hurt accuracy. Deterministic output only.
- **Paid/commercial tier** — MIT license, keep it open.
- **Custom LLM integration** — We serve data via MCP. The LLM integration is the agent's responsibility.
- **Browser extension** — MCP + hooks cover the agent use case. Browser extension is a different product.
- **Code generation** — We provide intelligence. The agent generates code.
