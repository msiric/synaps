# Roadmap

> Current version: 0.3.0. 279 tests. ~10,000 lines of source. Deterministic output mode implemented (13/15 sections hallucination-proof). Benchmarked against 10 open-source repos.

## Current Status

**What works well:**
- AST-based analysis: exports, imports, call graph, barrel resolution, convention detection
- Deterministic output for 13 of 15 AGENTS.md sections (no hallucination by construction)
- Version-aware framework guidance (React 18 vs 19, TypeScript 5.4 vs 5.5, Next.js 13-16)
- Monorepo support: hierarchical output, workspace command scanning, cross-package analysis
- Output validation: cross-references LLM output against structured analysis data
- Multiple formats: AGENTS.md, CLAUDE.md, .cursorrules, JSON

**What needs work:**
- Domain knowledge (4.2/10 in benchmarks — cannot infer project-specific terminology from code)
- Workflow specificity (4.9/10 — generates generic rules, not project-specific)
- Meta-tool detection (Knip-class tools that import frameworks for analysis, not as core deps)
- Empty target handling (should fail gracefully, not generate hallucinated content)
- Deterministic output not yet benchmarked against 10-repo suite

## Next: Meta-Tool Detection

### Problem

When analyzing tools that have plugins for multiple frameworks (Knip, ESLint configs, bundler plugins), the engine lists every supported framework as a project dependency. Knip's output says "Uses Express, NestJS, Webpack, Vite, Drizzle, Prisma" — these are frameworks Knip *analyzes*, not frameworks it *uses*.

The import-verification fix doesn't help because Knip's source files DO import from React (to analyze React projects). This is a semantic distinction: importing a framework to support it vs. importing it to build on it.

### Solution

A heuristic that detects packages importing >5 distinct major frameworks as "meta-tools" and adjusts output.

**Threshold:** >5 distinct major frameworks. Normal web app: 2-3 (React + Express + Prisma). Normal library: 0-1. Meta-tool: 10+.

**Major framework list (~40 entries):** UI frameworks (react, vue, angular, svelte, solid-js, preact), meta-frameworks (next, nuxt, remix, astro), HTTP servers (express, fastify, hono, koa, nestjs), build tools (webpack, vite, esbuild, rollup, parcel), ORMs (prisma, drizzle, typeorm, sequelize, knex, mongoose), state management (redux, zustand, mobx, jotai, recoil).

### Behavior when meta-tool detected

1. **Ecosystem detectors suppressed.** No "Uses Express" or "Uses React" conventions
2. **Dependencies split.** Core dependencies listed separately from "Supported frameworks (15 detected): react, express, nestjs, ..."
3. **Role summary updated.** "CLI tool — imports 15 frameworks for plugin support, not as core dependencies"
4. **Non-ecosystem conventions preserved.** File naming, hooks, testing still active

### Implementation

| File | Change | Lines |
|------|--------|------:|
| new: `src/meta-tool-detector.ts` | Detection logic, framework list | ~50 |
| `src/types.ts` | `isMetaTool` and `metaToolInfo` fields on PackageAnalysis | ~8 |
| `src/convention-extractor.ts` | Suppress ecosystem detectors when meta-tool | ~10 |
| `src/deterministic-formatter.ts` | Split dependency display for meta-tools | ~25 |
| `src/role-inferrer.ts` | Adjust role summary for meta-tools | ~15 |
| `src/pipeline.ts` | Insert detection after dependency analysis | ~10 |
| `src/config.ts` | `--meta-tool-threshold` flag (configurable) | ~5 |
| new: `test/meta-tool-detection.test.ts` | Test cases | ~80 |
| **Total** | | **~203** |

## Known Limitations

These are fundamental constraints of the current approach, not bugs.

1. **Domain knowledge ceiling.** The engine analyzes code structure but cannot infer *why* the code is structured this way, what terminology the team uses, or what deployment quirks exist. The "Team Knowledge" placeholder section is the escape hatch for humans to add this context.

2. **Empty target behavior.** If the analysis target has <5 source files (wrong path in a monorepo, restructured repo), the engine may produce plausible-sounding but fabricated output via the micro-LLM calls. It should instead error with a clear message.

3. **Single entry point.** Modern packages with `exports` subpaths (e.g., `./server`, `./client`, `./rsc`) are analyzed only at the main `.` entry. Subpath exports are not included in the public API surface.

4. **No documentation parsing.** The engine reads README.md first paragraph for domain context but does not parse CONTRIBUTING.md, wiki pages, or inline documentation beyond JSDoc comments. This is the primary source of the domain knowledge gap.

## Future Considerations

Ordered by expected impact on output quality.

### High Impact

- **README/CONTRIBUTING.md extraction.** Parse project documentation to extract domain terminology, workflow rules, and conventions that can't be inferred from code. Would directly address the 4.2/10 domain score.

- **CI config parsing.** Read `.github/workflows/*.yml` and pre-commit hooks to extract workflow rules ("conventional commits required," "build before test," "failing test first") rather than generating generic ones.

- **Incremental analysis.** Cache analysis results keyed by file content hash. Re-analyze only changed packages. Reduces monorepo analysis time from minutes to seconds for CI integration.

- **Benchmark deterministic output.** Run the deterministic formatter against all 10 benchmark repos to validate that accuracy improves as predicted. This is the most immediate need.

### Medium Impact

- **Breaking change detection.** Classify diff results as breaking/non-breaking using semver rules. Enable CI to auto-fail on unreleased breaking changes.

- **Example extraction improvements.** Richer usage example extraction from test files — currently limited to 3-7 line snippets around the first usage of each export.

- **Plugin ecosystem.** Move org-specific patterns to optional plugins. The plugin system exists (`src/plugin-loader.ts`) but has no community plugins yet.

### Lower Impact

- **Quality score per package.** 0-100 based on test coverage, type safety, documentation completeness.
- **Watch mode.** Regenerate AGENTS.md on file changes for development workflow.
- **Task-completion evaluation.** Measure whether generated AGENTS.md files actually help AI tools produce better code (the real metric, vs "does the output look good to an evaluator").
- **Streaming LLM output.** Progress indication during micro-LLM calls.
