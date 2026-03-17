# Minimal Mode Plan: <500 Token AGENTS.md

## Context

Research shows:
- **LLM-generated comprehensive AGENTS.md: -0.5% to -2.0%** (arxiv 2602.11988)
- **Developer-written focused AGENTS.md: +4%, -29% runtime** (arxiv 2601.20404)
- **"Less is More" paper**: Removing redundant tokens can IMPROVE performance
- **GitHub's analysis of 2,500 repos**: Successful files have exact commands, 1-2 code examples, clear boundaries
- **Our benchmark**: 10/13 tasks, all conditions tied (directories are obvious). AGENTS.md hurt on 2/3 divergent tasks via anchoring.

**Goal:** Generate output that matches the characteristics of developer-written files (short, focused, actionable) rather than comprehensive analysis dumps. Target <500 tokens total.

## Current Output Analysis

Our current AGENTS.md has 16 sections totaling ~1,500-2,500 tokens:

| Section | Tokens | Research Value | Minimal Mode |
|---------|--------|---------------|-------------|
| Title | 5-10 | Neutral | **KEEP** (1 line) |
| Summary | 15-30 | Low (AI can infer from package.json) | **DROP** |
| Tech Stack | 30-60 | Low (AI detects from imports/configs) | **DROP** |
| **Commands** | 40-120 | **HIGH** (+2.6% avg, never hurts, exact flags matter) | **KEEP** |
| Package Guide | 30-80 | Medium (monorepo-only) | **KEEP if monorepo** |
| Architecture | 200-400 | High (+20.2%) BUT causes anchoring | **CONDITIONAL** (only non-obvious dirs) |
| **Workflow Rules** | 50-150 | **HIGH** (co-change patterns, registration) | **KEEP** (top 3 only) |
| Domain Terminology | 100-250 | Low (LLM-synthesized, often generic) | **DROP** |
| Contributing Guidelines | 150-300 | Low (LLM-synthesized) | **DROP** |
| How to Add Code | 100-200 | Variable (+59% to -59%) | **CONDITIONAL** (only if inferability=low) |
| Public API | 150-400 | Low (AI can grep for exports) | **DROP** |
| Dependencies | 50-150 | Low (AI reads package.json) | **DROP** |
| Dependency Graph | 30-80 | Low (monorepo visualization) | **DROP** |
| Dependency Diagram | 100-300 | Low (mermaid) | **DROP** |
| Conventions | 100-250 | Variable | **CONDITIONAL** (only non-obvious) |
| Change Impact | 80-200 | Low for static file (better via MCP on-demand) | **DROP** |
| Team Knowledge | 100-200 | Meta (questions, not answers) | **DROP** |
| Supported Frameworks | 30-80 | Low (meta-tools only) | **DROP** |

## Minimal Mode Sections

Only 4-5 sections, all proven valuable by research or never harmful:

### 1. Title + One-Line Description (~10 tokens)
```markdown
# my-project
TypeScript API server using Express and Prisma.
```
Why: Orients the AI. Zero risk. Derived from package.json + role inference.

### 2. Commands (~40-100 tokens)
```markdown
## Commands
| Task | Command |
|------|---------|
| Build | `pnpm build` |
| Test | `pnpm vitest run` |
| Test (watch) | `pnpm vitest` |
| Lint | `pnpm eslint . --fix` |
| Type check | `pnpm tsc --noEmit` |
| Dev | `pnpm dev` |
```
Why: **+2.6% avg, never hurts.** Exact commands with exact flags — this is the #1 thing GitHub's 2,500-repo analysis found in successful AGENTS.md files. LLMs can guess `npm test` but can't guess `pnpm vitest run --reporter=verbose` or project-specific scripts.

**Rules:**
- Include ONLY commands that exist in package.json scripts (or pyproject.toml, etc.)
- Include flags if they're non-standard
- Include the package manager (don't say "npm" if the project uses pnpm)
- Skip commands where the script name IS the command (e.g., `build: tsc` → just `pnpm build`)

### 3. Workflow Rules (~30-80 tokens, only if git co-change data exists)
```markdown
## Workflow Rules
- After modifying `src/schema.prisma` → run `pnpm db:generate`
- After modifying `src/types.ts` → check dependent files: formatter, pipeline, mcp
- When adding a new detector → export it from `src/index.ts`
```
Why: This is the one area where our benchmark showed positive signal (barrel updates). Workflow rules capture cross-file dependencies that sibling files don't reveal. Limit to top 3 most important rules.

**Rules:**
- Maximum 3 rules
- Only include rules with high confidence (co-change count >= 5, or registration patterns)
- Prefer "After modifying X → run Y" (actionable) over "X is related to Y" (informational)
- Skip rules the AI can infer (e.g., "after modifying a .ts file → it needs to compile")

### 4. Non-Obvious Conventions (~30-80 tokens, only if inferability recommends "full")
```markdown
## Conventions
- Files in `src/detectors/` must export a `ConventionDetector` function and be registered in `src/convention-extractor.ts`
- All barrel files use `export *` re-exports (not named exports)
- Test files are co-located: `foo.ts` → `foo.test.ts` in same directory
```
Why: Only include conventions that the AI CANNOT infer from reading 2-3 sibling files. Skip obvious conventions (kebab-case filenames in a repo where every file is kebab-case).

**Rules:**
- Maximum 3 conventions
- Must pass the "would a senior dev reading 3 files in this directory know this?" test
- If yes → skip (the AI will also know it)
- If no → include (the AI needs to be told)
- Focus on registration patterns, barrel file conventions, naming suffixes
- Never include style rules that linters enforce (indentation, semicolons, etc.)

### 5. Non-Obvious Architecture (~30-60 tokens, only if non-obvious directories exist)
```markdown
## Key Directories (non-exhaustive)
- `scripts/` — build and deployment automation
- `internal/` — shared utilities not part of public API
- `integration-tests/` — end-to-end test suite (separate from unit tests)
```
Why: Our benchmark showed +20.2% for architecture tasks, but ALSO showed anchoring problems. The fix: list ONLY non-obvious directories (ones not in the OBVIOUS_DIR_NAMES set), and always include "non-exhaustive" to prevent anchoring.

**Rules:**
- Only list directories that fail the `isObviousDirectory()` check
- If ALL directories are obvious → skip this section entirely
- Always include "(non-exhaustive)" qualifier
- Maximum 5 directories
- Include one-line purpose for each

### 6. Package Guide (~30-50 tokens, only for monorepos with 3+ packages)
```markdown
## Packages
- `packages/core` — shared types and utilities
- `packages/cli` — command-line interface
- `packages/server` — API server (depends on core)
```
Why: Monorepo navigation is non-obvious. Which package handles what is valuable context that saves exploration time.

**Rules:**
- Only for repos with 3+ packages
- Maximum 8 packages listed
- One-line purpose each
- List dependencies only if there's a clear hierarchy

## Token Budget

| Section | Max Tokens | Condition |
|---------|-----------|-----------|
| Title + description | 15 | Always |
| Commands | 100 | Always (if commands detected) |
| Workflow rules | 80 | If git co-change data exists AND confidence >= 5 |
| Conventions | 80 | If inferability recommendation = "full" |
| Architecture | 60 | If non-obvious directories exist |
| Package guide | 60 | If monorepo with 3+ packages |
| **Total maximum** | **~395** | |
| **Typical** | **~200-300** | |

## Implementation

### New Flag: `--minimal`

```bash
# Minimal mode (default in future)
synaps init --minimal

# Full mode (legacy, for backward compatibility)
synaps init --full

# The MCP server always uses the full analysis internally
# but --minimal controls the static file output
```

### Changes to `src/deterministic-formatter.ts`

Add a new export: `generateMinimalAgentsMd(analysis, rootDir)` that produces the minimal output. The existing `generateDeterministicAgentsMd` remains unchanged for `--full` mode.

The minimal formatter:
1. Always includes: title + commands
2. Conditionally includes: workflow rules (if high-confidence co-change data exists)
3. Conditionally includes: conventions (if inferability = "full")
4. Conditionally includes: architecture (if non-obvious directories exist)
5. Conditionally includes: package guide (if monorepo with 3+ packages)
6. Enforces token limits per section
7. Enforces total token limit (~500)

### Changes to CLI

- `--minimal` flag (default for `init`, optional for `analyze`)
- `--full` flag (explicit override)
- The MCP server is not affected (it serves from the full analysis)

### What the MCP Server Provides (Everything Minimal Drops)

The dropped sections aren't lost — they're served on-demand via MCP:

| Dropped Section | MCP Tool |
|----------------|----------|
| Tech Stack | `get_commands` (includes stack info) |
| Public API | `get_exports` |
| Dependencies | (available in analysis JSON) |
| Change Impact | `analyze_impact` |
| How to Add Code | `get_contribution_guide` |
| Full Conventions | `get_conventions` |
| Architecture Details | `get_architecture` |

This is the "thin index + dynamic queries" model that Anthropic's context engineering guidelines recommend.

## Testing Plan

1. **Unit tests**: New `generateMinimalAgentsMd` function with test cases for each conditional section
2. **Token counting**: Verify output stays under 500 tokens for diverse repos
3. **Snapshot tests**: Generate minimal AGENTS.md for 5+ repos, verify they look like developer-written files
4. **Benchmark comparison**: Run PR benchmark with minimal vs full output on the 3 pilot repos
5. **Negative tests**: Verify minimal mode generates NOTHING for repos where all patterns are obvious (inferability = "skip")

## Success Criteria

The minimal output should:
- Be <500 tokens for any repo
- Look like something a senior developer would write in 5 minutes
- Never include information the AI can infer from reading 3 sibling files
- Always include exact commands (the one thing proven to help)
- Pass the "would this hurt if the info is slightly wrong?" test — if yes, don't include it
- Score at least as well as the full output on our PR benchmark (i.e., not make things worse)

## What Minimal Mode Does NOT Do

- It does not replace the MCP server (which provides everything on-demand)
- It does not replace `--full` mode (backward compatibility)
- It does not try to be comprehensive (that's the whole point)
- It does not include LLM-synthesized sections (architecture, domain, contributing)
- It does not include information that could cause anchoring (comprehensive directory lists)
