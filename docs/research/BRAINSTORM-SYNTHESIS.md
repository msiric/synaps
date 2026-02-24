# Brainstorm Synthesis: Product Direction

**Models consulted:** Gemini, Opus, Grok, GPT-4, MiniMax, GLM
**Date:** 2026-02-23

## The Verdict: Unanimous on 5 Points

Every single model independently reached the same conclusions:

### 1. The MCP server is the real product
> "Stop generating documents. Start serving intelligence." — Opus
> "MCP is the 'Spotify' — streaming exactly what's needed, when needed." — Gemini
> "The MCP server is the product. Everything else is distribution." — GLM

The research is clear: focused, task-specific context helps; static comprehensive context hurts. The MCP server architecturally solves this — each tool returns only what's relevant to the current query.

### 2. Static AGENTS.md becomes a fallback export, not the product
Every model agreed: keep AGENTS.md generation as a compatibility layer for tools without MCP, but stop treating it as the primary offering. The data doesn't support "generate a comprehensive markdown file" as a value proposition.

### 3. Publish the benchmark results — it's the best marketing asset
> "This is your single highest-leverage marketing asset." — Opus
> "Honesty sells. Developers are tired of AI hype." — Gemini
> "Being first with real data — even mixed/negative data — is a massive credibility signal." — MiniMax

The blog post writes itself: "We built an AGENTS.md generator, benchmarked it honestly, found static files can hurt, and rebuilt around that finding."

### 4. Ship NOW — stop waiting for perfect data
477 tests, working MCP server, CLI ready. Every model said the same thing: publish to npm and get real users. Benchmark perfectionism is blocking shipping.

### 5. Documentation drift / sync is the real unsolved problem
> "Generate is a commodity; maintain is a subscription." — Gemini
> "The recurring value is in the diff." — Gemini
> "Nobody has built a robust tool that automatically generates AND keeps AGENTS.md in sync." — Research agent

The `check` command + a GitHub Action is the clearest path to recurring value.

## Strong Consensus (5/6 Models)

### 6. Convention enforcement is the hidden gem
Deterministic convention detection from actual codebase patterns (not pre-configured rules) is the genuinely novel capability no competitor has. Every model recognized this as the strongest technical differentiator.

### 7. Position as "deterministic codebase intelligence"
Not "auto-generate AGENTS.md." The positioning is:
- "Less context, better results" (GPT)
- "The Source of Truth for your AI Agents" (Gemini)
- "Deterministic codebase intelligence — no hallucinations, no kitchen sink" (GPT)

### 8. The benchmark measured the wrong thing
Multiple models pointed out that file placement (our primary metric) is too easy — all conditions tied at 100% on 77% of tasks. The real value of AGENTS.md is likely in convention adherence (naming, imports, patterns) and integration behaviors (barrel updates, registration) — which we barely measured.

## The 2-Week Convergent Plan

Almost every model proposed a similar 2-week plan:

### Week 1: Ship and Publish
1. **npm publish v0.5.0** — MCP server as headline feature, AGENTS.md generation as secondary
2. **Add `--minimal` mode** — <500 token AGENTS.md with only non-inferrable conventions + commands
3. **Write the "honest data" blog post** — Lead with negative findings, pivot to MCP-first
4. **Polish MCP server docs** — Installation guide, integration examples for Cursor/Claude Code

### Week 2: CI + Users
5. **Build GitHub Action** for drift detection (wraps existing `check` command)
6. **Get 10-20 real users** — HN launch, relevant subreddits, Twitter/X
7. **Measure what matters** — Track which MCP tools get called, how often, user feedback
8. **Iterate based on real usage data** — not benchmarks, not hypotheses

## Key Divergence: Developer Onboarding

The one area of disagreement:

| Model | Onboarding? |
|-------|-------------|
| Gemini | NO — stick to AI context market (growing fast) |
| Opus | Partial — secondary positioning alongside AI tools |
| Grok | YES — proven ROI (80% time reduction) |
| GLM | Strong YES — clearer buyer, proven budget |
| GPT | Partial — parallel track using same pipeline |
| MiniMax | Maybe — different market entirely |

**Resolution:** Add human-readable output as a secondary capability, don't make it the primary positioning. Same pipeline, two audiences. Use the phrase "Docs so good even your humans can use them" (Gemini).

## Ranked Directions

| # | Direction | Evidence | Leverage | Time | Revenue | Consensus |
|---|-----------|----------|----------|------|---------|-----------|
| 1 | **MCP-First Intelligence API** | Strong | High (exists) | 2-3 wk | Medium-High | 6/6 |
| 2 | **CI Drift Detection + Sync** | Strong | High (check cmd) | 2-3 wk | Medium | 6/6 |
| 3 | **Convention Enforcement** | Medium | Medium | 3-4 wk | Medium-High | 5/6 |
| 4 | **Minimal AGENTS.md (validation)** | Medium | Highest | 1 wk | Low | 4/6 |
| 5 | **Developer Onboarding** | Medium | Medium | 3-4 wk | Medium | 3/6 |

## The One-Sentence Strategy

> **The pipeline is the product, not any single output format. Serve intelligence dynamically (MCP), keep it honest automatically (CI), and treat AGENTS.md as a compatibility layer.**

## What to Keep, Add, Deprecate

**Keep:**
- 18-stage deterministic pipeline (the core asset)
- Inferability scoring (right instinct — less is more)
- Co-change analysis (unique differentiator)
- Convention detection (strongest technical moat)
- MCP server (the primary product)

**Add:**
- `--minimal` mode (<500 tokens)
- GitHub Action for drift/sync
- Path-scoped MCP queries (only conventions for THIS directory)
- `get_task_context` composite tool
- Confidence scores / warnings on ambiguous sections

**Deprecate (as default):**
- Kitchen-sink AGENTS.md generation (keep as `--full` flag)
- Comprehensive static file as primary output
- The idea that more context = better
