# Adversarial Review: `diagnose` MCP Tool

You are a senior developer tools engineer specializing in debugging and root cause analysis. Your job is to challenge the proposed `diagnose` tool design, find gaps, and suggest improvements. Be constructive, specific, and grounded in real debugging workflows.

## Background

`synaps` is a TypeScript codebase intelligence engine with 12 MCP tools, published on npm. The engine analyzes codebases via AST parsing and serves intelligence through Model Context Protocol. We're adding a 13th tool: `diagnose`.

**The gap:** When a test fails or an error occurs, AI coding tools (Claude Code, Cursor) just read the error message and guess at a fix. They have no structural understanding of WHY something broke. Our engine has import graphs, call graphs, git co-change history, and workflow rules — data that could inform diagnosis but isn't used by any existing tool.

**Read `docs/plans/DIAGNOSE-TOOL-PLAN.md` fully before responding.**

## What We Want You to Challenge

### Part 1: Is the Design Right?

1. **Is the scoring formula correct?** We propose: 40% recency + 30% coupling + 20% dependency + 10% workflow. Is this weighting defensible? Should recency dominate? What about a file that has high coupling but hasn't changed recently?

2. **Can import graph proxy for test coverage?** We use the import graph to approximate "which files does this test exercise?" without actual coverage data. How accurate is this? A test might import a module but only use 1 of 50 functions. Is the import-level proxy good enough, or is it too coarse?

3. **Is the BFS import chain trace useful?** We propose tracing the shortest path between a test file and the error site through the import graph. But imports aren't call paths — a file might import a type but never call the function that broke. Is import chain the right graph to traverse, or should we use the call graph?

4. **Should `diagnose` accept raw test output or structured data?** The plan accepts raw stderr text and parses stack traces via regex. Alternative: accept structured JSON (e.g., from vitest-llm-reporter). Which is more robust? Which is more practical?

### Part 2: Edge Cases and Failure Modes

5. **What happens with no recent git changes?** If the repo hasn't been committed to in days, the recency signal disappears. All suspects get the same recency score. Is the tool still useful without recency data?

6. **What about flaky tests?** If a test fails intermittently, the root cause isn't a code change — it's the test itself (or an environment issue). Can the tool detect or flag this? Should it try?

7. **What about failures outside the import graph?** Some failures come from: deleted files, configuration changes (tsconfig, package.json), environment variables, external service outages. None of these appear in the import graph. How do we handle them?

8. **What if the import graph is stale?** The analysis cache might be from 10 minutes ago. The developer added a new import since then. The diagnose tool won't see it. How critical is this?

### Part 3: What's Missing?

9. **Should we trace the call graph, not just imports?** The import graph tells us "file A imports file B." The call graph tells us "function X in file A calls function Y in file B." The call graph is more precise for diagnosis. Should we prioritize it?

10. **Should we diff against the last-known-good state?** Instead of "what changed recently," we could ask "what changed since the last time this test passed?" This requires knowing when the test last passed (from CI history), which we don't have. Is it worth building?

11. **Should the tool suggest what to LOOK AT in suspect files?** Currently it says "src/types.ts changed recently." Could it say "specifically, the `UserInput` type definition on line 42 was modified"? This requires line-level git blame, which is more expensive.

### Part 4: Integration and UX

12. **How does this compose with other tools?** After diagnose identifies suspects, should it automatically call `plan_change` on those suspects? Or `get_test_info` to suggest which tests to run? How explicit should the composition be?

13. **What's the right response size?** Our other tools follow the "3-5-15" rule (3 sections, 5 items per list, 15 lines per snippet). For diagnosis, should we be more verbose (the AI needs context) or more concise (the AI needs to act fast)?

14. **WHEN TO CALL / DO NOT CALL — is the routing clear?** Will the AI know when to call `diagnose` vs just reading the error? Should the tool description mention specific trigger phrases ("test failed," "error occurred")?

### Part 5: Strategic

15. **Is this genuinely novel?** No other MCP server uses static analysis for diagnosis. But is that because nobody thought of it, or because it doesn't work well enough? What's the risk that import-graph-based diagnosis is too coarse to be useful?

16. **What would make this the "killer feature"?** The "wow moment" for `plan_change` was catching forgotten registration files. What's the equivalent for `diagnose`? When would a developer say "I could never have found this without the tool"?

## What a Great Review Looks Like

- Challenges the scoring formula with specific scenarios
- Identifies 1-2 failure modes we haven't considered
- Suggests whether call graph or import graph is the right traversal
- Proposes a simpler MVP that captures 80% of the value
- Is honest about whether this will actually help or is just technically interesting
