# Session Handoff 3: synaps (2026-02-24)

## What This Project Is

TypeScript codebase intelligence engine that serves live queries via MCP (Model Context Protocol). Published on npm as `synaps` (v0.7.3). Analyzes codebases via AST parsing and provides 12 MCP tools for AI coding assistants.

**Status:** 506 tests, 0 type errors, published on npm, MCP server working with Claude Code.

---

## What Was Built This Session

### 1. Minimal Mode (`--minimal`)
- <500 token AGENTS.md output matching developer-written file characteristics
- Boolean signal gates (not uncalibrated weighted scores)
- Commands capped at 6 with triviality check, conventions require ≥95% confidence
- Kill switch: "Standard project" note when output would be mostly inferrable
- No API key needed — 100% deterministic

### 2. PR-Based Benchmark v2
- 4 new modules: pr-miner.ts, pr-task-gen.ts, pr-scorer.ts, pr-runner.ts (38 tests)
- Mines real git commits as ground truth (eliminates v1 circularity)
- Time-travel reads via `git show` (no HEAD contamination)
- File placement as primary metric
- Piloted on 3 repos: synaps (+0%), nitro (-8.3%), vitest (+0%)
- Key finding: file placement is at ceiling (77% ties), barrel updates showed positive signal

### 3. MCP Server Expansion (8 → 12 tools)
- **`plan_change(files)`** — Full change plan: dependents + co-changes + registrations + tests + checklist
- **`get_test_info(filePath)`** — Test file mapping + per-file run command
- **`auto_register(newFilePath)`** — Exact code insertions for registration + barrel updates
- **`review_changes(files)`** — 5-check pattern compliance (suffix, imports, registration, barrel, test)

### 4. MCP Tool Improvements (Phase 1)
- `analyze_impact` — Blast radius summary at top of response
- `get_conventions` — Confidence percentages + strength labels
- `get_contribution_guide` — Inline 15-line example code snippets
- `get_exports` — Top usage example + parameter shapes (merged get_examples data)
- All tools — Freshness metadata footer (analyzed timestamp, commit SHA, fresh/stale)

### 5. Inferability Calibration
- Floor rule: if directoryObviousness < 40, never recommend "skip"
- Calibrated against 3 repos with known benchmark deltas (all correct after fix)
- Path-scoped MCP filters: category on conventions, filePath on workflow rules

### 6. Dogfooding (7 bugs found and fixed)
1. Import chain ≥5 threshold hiding real dependencies → lowered to ≥1
2. plan_change registration leak from unrelated directories → directory check
3. Test resolution missed test/ flattened pattern → 10 candidate patterns
4. Test resolution missed export-suffix naming → suffix-aware candidates
5. Import ordering detector confidence >100% → fixed double-counting
6. Barrel false positive on CLI entry points → verify re-exports exist
7. Always generating .js in barrel re-exports → detect project's extension convention

### 7. New Import Ordering Detector
- 9th convention detector, detects builtins-first + external-before-local patterns
- Tested end-to-end using our own MCP tools (dogfooding)

---

## Current MCP Tool List (12 tools)

| # | Tool | Purpose |
|---|------|---------|
| 1 | get_commands | Build/test/lint commands with exact flags |
| 2 | get_architecture | Directory structure, entry points |
| 3 | get_conventions | DO/DON'T rules with confidence levels (filterable by category) |
| 4 | get_workflow_rules | File coupling and co-change patterns (filterable by file) |
| 5 | get_contribution_guide | How to add new code, with inline example snippets |
| 6 | get_exports | Public API with usage examples and parameter shapes |
| 7 | analyze_impact | Blast radius + importers + co-change partners |
| 8 | list_packages | Monorepo package inventory |
| 9 | plan_change | Full change plan: dependents, co-changes, registrations, tests, checklist |
| 10 | get_test_info | Test file path + exact per-file run command |
| 11 | auto_register | Exact code insertions for registration files + barrel updates |
| 12 | review_changes | Pattern compliance check: suffix, imports, registration, barrel, tests |

---

## Strategic Direction

### Consensus from 6-model brainstorm + adversarial reviews:
1. **MCP server = primary product** (task-specific, on-demand context)
2. **Static AGENTS.md = compatibility export** (not the headline)
3. **Publish honest benchmark data as marketing** (credibility > hype)
4. **Dogfooding > benchmarking** (7 bugs found in 2 sessions vs 0 from 500+ unit tests)

### Research (Feb 2026):
- "Evaluating AGENTS.md" (2602.11988): LLM-generated context hurts (-2%), developer-written helps (+4%)
- "AGENTS.md Efficiency" (2601.20404): Focused real files reduce runtime by 29%
- Full synthesis: docs/research/RESEARCH-CONTEXT-FILES-2026.md

---

## What's Next: `diagnose` Tool (READY TO BUILD)

Backward tracing from test failures/errors to likely root cause. Two rounds of adversarial review completed (10 reviews total). Implementation plan finalized.

### Key Design Decisions (All Reviewed):
- **Exponential decay** for recency: λ=0.05, half-life ~14 hours
- **Missing co-change** as killer signal (35% weight): finds files that SHOULD have changed but didn't
- **Minimum co-change threshold**: ≥5 co-changes before activating missing co-change signal
- **Call graph bonus**: 1.5x multiplier excluding the error site itself
- **4 error parsers**: V8, TypeScript compiler, Vitest, generic fallback
- **Dynamic weights**: recency-dominant when recent changes exist, coupling-dominant when not
- **Uncommitted changes**: `git diff --name-only` as primary recency signal (hoursAgo = 0)
- **Config file detection**: tsconfig.json, package.json, .env changes
- **Flaky test heuristic**: no changes + timeout/network patterns → warning

### Implementation State:
- Plan: docs/plans/DIAGNOSE-TOOL-PLAN-V2.md
- Review synthesis: docs/research/DIAGNOSE-V2-REVIEW-SYNTHESIS.md
- **Partial implementation stashed**: `git stash` contains queries.ts with parseErrorText, getRecentFileChanges, traceImportChain, buildSuspectList (all 4 query functions). Run `git stash pop` to restore.
- Remaining: handleDiagnose in tools.ts, server registration, tests, docs update

### Files to Modify:
| File | Changes |
|------|---------|
| src/mcp/queries.ts | 4 new functions (partially implemented, in stash) |
| src/mcp/tools.ts | handleDiagnose (~120 lines) |
| src/mcp/server.ts | Register diagnose tool (~25 lines) |
| test/diagnose.test.ts | Tests (~200 lines) |
| README.md + CHANGELOG.md | Update docs |

---

## After `diagnose`: Remaining Roadmap

1. **Efficiency measurement** — Instrument MCP tool usage to measure token/time savings
2. **Blog post + launch** — Honest benchmark data + research citations (content is all written)
3. **GitHub Action** — Wraps `check` command for CI drift detection
4. **Python support** — Tree-sitter, 4-5 week effort, architecture 70% ready (docs/research has full analysis)

---

## Key Files

| File | Purpose |
|------|---------|
| src/mcp/tools.ts | 12 tool handlers |
| src/mcp/queries.ts | Data access layer + test resolution + registration insertions |
| src/mcp/server.ts | Tool registration with schemas + descriptions |
| src/mcp/cache.ts | Analysis cache with dirty-tree detection + freshness metadata |
| src/deterministic-formatter.ts | 16-section full output + minimal mode |
| src/pipeline.ts | 18-stage analysis orchestrator |
| src/import-chain.ts | File-to-file import coupling (threshold=1 for all edges) |
| src/inferability.ts | Inferability scoring with calibrated floor rule |
| src/detectors/import-ordering.ts | Newest detector (import ordering patterns) |
| src/convention-extractor.ts | Convention detection orchestrator + detector registry |

---

## Conventions

- kebab-case filenames (99%)
- Vitest for testing
- `buildConfidence()` shared across detectors
- Docs update in same commit as features, before publish
- Dogfooding > benchmarking
- Adversarial review process: save plan as .md, create review prompt, feed to 4-6 models, synthesize
