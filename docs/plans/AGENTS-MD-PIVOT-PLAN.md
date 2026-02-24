# AGENTS.md Content Pivot Plan

## Why We're Pivoting

### The Benchmark Evidence

We built a rigorous A/B/C/N benchmark system to measure whether AGENTS.md actually helps AI tools write better code. The system tests 4 conditions:
- **A (Treatment):** AGENTS.md + sibling files + dir listing + registration files
- **B (Realistic Control):** Sibling files + dir listing + registration files (no AGENTS.md)
- **C (Impoverished):** Dir listing + registration files only
- **N (Negative):** Shuffled AGENTS.md + dir listing + registration files

Results across 3 repos:

| Repo | Files | A (AGENTS.md) | B (Source only) | C (Listing) | N (Shuffled) | A - B |
|------|-------|:---:|:---:|:---:|:---:|:---:|
| autodocs-engine | 52 | 76.8% | 78.2% | 36.4% | 62.4% | **-1.4%** |
| knip | 2,427 | 50.0% | 41.0% | 0.0% | 41.0% | **+9.0%** |
| Vercel AI SDK | 355 | — | — | — | — | *no patterns* |

**Headline finding:** AGENTS.md provides essentially zero marginal value for contribution pattern adherence when the AI already has source code access. Claude Sonnet infers patterns from reading 2-3 sibling files just as accurately as from the AGENTS.md synthesis.

**But:** Dir listing alone (C) consistently fails (36.4%, 0%). The AI needs SOME code context. And shuffled AGENTS.md (N) scores lower than real source, confirming content matters — but source code IS the content.

### What This Means

The engine's most developed sections — convention detection (8 detectors), contribution patterns (deep analysis with common imports, export suffixes, registration files), file naming conventions — are solving a problem that doesn't exist for AI tools with file access. Modern AI models are excellent at pattern matching from examples.

The engine's value is NOT in telling AI tools how to write individual files. It's in providing information the AI genuinely cannot compute efficiently on its own.

### Research Confirmation

Three parallel research investigations confirmed the pivot direction:

**1. Section-by-section value analysis** — Evaluated every AGENTS.md section against "can the AI infer this from reading source files?" Results:
- Commands, workflow rules, change impact, team knowledge: AI CANNOT infer these
- Conventions, contribution patterns, file naming: AI CAN infer these from sibling files
- Dependencies, supported frameworks, Mermaid diagrams: Redundant with package.json/project structure

**2. Industry research** — Vercel (8KB beats 40KB), Anthropic (answer 4 questions only), HumanLayer (<60 lines ideal), Martin Fowler (workflow rules > code style rules), community consensus (linter rules don't belong in AGENTS.md)

**3. Instruction budget economics** — Current output averages 88 rules, 700 tokens, 74% of budget. ~50% is low/negative value content. A "50-rule AGENTS.md" retains 95% of actionable value at half the token cost.

## The Pivot: From Pattern Instructions to Operational Intelligence

### Current Output (16 sections, ~88 rules, ~700 tokens)

```
1.  Title                    → REMOVE (redundant with package.json)
2.  Summary                  → REMOVE (redundant with package.json)
3.  Tech Stack               → SHRINK to one line with version guidance
4.  Commands                 → KEEP AND EXPAND (highest value)
5.  Package Guide            → KEEP AS-IS (monorepo only)
6.  Architecture (LLM)       → KEEP, compress
7.  Workflow Rules            → KEEP AND EXPAND (highest value)
8.  Domain Terminology (LLM) → SHRINK to non-obvious terms only
9.  Contributing (LLM)       → MERGE into workflow rules
10. How to Add Code          → KEEP BUT COMPRESS (benchmark showed partial redundancy)
11. Public API               → SHRINK to top 10 by import count
12. Dependencies             → SHRINK to top 5 external
13. Dependency Graph         → REMOVE (visible from project structure)
14. Mermaid Diagram          → REMOVE (visual only, no AI value)
15. Conventions              → SHRINK to non-obvious patterns only (remove style rules)
16. Change Impact            → KEEP AND EXPAND (highest value)
17. Supported Frameworks     → REMOVE (visible from dependencies)
18. Team Knowledge           → KEEP (irreplaceable human input)
```

### Target Output (~50 rules, ~350 tokens)

**Tier 1 — Must-Have (non-inferable, ~35 rules):**
- Commands (8 rules) — exact build/test/lint/start with monorepo variants
- Workflow Rules + Co-change (8-10 rules) — "after X run Y", "when modifying X check Y"
- Change Impact (8-10 rules) — high-impact functions with transitive caller counts
- Team Knowledge (5-7 rules) — prompted questions for human input

**Tier 2 — Should-Have (saves AI work, ~12 rules):**
- Architecture (4-6 bullets) — entry points, layer structure, key patterns
- How to Add Code (4-6 rules) — compressed contribution recipes
- Public API (top 10 exports by import count)

**Tier 3 — Compressed Metadata (~3 rules):**
- Tech Stack (single line: "Node 20 | TypeScript 5.4 | Vitest 2")
- Key Dependencies (top 5 external by import frequency)

**Cut entirely:**
- Convention/style rules (linters handle this)
- Dependency tables (visible in package.json)
- Title/summary (redundant)
- Mermaid diagrams (visual-only)
- Supported frameworks (visible in deps)
- Verbose domain terminology

### Section Ordering (Optimized for AI Attention)

Research shows AI models attend most strongly to the beginning and end of context, with "lost in the middle" degradation. New section order puts highest-value content first:

```
1. Commands (highest usage, exact facts)
2. Workflow Rules + Co-change Clusters (operational sequences)
3. Change Impact (blast radius, non-obvious)
4. Architecture (system-level orientation)
5. How to Add Code (compressed recipes)
6. Public API (top 10)
7. Tech Stack (one line)
8. Team Knowledge (at end — for human readers, not AI)
```

### Implementation Changes

**In `src/deterministic-formatter.ts`:**
- Reorder sections by value (commands first, not title first)
- Remove: `formatTitle()`, `formatSummary()`, `formatDependencies()` (verbose version), `formatDependencyGraph()`, `formatMermaidDiagram()`, `formatSupportedFrameworks()`
- Shrink: `formatPublicAPI()` (cap at 10, not 20 per kind), `formatConventions()` (remove style rules, keep only architecture patterns)
- Expand: `formatWorkflowRules()` (include co-change clusters prominently), `formatChangeImpact()` (more detail on transitive callers)
- New: `formatTechStackCompact()` (single-line version + guidance)

**In `assembleFinalOutput()`:**
- New section ordering
- Reduce MAX_RULES from 120 to 60
- Add `--full-output` flag to restore verbose mode for users who want it

**In `src/budget-validator.ts`:**
- Lower MAX_RULES from 120 to 60
- Remove style rule detection (they won't be in the output)

**No changes to:**
- Pipeline stages (all analysis still runs — data is still collected)
- Types (PackageAnalysis still has all fields)
- Convention detectors (still run — output is just filtered at format time)
- Import chain / git history (these EXPAND in the new output)
- CLI flags (backwards compatible)

### Backwards Compatibility

- Default output changes (leaner, higher-value)
- `--verbose` or `--full-output` flag restores all sections for users who want them
- JSON output unchanged (all analysis data still present)
- No breaking changes to types or library API

## What Comes After

### Immediate (this pivot)
- Reorder and shrink AGENTS.md sections
- Reduce budget from 120 to 60 rules
- Add --full-output escape hatch

### Next (MCP server)
- The pivot makes MCP more natural: the engine computes MORE than it outputs
- The "hidden" analysis (full conventions, all patterns, complete API) becomes queryable via MCP
- Static AGENTS.md = summary of what matters always. MCP = deep dive on demand.

### Validation
- Re-run benchmark after pivot on autodocs-engine + knip
- Compare: does the leaner output score the same or better on contribution pattern tasks?
- Test new hypothesis: does the leaner output leave more context window for the AI to use on the actual task?
