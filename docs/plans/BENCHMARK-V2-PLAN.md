# Benchmark V2: Full Redesign with PR-Based Ground Truth

## Context

The current benchmark (v1) has fundamental problems:
- **Self-referential**: The engine tests its own output against its own detected patterns (circular)
- **Generic tasks**: Every repo gets "add import-ordering utility" — artificial, domain-irrelevant
- **Tiny samples**: 2-5 tasks per repo with NO statistical significance testing
- **Weak scoring**: Architecture and command scoring use naive text matching, not AST
- **Token confound**: Condition A always has more tokens than B, not controlled
- **Misleading data**: The BENCHMARK-RESULTS-20-REPOS.md contains contradictory numbers from 3 separate runs

The redesign eliminates circularity by using **real commits as ground truth**: we ask the AI to write code that a real developer actually wrote, then compare. AGENTS.md is just one of the conditions — its value is measured against real developer behavior, not engine-derived expectations.

## Architecture Overview

```
Benchmark V2
├── PR-Based Mode (primary) ← NEW
│   ├── pr-miner.ts      — Mine git history for qualifying commits
│   ├── pr-scorer.ts      — Score AI output against real diffs
│   └── pr-task-gen.ts    — Generate task prompts from commits
├── Synthetic Mode (improved existing)
│   ├── task-generator.ts — Fixed: diverse names, more tasks, 2 cmd tasks
│   └── scorer.ts         — Fixed: better arch/cmd scoring
├── Shared
│   ├── types.ts          — Extended with PR types
│   ├── code-generator.ts — Prompt assembly for both modes
│   ├── runner.ts         — Orchestrator (supports both modes)
│   ├── statistics.ts     — Always-on stats, permutation test added
│   └── report.ts         — Richer reporting with CIs and effect sizes
└── CLI
    └── benchmark.ts      — --mode pr|synthetic|both
```

## Phase 1: PR-Based Benchmark (Primary — New)

### 1.1 PR Mining (`src/benchmark/pr-miner.ts`)

**How it works:**
1. Run `git log --diff-filter=A` on the repo to find commits that **added** new TS files
2. Filter commits by quality criteria (see below)
3. For each qualifying commit, capture: commit SHA, parent SHA, message, added file(s)
4. Read the actual added file as **ground truth**
5. Collect sibling files in the same directory (excluding the ground truth file)

**Qualifying commit criteria:**
- Added 1-3 new `.ts`/`.tsx` files (focused, not bulk imports)
- Added files are 20-500 lines (not trivially small or massive)
- Added files are in a directory with >= 3 existing siblings (enough context for the AI)
- Commit message >= 15 characters (descriptive enough to derive a task)
- Not test-only files (`.test.ts`, `.spec.ts`)
- Not type-definition-only files (`.d.ts`)
- Not config files (`*.config.ts`)
- Commit doesn't primarily change `package.json` / lock files
- Commit changed <= 10 files total (not a sweeping refactor)

**Task selection:** From qualifying commits, select up to `maxTasks` (default 15 for quick, 30 for full), preferring:
1. More recent commits (represent current patterns)
2. Diverse directories (spread across the codebase)
3. Commits with clear messages over vague ones

**Output type:**
```typescript
interface PRTask {
  id: string;                    // e.g., "pr-src-utils-cache-adapter"
  commitSha: string;
  commitMessage: string;
  groundTruthFile: {
    path: string;                // Relative path of the added file
    content: string;             // The actual file content
  };
  targetDirectory: string;       // Directory the file was added to
  siblingFiles: FileContent[];   // Other files in that directory (for context)
  directoryListing: string[];    // Files in the directory
  barrelFile?: FileContent;      // index.ts if it exists
  registrationFile?: FileContent; // If detected by engine
  taskPrompt: string;            // Derived from commit message
}
```

### 1.2 Task Prompt Generation (`src/benchmark/pr-task-gen.ts`)

Derive a task prompt from the commit — deliberately vague about WHERE to put the file so AGENTS.md can demonstrate its value for file placement and convention adherence.

**If commit message is descriptive (>= 30 chars):**
```
Add a new module to the {packageName} project: {commitMessage}.
Follow the project's conventions for file naming, imports, exports, and code style.
Include the implementation file and any necessary updates to barrel/index files.
```

**If commit message is short/vague:**
Derive from the ground truth file's exports and directory:
```
Add a new {typeLabel} for {primaryExportName} to the {packageName} project.
It should provide {derived purpose from exports/directory context}.
Follow the project's conventions for file naming, imports, exports, and code style.
```

### 1.3 PR Scoring (`src/benchmark/pr-scorer.ts`)

Score AI output against the ground truth file across 5 deterministic dimensions:

| Dimension | Weight | How Scored |
|-----------|--------|------------|
| **File placement** | 25% | Did the AI create a file in the correct directory? Exact dir = 100%, parent dir = 50%, wrong = 0% |
| **File naming** | 20% | Does filename follow the same naming convention as ground truth? (kebab/camel/pascal match) |
| **Import patterns** | 25% | Jaccard similarity of import specifiers (AST-parsed) between AI output and ground truth |
| **Export structure** | 15% | Does the AI export similar symbols? Compare export count, naming pattern, types |
| **Compilability** | 15% | Does the file parse without syntax errors? (TS AST) |

All dimensions use AST parsing or filesystem checks — no LLM-as-judge, fully deterministic.

**Composite score:** Weighted sum, 0-100%.

### 1.4 Conditions (3 for PR mode)

| Condition | System Prompt | User Prompt Context |
|-----------|--------------|---------------------|
| **A (Treatment)** | Standard coding prompt | AGENTS.md + sibling files + dir listing + barrel + task prompt |
| **B (Realistic Control)** | Same | Sibling files + dir listing + barrel + task prompt |
| **C (Impoverished)** | Same | Dir listing + task prompt only |

**Key design decisions:**
- 3 conditions (not 4/5) to keep API costs manageable: 20 repos x 15 tasks x 3 = 900 calls
- Ground truth file is ALWAYS excluded from context (the AI must generate it, not copy it)
- A vs B is the headline metric: marginal value of AGENTS.md when source code is available
- C is the lower bound: how well can the AI do with minimal context?

**Dropped from v1:**
- N (shuffled AGENTS.md) — replaced by the non-circular design itself. With real ground truth, we don't need a negative control to prove "content matters vs. structure."
- If token confound analysis is needed later, add B+ (padded) as a 4th condition.

## Phase 2: Fix Existing Synthetic Benchmark

These improvements make the synthetic benchmark a credible secondary signal alongside the PR-based primary.

### 2.1 Diverse Task Names (`src/benchmark/task-generator.ts`)

**Problem:** `deriveTaskName()` always picks "import-ordering" (first non-colliding name in a fixed-order pool).

**Fix:** Seed a deterministic shuffle of the pool per directory path, so different directories get different task names:
```typescript
function deriveTaskName(pattern, absDir): string | null {
  const seed = hashString(absDir);
  const shuffled = seededShuffle(TASK_NAME_POOL, seed);
  // ... pick first non-colliding from shuffled pool
}
```

### 2.2 More Tasks Per Repo

**Changes:**
- Quick mode minimum: 10 tasks (was 5)
- Generate 2 command tasks instead of 1 (add pre-commit hook template)
- Generate up to 4 architecture tasks (was 2)
- Fill remaining slots with pattern tasks

### 2.3 Better Architecture Scoring (`src/benchmark/scorer.ts`)

**Current:** `response.includes(expectedDir)` — naive substring.

**Fix:** Extract directory paths from the response using regex, then compare structurally:
```typescript
function extractDirectoryPaths(text: string): string[] {
  // Match patterns like src/utils/, ./lib/core, packages/auth/src/
  const pathRegex = /(?:^|\s|["'`])((?:\.\/|src\/|lib\/|packages\/)[a-z0-9_\-\/]+)/gi;
  // ...
}
```

Remove the "justification quality" keyword check — replace with a simple length check (>50 chars = has substance).

### 2.4 Better Command Scoring (`src/benchmark/scorer.ts`)

**Improvement:** If the output looks like YAML (contains `name:`, `run:`, `steps:`), parse it as YAML and extract `run:` values. Otherwise fall back to current text matching.

## Phase 3: Statistics Overhaul (`src/benchmark/statistics.ts`)

### 3.1 Always-On Statistics

**Remove** the `mode === "full" && n >= 10` gate. Always compute:
- Wilcoxon signed-rank test (works for n >= 6, appropriate for non-normal data)
- Bootstrap 95% CI on the mean delta (10,000 resamples, true RNG not fixed seed)
- Cohen's d_z (within-subjects effect size)
- Per-task-type stratified statistics (with explicit caveat when n < 10)

### 3.2 Add Permutation Test

New export: `permutationTest(a, b, nPermutations = 10000)` — non-parametric test that randomly swaps A/B labels and counts how often the shuffled difference exceeds the observed difference. More robust than Wilcoxon for small samples.

### 3.3 Fix Bootstrap

Replace the seeded LCG with `crypto.getRandomValues()` for proper randomness. Keep a `seed` parameter for reproducibility in tests, but default to true random.

## Phase 4: Reporting (`src/benchmark/report.ts`)

### 4.1 Richer Report Format

```markdown
# Benchmark Report: {repoName}
Mode: PR-based | Tasks: 15 | Model: claude-sonnet-4-20250514

## Headline
AGENTS.md Delta (A - B): +12.3% [95% CI: +4.1%, +20.5%]
Effect size: 0.65 (medium), p = 0.003 (Wilcoxon), p = 0.004 (permutation)

## Per-Dimension Breakdown
| Dimension       | A Mean | B Mean | Delta  | CI              |
|-----------------|--------|--------|--------|-----------------|
| File placement  | 82%    | 65%    | +17%   | [+8%, +26%]     |
| File naming     | 91%    | 88%    | +3%    | [-2%, +8%]      |
| Import patterns | 45%    | 32%    | +13%   | [+5%, +21%]     |
| Export structure | 60%    | 55%    | +5%    | [-3%, +13%]     |
| Compilability   | 95%    | 93%    | +2%    | [-1%, +5%]      |

## Token Analysis
| Condition | Mean Input Tokens | Token Delta vs B |
|-----------|-------------------|------------------|
| A         | 4,200             | +1,800 (AGENTS.md) |
| B         | 2,400             | baseline         |
| C         | 800               | -1,600           |

## Methodology
- Tasks derived from {N} real commits (date range: {start} to {end})
- Ground truth: actual files committed by developers
- Scoring: 5 deterministic dimensions (AST-based, no LLM-as-judge)
- Statistics: Wilcoxon signed-rank, permutation test, bootstrap 95% CI
```

### 4.2 Cross-Repo Aggregate Report

When running across multiple repos, produce an aggregate:
- Overall Wilcoxon signed-rank across all repos (treating repo means as paired observations)
- Forest plot data (repo-level effect sizes with CIs)
- Per-dimension aggregates
- Repo characteristic correlations (size, packages, pattern tiers vs. delta)

## Phase 5: Fix Data Document

Rewrite `BENCHMARK-RESULTS-20-REPOS.md` to:
1. Clearly separate v1 (synthetic) results from v2 (PR-based) results
2. Report accurate numbers with CIs
3. Acknowledge methodology limitations explicitly
4. Remove the contradictory "Post-Fix Summary" that mixed v2fix numbers into the original table

## Files to Create

| File | Purpose | Est. Lines |
|------|---------|------------|
| `src/benchmark/pr-miner.ts` | Mine git history, filter commits, select tasks | ~250 |
| `src/benchmark/pr-scorer.ts` | Score AI output against real diffs (5 dimensions) | ~300 |
| `src/benchmark/pr-task-gen.ts` | Generate task prompts from commit messages | ~150 |
| `test/benchmark/pr-miner.test.ts` | Tests for PR mining logic | ~200 |
| `test/benchmark/pr-scorer.test.ts` | Tests for PR scoring logic | ~250 |

## Files to Modify

| File | Changes |
|------|---------|
| `src/benchmark/types.ts` | Add PR task types, benchmark mode enum, extended result types |
| `src/benchmark/runner.ts` | Support PR mode, always compute stats, handle mode selection |
| `src/benchmark/code-generator.ts` | PR task prompt assembly, ground truth exclusion from context |
| `src/benchmark/statistics.ts` | Remove n>=10 gate, add permutation test, fix bootstrap RNG |
| `src/benchmark/report.ts` | Per-dimension reporting, CIs, effect sizes, aggregate reports |
| `src/benchmark/task-generator.ts` | Seeded shuffle for task names, 2 cmd tasks, min 10 tasks |
| `src/benchmark/scorer.ts` | Better architecture/command scoring |
| `src/bin/benchmark.ts` | `--mode pr|synthetic|both` flag |
| `src/bin/synaps.ts` | Updated help text |

## Implementation Order

1. **Types first** — extend `types.ts` with PR types and benchmark mode
2. **PR miner** — `pr-miner.ts` + tests (can validate against real repos immediately)
3. **PR task generator** — `pr-task-gen.ts` + tests
4. **PR scorer** — `pr-scorer.ts` + tests
5. **Code generator update** — PR prompt assembly in `code-generator.ts`
6. **Runner update** — PR mode support in `runner.ts`
7. **Statistics fix** — always-on stats, permutation test, bootstrap fix
8. **Fix synthetic benchmark** — task names, scoring, task count
9. **Report update** — new format with CIs and per-dimension breakdown
10. **CLI update** — mode flag, help text
11. **Run benchmarks** — PR mode on 3 pilot repos first, then all 20
12. **Fix data document** — accurate numbers, honest methodology

## Verification Plan

1. **Unit tests**: All new modules have dedicated test files
2. **Integration test**: Run PR-based benchmark on synaps itself (self-benchmark)
3. **Pilot run**: 3 repos (zod, astro, medusa) with PR mode — verify sensible results
4. **Comparison**: Run both modes on the 3 pilot repos, check if they directionally agree
5. **Full run**: All 20 repos with both modes
6. **Sanity checks**:
   - Score distributions should be roughly normal per condition
   - A should beat C in most cases (AGENTS.md should beat minimal context)
   - Effect sizes should be in the 0.2-0.8 range (not implausibly large or negligible)
   - Per-dimension breakdown should show file placement and imports as the strongest AGENTS.md contributions

## Cost Estimate

- PR mode: 20 repos x 15 tasks x 3 conditions = **900 LLM calls** (~$3 at Sonnet rates, ~75 min)
- Synthetic mode: 20 repos x 10 tasks x 3 conditions = **600 LLM calls** (~$2, ~50 min)
- Both modes: **1,500 calls** (~$5, ~2 hours)
- Pilot (3 repos, PR only): **135 calls** (~$0.50, ~11 min)
