# Product Direction Brainstorm: synaps

You are a senior product strategist and developer tools expert participating in a constructive brainstorming session. Your goal is to help us figure out the best direction for this project based on honest data, real market conditions, and genuine developer needs. Be objective, non-sycophantic, and grounded in reality. We don't need cheerleading — we need clear thinking.

## What This Project Is

`synaps` is a TypeScript codebase intelligence engine. It analyzes codebases via AST parsing and produces structured intelligence about conventions, commands, architecture, contribution patterns, workflow rules, and more.

**Current outputs:**
- AGENTS.md / CLAUDE.md / .cursorrules files (static context documents for AI coding tools)
- MCP server with 8 tools for live, on-demand codebase queries
- JSON analysis (raw structured data)

**Technical assets (what we've actually built):**
- 18-stage analysis pipeline, ~18K lines TypeScript, 477 tests, 0 type errors
- 14/16 sections generated deterministically (no LLM) — AST parsing, git history mining, convention detection, pattern recognition
- Only 2 sections use micro-LLM calls (architecture summary, domain terminology)
- MCP server: 8 tools, STDIO transport, eager cache warmup, dirty-tree detection
- Inferability scoring: adaptively skips sections when patterns are obvious from source code
- Git co-change analysis: Jaccard similarity for file coupling, workflow rule generation
- Contribution pattern detection: finds repeating structures for "how to add code" recipes
- 5 production dependencies only: typescript, mri, picomatch, @modelcontextprotocol/sdk, zod

**What it does NOT do:**
- No multi-language support (TypeScript/JavaScript only)
- No semantic code understanding (only structural/AST analysis)
- No runtime analysis, no test execution
- Not published to npm yet (v0.5.0 ready but not shipped)

## The Honest Data

### Our Benchmark Results (PR-Based, Real Commits)

We built a benchmark that mines real git commits where developers added new files, hides the file, asks the AI to recreate it with/without AGENTS.md, and compares against what the developer actually wrote.

**Pilot results (3 repos, 13 tasks):**

| Repo | Tasks | A (AGENTS.md) | B (Source only) | C (Minimal) | A-B Delta |
|------|-------|---------------|-----------------|-------------|-----------|
| synaps | 2 | 100% | 100% | 0% | 0.0% |
| nitro | 6 | 91.7% | 100% | 91.7% | **-8.3%** |
| vitest | 5 | 80% | 80% | 80% | 0.0% |

**Per-task breakdown (the 3 tasks where conditions diverged):**
- vitest `chai-style-assertions`: A=100%, B=0% — AGENTS.md found a non-obvious deep monorepo path
- nitro `src/preview`: A=50%, B=100% — AGENTS.md anchored on wrong directory
- vitest `cli/completions`: A=0%, B=100% — AGENTS.md misled the model
- 10 other tasks: all conditions tied at 100% (obvious directories)

**One positive secondary signal:** On barrel/index file updates, AGENTS.md helped (A=50% vs B=0% on synaps). The model knew to update `index.ts` when adding a new file.

### Published Research (February 2026)

The most important paper is **"Evaluating AGENTS.md"** (arxiv 2602.11988):

| Context Type | SWE-bench Lite | AGENTbench (138 tasks) | Cost Impact |
|---|---|---|---|
| No context file | baseline | baseline | baseline |
| LLM-generated context | **-0.5%** | **-2.0%** | **+20% cost** |
| Developer-written context | — | **+4.0%** | **+20% cost** |

**LLM-generated AGENTS.md files consistently hurt.** Only developer-written files showed marginal benefit. The reason: agents follow ALL instructions, and most are unnecessary for any given task.

But another paper (**"On the Impact of AGENTS.md"**, arxiv 2601.20404) found that real-world AGENTS.md files **reduce runtime by 28.6% and tokens by 16.6%**. The difference: focused practical guidance (real files) vs broad generated instructions.

**Other key findings:**
- ContextBench: Gold contexts are stable across different valid implementations (Jaccard 0.9518)
- SWE Context Bench: Only correctly-selected, curated summaries help. Unfiltered experience hurts.
- "Less is More" paper: Removing redundant tokens from documentation can IMPROVE performance

### The Convergent Conclusion

**Focused, minimal, accurate context = helpful. Verbose, kitchen-sink context = harmful.**

The question for us: Is our engine's output more like "focused developer-written" or "verbose LLM-generated"?

## The Market Context

### AGENTS.md Ecosystem (Growing Fast)
- **60,000+ repositories** on GitHub have adopted AGENTS.md
- Now a **Linux Foundation standard** (Agentic AI Foundation)
- Supported by: Copilot, Cursor, Codex, Gemini CLI, VS Code, Devin, and more
- GitHub published "How to write a great agents.md" analyzing 2,500+ repos
- Every major AI coding tool except Claude Code has rallied behind AGENTS.md

### Developer Pain Points (from Reddit, HN, Stack Overflow)
1. **"Almost right but not quite" code** (66% of developers cite this as #1 frustration)
2. **Convention violations** — AI uses wrong file patterns, naming, directory structure
3. **Every session starts fresh** — "The state of the art is that every new chat session your agent is a brand new hire"
4. **Multi-file refactoring fails** — AI loses track of architectural decisions by file 7
5. **Documentation drift** — AGENTS.md goes stale, stale docs poison AI context
6. **Duplicate code** — AI writes new implementations instead of reusing existing ones

### Competitive Landscape

| Tool | Approach | Gap |
|------|----------|-----|
| **Repomix** | Packs entire repo into one file | Brute force, no intelligence about what matters |
| **Aider repo-map** | Graph-ranked symbol map | Tightly coupled to Aider, not standalone |
| **"Ask Claude to write CLAUDE.md"** | LLM-generated | Non-deterministic, misses patterns, research shows it hurts |
| **PRPM** | Template marketplace (7K+ packages) | Templates, not tailored analysis |
| **agent-guard** | Deterministic inventory scripts | Primitive, only extracts file lists |
| **Sourcegraph Cody / Augment Code** | Enterprise RAG-based context | Enterprise-only, proprietary, not portable |

**The gap nobody fills:** A tool that deterministically analyzes a codebase and produces focused, accurate, auto-updating AGENTS.md that actually helps AI tools (rather than hurting them).

## What We Want From You

### Part 1: Honest Assessment

1. **Given the research showing LLM-generated context files hurt, does this project make sense at all?** Our engine is 14/16 deterministic (not LLM-generated), but the output format is the same (a static markdown file injected into context). Does the deterministic approach actually change the outcome, or is the fundamental problem "too much context for any given task"?

2. **Is the static AGENTS.md file the wrong product?** The research says focused, task-specific context helps. A static file by definition includes everything. Even with inferability gating, the file contains sections irrelevant to any specific task. Should we abandon the static file and go all-in on MCP (dynamic, on-demand context)?

3. **Are we solving a real problem or a perceived one?** Developers SAY they want AI tools to "know their codebase." But when we actually measure whether providing that knowledge helps, the effect is approximately zero. Is the problem real but our solution wrong? Or is the problem itself overstated?

### Part 2: Product Direction

Given everything above, suggest **3-5 concrete directions** this project could take. For each:
- What it is (one sentence)
- Why it would work (grounded in the data/research)
- What we'd need to build (scope estimate)
- What the risk is (why it might fail)
- Who would pay for it and why

Consider directions that leverage our existing technical assets (18-stage pipeline, 477 tests, MCP server, convention detection, git co-change analysis, contribution pattern detection) rather than requiring a ground-up rebuild.

### Part 3: The Hard Questions

4. **Should we pivot from "generate AGENTS.md" to "keep AGENTS.md in sync"?** Documentation drift is the #1 acknowledged unsolved problem. A CI tool that runs on every commit and updates AGENTS.md when conventions change could be more valuable than the initial generation. We already have the `check` command that detects staleness.

5. **Should we pivot from "help AI write code" to "help developers understand code"?** The onboarding use case (new developer joins team, needs to understand codebase) is a proven pain point with measured outcomes (80% reduction in onboarding time with AI docs). Our analysis pipeline produces exactly the kind of intelligence a new developer needs. Is this a better market than AI tool context?

6. **Should we pivot from "general codebase intelligence" to "convention enforcement"?** AI code review tools (Qodo, CodeRabbit) detect convention violations in PRs. Our engine detects conventions deterministically. Could we become a convention detection layer that feeds into these tools, rather than generating AGENTS.md files?

7. **Is the MCP server the real product?** The 8 tools (get_commands, get_architecture, analyze_impact, get_workflow_rules, list_packages, get_contribution_guide, get_exports, get_conventions) provide focused, task-specific answers. This avoids the "too much context" problem entirely. Should we invest everything in making the MCP server the best codebase intelligence API and treat AGENTS.md as just one consumer of that API?

8. **What would you build if you were starting from scratch today,** knowing what we know about the research, the market, and the developer pain points — but with the constraint that you have our existing analysis pipeline as a starting point?

### Part 4: Go-to-Market

9. **How should we position this?** The "generate AGENTS.md automatically" pitch sounds good but the data doesn't support it (LLM-generated context hurts). What positioning IS supported by the data?

10. **What's the minimum viable release?** We have 477 tests and an MCP server. What's the smallest thing we could ship that provides genuine value and gets us real user feedback?

11. **Should we publish the benchmark results?** We have honest data showing mixed/slightly negative results. Publishing builds credibility but might undermine the product. What's the right play?

## Reference Files

For the brainstorming models, these files contain the full context:
- `RESEARCH-CONTEXT-FILES-2026.md` — comprehensive literature review
- `BENCHMARK-V2-PLAN.md` — benchmark methodology
- `ADVERSARIAL-REVIEW-BENCHMARK-V2-SYNTHESIS.md` — adversarial review synthesis
- `SESSION-HANDOFF.md` — project history and architecture
- `BENCHMARK-ANALYSIS-ROOT-CAUSE.md` — why AGENTS.md hurts some repos

## What a Great Response Looks Like

- Acknowledges the uncomfortable reality (the data doesn't strongly support the current product)
- Proposes directions grounded in evidence, not hope
- Distinguishes between "what developers say they want" and "what measurably helps"
- Considers the business viability, not just technical elegance
- Identifies the 1-2 highest-leverage moves we could make in the next 2 weeks
- Is honest about what they don't know or can't predict
