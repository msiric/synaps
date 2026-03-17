# Adversarial Review: Benchmark V2 — PR-Based Ground Truth Design

You are a senior principal engineer specializing in ML evaluation methodology and developer tools. Your job is to challenge the reasoning, find gaps in the design, identify blind spots, and suggest improvements. Be specific, constructive, and brutally honest. We'd rather catch problems now than after building the wrong thing.

## Background

`synaps` is a TypeScript codebase intelligence engine that generates AGENTS.md context files for AI coding tools (Claude Code, Cursor, Copilot). It analyzes codebases via AST parsing and produces output covering conventions, commands, architecture, contribution patterns, workflow rules, etc.

We built a benchmark (v1) to measure whether AGENTS.md actually helps AI tools write better code. After thorough investigation, we found the benchmark has fundamental problems that make its results unreliable. We're now designing v2.

## What's Wrong with Benchmark V1 (Current)

We identified these problems through deep investigation of the code, data, and methodology:

### Circularity
The engine detects patterns, generates benchmark tasks FROM those patterns, and scores AI output against those same patterns. If the engine misidentifies a pattern, the benchmark can't catch it — the tasks and scoring derive from the same (potentially wrong) analysis. This is the most fundamental flaw.

### Generic Tasks
Every repo gets the same task: "add an import-ordering utility." This is generated from a fixed-order name pool where `deriveTaskName()` always returns the first non-colliding entry. Asking a server framework to implement "import ordering" is nonsensical and doesn't test real developer workflows.

### Tiny Samples
Quick mode runs 2-5 tasks per repo (varies by detected patterns). The code has statistical significance testing (Wilcoxon, bootstrap CI, Cohen's d) but gates it behind `mode === "full" && n >= 10`. In practice, no repo ever reaches this threshold. All published results are "directional only, not statistically powered."

### Weak Scoring
- Architecture tasks use `response.includes(expectedDir)` (naive substring match) and keyword matching for "justification quality" ("because", "convention", "structure")
- Command tasks use loose regex text matching (a comment mentioning "npm test" counts as finding the test command)
- Only pattern tasks use genuine AST-based scoring

### Token Count Confound
Condition A (treatment) always has more tokens than Condition B (control) because A includes AGENTS.md. More context could help regardless of content quality. This isn't controlled for.

### Data Integrity
The BENCHMARK-RESULTS-20-REPOS.md doc was updated across 3 separate benchmark runs (original, postfix, v2fix) and contains contradictory data. The claimed "14/20 positive, 2/20 negative" distribution doesn't match the actual files. Real post-fix distribution: 12/20 positive (60%), 5/20 neutral (25%), 3/20 negative (15%).

## The Proposed V2 Design

**Read `BENCHMARK-V2-PLAN.md` fully before starting your review.** The key idea:

### PR-Based Benchmark (New Primary Mode)
Instead of synthetic tasks, mine real git commits where developers added new files. Use the commit as the task and the actual file as ground truth. Compare AI output against what a real developer wrote.

**Flow:**
1. Mine `git log --diff-filter=A` for commits that added TypeScript files
2. Filter by quality criteria (file size, directory context, commit message quality)
3. For each qualifying commit: ask the AI to write a similar file (excluding the real file from context)
4. Score along 5 deterministic dimensions: file placement, naming, imports, exports, compilability
5. Compare Condition A (with AGENTS.md) vs B (without) vs C (minimal context)

**Why this breaks circularity:** Ground truth comes from real developer behavior, not from the engine's own analysis. AGENTS.md is just one of the conditions being tested.

### Improved Synthetic Mode (Secondary)
Keep the pattern-derived benchmark but fix its problems: diverse task names, 10+ tasks per repo, better scoring, always-on statistics.

### Statistics
Always compute Wilcoxon signed-rank, bootstrap 95% CIs, Cohen's d_z, and permutation tests. Report per-dimension breakdowns. Stratify by task type with explicit power caveats.

## What We Want From You

### Part 1: Challenge the PR-Based Design

1. **Does PR mining actually break circularity?** We claim ground truth comes from "real developer behavior." But we still use the engine to generate AGENTS.md, and we score with AST-based heuristics we designed. Is the circularity actually broken, or just moved? What would truly independent ground truth look like?

2. **Is the task prompt design fair?** We derive prompts from commit messages, made deliberately vague about file placement. Could this bias the benchmark? If the commit message says "add cache adapter to utils," we'd need to strip "to utils" — but then the task becomes harder for ALL conditions equally. Is "deliberately vague" the right approach, or does it handicap the AI unfairly?

3. **Are 5 scoring dimensions right?** We propose: file placement (25%), naming (20%), imports (25%), exports (15%), compilability (15%). Is this the right set? Are we missing anything? Is the weighting defensible? Should we test "code structure similarity" or "function signature match"?

4. **Is comparing against a single ground truth file valid?** There may be many valid implementations for a given task. If the real developer used one approach and the AI uses another equally valid approach, scoring against the developer's file would penalize the AI unfairly. How do we handle the "multiple valid solutions" problem?

5. **Is Jaccard similarity on imports a good metric?** If the ground truth imports `{foo, bar}` from `'./utils'` and the AI imports `{baz, qux}` from `'./utils'`, the specifier matches but the symbols don't. Is specifier-level Jaccard sufficient, or do we need symbol-level comparison?

6. **Does the ground truth file still exist at HEAD?** We read it from the current repo state, but the file might have been renamed, moved, or deleted since the commit. How do we handle this? Should we only use commits where the added file still exists at HEAD unchanged?

### Part 2: Challenge the Experimental Design

7. **Is 3 conditions enough?** We dropped the shuffled AGENTS.md condition (N) and the token-matched control (B+). The argument: "with real ground truth, we don't need negative controls." Is this valid? Would adding N or B+ strengthen the conclusions enough to justify the 33-50% cost increase?

8. **How do we handle the token confound without B+?** If A beats B, is it because AGENTS.md content is good, or because more context is always better? We claim Condition C (minimal) helps distinguish this. Is that sufficient? If A > B > C in a monotonic pattern, does that prove content value or just context volume?

9. **Sample size: is 15 tasks/repo enough?** The current 3-5 tasks is clearly too few. We propose 15 (quick) to 30 (full). Is this sufficient for Wilcoxon signed-rank to detect a medium effect (d=0.5) at 80% power? What's the minimum viable n for our design?

10. **Should we test multiple models?** We default to Sonnet 4. If AGENTS.md helps Sonnet but not Haiku or GPT-4o, the conclusion "AGENTS.md helps AI tools" is too broad. How important is multi-model testing for credibility? Is it worth the 2-3x cost?

### Part 3: Challenge the Scoring

11. **Import Jaccard similarity might be noisy.** Different implementations of the same feature can have completely different imports. A cache adapter might use `Redis` or `Map` depending on the approach. The ground truth used Redis; the AI used Map. Jaccard = 0%, but both are valid. How do we score this fairly?

12. **File placement scoring is binary-ish.** Exact directory = 100%, parent = 50%, wrong = 0%. But "wrong directory" is ambiguous in monorepos. If the ground truth is in `packages/auth/src/utils/` and the AI puts it in `packages/auth/src/helpers/`, is that wrong (0%) or close (50%)? What's the right granularity?

13. **Compilability is easy to game.** Almost any syntactically valid TypeScript file scores 100% on compilability. Is this dimension pulling its weight at 15%? Should we replace it with something more discriminating?

14. **We're not scoring code correctness at all.** The AI might place the file correctly, name it correctly, import the right things, and export the right things — but the implementation could be completely wrong. Does this matter for our benchmark? Are we measuring "convention adherence" or "code quality"? Should we be more explicit about this?

### Part 4: Alternative Approaches

15. **Should we use test suites as ground truth instead?** SWE-bench uses repo test suites to verify patches. For our case: check out the parent commit, run tests, apply the AI's file, run tests again. If tests pass, the AI's implementation is valid regardless of how different it looks from the real one. Is this worth the complexity?

16. **Should we use LLM-as-judge for some dimensions?** "Code structure similarity" is hard to measure deterministically. An LLM could compare the ground truth and AI output and rate similarity on a scale. This adds subjectivity but might capture aspects AST analysis misses. When is LLM-as-judge appropriate vs. inappropriate?

17. **Is there a simpler benchmark design that would be more credible?** Maybe we're overcomplicating this. What if we just: (a) pick 100 real "add file" commits across 20 repos, (b) ask the AI with/without AGENTS.md, (c) compute file placement accuracy as the ONLY metric? A single, clean metric that's obviously correct might be more persuasive than a 5-dimensional weighted score.

18. **Should we benchmark the MCP server instead of static AGENTS.md?** The engine has an MCP server with 8 tools. Instead of comparing "static doc in context" vs "no doc," we could compare "AI with access to MCP tools" vs "AI without." This tests the product as actually used, not a simplified version. Is this a better approach for v2?

### Part 5: Statistical & Reporting Concerns

19. **Is Wilcoxon signed-rank appropriate?** The test assumes the distribution of differences is symmetric. If our deltas are heavily skewed (e.g., most repos show +0% but a few show +30%), Wilcoxon may be underpowered. Should we use a different non-parametric test?

20. **How should we aggregate across repos?** Each repo has different characteristics. Simple averaging (mean of repo-level deltas) treats all repos equally. Should we weight by repo complexity? By number of tasks? By confidence interval width? What's the most defensible aggregation?

21. **Per-dimension CIs with n=15 tasks will be wide.** With 15 tasks and 5 dimensions, we're computing 5 CIs per repo from very few observations. The CIs will likely overlap zero for most dimensions. Is this useful information, or will it just make us look uncertain? Should we only report aggregate (across all dimensions) CIs?

22. **Publication bias risk.** If the benchmark shows AGENTS.md doesn't help, do we publish? We claim we publish negative results (the v1 data includes them). But v2 is specifically designed to be the "better" benchmark — if even the better benchmark shows no effect, that's a product existential crisis. How do we commit to publishing regardless?

## What a Great Review Looks Like

- Identifies 2-3 fundamental problems we haven't considered
- Proposes specific, implementable fixes (not just "this is bad")
- Challenges our assumptions with concrete scenarios/examples
- Suggests a simpler alternative that achieves 80% of the value
- Distinguishes between "nice to fix" and "must fix before building"
- Is honest about which of our concerns are real problems and which are overthinking

## Reference Files

- `BENCHMARK-V2-PLAN.md` — The full implementation plan
- `BENCHMARK-RESULTS-20-REPOS.md` — Current (flawed) v1 results
- `BENCHMARK-ANALYSIS-ROOT-CAUSE.md` — Root cause analysis of v1 failures
- `SESSION-HANDOFF.md` — Project context and current state
- `src/benchmark/` — Current benchmark implementation (7 modules)
