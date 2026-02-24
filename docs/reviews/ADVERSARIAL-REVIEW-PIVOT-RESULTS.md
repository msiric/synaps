# Adversarial Review Results: AGENTS.md Content Pivot

## Review Context

Four flagship AI models (GPT-5, Claude Opus 4.6, Grok 4, Gemini 3 Pro) reviewed the proposed AGENTS.md content pivot. The pivot was prompted by benchmark results showing AGENTS.md provides -1.4% marginal value for contribution pattern adherence on autodocs-engine (52 files) and +9.0% on knip (2,427 files).

All four models returned **REVISE** or equivalent. None approved the pivot as proposed.

---

## Universal Consensus (All 4 Models)

### 1. n=2 Is Not Enough to Pivot the Product

All four models flag the sample size as critically insufficient:

- **Gemini:** "Pivoting on n=2 risks confirmation bias. If expanded benchmarks contradict, you'll have to un-pivot."
- **Opus:** "7 tasks total across 2 repos. Statistical power is essentially zero. A single ambiguous grading decision swings results by 14%."
- **Grok:** "N=2 repos with only 7 total tasks is woefully underpowered. It's like A/B testing a UI change on 2 users and redesigning the app."
- **GPT:** "n=2 repos and k=7 tasks targeting a single outcome is not enough to remove entire sections."

**Recommendation:** Run 5-10+ repos with 50+ total tasks before making product decisions.

### 2. "AI Can Infer X" Is the Wrong Primary Filter

All four identify the logical gap between capability and utility:

- **Opus:** "The right filter is 'what information, if absent, would cause the AI to write incorrect or inconsistent code?' This reframes from capability to consequence."
- **Gemini:** "'Inferring from sibling files' requires the model to retrieve, analyze, synthesize, and apply. Pre-computation is always cheaper."
- **GPT:** "Even if the LLM can read 2-3 siblings, pre-computing removes a planning step and token traffic. Measure TTI (time-to-insight) and TTR (time-to-resolve)."
- **Grok:** "The benchmark measured correctness, not time/token cost. Run efficiency tests."

**Better filter:** consequence of absence × probability of wrong inference × token cost of inference.

### 3. The +9% on Knip Supports Conventions, Not Removing Them

Three of four models explicitly flag this contradiction:

- **Opus:** "You have one data point that's mildly negative and one that's positive, and you're treating the negative one as the headline."
- **Gemini:** "By pivoting away from patterns based on the small-repo result, you sacrifice the 9% lift for enterprise-scale users."
- **GPT (paraphrased):** "The knip +9.0% is the more important signal because it reflects real-world sampling behavior in large repos."

**Implication:** Conventions may be valuable specifically in large, complex repos — the target audience.

### 4. The MCP Server IS the Product

All four converge on this strategic direction:

- **Opus:** "Your benchmark proved that the analysis pipeline is the product, not the document. Build the MCP server. Let the AI query the full, uncompressed intelligence when it needs it."
- **Gemini:** "Static files are limited to O(1) context. MCP allows O(N) context via tool calling."
- **GPT:** "Ship a minimal MCP server with five queries: commands.get(), workflows.get(), impact.analyze(diff), cochange.suggest(files), api.topExports()."
- **Grok:** "Position as 'Codebase Intelligence API platform' centered on the MCP server."

**Key insight:** The static AGENTS.md is a lossy compression of rich intelligence. MCP eliminates the compression problem entirely.

### 5. The Benchmark Infrastructure Is the Hidden Gem

All four see the benchmark as a product differentiator:

- **Grok:** "Make it a standalone tool/product feature for testing any AGENTS.md."
- **Opus:** "Package as: 'autodocs benchmark --context-file .agents.md --repo . --tasks 20'. This becomes a validation tool, sales tool, research tool, and feedback loop."
- **Gemini:** "Publish: 'We proved that 40% of standard context files are useless noise to Claude. So we built an engine that only gives the AI what it can't figure out on its own.'"
- **GPT:** "Turn the benchmark into the product's proof loop. Instrument time-to-green, token budget, and tool actions."

### 6. Publish the Honest Results

All four agree transparency builds credibility:

- **Gemini:** "Title: 'Why we deleted 50% of our code.' This establishes massive credibility in a hype-filled AI tools market."
- **GPT:** "Frame as 'we measured, then we cut the fluff; here's the data.'"
- **Opus:** "If the AI can infer everything from source, maybe the real user of AGENTS.md is the human developer new to the codebase."

---

## Key Disagreements With the Proposed Pivot

| Pivot Decision | Reviewer Consensus | Severity |
|---|---|---|
| Remove conventions from default output | **Wrong** — compress, don't remove. Keep architectural conventions, cut style rules only | Critical |
| Target 50 rules | **Arbitrary** — optimize by signal quality, not count. 700 tokens is negligible in modern context windows | Medium |
| "Lost in the middle" section reordering | **Doesn't apply** — document is 700 tokens, not 32K. No "middle" to get lost in | Low |
| Build lean AGENTS.md before MCP | **Wrong order** — MCP first, let usage data inform static file content | High |
| Remove Mermaid diagrams | **Agree** — zero AI value | Low |
| Remove dependency graph | **Agree** — inferable from project structure | Low |
| Remove title/summary | **Mixed** — Opus says petty optimization (5 tokens), others agree with removal | Low |

---

## Revised Priority Stack (Consensus Across All 4 Models)

### Priority 1: Expand Benchmarks (1-2 weeks)

Before any product changes:
- Run on 5-10 repos of varying size and complexity
- Test MORE than contribution patterns — add commands, workflow rules, change impact, co-change
- Measure efficiency (tokens, time, tool calls), not just correctness
- Measure consistency across sessions
- Pre-register the study design for credibility

### Priority 2: Build MCP Server (2-4 weeks)

The strategic pivot that all four models endorse:
- 5 core endpoints: commands, workflows, impact, co-change, top exports
- Pipeline already computes everything needed — this is a query layer, not new analysis
- Eliminates instruction budget problem entirely (serve what's needed per task)
- Enables usage data collection (which queries get made → what's actually valuable)
- Competitive window: few production-grade code intelligence MCP servers exist yet

### Priority 3: Minimal AGENTS.md Trim (1 week)

Only uncontroversial cuts:
- Remove Mermaid diagrams, dependency graph, supported frameworks
- Compress dependency table to top 5
- Cap Public API at top 10
- Keep conventions compressed (not removed)
- Everything else stays as-is until benchmark data justifies changes

### Priority 4: Benchmark as Product Feature

Package the benchmark for anyone to test any AGENTS.md:
- Validation tool for handwritten context files
- Sales tool ("our generated AGENTS.md scores X%, handwritten average Y%")
- Research tool (run across many repos → publish findings)
- Feedback loop (which sections correlate with higher scores)

### Priority 5: Publish Findings

The honesty angle is the moat:
- "We measured our own product. Here's what we found."
- "40% of typical context files are noise. Here's the data."
- Blog post + benchmark data + methodology = credibility in a hype market

---

## What NOT to Build (Consensus)

- More convention detectors (the 8 existing are sufficient)
- Style/formatting rules in AGENTS.md (linters handle this)
- VS Code extension (premature before MCP proves value)
- Multi-language support (not ready to scale; benchmark is the gate)
- Chat UI / LLM wrapper (be the plugin, not the platform)
- Vector database / embeddings (your moat is AST-level structural understanding)
- Verbose output mode as a long-term product (maintenance burden; MCP replaces it)

---

## The One Thing (Per Model)

- **Gemini:** "Double down on Change Impact and Co-change Clusters. No other tool tells an LLM: 'Warning: 85% of PRs that touched this file also required a database migration.'"
- **Opus:** "Your benchmark proved that the analysis pipeline is the product, not the document. Stop compressing. Start serving."
- **Grok:** "Run more benchmarks before pivoting. The entire pivot rests on n=2 data with contradictory results."
- **GPT:** "Prove, with public data, that your lean AGENTS.md + MCP cuts time-to-green and token cost by >20% on 5+ real repos."

---

## Strategic Synthesis

The engine is at a fork:

**Path A (proposed pivot):** Optimize the static AGENTS.md by cutting sections. This is compression optimization — making a lossy format slightly less lossy.

**Path B (reviewer consensus):** Build the MCP server that serves the FULL analysis on demand. The static file becomes a lightweight fallback. The analysis pipeline — which is genuinely excellent — gets directly exposed to AI tools.

All four models recommend Path B. The pipeline IS the product. The document is an artifact. Stop optimizing the artifact and expose the pipeline.

**The MCP server answers questions that static files fundamentally cannot:**
- "I'm about to modify pipeline.ts — what's the blast radius?"
- "What co-changes with types.ts?"
- "What's the contribution pattern for src/detectors/?"
- "What commands should I run after modifying the schema?"

These are contextual, task-specific, and can't be pre-compressed into a static file without waste.
