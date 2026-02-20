# Roadmap

> autodocs-engine — generate research-backed AGENTS.md files that AI coding tools actually follow.

## Where We Are

**Version 0.3.0.** 327 tests. ~11K lines of source across 37 modules. Zero technology hallucinations across 10 benchmark repos.

The engine produces 11-section AGENTS.md files with:
- **Commands** — exact build/test/lint/start with variants, from package.json
- **Architecture** — capability descriptions via constrained micro-LLM
- **Workflow Rules** — technology-aware rules + import-chain coupling ("when modifying types.ts → check 12 dependent files")
- **How to Add New Code** — deep contribution recipes with common imports, naming conventions, and registration files
- **Change Impact** — BFS on call graph for blast radius analysis
- **Public API** — typed function signatures sorted by usage
- **Conventions** — DO/DON'T rules with confidence metrics
- **Team Knowledge** — contextual questions the engine can't answer from code alone

Distribution: `npx autodocs-engine init` (zero-config), GitHub Action (PR comments), JSON/AGENTS.md/CLAUDE.md/.cursorrules formats.

**What the engine does well:** The structural 60% — commands, API surface, conventions, tech stack, change impact, contribution patterns. Everything that's tedious to write by hand and drifts out of sync.

**What it can't do yet:** The operational 40% — debug workflows, coding style preferences, architectural rationale, deployment quirks. This requires project-specific knowledge from the developer's head.

---

## Near-Term: Ship & Learn (Weeks 1-4)

### Ship v0.5.0

Version bump, npm publish. The engine is ready for real users. Everything below should be informed by actual usage feedback.

### Community Launch

- dev.to article: "Generate AGENTS.md automatically from your TypeScript codebase"
- agents.md community channels, Claude Code subreddit
- X/Twitter announcement with benchmark results
- Target: first 50 users, collect what they love and what they complain about

### Staleness Detection

CI check that compares the committed AGENTS.md against what the engine would generate today. Warns (or fails) if they've diverged significantly. Uses the existing `--diff` analyzer. Turns the engine from a one-time generator into an ongoing quality gate.

```yaml
# .github/workflows/agents-check.yml
- run: npx autodocs-engine analyze . --dry-run > /tmp/current.json
- run: npx autodocs-engine --diff /tmp/current.json --previous .agents-snapshot.json
```

### CONTRIBUTING.md Extraction

Already detected but not read. When present, extract key patterns via micro-LLM:
- Commit message format, branch naming, PR process
- Review requirements, test requirements
- Same bounded micro-LLM pattern as README extraction

High signal, low hallucination risk. Directly addresses the 6/10 domain terminology score.

---

## Medium-Term: Close the Gap (Months 2-3)

These features address the specific weaknesses identified in benchmarks and evaluator feedback.

### Co-Change Analysis from Git History

The most powerful workflow signal we're not capturing. `git log --name-only` tells us which files change together across commits.

```
"src/types.ts and src/llm/serializer.ts change together in 78% of commits"
→ Workflow rule: "When modifying types.ts, also check serializer.ts"
```

This produces stronger "when X → do Y" rules than import-chain analysis alone — it's grounded in how developers actually work, not just how code is structured. Deterministic, no LLM needed.

**Implementation:** Parse `git log --name-only --pretty=format:""` output, build a co-change matrix (file pairs → change frequency), filter to pairs above a threshold (e.g., co-change in ≥60% of commits that touch either file). Generate `WorkflowRule` entries.

**Requires:** `.git` directory access (available in most dev environments, not in all CI).

### `exports` Subpath Support

Modern packages with `"exports": { "./server": ..., "./client": ..., "./rsc": ... }` are increasingly common. The engine currently only analyzes the main `.` entry point.

Extend `symbol-graph.ts` to resolve multiple entry points from the exports field. Each subpath becomes an additional source for the public API section with clear labeling: `[./server] createHandler()`, `[./client] useQuery()`.

### Pre-Filled Team Knowledge Answers

The prompted questions are good, but the engine could **pre-fill partial answers** from what it already knows:

Instead of:
> "Are there ordering requirements between commands?"

Generate:
> "Build runs `tsc` → TypeScript compilation. Tests import from `src/`, not `dist/`. No build-before-test dependency detected. Verify: is there a scenario where build must run first?"

The engine knows the build command, knows what tests import, and can check for dist/ imports. A 70%-correct pre-filled answer is more useful than a blank question, and the "Verify:" prompt invites the developer to confirm or correct.

**Risk:** Incorrect pre-filled answers could be worse than blank questions. Mitigation: frame every pre-filled answer with a verification prompt, and only pre-fill when confidence is high.

### Incremental Analysis

Cache analysis results keyed by file content hash. Re-analyze only changed files. Reduces monorepo analysis from seconds to milliseconds for CI integration.

**Implementation:** SHA-256 hash per file → cache `ParsedFile` results. Invalidate on content change. Store cache in `.autodocs-cache/` (gitignored).

---

## Long-Term: Differentiation (Months 4-6)

Features that would make the engine genuinely unique in the ecosystem.

### MCP Server Mode

Expose the analysis as a real-time service that AI tools query via Model Context Protocol:

```bash
autodocs-engine serve
```

Instead of generating a static file, the engine answers questions on demand:
- "What are the conventions in this package?"
- "What's the public API of this module?"
- "How do I add a new detector?"
- "What files would be affected if I change types.ts?"

**Why this is a game changer:** A static AGENTS.md drifts the moment code changes. An MCP server is always current. AI tools get live, contextual answers instead of reading a file that may be stale.

**Requires:** Incremental analysis (for performance), MCP protocol implementation, process management.

### Deep Pattern Recognition

Go beyond "all files in this directory share these imports" to understanding **architectural patterns**:

- **Factory patterns:** "All services are instantiated via `createService()` in `service-registry.ts`"
- **Middleware chains:** "Request handlers are composed in order in `app.ts` — ordering matters"
- **State machine patterns:** "Status transitions follow: draft → review → approved → published"
- **Observer patterns:** "Events are emitted via `eventBus.emit()` — subscribers registered in `listeners/`"

These require recognizing higher-level code structures from AST patterns, not just counting imports. Each pattern type needs a dedicated detector, similar to how convention detectors work.

**Implementation:** New `pattern-detectors/` directory with detectors for each architectural pattern. Each detector examines the call graph, export shapes, and directory structure to identify the pattern. Results surface in the Architecture section with specific operational guidance.

### Multi-Language Support

TypeScript-only limits the addressable market to ~30% of AGENTS.md users. The architecture is modular enough that language-specific modules (parser, convention detectors, symbol graph) could be swapped:

| Language | Parser | Effort | Market Impact |
|----------|--------|--------|--------------|
| Python | tree-sitter | ~3K lines | High — AI/ML community |
| Go | go/ast | ~2K lines | Medium — cloud infrastructure |
| Rust | syn + tree-sitter | ~3K lines | Medium — systems tooling |

The pipeline orchestrator, formatter, output validator, and LLM adapter are language-agnostic. The language-specific work is in: file discovery (extensions), AST parsing (exports/imports/signals), symbol graph (module resolution), convention detectors (language-specific patterns), and tier classification.

**Approach:** Start with Python via tree-sitter. Build a `python-parser.ts` that produces the same `ParsedFile` interface as `ast-parser.ts`. Everything downstream works unchanged.

### Quality Score

0-100 score measuring **AI-readability** — not code quality per se, but how easy the codebase is for AI coding tools to work with:

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| Type safety | 20% | Strict mode, `any` usage, typed exports |
| Test coverage ratio | 20% | Test files per source file |
| Documentation | 15% | JSDoc on public API, README presence |
| Convention consistency | 15% | How uniform naming, structure, patterns are |
| API surface clarity | 15% | Barrel files, clear entry points, typed signatures |
| Architecture coherence | 15% | Layering violations, circular deps, coupling score |

Novel signal: "Your codebase scores 72/100 for AI-readability. Here's what would improve it." Creates a continuous improvement loop.

---

## Game-Changers: High Effort, High Reward

Features that would transform the tool from "useful" to "essential" but require careful design and significant engineering.

### Codemod Generation

When the engine detects a migration opportunity (e.g., React 18 → 19, Express 4 → 5, CJS → ESM), generate a jscodeshift transform that automates it.

```bash
npx autodocs-engine migrate react-19
# Generates: migrations/react-19.ts
# Transforms: forwardRef → ref-as-prop, useContext → use(), etc.
```

The engine already knows the framework version, the relevant API surface, and the patterns in use. Generating a codemod from this data is a natural extension.

### Cross-Repository Analysis

For organizations with 10+ repositories, analyze the entire portfolio:
- Shared conventions across repos (or divergent ones)
- Technology version spread (which repos are on React 18 vs 19?)
- Dependency graph between repos (which repo is the most depended-on?)
- Organizational "super-AGENTS.md" that covers the whole ecosystem

### AI Tool Feedback Loop

Instead of generating a static file and hoping it helps, measure whether AI tools actually produce better code when reading the AGENTS.md:

1. Generate AGENTS.md for a repo
2. Give an AI tool a coding task with and without the AGENTS.md
3. Measure: does the output follow conventions? Use correct commands? Match architecture?
4. Feed results back to improve what the engine generates

This closes the loop from "we think this helps" to "we measured that this helps by X%."

---

## Known Limitations

These are fundamental constraints of the current approach, not bugs.

1. **Domain knowledge ceiling.** AST analysis cannot infer project-specific terminology, design rationale, or tribal knowledge. The Team Knowledge section bridges this gap by asking specific questions and (in future) pre-filling partial answers.

2. **TypeScript only.** No Python, Go, Rust, or other language support. The AST parser, convention detectors, and symbol graph are deeply TypeScript-specific.

3. **Static output.** AGENTS.md files drift as code changes. The GitHub Action and staleness detection mitigate this, but MCP server mode is the real solution.

4. **Single entry point.** Packages with `exports` subpaths are analyzed at the main `.` entry only.

5. **No semantic understanding.** The engine knows WHAT the code does structurally but not WHY it's designed this way. The Architecture section uses a micro-LLM for capabilities, but rationale requires human input.

---

## Explicitly Deprioritized

- **Watch mode.** GitHub Action + staleness check covers "keep it updated." Watch mode is useful in dev but rarely remembered.
- **More output formats.** AGENTS.md, CLAUDE.md, .cursorrules, JSON covers the market. Add formats on user demand.
- **More TypeScript convention detectors.** The 8 detectors cover major patterns. Long-tail detectors (Redux Toolkit slices, tRPC routers) should be community plugins via the existing plugin system.
- **Interactive CLI.** Prompts like "which packages to analyze?" add friction. The init command auto-detects everything — zero friction is the goal.
