# Adversarial Review: Git History Mining Plan

You are a senior principal engineer conducting an adversarial review of a feature plan. Your job is to find flaws, gaps, bad assumptions, and risks that the author missed. Be specific, constructive, and brutal. Don't be nice — be right.

## Your Role

You are reviewing a plan to add **git history mining** (co-change analysis) to `synaps` — a TypeScript codebase intelligence engine that generates AGENTS.md context files for AI coding tools.

The engine currently has an 18-stage deterministic pipeline that analyzes TypeScript codebases via AST parsing. It produces workflow rules like "When modifying `src/types.ts` -> also check `src/analysis-builder.ts` (17 symbols imported)." These rules currently come from static import-chain analysis only.

The proposed feature adds a new data source: **git commit history**. By parsing `git log`, the engine identifies file pairs that frequently change together in commits and generates additional workflow rules.

## The Plan

The complete plan is attached below (read `GIT-HISTORY-MINING-PLAN.md`). Key points:

- **New module**: `src/git-history.ts` (~180 lines)
- **Algorithm**: Parse `git log --name-only`, build co-change matrix, filter by frequency threshold (>= 50%), generate WorkflowRule entries
- **Noise filters**: Skip commits touching > 15 files (refactors), exclude hub files in > 70% of commits, skip repos with < 10 commits
- **Integration**: Follows the existing import-chain pattern — appends WorkflowRule entries to the same array
- **Deduplication**: Skips co-change rules for file pairs already covered by import-chain rules
- **Graceful degradation**: Returns null if git unavailable, analysis continues normally
- **Scope**: v1 is co-change rules only; volatility/hotspots deferred

## What to Review

Attack this plan on every dimension. Specifically:

### 1. Algorithm Correctness
- Is the co-change frequency calculation correct? The plan uses `coChangeCount / min(commitsForFile1, commitsForFile2)`. Is `min()` the right denominator? Should it be `max()`, `union()`, or something else?
- Does the large-commit filter (> 15 files) actually prevent noise, or does it throw away valuable signal? What about a commit that legitimately changes 20 related files?
- Is the hub-file threshold (70%) correct? What happens in a young repo with 15 commits where `types.ts` appears in 11 (73%)? Should the threshold be adaptive?
- What happens with file renames? `git mv old.ts new.ts` — does the algorithm handle this correctly or does it see them as different files?

### 2. Threshold Calibration
- The plan has 9 hardcoded constants (MIN_COMMITS=10, MAX_COMMITS=200, MAX_DAYS=90, MAX_FILES_PER_COMMIT=15, HUB_FILE_THRESHOLD=0.7, MIN_FREQUENCY=0.5, MIN_CO_CHANGES=3, MAX_EDGES=50, MAX_RULES=5). Are these values justified by data or guesses?
- How sensitive is the output to these thresholds? Would MIN_FREQUENCY=0.4 vs 0.6 dramatically change results?
- Should any thresholds be configurable by the user?
- Were these thresholds validated against real repositories?

### 3. Edge Cases & Failure Modes
- What happens with monorepos where git history spans the entire repo but analysis is per-package?
- What happens with squash-merge workflows where feature branches are squashed into single commits? Does this distort co-change signals?
- What happens with `git rebase` heavy workflows where commit history is rewritten?
- What about repos that use conventional commits (feat:, fix:, chore:) — is there signal being left on the table?
- What happens when two files SHOULD co-change but don't (a bug) — does the absence of co-change signal provide useful info?

### 4. Performance & Scale
- `git log` on a repo with 50,000 commits — does the `--since` and `-n` flags cap this adequately?
- Building the co-change matrix for 200 commits each with up to 15 files — what's the actual memory footprint?
- Is 10 seconds enough timeout for git log on a large repo over SSH?
- Should the analysis be cached? Running `git log` on every `synaps analyze` invocation seems wasteful.

### 5. Architecture & Design
- The plan puts git history mining in `analyzePackage()` (per-package). But git history is repo-level, not package-level. Is this the right place? Should it run once at the repo level and be distributed to packages?
- The deduplication against import-chain rules uses regex on the trigger string (`r.trigger.match(/`([^`]+)`/)`). Is parsing rendered strings to extract file paths a good pattern? What if the trigger format changes?
- The `source` field on WorkflowRule distinguishes co-change from import-chain rules. But is this enough? Should there be a `ruleType` field instead?
- Is `WorkflowRule` the right output type, or should co-change data have its own formatter section?

### 6. Value & Signal Quality
- Co-change analysis works best with long, consistent commit histories. But the engine targets TypeScript projects using AI coding tools — many of which are new projects with short histories. Is co-change analysis valuable for the target audience?
- Import-chain analysis gives **structural** coupling (file A imports 17 symbols from file B). Co-change gives **behavioral** coupling (files A and B changed together). When do these diverge? Is the divergence common enough to justify the feature?
- Could this feature actively mislead AI tools? If two files co-changed historically because of a now-completed refactoring, the co-change signal is stale but still appears as a rule.
- How does this compare to just telling AI tools "run the tests"? Is the co-change signal more valuable than "check if tests pass"?

### 7. Missing Considerations
- What about `.gitignore`d files that appear in history? (Files that were tracked, then ignored.)
- What about deleted files that appear in git history but no longer exist?
- What about the interaction between `--no-merges` and merge-based workflows?
- Should the feature respect the engine's `exclude` configuration? (If a user excludes `fixtures/`, should co-change analysis also exclude fixture files?)
- What about binary files, config files, or non-source files that appear in commits alongside source files?

### 8. Testing Strategy
- The plan mocks `runGitLog` and tests pure computation. But the git log parsing is the most fragile part (text parsing of subprocess output). Should there be integration tests that run actual `git log` commands?
- How do you test threshold calibration? Unit tests with mock data don't prove the thresholds work on real repos.
- The plan has ~20 tests. Is this enough for a module that parses subprocess output, handles 5+ edge cases, and has 9 configurable constants?

## Output Format

Structure your review as:

### Critical Issues (Must Fix Before Implementation)
Issues that would cause incorrect output, crashes, or architectural problems if not addressed.

### Important Concerns (Should Address)
Issues that affect quality, maintainability, or edge case handling but aren't blockers.

### Minor Suggestions (Nice to Have)
Polish, style, or minor improvements.

### Questions for the Author
Things you need clarified before you can fully evaluate.

### What's Good
Acknowledge what's well-designed (be specific, not generic praise).

### Revised Recommendation
Based on your review: PROCEED as-is, REVISE (with specific changes), or RETHINK (fundamental approach issues).

---

## Codebase Context

For reference, the engine's current architecture:

- **18-stage pipeline** per package: file discovery -> AST parsing -> symbol graph -> import chain -> tier classification -> public API -> config analysis -> dependency analysis -> meta-tool detection -> convention extraction -> commands -> architecture detection -> role inference -> anti-patterns -> contribution patterns -> impact classification -> pattern fingerprinting -> example extraction
- **Import-chain module** (`src/import-chain.ts`, 123 lines): The closest analogue. Computes file-to-file coupling from `SymbolGraph.importGraph`, generates `WorkflowRule` entries. Thresholds: >= 5 imported symbols, >= 3 dependents, max 5 rules.
- **File discovery** (`src/file-discovery.ts`): Only current git usage — `execSync('git ls-files --cached --others --exclude-standard')` with 5s timeout, fallback to FS walk.
- **Workflow rules** (`src/workflow-rules.ts`): Generates technology-aware rules (Drizzle migrations, Prisma generate, Turbo tasks). Co-change and import-chain rules are appended separately in `pipeline.ts`.
- **Types** (`src/types.ts`): `WorkflowRule { trigger, action, source, impact: "high" }`. `FileImportEdge { importer, source, symbolCount, symbols[] }`.
- **3 production dependencies**: typescript, mri, picomatch. No git libraries.
- **327 tests**, 0 type errors, ~11K lines across 37+ modules.

The full plan is in `GIT-HISTORY-MINING-PLAN.md`. Read it completely before starting your review.
