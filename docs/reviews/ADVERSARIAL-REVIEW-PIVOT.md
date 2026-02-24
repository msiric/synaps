# Adversarial Review: AGENTS.md Content Pivot

You are a senior principal engineer and product strategist conducting an adversarial review. Your job is to challenge the reasoning, find gaps in the logic, and suggest where this project should go next for maximum utility and impact. Be specific, constructive, and brutally honest.

## Background

`autodocs-engine` is a TypeScript codebase intelligence engine that generates AGENTS.md context files for AI coding tools (Claude Code, Cursor, Copilot). It analyzes codebases via AST parsing and produces 16-section output files with conventions, contribution patterns, commands, workflow rules, change impact analysis, and more.

The engine is at a critical inflection point. We built a benchmark system to measure whether AGENTS.md actually helps AI tools write better code. The results challenged our core assumptions.

## The Benchmark Results

We ran a rigorous A/B/C/N benchmark:
- **A (Treatment):** AGENTS.md + sibling source files + directory listing
- **B (Realistic Control):** Sibling source files + directory listing (no AGENTS.md)
- **C (Impoverished):** Directory listing only
- **N (Negative Control):** Shuffled AGENTS.md + directory listing

Results:

| Repo | A (AGENTS.md) | B (Source only) | C (Listing) | N (Shuffled) | A - B |
|------|:---:|:---:|:---:|:---:|:---:|
| autodocs-engine (52 files) | 76.8% | 78.2% | 36.4% | 62.4% | **-1.4%** |
| knip (2,427 files) | 50.0% | 41.0% | 0.0% | 41.0% | **+9.0%** |
| Vercel AI SDK (355 files) | — | — | — | — | *no patterns found* |

**Key finding:** AGENTS.md provides essentially zero marginal value for contribution pattern adherence when the AI already has source code access. Claude Sonnet can infer file-level patterns (imports, naming, exports, registration) from reading 2-3 sibling files just as accurately as from AGENTS.md.

**Important caveats:** The benchmark ONLY tested contribution pattern adherence. It did NOT test commands, workflow rules, change impact, architecture orientation, or any of the other 12 sections.

## The Proposed Pivot

Based on these results plus research from Vercel, Anthropic, HumanLayer, and Martin Fowler, we're proposing:

1. **Shrink AGENTS.md from ~88 rules / 700 tokens to ~50 rules / 350 tokens**
2. **Remove sections AI can infer from source:** verbose convention lists, dependency tables, title/summary, Mermaid diagrams, supported frameworks
3. **Keep and expand sections AI cannot infer:** commands, workflow rules, co-change clusters, change impact, team knowledge
4. **Reorder sections** by value (commands first, team knowledge last) based on "lost in the middle" research
5. **Add --full-output flag** for backwards compatibility
6. **Then build MCP server** as the next major feature — live, contextual queries instead of static document

The complete pivot plan is in `AGENTS-MD-PIVOT-PLAN.md`. Read it fully before starting your review.

## What We Want From You

We want TWO things from this review:

### Part 1: Challenge the Pivot Logic

Attack the reasoning. Specifically:

1. **Is the benchmark valid enough to drive this pivot?** We tested contribution patterns on 2 repos (one failed to produce tasks). Is n=2 with 7 total tasks enough evidence to restructure the product? Should we run more benchmarks before committing?

2. **Are we throwing away the right things?** The plan removes convention lists and contribution patterns from default output. But Vercel's research showed naming conventions ARE effective ("Guides create_file and edit_file decisions"). Are we conflating "AI can infer X from siblings" with "X has no value in AGENTS.md"? Maybe the value is CONSISTENCY — AGENTS.md ensures ALL sessions follow conventions, not just sessions where the AI happens to read the right files.

3. **Is the "50-rule" target right?** Research says first 50 rules get near-perfect adherence, 50-150 has slippage. But our output currently has 88 rules at 74% budget. Are we solving a real problem or optimizing for a theoretical concern?

4. **Is "AI can infer this" the right filter?** AI can infer a lot of things, but inferring takes time and context window. AGENTS.md pre-computes the answer. Even if the AI CAN read 3 sibling files, is it faster/cheaper/more reliable to give it the synthesized answer? The benchmark tested correctness, not efficiency.

5. **Are workflow rules actually harder for AI to infer?** We claim "after modifying schema.prisma, run db:generate" can't be inferred from code. But an AI with access to package.json scripts and Prisma docs could figure this out. Are we sure the "keep" sections are genuinely non-inferable, or are we just assuming?

### Part 2: Strategic Direction

Tell us where this project should go for maximum utility. Consider:

1. **Product positioning:** Is autodocs-engine a document generator, a codebase intelligence API (MCP), a CI quality gate, or something else entirely? What's the right primary identity?

2. **The MCP server vs leaner AGENTS.md tradeoff:** Should we invest in making the static file better, or skip straight to MCP? The static file is a compression problem (fit value into limited tokens). MCP eliminates the compression problem entirely. Is optimizing the static file the wrong focus?

3. **Benchmark as product feature:** The benchmark system itself could be a product differentiator — "test whether your context file actually helps AI tools." Should we invest in making the benchmark more general (test any AGENTS.md, not just engine-generated ones)?

4. **The target user question:** Who benefits most from this tool? Developers writing code with AI tools? Open-source maintainers making their repo AI-friendly? Engineering leaders standardizing documentation? The pivot should be informed by who we're building for.

5. **Competitive landscape:** What else exists in this space? Are there tools that do what autodocs-engine does? If we pivot to MCP, who are we competing with? What's the defensible advantage?

6. **The honesty angle:** We have benchmark data showing our own output has ~zero marginal value for patterns. Is publishing this a strength (credibility, scientific rigor) or a weakness (undermining our own product)? How do we frame it?

7. **What would you build?** If you were starting from scratch with the same insight ("AI tools can infer code patterns from source but can't infer operational workflows"), what product would you build? Would it look like autodocs-engine, or something completely different?

## Output Format

### Part 1: Pivot Review

#### Agree / Disagree / Nuance
For each aspect of the pivot, state whether you agree, disagree, or see nuance the authors missed.

#### Concerns
Issues with the pivot logic, ordered by severity.

#### Missing Considerations
Things the pivot plan doesn't address that it should.

### Part 2: Strategic Recommendation

#### Product Vision
Where should this project go? Be specific — not "build more features" but "become X by doing Y."

#### Priority Stack
What to build next, in order, with rationale.

#### What NOT to Build
Features or directions that seem tempting but are traps.

#### The One Thing
If you could only give one piece of advice for this project, what would it be?

## Codebase Context

For reference:
- **Current state:** v0.5.0, 380 tests, ~13K lines across 47+ modules, 3 production deps
- **Key features:** 18-stage pipeline, 8 convention detectors, git co-change analysis (new), benchmark system (new), GitHub Action, CLI with init/check/analyze/benchmark commands
- **Benchmark repos:** 11 TypeScript repos cloned (sanity, medusa, vercel/ai, knip, nitro, openstatus, documenso, effect, excalidraw, mcp-sdk)
- **Known strengths:** Zero hallucinations, deterministic-first architecture, minimal deps, strong test suite
- **Known weaknesses:** TypeScript only, single contributor, convention detection is redundant with AI inference, no MCP server yet

The full pivot plan is in `AGENTS-MD-PIVOT-PLAN.md`. Read it completely before starting your review.
