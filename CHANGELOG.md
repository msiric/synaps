# Changelog

## 0.9.2 (2026-02-25)

### Improvements

- **`init` defaults to minimal** — `npx autodocs-engine init` now produces focused AGENTS.md (~300 tokens, no API key). Use `--full` for comprehensive output. Research-backed: focused files improve AI performance by 4% and reduce runtime by 29%.
- **Session telemetry** — Opt-in per-call JSONL logging (`--telemetry` or `AUTODOCS_TELEMETRY=1`). Session summary on stderr at shutdown. Writes to `~/.autodocs/telemetry/`.
- **MCP integration tests** — Real ESM server process over JSON-RPC stdio, verifying all 13 tools work in production.
- **Diagnose hardening** — Broader error parsing (any relative path, not just `src/`), empirical validation (83% hit rate on real bug-fix commits), adaptive co-change thresholds for young repos.
- **Security hardening** — `execSync` → `execFileSync` with argument arrays, `safeReadFile` with path boundary validation, 100KB cap on `parseErrorText` input.
- **Agent readiness 89%** — Biome (lint+format), Husky pre-commit hooks, CodeQL, Dependabot, knip dead code detection, coverage config, CONTRIBUTING.md, SECURITY.md, CLAUDE.md, CODEOWNERS.
- **Pattern matching fix** — `findBestPattern` sorts by directory specificity. Registration falls back to parent pattern while preserving child's export suffix.
- **ESM fix** — `require("typescript")` → proper `import` (was silently broken in MCP server since v0.7.0).

### Stats

- 569 tests, 0 type errors, 0 Biome lint errors, 13 MCP tools
- 89% agent readiness (31/35 checks)
- 83% diagnose accuracy on real bug-fix commits

## 0.8.0 (2026-02-24)

### New MCP Tool

- **`diagnose`** — Root cause analysis for test failures. Paste a stack trace, point at a file, or name a failing test — and get ranked suspect files with structural evidence the AI cannot derive from reading error text alone.

  **How it works:** Collects candidates from the import graph (upstream dependencies + downstream dependents) and git co-change partners of the error site. Scores each with 5 signals using dynamic weights, then applies a call graph bonus:

  | Signal | What It Captures |
  |--------|-----------------|
  | Missing co-change (35%) | File that usually co-changes with a recently modified file but wasn't updated |
  | Recency (25%) | Recently modified files (exponential decay, ~14h half-life) |
  | Coupling (20%) | Jaccard co-change score from git history |
  | Dependency (10%) | Import graph proximity (shared symbols) |
  | Workflow (10%) | Workflow rule matches |

  Plus 1.5x call graph multiplier for suspects with direct call edges to the error site (excluding the error site itself to avoid circular boosting).

  The output includes: ranked suspect list with per-signal reasons, dependency chain from test to top suspect, configuration file changes, flaky test detection (timeout/network patterns with no code changes), recently-added-test detection, at-risk tests, and a `plan_change` next-step suggestion.

  Designed to break the "fix loop" where AI tools guess at fixes from error text, break something else, and spiral. Validated by PRAXIS paper (graph-guided RCA improves accuracy 3.8x) and 2 rounds of adversarial review (10 reviews, 5 models).

### Stats

- 538 tests, 0 type errors, 13 MCP tools
- 9 convention detectors

## 0.7.0 (2026-02-24)

### New MCP Tools

- **`auto_register`** — Given a newly created file, generates exact code insertions for registration files and barrel/index updates. Returns line numbers and import/export statements the AI can apply directly. Solves the #1 failure mode: "created the file but forgot to wire it up."

- **`review_changes`** — Pattern compliance checker. Given files the AI generated, checks 5 things: export naming suffix, common imports, registration status, barrel exports, and test file existence. Returns pass/fail per check. Scoped to project-specific conventions that no linter catches.

Together these create a closed self-correction loop: the AI creates code → review_changes catches violations → auto_register generates the exact fixes.

## 0.6.0 (2026-02-24)

### New MCP Tools

- **`plan_change`** — The flagship tool. Given files being edited, returns full blast radius: dependent files (import graph), co-change partners (git history), registration/barrel files that need updating, corresponding test files, and an ordered checklist. Provides information AI tools literally cannot get from reading source code alone.

- **`get_test_info`** — Maps any source file to its corresponding test file with the exact per-file run command. Detects vitest, jest, mocha, ava. Tries co-located tests, spec variants, and test/ directory mirrors.

### MCP Tool Improvements

- **`analyze_impact`** — Now shows blast radius summary at the top ("Medium — 8 direct importers, 3 co-change partners")
- **`get_conventions`** — Shows confidence percentages and strength labels (strong ≥95%, moderate ≥80%, weak)
- **`get_exports`** — Includes top usage example from test files + parameter shapes from pattern fingerprints
- **`get_contribution_guide`** — Inlines first 15 lines of example file as code snippet
- **All tools** — Freshness metadata appended (analyzed timestamp, commit SHA, fresh/stale indicator)
- **`get_conventions`** — Filterable by category (file-naming, hooks, testing, ecosystem)
- **`get_workflow_rules`** — Filterable by filePath (only rules mentioning that file)

### Minimal Mode

- **`--minimal` flag** — Generates <500 token AGENTS.md matching developer-written file characteristics. No API key needed. Research-backed: comprehensive files hurt (-2%); focused files help (+4%, -29% runtime).
- Boolean signal gates instead of uncalibrated weighted scores
- Commands capped at 6 with triviality check
- Conventions require ≥95% confidence
- Kill switch: "Standard project" note when output would be mostly inferrable

### Other

- Inferability thresholds calibrated against 20-repo benchmark dataset
- MCP handshake fix for large repos (deferred cache warmup prevents timeout)
- PR-based benchmark v2 with real commit ground truth
- Repo cleaned up: 30 planning docs moved to docs/ subdirectories
- 501 tests, 0 type errors, 10 MCP tools

## 0.5.0 (2026-02-22)

### Major Features

- **MCP Server** — Live codebase intelligence API via Model Context Protocol. Run `npx autodocs-engine serve` to expose 8 tools that AI coding tools (Claude Code, Cursor) query on demand. Tools: get_commands, get_architecture, analyze_impact, get_workflow_rules, list_packages, get_contribution_guide, get_exports, get_conventions. Hardened through 2 rounds of adversarial review (10 reviews total).

- **Git Co-change Analysis** — Mines git history to identify file pairs that frequently change together. Uses Jaccard similarity with cluster detection, recency filtering, hub-file exclusion, and large-commit filtering. Produces workflow rules: "When modifying src/types.ts → also check src/pipeline.ts (co-changed in 56% of commits)."

- **Benchmark System** — A/B/C/N benchmark measuring whether AGENTS.md actually helps AI tools. Four conditions: Treatment (AGENTS.md + source), Realistic control (source only), Impoverished (dir listing only), Negative (shuffled AGENTS.md). Results across 3 repos: Commands +16.7%, Architecture +18.8%, Patterns +6.4%.

- **CONTRIBUTING.md Extraction** — Micro-LLM extracts 4-6 workflow rules from CONTRIBUTING.md files.

- **Staleness Detection** — `autodocs-engine check` command compares current analysis against baseline. `--save-baseline` creates baseline, exit code 1 if stale. For CI integration.

### MCP Server Details

- 8 tools with "WHEN TO CALL / DO NOT CALL" descriptions for AI tool selection
- Eager background initialization — analysis starts on server startup, first tool call is fast
- Cache invalidation: composite key (git HEAD + hash of git status output) catches committed, uncommitted, staged, and untracked changes
- Non-git fallback: 15-second TTL-based re-analysis
- Singleton promise: prevents concurrent duplicate analyses
- Typed errors with codes + recovery hints
- Per-tool-call telemetry logging (opt-in via --verbose or AUTODOCS_DEBUG=1)
- Monorepo support: list_packages tool + packagePath parameter on all tools

### Benchmark Details

- Multi-task-type support: pattern tasks, command tasks, architecture tasks
- Deterministic scoring via AST parsing (no LLM-as-judge)
- Shuffled AGENTS.md negative control validates content specificity
- Robust code block parser handling multiple LLM output formats
- Statistical analysis: paired t-test, Wilcoxon signed-rank, bootstrap CI, Cohen's d

### Git Co-change Details

- Jaccard index for symmetric, unbiased co-change scoring
- Cluster detection: groups of files that always change together emit 1 rule, not N
- Recency filter: 45-day window excludes stale creation-time artifacts
- Adaptive hub detection: 0.9 threshold for young repos (< 50 commits), 0.7 for mature
- Large-commit cap: 30 files per commit, warns when > 50% filtered (squash-merge detection)
- Shallow clone detection via git rev-parse --is-shallow-repository

### Other Improvements

- Import-chain workflow rules: "When modifying X → check Y (N symbols imported)"
- Deep contribution patterns: common imports (80% threshold), export suffixes, registration files
- Change impact analysis: BFS on reverse call graph for blast radius
- Meta-tool detection: 3-signal cascade (peerDeps → dep-placement → family-count)
- Plugin system for custom convention detectors
- GitHub Action for PR comment automation

### Stats

- 412 tests, 0 type errors
- ~17K lines across 60+ modules
- 5 production dependencies (typescript, mri, picomatch, @modelcontextprotocol/sdk, zod)
- Tested on 11 benchmark repos with zero technology hallucinations

## 0.2.0 (2026-02-16)

### New Features
- **Config file analysis**: Detects turbo.json, biome.json, justfile, tsconfig settings, eslint/prettier configs, .env.example variables
- **Dependency versioning**: Extracts exact framework versions from package.json with version-specific guidance (e.g., "React 19 — use() hook available")
- **Lightweight call graph**: Tracks which exported functions call which other exported functions, enabling "change impact" descriptions
- **Existing docs awareness**: Detects README.md, AGENTS.md, CLAUDE.md presence. New `--merge` flag preserves human-written sections across regenerations
- **Wave 1 template updates**: Tech stack section with exact versions, call graph in architecture descriptions, build tool awareness in workflow rules

### Improvements
- Commands now correctly detect Turbo (`turbo run build` instead of `bun run build`)
- Biome detected as linter/formatter (not confused with ESLint/Prettier)
- Bun runtime version extracted from packageManager field
- TypeScript strict mode, target, and module settings extracted from tsconfig.json

### Bug Fixes
- Fixed TS 5.9 compatibility issue with ts.getModifiers() (canHaveModifiers guard)
- Generalized JSDoc example from @msteams reference to @scope/my-package-name

## 0.1.0 (2026-02-15)

Initial release.

### Features
- TypeScript/JavaScript codebase analysis via AST parsing (no type checker needed)
- Convention detection with confidence metrics (18+ conventions across 9 categories)
- Command extraction from package.json (supports npm, yarn, pnpm, bun)
- Package role inference from exports and dependencies
- Tier classification (Public API / Internal / Generated noise)
- Anti-pattern derivation from convention data
- Contribution pattern detection (how to add new code)
- Rule impact classification (high/medium/low)
- Instruction budget validator
- Hierarchical output for monorepos (root + per-package files)
- Output formats: JSON, AGENTS.md, CLAUDE.md, .cursorrules
- Library API: `analyze()` and `format()` / `formatAsHierarchy()`

### Tested Against
- zod (42K ⭐) — 8.5/10
- hono (29K ⭐) — 9.5/10
- react-hook-form (42K ⭐) — 8.5/10
- changesets (9K ⭐) — 7.5/10
- shadcn/ui (85K ⭐) — 7.5/10
