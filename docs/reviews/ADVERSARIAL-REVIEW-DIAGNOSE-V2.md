# Adversarial Review: `diagnose` MCP Tool (v2 — Post-Feedback)

You are a senior developer tools engineer reviewing the REVISED implementation plan for a `diagnose` MCP tool. This is v2 — we already got feedback from 5 models on v1 and incorporated their P0 recommendations. Your job is to find remaining gaps, challenge the revised design, and catch issues before we write ~590 lines of code.

**Read `docs/plans/DIAGNOSE-TOOL-PLAN-V2.md` fully before responding.**

## Background

`synaps` is a TypeScript codebase intelligence engine with 12 MCP tools, published on npm (v0.7.3). We're adding a 13th tool: `diagnose` — backward tracing from test failures/errors to likely root cause using import graphs, call graphs, git co-change history, and uncommitted changes.

### What Changed From v1 to v2

Based on unanimous feedback from 5 adversarial reviewers:
- Replaced `1/hoursAgo` with exponential decay `e^(-0.1 * hours)`
- Added uncommitted change detection (`git diff --name-only`)
- Added "missing co-change" as the highest-weighted signal (35%)
- Added call graph as a score multiplier (1.5x)
- Added 4 error format parsers (V8, TS compiler, Vitest, generic)
- Added dynamic weights (recency-dominant vs coupling-dominant)
- Added config file change detection and flaky test heuristic

## What We Want You to Review

### Part 1: Scoring System

1. **Is the "missing co-change" signal reliable?** We weight it at 35% — the strongest single signal. But it depends on co-change data quality. If a file has only co-changed 3 times (our minimum), is that enough to declare a "missing co-change"? Should there be a minimum co-change count threshold before we use this signal?

2. **Is `e^(-0.1 * hours)` the right decay constant?** With λ=0.1, a 7-hour-old change scores 50%. A 24-hour-old change scores 9%. A 48-hour-old change scores 0.8%. Is this too aggressive? Should it be more or less sensitive to time?

3. **The call graph 1.5x multiplier — is it too strong or too weak?** A file with a lower base score but a call graph connection could overtake a higher-scoring file without one. Is 1.5x the right magnification?

4. **Does the scoring formula overfit to "recent regression" scenarios?** What about latent bugs, refactoring regressions, or integration test failures that aren't caused by a single recent change?

### Part 2: Implementation Concerns

5. **Performance: how many git operations?** The plan runs `git diff --name-only` + `git diff --cached --name-only` + `git log -n 50`. For a repo with 500 files and 20 suspect candidates, how many total git operations? Is this fast enough (<500ms)?

6. **The BFS import chain trace — will it find useful paths?** Our import chain only has direct edges (A imports B). It doesn't follow re-exports through barrel files. If test → index.ts → module.ts, will the BFS find that path or stop at index.ts?

7. **What happens if `parseErrorText` extracts no files?** The plan says "at least one of errorText, filePath, testFile required" — but what if errorText is provided but contains no parseable file references (e.g., a cryptic error message with no stack trace)?

### Part 3: Output Quality

8. **Is the output format right for AI consumption?** The plan shows a markdown table of suspects with scores. But AI models process markdown tables imperfectly. Would a simple ranked list be more reliable?

9. **Should the output include the SCORING BREAKDOWN per suspect?** Currently it shows a combined reason string. Would showing `recency=25, coupling=20, missingCoChange=35` help the AI understand WHY a file is ranked where it is?

10. **The "Suggested Actions" section — is it actionable enough?** It suggests `git diff HEAD~3 -- file`. But the AI might not know how to run bash commands in all contexts. Should actions be phrased differently?

### Part 4: Integration

11. **How does `diagnose` interact with `plan_change`?** If diagnose says "fix src/validator.ts", should the AI then call `plan_change(["src/validator.ts"])` to understand the blast radius? Should the suggested actions explicitly recommend this?

12. **Should `diagnose` be called AUTOMATICALLY on every test failure?** The WHEN TO CALL says "IMMEDIATELY after a test failure." But some failures are trivial (assertion value mismatch where the fix is obvious). Would auto-calling waste tokens and confuse the AI?

### Part 5: Will This Actually Work?

13. **Be honest: what percentage of real failures will this tool correctly identify the root cause?** The v1 review estimated "60% very useful, 25% somewhat useful, 15% not useful." With the v2 improvements (missing co-change, uncommitted detection, call graph bonus), does this change?

14. **What's the biggest remaining blind spot?** After all v2 improvements, what class of failures will the tool still completely miss?

15. **Is ~590 lines too much for a single feature?** Should we ship a smaller MVP (e.g., just error parsing + recency scoring, ~200 lines) and add the sophisticated scoring later?

## What a Great Review Looks Like

- Tests the scoring formula with 2-3 concrete scenarios
- Identifies one implementation concern we haven't considered
- Suggests whether to ship the full 590 lines or a smaller MVP
- Is honest about the expected hit rate
- Proposes one specific test case that would validate the "missing co-change" signal
