# Adversarial Review: Minimal Mode (<500 Token AGENTS.md)

You are a senior AI/ML engineer and developer tools expert conducting an adversarial review. Your goal is to find gaps, challenge assumptions, and make this plan bulletproof. Be constructive but brutally honest.

## Background

`synaps` generates AGENTS.md context files for AI coding tools from deterministic codebase analysis. After extensive benchmarking and literature review, we found:

- **Comprehensive AGENTS.md files hurt** (research: -0.5% to -2%; our benchmark: -3.1% on file placement)
- **Focused developer-written files help** (+4% accuracy, -29% runtime, -17% tokens)
- **The key difference**: developer-written files are short, focused, and only include what the AI can't figure out on its own

We're building a `--minimal` mode that generates <500 token AGENTS.md matching the characteristics of helpful developer-written files. The full plan is in `MINIMAL-MODE-PLAN.md` — read it fully before starting.

## The Minimal Output Design

**Always included:**

- Title + one-line description (~10 tokens)
- Commands with exact flags (~40-100 tokens)

**Conditionally included (based on inferability scoring + data availability):**

- Top 3 workflow rules (if high-confidence git co-change data exists)
- Top 3 non-obvious conventions (if inferability = "full")
- Non-obvious directories (if they exist, with "non-exhaustive" qualifier)
- Package guide (if monorepo with 3+ packages)

**Explicitly dropped:**

- Tech stack, summary, domain terminology, contributing guidelines, public API, dependencies, dependency graph, mermaid diagrams, change impact, team knowledge, supported frameworks

## What We Want You to Challenge

### Section Selection

1. **Are we keeping the right sections?** We kept commands, workflow rules, conventions, and architecture. We dropped tech stack, public API, dependencies, and change impact. Is this the right split? Is there a dropped section that's actually high-value? Is there a kept section that could still cause harm?

2. **Is "3 items per section" the right limit?** We cap workflow rules at 3, conventions at 3, directories at 5. Too few means missing useful info. Too many means kitchen-sink. What's the right balance? Should it be adaptive (more for complex repos, fewer for simple ones)?

3. **Should the command table include ALL detected commands or just build/test/lint?** Currently we include every script detected. But `dev`, `start`, `typecheck`, `db:generate`, `storybook` etc. add tokens. Which commands are worth including?

### The Inferability Gate

4. **Is the inferability scoring threshold right?** Current: score ≤35 = "full" (include conventions), 36-65 = "minimal" (skip conventions), >65 = "skip" (omit everything optional). These thresholds were set without empirical calibration. Should they be different for minimal mode?

5. **Could we use a simpler heuristic?** Instead of a 4-factor weighted score, what about: "If the repo has registration files or non-standard import patterns, include conventions. Otherwise, skip." Is the complexity of inferability scoring justified?

### Content Quality

6. **How do we prevent "almost right but misleading" conventions?** Our convention detection is deterministic but pattern-based. If 90% of files use kebab-case but 10% use PascalCase (for React components), we'd report "DO: use kebab-case filenames" — which would be wrong for component files. How do we handle partial conventions?

7. **Should workflow rules be phrased as commands or as information?** Current: "After modifying schema.prisma → run pnpm db:generate." Alternative: "schema.prisma and db client are coupled (co-change score: 0.85)." The first is more actionable. But what if the command is wrong or outdated?

8. **What happens when the minimal output is EMPTY?** If a repo has standard structure, obvious conventions, and no git history — we'd generate just a title + commands table (~50 tokens). Is that useful or confusing? Should we include a note like "Standard project structure — conventions are inferrable from source code"?

### Comparison to Developer-Written Files

9. **GitHub's analysis of 2,500 repos found successful files have "1-2 code examples."** Our minimal mode has ZERO code examples. Should we include one example file from a contribution pattern? E.g., "Example detector: `src/detectors/file-naming.ts`"? Or does this add too many tokens?

10. **Developer-written files often include "what NOT to do."** Our conventions include anti-patterns (DON'T rules). Should minimal mode include the single most important DON'T? Or is one rule misleading without context?

### Token Budget

11. **Is <500 tokens the right target?** The "Less is More" paper found 25-40% compression preserves quality. Our full output is ~2000 tokens. 500 is a 75% reduction. Is this too aggressive? The 2601.20404 paper's real-world AGENTS.md files that showed -29% runtime — how many tokens were those typically? Should we target 800? 300?

12. **Should we count tokens precisely or use a character approximation?** The current codebase uses `chars/4` as a token estimate. For a <500 token budget, should we use a proper tokenizer (tiktoken) to be precise? Or is the approximation good enough?

### Edge Cases and Risks

13. **What about monorepos with 20+ packages?** The package guide section could blow the budget. Should we have a separate "monorepo minimal" template with different limits?

14. **What if commands are wrong?** If `package.json` says `"test": "vitest"` but the repo actually uses `npm test -- --run`, our detected command is technically wrong. How do we handle stale or incorrect package.json scripts?

15. **What about repos with NO package.json?** (e.g., Python repos, Go repos, or unusual setups). The commands section relies on package.json scripts. Should minimal mode gracefully degrade to just a title?

16. **Could minimal mode actively HURT compared to NO file at all?** The research shows even +4% for developer-written files comes with +20% cost. If our minimal output adds 200 tokens of context that's all correct but all inferrable, we're adding cost without benefit. How do we ensure we're not generating a "correct but useless" file?

### Strategic Questions

17. **Should minimal mode be the DEFAULT?** Currently `--minimal` is a flag. Should we flip it: minimal is default, `--full` is the opt-in? The research supports this, but it changes the product impression ("I ran it and only got 5 lines?").

18. **How does this interact with the MCP server?** If a user has both the minimal AGENTS.md AND the MCP server running, there's potential for conflicting information. The static file says "3 workflow rules" but the MCP server has 10. Is this a problem?

19. **Should minimal mode output DIFFERENT content per AI tool?** AGENTS.md for Copilot might need different content than CLAUDE.md for Claude Code. Claude has access to the full repo; Copilot doesn't. Should the minimal output adapt to the target tool?

## What a Great Review Looks Like

- Identifies 2-3 content selection errors we haven't considered
- Proposes a specific alternative token budget with justification
- Suggests how to handle the "correct but useless" risk
- Challenges the inferability thresholds with concrete scenarios
- Recommends whether minimal should be the default
- Proposes how to validate minimal mode works before shipping (beyond benchmarks)
