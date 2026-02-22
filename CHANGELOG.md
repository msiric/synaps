# Changelog

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
