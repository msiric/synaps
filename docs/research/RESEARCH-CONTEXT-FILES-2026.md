# Research Synthesis: Do Context Files Help AI Coding Agents? (2026)

**Date compiled:** 2026-02-23
**Purpose:** Inform synaps benchmark v2 design and product positioning

## The Key Paper: "Evaluating AGENTS.md" (arxiv 2602.11988, Feb 2026)

**Directly studies our problem.** Tests whether AGENTS.md files improve coding agent task completion.

### Setup
- **SWE-bench Lite**: established popular repositories
- **AGENTbench**: 138 unique Python tasks across 12 recent/niche repositories (developer-written context files)
- Three conditions: no context, LLM-generated context, developer-provided context
- Multiple LLMs and prompt strategies tested

### Results

| Context Type | SWE-bench Lite | AGENTbench | Cost Impact |
|---|---|---|---|
| No context file | baseline | baseline | baseline |
| LLM-generated context | **-0.5%** | **-2.0%** | **+20% cost** |
| Developer-written context | — | **+4.0%** | **+20% cost** |

### Why LLM-Generated Files Hurt
- Agents faithfully follow ALL instructions in context files
- Most instructions are **unnecessary for the specific task**
- Directives like "follow style guides" and "use specific test patterns" add complexity without improving outcomes
- Context files added unnecessary requirements that complicated issue resolution

### Authors' Recommendation
> Omit LLM-generated context files entirely. If using developer-written files, include only minimal critical requirements.

### Implications for synaps
- Our 14/16 deterministic approach avoids the "LLM hallucination/over-specification" problem
- The inferability gating (skip sections for standard repos) directly addresses "unnecessary instructions"
- We need to prove our output is more like developer-written (+4%) than LLM-generated (-2%)
- The 20% cost increase is a positioning risk — we need to show efficiency gains, not just accuracy

---

## Supporting Research

### ContextBench (arxiv 2602.05892, Feb 2026)

**What it measures:** Context retrieval quality in coding agents.

**Scale:** 1,136 tasks, 66 repos, 8 languages, 522K lines of human-annotated gold context.

**Key findings:**
- Higher context recall correlates with higher Pass@1 — right context helps
- **Multiple valid solutions have 0.9518 Jaccard similarity in required context** — the "right context" is stable even when implementations differ
- All systems show high recall but low precision (agents retrieve too much context)
- "Evidence Drop": agents see relevant code but fail to retain/use 50-70% of it
- Sophisticated scaffolding yields only marginal gains in retrieval

**Relevance:** Validates that pre-curated context (like AGENTS.md) could bypass the retrieval/retention gap. The 0.9518 Jaccard finding partially addresses the "multiple valid solutions" concern for our benchmark.

### SWE Context Bench (arxiv 2602.08316, Feb 2026)

**What it measures:** Can agents reuse experience from related tasks?

**Scale:** 300 base tasks + 99 related tasks with dependency relationships.

**Key findings:**
- **Only correctly-selected, summarized experience reliably helps**
- Unfiltered or incorrectly selected experience is negative or neutral
- Oracle summaries (~204 words) reduce runtime by >60% on hardest tasks
- Cost reduction: $0.77/instance (oracle summary) vs $0.98/instance (free experience)

**Relevance:** Directly parallel to our findings. Maps to: well-curated AGENTS.md = oracle summary (helps), kitchen-sink AGENTS.md = unfiltered experience (hurts). The 204-word average sweet spot is a useful data point for our output sizing.

### AGENTS.md Efficiency Impact (arxiv 2601.20404, Jan 2026)

**What it measures:** Runtime and token consumption with/without AGENTS.md on real PRs.

**Scale:** 10 repos, 124 pull requests, two conditions.

**Key findings:**
- **28.64% reduction in median runtime** with AGENTS.md
- **16.58% reduction in output token consumption**
- Comparable task completion (no degradation)

**Relevance:** Contradicts the cost-increase finding from 2602.11988. Difference appears to be content quality: focused practical guidance (real AGENTS.md files) reduces work; broad LLM-generated instructions increase it. Validates our focus on deterministic, minimal output.

### Context-Bench / ACE Framework (arxiv 2510.04618, Oct 2025)

**What it measures:** Agentic context engineering capability.

**Key findings:**
- +10.6% on agent benchmarks with ACE framework
- **Contamination-proof design** using fictional entities in SQL databases

**Relevance:** The contamination-proofing methodology (fictional entities) is interesting but not directly applicable. The overall finding supports context engineering value.

---

## Convergent Findings Across All Papers

### 1. Quality > Quantity
Every paper reaches the same conclusion: **curated, minimal, accurate context helps. Verbose, unfiltered, over-specified context hurts.**

| Paper | Minimal/Curated | Verbose/Unfiltered |
|---|---|---|
| Evaluating AGENTS.md | Developer-written: +4% | LLM-generated: -2% |
| SWE Context Bench | Oracle summary: +efficiency | Free experience: neutral/negative |
| AGENTS.md Efficiency | Focused files: -29% runtime | — |
| ContextBench | High recall + precision: +Pass@1 | High recall, low precision: less impact |

### 2. The "Unnecessary Requirements" Problem
LLM-generated context files include instructions that are correct but irrelevant to the specific task. The agent spends effort following style guides, test patterns, and naming conventions that don't affect the outcome. This increases cost without improving results.

**Our mitigation:** Inferability gating. If the repo's patterns are obvious from source code, skip those sections. Only include what the AI can't infer on its own.

### 3. Context Stability Across Solutions
ContextBench found 0.9518 Jaccard similarity in required context across different valid solutions. This means: even though there are many valid implementations, they all need roughly the same context. Our benchmark's "single ground truth" approach is less problematic than we feared — the scoring dimensions most affected (imports, exports) can be de-emphasized.

### 4. Efficiency Is a Valid Metric
The efficiency paper (2601.20404) found 29% runtime reduction and 17% token reduction. If we can't prove accuracy gains, we might be able to prove efficiency gains. This is worth measuring in our benchmark.

---

## What This Means for Benchmark V2

### Stronger Position
1. Our 14/16 deterministic approach avoids the exact problem that makes LLM-generated files fail
2. Our inferability gating directly addresses the "unnecessary requirements" problem
3. File placement as primary metric is validated — it's a clean signal not affected by implementation variance
4. The ContextBench 0.9518 finding means single-ground-truth comparison is more valid than we feared

### Risks
1. If our engine's output looks more like "LLM-generated" than "developer-written," we'll see negative results
2. The +4% ceiling for developer-written files is modest — even the best case isn't dramatic
3. The 20% cost increase is real and must be addressed (either show it doesn't apply to us, or show efficiency gains)

### New Comparison Point
We should frame our results against the 2602.11988 findings:
- LLM-generated files: -0.5% to -2% (the problem we're solving)
- Developer-written files: +4% (the ceiling we're approaching)
- Our engine: [to be measured] (the gap between these)

If we can show our deterministic output achieves closer to +4% than -2%, that's a compelling story: "automated generation that works like developer-written files."

---

## Sources

- [Evaluating AGENTS.md (2602.11988)](https://arxiv.org/abs/2602.11988)
- [ContextBench (2602.05892)](https://arxiv.org/abs/2602.05892)
- [SWE Context Bench (2602.08316)](https://arxiv.org/abs/2602.08316)
- [AGENTS.md Efficiency (2601.20404)](https://arxiv.org/abs/2601.20404)
- [Context-Bench/ACE (2510.04618)](https://arxiv.org/abs/2510.04618)
- [Evaluating AGENTS.md - Hacker News Discussion](https://news.ycombinator.com/item?id=47034087)
- [Packmind: Writing AI coding agent context files](https://packmind.com/evaluate-context-ai-coding-agent/)
