# Benchmark V4 — Three-Way Quality Comparison (Engine v0.3.0)

**Date:** 2026-02-17
**Engine Version:** 0.3.0 (Wave 2: output validation, pattern fingerprinting, ecosystem detectors, diff analysis)
**LLM used by engine:** claude-sonnet-4-20250514
**Raw LLM evaluator:** claude-opus-4 (reading code directly, writing AGENTS.md without engine)

---

## Methodology

Three outputs per repo:
- **A (Engine):** autodocs-engine v0.3.0 analyzing the codebase
- **B (Human):** Any existing AGENTS.md / CLAUDE.md / .cursorrules in the repo
- **C (Raw LLM):** Claude Opus reading 5-10 representative files and writing an AGENTS.md from scratch

Raw LLM output (C) was written **before** seeing engine output (A) to prevent bias.

Scoring criteria based on [user research findings](./research/user-research-findings.md):
- AI tools follow ~100-150 instructions max. Lean wins.
- Exact commands, workflow rules, tech declarations = high impact.
- Style rules, file paths, verbose explanations = low impact.
- Hallucinations are critical failures.

---

## midday-v1 (Turborepo SaaS — Bun, Next.js 16, oRPC, Drizzle)

**Critical test:** V3 engine hallucinated "GraphQL" here. Wave 2 should fix this.

### Specific Validation

- **Does engine mention "GraphQL"?** NO. The engine output mentions oRPC correctly. The web package file correctly says "NOT GraphQL." **GraphQL hallucination is fixed.**
- **Next.js version?** Engine says "Next.js 16.1.6" — correct.
- **oRPC detected?** Yes — "oRPC Procedures: Type-safe RPC endpoints replacing REST routes."
- **Biome detected (not ESLint)?** Yes — "Biome (lint + format)" in tech stack.

### Output Sizes
| Output | Lines (root) | Lines (total with packages) |
|--------|-------------|----------------------------|
| Engine (A) | 62 | 62 + 75 + 72 + 90 = 299 |
| Human (B) | N/A | No human file exists |
| Raw LLM (C) | 93 | 93 (single file) |

### Scoring

| Dimension | Engine (A) | Human (B) | Raw LLM (C) | Notes |
|-----------|-----------|-----------|-------------|-------|
| Commands | 7 | — | 9 | Engine: table format, correct. Missing db commands and worker commands. Raw LLM: complete dev/build/db/worker commands with full context. |
| Budget | 8 | — | 7 | Engine root: 62 lines, lean. But total with packages = 299 lines — a developer working across packages sees too much. Raw LLM: 93 lines, single file, acceptable. |
| Signal/Noise | 7 | — | 8 | Engine package files contain style rules (kebab-case, named exports) and percentage stats ("42% of files"). Raw LLM: almost all high-signal content, minimal style rules. |
| Workflow | 6 | — | 8 | Engine: 5 generic workflow rules (one is "README exists"). Raw LLM: 7 specific workflow rules ("After modifying schema.ts, run db:generate then db:migrate"; "MCP tools registered in src/mcp/server.ts"). |
| Architecture | 7 | — | 9 | Engine: correct capability descriptions, good data flow. But "Utility library" role for API server is wrong — it's a web service. Raw LLM: detailed per-package architecture with correct roles, explains oRPC dual-protocol, ISR strategy, MCP SSE streaming. |
| Domain | 7 | — | 9 | Engine: good terminology section (Package Health, oRPC Procedures). Raw LLM: explains oRPC, better-auth, MCP, health scoring, ISR revalidation timing, BullMQ dedup. |
| Accuracy | 9 | — | 9 | Engine: No GraphQL hallucination (V3 fix confirmed!). Minor issue: "api-server" package name doesn't match actual "api" directory. Raw LLM: all facts verified correct. |
| **Average** | **7.3** | — | **8.4** | |

---

## hono (Web Framework — Bun, Vitest, Multi-Runtime)

### Specific Validation

- **Architecture includes specific pattern descriptions?** Engine mentions routing system, context processing, middleware pipeline, JSX rendering, multi-runtime adapters. Reasonable but generic. Raw LLM names all 5 routers, explains SmartRouter composition, describes middleware pattern signature.
- **Multi-runtime coverage?** Engine mentions "Node, Bun, Deno, Cloudflare Workers." Raw LLM lists all 9 adapters and 8 runtime test targets.

### Output Sizes
| Output | Lines |
|--------|-------|
| Engine (A) | 60 |
| Human (B) | No human file |
| Raw LLM (C) | 117 |

### Scoring

| Dimension | Engine (A) | Human (B) | Raw LLM (C) | Notes |
|-----------|-----------|-----------|-------------|-------|
| Commands | 8 | — | 9 | Engine: correct base commands with variants in table. Raw LLM: adds all runtime-specific test commands (test:deno, test:workerd, etc.), release workflow, coverage. |
| Budget | 9 | — | 7 | Engine: 60 lines, very lean. Raw LLM: 117 lines, still under budget but heavier. |
| Signal/Noise | 7 | — | 8 | Engine: includes "909 of 920 exports (99%)" stat — noise. "How to Add New Code" with file counts is moderate signal. Public API import counts are useful. Raw LLM: high-signal throughout, testing patterns section is actionable. |
| Workflow | 6 | — | 8 | Engine: 5 rules, mostly obvious ("Use Vitest for all tests"). Raw LLM: 6 rules, more specific ("update BOTH package.json AND jsr.json", "CJS output uses package.cjs.json", "Runtime-specific tests go in runtime-tests/"). |
| Architecture | 6 | — | 9 | Engine: mentions components but generic. "hc orchestrates client routing via mergePath" — this describes the client helper, not the core architecture. Misses the 5 router implementations, presets, middleware count. Raw LLM: names all routers, explains SmartRouter composition, covers presets, counts middleware, describes JSX engine, client. |
| Domain | 6 | — | 9 | Engine: "TypeScript 5.9 — satisfies keyword" — true but not hono-specific. Missing: Web Standards philosophy, middleware pattern signature, Env type system, c.set/c.get pattern. Raw LLM: explains all of these. |
| Accuracy | 8 | — | 9 | Engine: "Zod-based validation" — Zod is a devDependency, not core. Validation is generic via `validator.ts`, not Zod-specific. Raw LLM: correct on all points. |
| **Average** | **7.1** | — | **8.4** | |

---

## inversify (DI Framework Monorepo — pnpm, Turbo, Vitest)

### Specific Validation

- **Detects monorepo build tool?** Engine says "Turbo (build orchestration)" — correct.
- **pnpm detected?** Engine commands use `turbo run` and `pnpm` — correct.
- **Stryker mutation testing?** Engine: not mentioned. Raw LLM: mentioned. Human: not mentioned.

### Output Sizes
| Output | Lines |
|--------|-------|
| Engine (A) | 55 |
| Human (B) | 197 |
| Raw LLM (C) | 115 |

### Scoring

| Dimension | Engine (A) | Human (B) | Raw LLM (C) | Notes |
|-----------|-----------|-----------|-------------|-------|
| Commands | 7 | 8 | 9 | Engine: 4 basic commands, missing test:mutation, test:uncommitted, unused (knip), commit. Human: good coverage but duplicates commands in multiple sections. Raw LLM: comprehensive with all variants, benchmarks, filter examples. |
| Budget | 9 | 4 | 7 | Engine: 55 lines, very lean. Human: 197 lines — exceeds budget. Duplicates test commands in 3 places. Raw LLM: 115 lines, moderate. |
| Signal/Noise | 7 | 5 | 8 | Engine: clean, but Public API import counts add noise for a DI library. Human: security section, performance section, PR guidelines — all low-signal filler AI won't follow. Raw LLM: focused on actionable content. |
| Workflow | 5 | 5 | 8 | Engine: 4 rules, generic ("use turbo run, not pnpm run"). Human: PR guidelines are process rules, not "when X → do Y" triggers. Raw LLM: 7 specific rules including build-before-test dependency, foundation config impact, changeset workflow. |
| Architecture | 7 | 6 | 9 | Engine: good binding calculations description, fluent API mention. Human: lists package categories but as file paths. Raw LLM: describes all package categories with purpose, build output structure, explains the foundation config inheritance pattern. |
| Domain | 6 | 6 | 9 | Engine: missing DI-specific terminology (ServiceIdentifier, scopes, ContainerModule pattern). Human: mentions DI but surface-level. Raw LLM: explains ServiceIdentifier, binding scopes (Transient/Singleton/Request), fluent syntax chain, ContainerModule, reflect-metadata requirement. |
| Accuracy | 9 | 8 | 9 | Engine: all correct. Human: minor inaccuracy — "Run only unit tests: pnpm run test:unit" exists at root AND package level but document doesn't clarify scope. Raw LLM: all correct, specific version numbers verified. |
| **Average** | **7.1** | **6.0** | **8.4** | |

---

## V4 vs V3 Comparison

| Repo | V3 Engine | V4 Engine | V3 Raw LLM | V4 Raw LLM | Delta (Engine) | Delta (Raw LLM) |
|------|-----------|-----------|------------|------------|----------------|-----------------|
| midday-v1 | 7.7 | 7.3 | 7.9 | 8.4 | -0.4 | +0.5 |
| hono | 7.6 | 7.1 | 8.1 | 8.4 | -0.5 | +0.3 |
| inversify | 7.7 | 7.1 | 8.1 | 8.4 | -0.6 | +0.3 |
| **Average** | **7.7** | **7.2** | **8.0** | **8.4** | **-0.5** | **+0.4** |

### Gap Analysis

| Metric | V3 | V4 |
|--------|----|----|
| Engine Average | 7.7 | 7.2 |
| Raw LLM Average | 8.0 | 8.4 |
| **Gap** | **0.3** | **1.2** |

### Did Wave 2 close the gap?

**No. The gap widened from 0.3 to 1.2 points.**

However, this requires careful interpretation:

1. **V4 scoring is stricter than V3.** This benchmark applies the user research findings more rigorously — style rules, percentage stats, and generic workflow rules are penalized harder. The V3 benchmark likely scored these as neutral.

2. **The GraphQL hallucination IS fixed.** This was the highest-priority Wave 2 goal. The ecosystem detector works — midday-v1 no longer mentions GraphQL. Accuracy scores improved or held steady.

3. **The output validator works.** Root files are 55-62 lines. Package files are 72-90 lines. This is the correct range per research.

4. **The Raw LLM got better.** Using Opus 4 (vs the Sonnet used by the engine) with more code context produced significantly richer output. This is the fundamental challenge: the engine uses Sonnet for cost/speed, while a raw LLM benchmark can use any model.

### What Wave 2 improved (confirmed)

| Improvement | Evidence |
|-------------|----------|
| No GraphQL hallucination | midday-v1 engine output correctly identifies oRPC, not GraphQL |
| Output size control | Root files 55-62 lines. Output validator caught 140-line file and forced retry |
| Style rule detection | Budget validator flags style rules with linter suggestions |
| Hierarchical output | midday-v1 produces root + 3 package files (correct for monorepos) |
| Existing docs awareness | inversify engine noted "Existing docs: AGENTS.md" during analysis |

### Where engine still falls behind Raw LLM

| Gap | Engine Weakness | Raw LLM Strength |
|-----|----------------|------------------|
| **Workflow rules** | Generic ("use turbo, not pnpm") | Specific ("After modifying schema.ts → run db:generate then db:migrate") |
| **Architecture depth** | Correct but shallow. Sometimes wrong role ("Utility library" for API server) | Names specific patterns, explains composition, covers all subsystems |
| **Domain context** | Often omits framework-specific concepts | Explains oRPC dual-protocol, middleware signatures, DI scopes |
| **Command completeness** | Covers basics but misses advanced commands | Includes all variants: db commands, worker commands, benchmark commands |
| **Call graph accuracy** | "fetchPackageMetrics → orchestrates fetchPackageMetadata" — function names look reasonable but some appear fabricated from patterns rather than actual code | Functions described match actual code; no fabricated names |

### Root Cause Analysis

The engine's structural analysis is good at:
- Detecting tech stack and versions (correct)
- Identifying build tools and linters (correct)
- Counting conventions and patterns (correct but low-signal)
- Generating lean output within budget (correct)

The engine struggles with:
1. **Semantic understanding.** It sees oRPC imports and calls but doesn't explain *what oRPC is* or *how the dual-protocol works*. The raw LLM reads the code and understands the architecture.
2. **Workflow inference.** The engine detects that Drizzle is used but doesn't generate "after schema change → run migration." This requires understanding the *developer workflow*, not just the code structure.
3. **Role classification.** Calling an API server a "Utility library" suggests the role classifier relies too heavily on export patterns rather than architectural context.
4. **Noise filtering.** Percentage stats ("42% of files use try-catch") are filler. The raw LLM never includes these because they don't help an AI tool write code.

### Recommendations for Wave 3

1. **Upgrade LLM to Sonnet 4.5 or Opus** for the generation step. The analysis → LLM pipeline is only as good as its weakest link. Sonnet produces competent but generic output; a stronger model produces the workflow rules and domain context that matter.

2. **Add workflow rule inference.** When ORM is detected → generate migration workflow rule. When monorepo with build deps → generate "build before test" rule. These are template-able from the analysis data.

3. **Fix role classification.** An app with HTTP routes, middleware, and handlers is a "web service" or "API server", not a "Utility library." Use entry point patterns (server.listen, Hono routing) to detect.

4. **Remove percentage stats from output.** "42% of files use try-catch" is noise. Replace with: "Use try-catch for error handling in API procedures and database operations."

5. **Add domain context templates.** When oRPC is detected, include a brief explanation of what it is. When Drizzle is detected, explain schema-as-code. The engine has the detection data — it just doesn't template domain explanations.

6. **Expand command discovery.** Scan not just root package.json but also `apps/*/package.json` and `packages/*/package.json` for important commands (db:migrate, sync:bulk, etc.).

---

## Appendix: Human File Analysis (inversify only)

The inversify AGENTS.md (197 lines) is a representative example of a human-written context file:

**Strengths:**
- Correct commands and build tool detection
- Good package taxonomy
- Mentions testing patterns and fixture guidelines

**Weaknesses (per research criteria):**
- 197 lines exceeds the ~100-150 instruction budget
- Duplicates test commands in 3 different sections
- Security section ("type-safe DI prevents injection attacks") — low signal
- Performance section ("Turbo caching speeds up builds") — low signal
- PR guidelines — process rules AI doesn't follow
- Standard package structure listing — file paths that get stale

**Score: 6.0/10** — Demonstrates that human-written files without research-backed optimization also underperform. The engine (7.2) beats the human file by being leaner.

---

## Appendix: Output Files

All outputs saved to `/tmp/benchmark-v4/results/`:
```
results/
├── midday-v1/
│   ├── engine/          # AGENTS.md + packages/*.md
│   ├── raw-llm/         # AGENTS.md
│   └── human/           # (empty — no human file)
├── hono/
│   ├── engine/          # AGENTS.md
│   ├── raw-llm/         # AGENTS.md
│   └── human/           # (empty — no human file)
└── inversify/
    ├── engine/          # AGENTS.md
    ├── raw-llm/         # AGENTS.md
    └── human/           # AGENTS.md (from repo)
```
