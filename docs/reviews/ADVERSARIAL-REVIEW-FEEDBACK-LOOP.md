# Adversarial Review: Feedback Loop / Benchmark System Plan

You are a senior principal engineer conducting an adversarial review of a feature plan. Your job is to find flaws, gaps, bad assumptions, and risks that the author missed. Be specific, constructive, and brutal. Don't be nice -- be right.

## Your Role

You are reviewing a plan to build a **benchmark system** for `autodocs-engine` -- a TypeScript codebase intelligence engine that generates AGENTS.md context files for AI coding tools (Claude, Cursor, Copilot).

The benchmark system answers the existential question: **"Does AGENTS.md actually help AI tools write better code?"**

The proposed approach:
1. Analyze a repo to produce AGENTS.md + StructuredAnalysis
2. Auto-generate coding tasks from the engine's own ContributionPattern objects (step-by-step "how to add code" recipes)
3. Run each task through an LLM twice: once WITH AGENTS.md context, once WITHOUT
4. Score each output using the engine's own convention detectors and AST analysis (deterministic, no LLM-as-judge)
5. Produce a report with paired t-test and Cohen's d

The complete plan is in `FEEDBACK-LOOP-PLAN.md`. Read it fully before starting.

## What to Review

Attack this plan on every dimension. Specifically:

### 1. Experimental Validity
- Is this a valid A/B experiment? Are there confounding variables?
- Is the control condition (dir listing without AGENTS.md) fair? Too generous? Too restrictive?
- Does testing the engine's output with the engine's own scorer create circular logic? (The engine detects patterns X, generates AGENTS.md saying "follow X", then checks if AI followed X -- is this measuring AGENTS.md effectiveness or just testing if the AI can follow any instruction?)
- Is temperature 0 sufficient to control for randomness, or should there be multiple runs even in quick mode?
- Are 3-5 tasks enough for quick validation? What's the minimum for any statistical claim?

### 2. Scoring Rubric Validity
- The rubric has 25 points split across structure (10), convention (7), integration (5), quality (3). Are these weights justified? Should convention compliance matter more than file placement?
- The "integration" checks (registration file updated, barrel file updated) require the AI to MODIFY existing files, not just CREATE new ones. Can the AI do this in a single prompt response? Does the prompt design support multi-file edits including modifications to existing files?
- Some checks overlap: "file naming convention" appears in both structure and convention categories. Is this double-counting?
- Is the 70% pass threshold meaningful, or arbitrary?
- What if a task has 12 possible points (Tier C) and the AI gets 9? That's 75% -- a pass. But if the same AI gets 18/25 on a Tier A task, that's 72% -- also a pass. Are these comparable?

### 3. Task Generation Quality
- Tasks are derived from ContributionPattern objects. But these patterns represent EXISTING code structure -- they're not necessarily the RIGHT way to add code. What if the contribution pattern is wrong or suboptimal?
- The plan says "task prompt is carefully designed to NOT leak the answer." But the prompt includes the package name and expected directory. Isn't that already a significant hint? Would an AI without AGENTS.md also look at the directory structure and infer patterns?
- `deriveTaskName` creates plausible names that don't collide with existing exports. How hard is this? What if the directory has generic export names (e.g., `index.ts`, `utils.ts`) where naming a new plausible item is ambiguous?
- How many Tier A patterns does a typical repo produce? If most repos produce 0-1 Tier A patterns, the benchmark only works on repos like autodocs-engine that happen to have rich patterns. Is this representative?

### 4. Prompt Design Fairness
- The control condition gives a directory listing. But a real AI tool (e.g., Claude Code, Cursor) would have access to the FULL file contents, not just a listing. The control is actually WORSE than what an AI would normally have. Does this artificially inflate the delta?
- Conversely, the treatment condition gives the full AGENTS.md. But a real AI tool would also have the dir listing AND file contents. The treatment doesn't add that -- it replaces the dir listing with AGENTS.md. Is this a fair comparison?
- Should there be a third condition: dir listing + AGENTS.md (the realistic scenario)?
- The system prompt says "Output ONLY the file contents." This is a very constrained format. Real AI tools often explain their reasoning, ask clarifying questions, or produce partial solutions. Does the constrained format favor the AGENTS.md condition (which gives more structure) or disadvantage it?

### 5. Technical Implementation
- The plan calls for writing generated files to a temp directory and running `parseFile()` on them. But `parseFile()` expects files within a package with a `package.json`. Will it work on isolated files in a temp dir?
- The "registration file updated" check requires the AI to produce a MODIFIED version of an existing file. How does the benchmark handle this? Does it copy the existing file to temp, apply the AI's changes, then check? Or does it expect the AI to output the complete modified file? This is a critical detail that's underspecified.
- `parseCodeBlocks()` extracts triple-backtick blocks with filepath headers. What if the LLM doesn't follow this format exactly? What if it uses single backticks, or puts the path outside the backtick block, or uses relative vs absolute paths?
- The statistics module implements a t-distribution CDF approximation. The Abramowitz-Stegun approximation has known precision limits. Is this accurate enough for p-values near 0.05?

### 6. Scale and Representativeness
- The benchmark tests "add new code" tasks (contribution patterns). But AGENTS.md also contains conventions, commands, workflow rules, change impact, public API, and more. These other sections are NOT tested by the benchmark. Can you claim "AGENTS.md helps" if you only test one section?
- The 11 benchmark repos are all TypeScript. The results won't generalize to other languages.
- Most repos produce few or zero rich contribution patterns (Tier A). The benchmark may only work well on repos that already have clear, consistent patterns -- the repos that need AGENTS.md the least.
- How does the benchmark handle monorepos? The plan mentions `--root` but doesn't detail how multi-package analysis interacts with task generation.

### 7. Cost and Practicality
- Quick mode ($0.50) requires an ANTHROPIC_API_KEY. Many potential users may not have one. Is this a barrier to adoption?
- Full mode at $5-15 per repo is reasonable for the project maintainer but not for regular users. Is this a developer tool or a one-time research tool?
- The benchmark requires generating AGENTS.md first, which itself requires an API key. So even the "analysis" phase needs LLM access. Can the benchmark work with JSON-only analysis (no LLM)?
- Running 60 LLM calls sequentially could take 5-10 minutes. Is there any parallelization planned?

### 8. What's Missing
- No baseline comparison against other context formats (e.g., raw README, hand-written AGENTS.md vs generated, minimal context vs full context).
- No measurement of token efficiency: does AGENTS.md use fewer tokens to achieve the same result as giving the AI full file contents?
- No measurement of which SECTIONS of AGENTS.md contribute most to the improvement. Without this, you can't optimize the output.
- No consideration of model-specific behavior: Sonnet vs Opus vs GPT may respond differently to AGENTS.md. A benchmark that only tests one model is less publishable.
- No negative controls: what happens if you give the AI WRONG AGENTS.md (e.g., from a different repo)? This would test whether the AI actually reads the context or just benefits from having any structured prompt.
- No measurement of the AI's EXPLANATIONS or reasoning -- only the code output. If the AI correctly identifies the pattern but fails to follow it, that's useful data lost.

### 9. Ethical / Methodological Concerns
- Publishing results like "AGENTS.md improves code quality by 32%" when you are the maker of AGENTS.md is a conflict of interest. How do you address this?
- If the results show AGENTS.md DOESN'T help (or helps only marginally), what's the plan? Is there a commitment to publishing negative results?
- The benchmark tests the engine's OWN patterns with the engine's OWN scorer. This is inherently circular. A hostile reviewer would say "you graded your own homework." How do you address this?

## Output Format

Structure your review as:

### Critical Issues (Must Fix Before Implementation)
Issues that would cause incorrect results, invalidate the experiment, or produce misleading claims.

### Important Concerns (Should Address)
Issues that affect quality, generalizability, or credibility but aren't blockers.

### Minor Suggestions (Nice to Have)
Polish, extensibility, or minor improvements.

### Questions for the Author
Things you need clarified before you can fully evaluate.

### What's Good
Acknowledge what's well-designed (be specific, not generic praise).

### Revised Recommendation
PROCEED as-is, REVISE (with specific changes), or RETHINK (fundamental approach issues).

---

## Codebase Context

For reference, the engine's relevant architecture:

- **ContributionPattern** (the task source): `{ type, directory, filePattern, testPattern?, exampleFile, steps[], commonImports?, exportSuffix?, registrationFile? }`. Detected in `src/contribution-patterns.ts` by analyzing sibling files in directories.
- **Convention** (scoring input): `{ category, name, description, confidence: { matched, total, percentage }, examples[], impact?, source? }`. Detected by 8 built-in detectors in `src/detectors/`.
- **parseFile()** in `src/ast-parser.ts`: AST-parses a TypeScript file, returns exports, imports, content signals, syntax errors. This is the core scorer primitive.
- **callLLMWithRetry()** in `src/llm/client.ts`: Anthropic API client with 1 retry, 2s delay, 120s timeout, temperature 0.
- **CLI structure** in `src/bin/`: `autodocs-engine.ts` (main), `init.ts`, `check.ts`. The `benchmark` subcommand follows this pattern.
- **analyze()** in `src/index.ts`: Runs the full 18-stage pipeline, returns StructuredAnalysis.
- **formatDeterministic()** in `src/index.ts`: Generates AGENTS.md with 13 deterministic + 3 micro-LLM sections.

The full plan is in `FEEDBACK-LOOP-PLAN.md`. Read it completely before starting your review.
