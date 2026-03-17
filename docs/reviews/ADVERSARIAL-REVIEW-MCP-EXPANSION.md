# Adversarial Review + Brainstorm: MCP Server Expansion

You are a senior developer tools engineer and AI/ML product strategist. Your job is twofold:
1. **Challenge** the proposed MCP expansion plan — find gaps, over-engineering, and wrong priorities
2. **Brainstorm** additional tools, features, or approaches we haven't considered

Be constructive, specific, and grounded in real developer workflows. We want to build what developers actually need, not what sounds impressive.

## Background

`synaps` is a TypeScript codebase intelligence engine (just published as [npm: synaps](https://www.npmjs.com/package/synaps)). It analyzes codebases via AST parsing and serves intelligence through an MCP server with 8 tools. The full expansion plan is in `MCP-EXPANSION-PLAN.md` — **read it fully before responding**.

### Key Context
- **18-stage analysis pipeline**: AST parsing, convention detection, git co-change analysis, contribution patterns, call graphs, import chains, inferability scoring
- **Research-backed**: Comprehensive context hurts AI (-2%); focused, task-specific context helps (+4%, -29% runtime)
- **501 tests, 0 type errors, published to npm**
- **MCP server works with Claude Code** — tested on real monorepos
- **The analysis pipeline computes far more data than the 8 tools currently expose**

### The Proposed Additions (4 new tools + 4 improvements)

**New tools:**
1. `get_test_command(filePath)` — per-file test command + test file path
2. `plan_change(description, files?)` — change impact + checklist (import graph + co-change + registration)
3. `get_examples(exportName)` — usage snippets from test files
4. `get_file_context(filePath)` — everything about one file in one call

**Improvements to existing tools:**
5. `analyze_impact` — add blast radius summary
6. `get_contribution_guide` — include example code snippet
7. `get_conventions` — show confidence percentages
8. `get_architecture` — richer directory descriptions

## What We Want You to Challenge

### Part 1: Challenge the Proposed Tools

1. **Is `plan_change` too ambitious?** It combines import graph + git co-change + contribution patterns + test patterns into one response. Could the keyword-based task classification fail badly? Would a simpler tool (just "given these files, what else needs updating?") be more reliable? What's the minimum viable version?

2. **Is `get_file_context` redundant?** If the AI can call `analyze_impact` + `get_conventions` + `get_contribution_guide` separately, does a composite tool add value or just duplicate functionality? When would the AI call this vs the individual tools?

3. **Are we over-indexing on tools the AI can approximate?** For `get_examples`, the AI can already read test files directly. For `get_test_command`, the AI can check package.json and guess the command. Are these tools genuinely better than what the AI would figure out on its own? How do we avoid building "correct but useless" tools (the same trap as comprehensive AGENTS.md)?

4. **Is 12 tools too many?** The current 8 already create cognitive load for the AI (which tool to call when?). Adding 4 more increases the routing decision space. GitHub's MCP server consolidated tools to reduce this. Should we consolidate instead of expanding?

### Part 2: Challenge the Priority Order

5. **Should we prioritize improvements to existing tools over new tools?** The 4 improvements (blast radius, example code, confidence, richer dirs) are tiny changes (~20-30 lines each) with immediate impact. The 4 new tools are larger. Is the right move "improve existing first, add new later"?

6. **Is `get_test_command` really the highest priority?** It's the simplest to build, but do AI tools actually struggle with test commands? Claude Code can `grep -r "vitest\|jest\|mocha" package.json` and figure it out. What evidence do we have that this is a real pain point vs a theoretical one?

### Part 3: What Are We Missing?

7. **What tools would make the MCP server indispensable that we haven't thought of?** Think about real developer workflows:
   - Debugging a production issue across multiple services
   - Onboarding to a new codebase for the first time
   - Reviewing a PR from a colleague
   - Migrating from one framework/library to another
   - Understanding why a test is failing

8. **Should we add a "memory" or "learning" capability?** The current server analyzes the codebase at startup and serves static results. Should it learn from the developer's actions? E.g., "every time you edit files in src/detectors/, you also update convention-extractor.ts" — building project-specific workflow knowledge over time.

9. **Should we add cross-repository intelligence?** Many organizations have multiple repos that depend on each other. Understanding "this package is consumed by repos X, Y, Z" could be valuable for change impact assessment.

10. **Should tools be proactive?** Current tools wait to be called. Should the MCP server proactively inject context? E.g., when the AI opens a file, automatically provide the file's context without being asked. Is this possible with the MCP protocol?

### Part 4: Design and UX

11. **How should tool responses be sized?** Our research shows "less is more." Should every tool have a hard token cap? Should responses include a "want more?" hint that tells the AI it can call a follow-up tool for details?

12. **Should tool responses include actionable suggestions?** Current tools return data. Should they return recommendations? E.g., `analyze_impact` could say "WARNING: High blast radius. Consider creating a migration plan before changing this file." Is that helpful or patronizing?

13. **How do we handle stale data?** The MCP server analyzes the codebase at startup and caches. If the developer modifies files during the session, the cache is invalidated via dirty-tree detection. But there's a lag. Should tools return a "freshness" indicator? Should critical tools (plan_change) always re-analyze?

### Part 5: Strategic

14. **What's the competitive moat?** Other MCP servers exist (CodePathfinder, CodeGraphContext, Dependency MCP). What makes our server worth using over alternatives? Is it the git co-change analysis? The convention detection? The contribution patterns? What should we double down on?

15. **Should we optimize for Claude Code specifically or stay tool-agnostic?** Claude Code has specific behaviors (reads CLAUDE.md, uses glob/grep natively, has large context windows). Optimizing for Claude Code might mean: smaller responses (it can read files itself), more pointers less content, integration with its native tool set. But this reduces portability.

16. **What would make a developer write a blog post about this tool?** Not "it's nice to have" but "I can't work without it." What's the "wow" moment? Is it `plan_change` showing them 5 files they would have forgotten to update? Is it `get_test_command` saving them from running the whole suite? What's the hook?

## What a Great Response Looks Like

- Identifies 1-2 proposed tools that should be cut or merged
- Proposes 1-2 tools we haven't thought of that address real pain points
- Gives a clear priority order with justification
- Challenges at least one assumption we've made about what developers need
- Suggests the "wow" moment that would make this tool viral
- Is honest about what they don't know
