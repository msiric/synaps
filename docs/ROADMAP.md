# Roadmap

> Current version: 0.3.0. 299 tests. ~10,200 lines of source.
> Deterministic output (14/16 sections hallucination-proof).
> Meta-tool detection (3-signal cascade). Benchmarked against 10 open-source repos.

## Current Status

**Shipped and working:**
- AST-based analysis: exports, imports, call graph, barrel resolution, convention detection
- Deterministic output for 14 of 16 AGENTS.md sections (no hallucination by construction)
- Meta-tool detection: 3-signal cascade (peerDeps → dep-placement → family-count) with format-time reclassification, dominant family exemption, and `--no-meta-tool` escape hatch
- Version-aware framework guidance (React 18 vs 19, TypeScript 5.4 vs 5.5, Next.js 13-16)
- Monorepo support: hierarchical output, workspace command scanning, cross-package analysis
- Workflow rules for both single-package and multi-package analysis
- Output validation: cross-references LLM output against analysis data
- Type-only import filtering across pipeline and ecosystem detectors
- Multiple formats: AGENTS.md, CLAUDE.md, .cursorrules, JSON
- Security: plugin path boundary validation, LLM error body redaction, typed API responses

**Benchmark results (10-repo suite, Feb 2026):**
- 10/10 repos generate without errors
- Knip correctly detected as meta-tool (16 framework families, "Supported Frameworks" section)
- Zero false positives on meta-tool detection (7 normal repos unaffected)
- Zero technology hallucinations in deterministic sections
- Analysis times: 5ms to 1.6s (even 3,746-file sanity in under 2 seconds)

---

## Phase 1: Ship (Weeks 1-2)

### `npx autodocs-engine init`

The single most important feature for adoption. Zero-config first-run experience:

```bash
npx autodocs-engine init
```

Auto-detects:
- Monorepo vs single package (from `workspaces` in package.json, `pnpm-workspace.yaml`, `turbo.json`)
- Package paths from workspace configuration
- Package manager from lockfiles
- Whether an API key is available (JSON-only vs full AGENTS.md)

Generates AGENTS.md in the right location(s). Prints a 3-line summary. No flags required.

**Implementation:** New `src/bin/init.ts` command (~150 lines). Reads workspace configs, calls existing `analyze()` and `formatDeterministic()` APIs, writes output.

### Update README with benchmark results

Current README references old benchmarks (zod, hono, react-hook-form — 5 repos). Update with the 10-repo suite results and the deterministic output claims.

### Ship as v0.5.0

Version bump, npm publish, first public release with the init command.

---

## Phase 2: Distribution (Weeks 3-4)

### GitHub Action

```yaml
- uses: msiric/autodocs-engine@v1
```

Runs on PR. Either:
- Comments with a diff ("3 new exports detected, 1 convention changed")
- Auto-commits an updated AGENTS.md

The `--diff` analyzer already exists. This is mostly packaging (action.yml, Dockerfile or composite action, CI testing).

**Why this matters:** One person installs it → every contributor on every PR sees it. Viral within organizations.

### Community launch

- Post to agents.md community channels
- dev.to article: "Generate AGENTS.md automatically from your TypeScript codebase"
- X/Twitter announcement
- Target: first 50 users, collect feedback

---

## Phase 3: Quality Improvements (Month 2)

Based on benchmark gap analysis (domain: 4.2/10, workflow: 4.9/10):

### CONTRIBUTING.md extraction

Already detected but not read. When present, extract key patterns via micro-LLM:
- Commit message format
- Branch naming conventions
- Review requirements
- Test requirements before PR

Same bounded micro-LLM pattern as README extraction. High signal, low hallucination risk.

### `exports` subpath support

Modern packages with `"exports": { "./server": ..., "./client": ... }` are increasingly common. Currently only the main `.` entry is analyzed.

Extend `symbol-graph.ts` to resolve multiple entry points from the exports field. Each subpath becomes an additional source for the public API section.

### Workflow rules from package.json scripts

Parse `package.json` scripts more deeply to extract specific workflow rules. Scripts like `precommit`, `prepare`, `postinstall`, `prebuild` encode workflow requirements that should surface as rules.

---

## Phase 4: Differentiation (Month 3)

### MCP server mode

Expose the analysis as a real-time service that AI tools query via Model Context Protocol:

```bash
autodocs-engine serve
```

Requires incremental analysis (content-hash caching) to avoid re-parsing on every query. The structured JSON output is already the right shape for MCP tool responses.

This is the long-term moat: a static file drifts; a live service is always current.

### Quality score per package

0-100 score measuring AI-readability: test coverage ratio, type safety (strict mode, `any` usage), JSDoc on public API, convention consistency. Novel signal — not code quality per se, but how easy the codebase is for AI tools to work with.

---

## Known Limitations

1. **Domain knowledge ceiling.** AST analysis cannot infer project-specific terminology, design rationale, or tribal knowledge. The "Team Knowledge" placeholder section is the escape hatch.

2. **Single entry point.** Packages with `exports` subpaths are analyzed at the main `.` entry only. Subpath public APIs are not yet captured.

3. **TypeScript only.** No Python, Go, Rust, or other language support. The AST parser, convention detectors, and symbol graph are deeply TypeScript-specific.

4. **Empty target behavior.** Analyzing a directory with <5 source files may produce thin output. The engine should warn rather than generate minimal content.

---

## Explicitly Deprioritized

- **Watch mode.** GitHub Action covers "keep it updated" better. Watch mode useful in dev but rarely remembered.
- **More output formats.** AGENTS.md, CLAUDE.md, .cursorrules, JSON covers the market. Add formats on user demand.
- **More convention detectors.** The 8 detectors cover major patterns. Long-tail detectors (Redux Toolkit slices, tRPC routers) should be community plugins.
- **Task-completion eval.** Intellectually interesting but premature. Need users before measuring effectiveness.
- **Python support.** ~3K lines, requires parallel implementations of parser, symbol graph, convention detectors. Quarter 2 at earliest, driven by user demand.
