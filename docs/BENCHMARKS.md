# Benchmarks

> Three-way comparison: engine output vs human-written context files vs raw LLM (Claude reading code directly). 10 TypeScript repos, 7 scoring dimensions.
>
> Last benchmark run: 2026-02-18 (engine v3, grounded prompting). The deterministic output mode (commit 2c04f12) has not yet been benchmarked.

## Methodology

**Scoring dimensions** (each 1-10):

| # | Dimension | 10/10 Means |
|---|-----------|-------------|
| 1 | Commands | All commands exact and correct, build tool detected, variants listed |
| 2 | Budget | 100-150 lines, ~4-8KB. Not too sparse, not too verbose |
| 3 | Signal/Noise | Every line actionable for AI tools. No style rules, file listings, percentages |
| 4 | Workflow | Specific "when X -> do Y" rules with exact commands. Not generic advice |
| 5 | Architecture | Describes capabilities, names specific implementations. Not file listings |
| 6 | Domain | Terminology, version guidance, concepts AI can't infer from code |
| 7 | Accuracy | Zero errors. Hallucinations are critical failures |

Based on: [Vercel AGENTS.md research](https://vercel.com/blog/agents-md) (8KB index = 100% eval pass rate), [HumanLayer instruction budget](https://humanlayer.dev/blog/agents-md) (~100-150 rules max), [Builder.io findings](https://www.builder.io/blog/cursor-tips) (commands > style rules).

## Benchmark Repos

| # | Repo | Stars | Archetype | Context File | Pkg Mgr |
|---|------|------:|-----------|-------------|---------|
| 1 | sanity-io/sanity | 6K | CMS monorepo | AGENTS.md (386 lines) | pnpm+Turbo |
| 2 | medusajs/medusa | 32K | E-commerce API | CLAUDE.md (341 lines) | Yarn+Turbo |
| 3 | vercel/ai | 22K | AI SDK monorepo | AGENTS.md (284 lines) | pnpm+Turbo |
| 4 | modelcontextprotocol/typescript-sdk | 12K | SDK | CLAUDE.md (266 lines) | pnpm |
| 5 | webpro-nl/knip | 10K | CLI tool | AGENTS.md (183 lines) | pnpm |
| 6 | unjs/nitro | 10K | Backend server | AGENTS.md (164 lines) | pnpm |
| 7 | openstatusHQ/openstatus | 8K | Web app (Bun) | CLAUDE.md (106 lines) | pnpm+Turbo |
| 8 | documenso/documenso | 12K | Web app (Remix) | .cursorrules + AGENTS.md | npm+Turbo |
| 9 | Effect-TS/effect | 13K | Functional library | AGENTS.md (77 lines) | pnpm |
| 10 | excalidraw/excalidraw | 117K | Component library | CLAUDE.md (34 lines) | Yarn+Vite |

Selected from 30+ candidates. Criteria: >5K stars, >80% TypeScript, existing human-written context file, <1000 source files, actively maintained.

## Score Evolution

### Overall Averages

| Version | What Changed | Engine | Human | Raw LLM |
|---------|-------------|-------:|------:|--------:|
| v1 (baseline) | First 10-repo benchmark | 5.9 | 7.2 | 6.6 |
| v2 (post-bugfix) | 16 algorithm bugs fixed | 5.9 | 7.4 | 7.0 |
| v3 (grounded) | XML tags, temperature 0, whitelist validator | 5.5 | 7.4 | 7.0 |

Score did not meaningfully improve across 3 iterations despite ~2,000 lines of changes. The v3 regression prompted a pivot to deterministic output generation.

### Per-Repo Scores

| Repo | Engine v1 | Engine v2 | Engine v3 | Human | Raw LLM |
|------|----------:|----------:|----------:|------:|--------:|
| sanity | 5.9 | 4.7 | 5.1 | 7.4 | 7.4 |
| medusa | 5.7 | **8.0** | 6.1 | 7.6 | 6.4 |
| vercel/ai | 6.7 | **7.6** | 6.4 | 7.6 | 6.4 |
| MCP SDK | 6.1 | 3.6 | 3.4 | 8.1 | 7.9 |
| knip | 5.1 | 4.4 | 4.6 | 8.4 | 7.1 |
| nitro | 5.4 | 6.3 | 5.7 | 7.9 | 7.7 |
| openstatus | 6.7 | 6.4 | 6.6 | 7.4 | 7.1 |
| documenso | 5.7 | 4.9 | 4.4 | 6.1 | 6.9 |
| effect | 5.4 | 5.7 | 6.3 | 7.3 | 5.9 |
| excalidraw | 6.6 | **6.9** | 6.7 | 5.7 | 6.9 |

Engine v2 won or tied on 3 repos (medusa, vercel/ai, excalidraw). MCP SDK and documenso had invalid target paths (repos restructured since benchmark setup).

## Dimension Analysis

From the v1 baseline (most complete single-run data):

| Dimension | Engine | Human | Raw LLM | Gap to Human |
|-----------|-------:|------:|--------:|:-------------|
| Budget | **7.0** | 6.4 | 5.5 | +0.6 (engine best) |
| Signal/Noise | **7.2** | 6.4 | 5.9 | +0.8 (engine best) |
| Commands | 6.2 | 7.3 | 7.1 | -1.1 |
| Architecture | 6.2 | 6.5 | 7.1 | -0.3 |
| Accuracy | 6.3 | **8.9** | 6.9 | -2.6 |
| Workflow | 4.9 | **7.5** | 6.7 | -2.6 |
| Domain | 4.2 | 7.0 | **7.3** | -2.8 |

**Engine strengths:** Budget adherence and signal-to-noise ratio are the highest of all three approaches. These are structural properties the engine controls directly through its analysis pipeline and output formatting.

**Engine weaknesses:** Domain knowledge (4.2) and workflow specificity (4.9) are the widest gaps. These require semantic understanding of the project that AST analysis cannot provide. Accuracy (6.3) suffers from hallucinations in the LLM formatting step.

## Key Findings

1. **The engine excels at what can be computed deterministically.** Budget and signal-to-noise are best because these are pipeline-controlled, not LLM-dependent. This motivated the deterministic output architecture.

2. **Domain knowledge is the structural ceiling.** Project-specific terminology, design rationale, and workflow conventions cannot be inferred from AST analysis. The engine score of 4.2/10 on domain reflects a fundamental limitation, not a bug. The "Team Knowledge" placeholder section acknowledges this.

3. **Accuracy is the trust gate.** Three hallucinations in v1 (React in a CLI tool, Bun in a pnpm project, "src" as a title) were traced to monorepo root dependency leakage. These were fixed but new LLM hallucinations appeared in v2 (Bun in MCP SDK, jest.mock in Sanity). The deterministic pivot eliminates this class of failure for 13/15 output sections.

4. **Grounded prompting regressed scores.** v3 (XML tags, temperature 0, fill-in-blank templates, whitelist validator) scored 5.5, down from 5.9. Rigid templates prevented the LLM from using correct training knowledge for well-known repos. Lesson: constrain the LLM's scope rather than its creativity.

5. **The engine is a starting point, not a replacement.** It beats sparse human files (excalidraw, 34 lines) and bloated LLM output (medusa, 309 lines). It loses where deep project knowledge matters. Positioning: "generates an accurate structural foundation; add your domain knowledge."

## Algorithm Audit Summary

A systematic trace of all data flow paths found 16 bugs across 7 categories. All critical and high bugs were fixed in commit `8e4628e`.

| Category | Count | Severity | Example |
|----------|------:|----------|---------|
| Root dependency leakage | 3 | Critical | React from docs site appeared in CLI tool analysis |
| Package name resolution | 2 | High | Analysis path "src" leaked as title instead of "nitro" |
| Framework false positives | 3 | High | Version guidance for frameworks not imported by source |
| Command extraction | 2 | Medium | Workspace commands from unrelated packages |
| Output quality | 3 | Medium | Templates treated as ceilings (50-70 lines, not 80-120) |
| Edge cases | 4 | Medium | Analyzing src/ directly, workspace:\* protocol |
| Validator gaps | 3 | Medium | Can't catch upstream data pollution |

Key fixes: per-package dependency isolation (no root dep merge), walk-up package name resolution, import-verified framework detection, meaningless title rejection, test framework fallback to root devDeps.
