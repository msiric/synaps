# Plan: Git History Mining for synaps (v2 — Post-Adversarial Review)

## Context

The engine analyzes code as a static snapshot — it sees structure but not evolution. Git history contains signals no static analysis can produce. The most valuable: **co-change patterns** ("types.ts and serializer.ts change together in 78% of commits"). These capture semantic coupling invisible in code structure.

This feature adds `src/git-history.ts` (~220 lines) that mines `git log` output to produce co-change workflow rules. It follows the import-chain pattern.

**Revision history:** This plan was reviewed by 4 adversarial reviewers (GPT-5, Claude Opus 4.6, Grok 4, Gemini 3 Pro). All returned REVISE. This is the revised version addressing all critical findings.

## Critical Fixes from Adversarial Review

| # | Issue | Finding | Fix Applied |
|---|-------|---------|-------------|
| 1 | **`min()` denominator inflates asymmetric pairs** | All 4 models flagged. `min(3, 100) = 3`, frequency = 1.0 for a pair that only matters 3% of the time from the other direction | Switch to **Jaccard index**: `coChangeCount / (commitsA + commitsB - coChangeCount)`. Recalibrate threshold to ~0.15-0.25 |
| 2 | **Regex dedup parses rendered strings** | All 4 models flagged. `r.trigger.match(/`([^`]+)`/)` is fragile, breaks if format changes | Pass structured `Set<string>` of covered files directly from import-chain computation |
| 3 | **Deleted files create ghost rules** | 3/4 models flagged. Rules point to files that no longer exist | Filter edges by `fs.existsSync()` after computation |
| 4 | **Per-package git analysis is architecturally wrong** | 3/4 models flagged. Monorepos run `git log` N times redundantly; cross-package co-changes invisible | Run git analysis **once at repo level** in pipeline orchestrator, distribute edges to packages |
| 5 | **15-file cap breaks squash-merge workflows** | 3/4 models flagged. Squash merges routinely produce 20-30 file commits | Raise to 30, add warning when >50% of commits are filtered |
| 6 | **File renames create spurious pairs** | 3/4 models flagged. `git mv old.ts new.ts` appears as co-change | Use `--diff-filter=AMCR` to exclude deletion-only entries |
| 7 | **Hub-file threshold too aggressive for young repos** | 3/4 models flagged. In a 15-commit repo, core file in 11 commits (73%) gets excluded | Adaptive: only apply hub filtering when `totalCommits >= 50`; otherwise raise to 0.9 |
| 8 | **Thresholds unvalidated** | All 4 models flagged | Calibrate on 3 benchmark repos before finalizing constants |

## Scope

### In scope (v1)
1. **Co-change analysis** using Jaccard similarity — file pairs that change together, producing WorkflowRule entries
2. **Noise filtering** — large-commit cap, adaptive hub-file detection, deleted-file filtering
3. **Graceful degradation** — no git / shallow clone = null, analysis continues
4. **Repo-level execution** — run once, distribute to packages

### Deferred to v2
- File volatility / hotspot metrics
- Bug-fix commit detection
- Rename-aware history unification (`--follow`)
- Caching of git analysis results
- Size-weighted pair contributions (instead of hard commit-size cap)

### Out of scope
- Git blame / author attribution
- Branch-specific analysis
- Cross-repo analysis

## Implementation

### Step 1: Add types to `src/types.ts`

Add after `FileImportEdge` (~line 166):

```typescript
export interface CoChangeEdge {
  file1: string;              // relative path (alphabetically first)
  file2: string;              // relative path (alphabetically second)
  coChangeCount: number;      // commits where both changed
  file1Commits: number;       // total commits changing file1
  file2Commits: number;       // total commits changing file2
  jaccard: number;            // coChangeCount / (file1Commits + file2Commits - coChangeCount)
}

export interface GitHistoryAnalysis {
  coChangeEdges: CoChangeEdge[];
  totalCommitsAnalyzed: number;
  commitsFilteredBySize: number;  // how many were skipped (squash-merge detection)
  historySpanDays: number;
}
```

Add `gitHistory?: GitHistoryAnalysis` to `PackageAnalysis` (after `importChain`, ~line 82).

### Step 2: Create `src/git-history.ts` (~220 lines)

**`mineGitHistory(repoDir, packageDirs, warnings, options?)`**
- Entry point. Runs git ONCE at repo level, returns `Map<packageDir, GitHistoryAnalysis>` or null
- Options: `{ maxCommits?, maxDays?, maxFilesPerCommit?, hubFileThreshold?, minHubCommits? }`
- Detects shallow clone via `git rev-parse --is-shallow-repository`

**`runGitLog(repoDir, maxCommits, maxDays)`**
- Resolve git root via `git rev-parse --show-toplevel` (cache for monorepo)
- Command: `git log --name-status --diff-filter=AMCR --format="COMMIT:%H %at" --no-merges -n {maxCommits} --since="{maxDays} days ago"`
- `execSync` with 10s timeout, stdio: pipe
- `--name-status` with `--diff-filter=AMCR` excludes deletion-only entries (handles renames cleanly)
- Returns raw string or null on failure

**`parseGitLog(raw)`**
- Splits on `COMMIT:` markers
- Each commit -> `{ hash, timestamp, files[] }`
- Parses `--name-status` format: `M\tsrc/foo.ts` or `A\tsrc/bar.ts` (tab-separated)
- Filters to SOURCE_EXTENSIONS only
- Paths are repo-root-relative (from `--name-status`)
- Returns `ParsedCommit[]`

**`computeCoChangeEdges(commits, packageFiles, options)`**
- `packageFiles: Set<string>` — files that currently exist (from file-discovery), for deleted-file filtering
- Skip commits with > maxFilesPerCommit source files; track count in `commitsFilteredBySize`
- If `commitsFilteredBySize / totalCommits > 0.5`, add warning: "Most commits touch >{maxFilesPerCommit} files -- co-change analysis may be unreliable (squash-merge workflow?)"
- Count per-file commit appearances
- Hub-file detection (adaptive):
  - If totalCommits >= minHubCommits (default 50): exclude files in > hubFileThreshold (default 0.7) of commits
  - If totalCommits < 50: exclude files in > 0.9 of commits (more lenient for young repos)
- For each remaining commit with 2+ files: create pair key `[fileA, fileB]` (alphabetically sorted)
- Accumulate counts per pair and per file
- Compute Jaccard: `coChangeCount / (file1Commits + file2Commits - coChangeCount)`
- Filter: `jaccard >= MIN_JACCARD` AND `coChangeCount >= MIN_CO_CHANGES`
- Filter: both files exist in `packageFiles` (no ghost rules)
- Sort by jaccard desc, cap at MAX_EDGES
- Return `CoChangeEdge[]`

**`generateCoChangeRules(edges, coveredFiles, maxRules?)`**
- `coveredFiles: Set<string>` — file paths already covered by import-chain rules (structured data, NOT parsed from strings)
- Groups edges by file -> "which files co-change with this one?"
- Filters files with >= 2 co-change partners above threshold
- Skips files in `coveredFiles` set
- For display text, use the higher directional confidence: `coChangeCount / file1Commits` or `coChangeCount / file2Commits` (whichever is the trigger file)
- Produces WorkflowRule[]:
  ```
  trigger: "When modifying `src/types.ts`"
  action: "Also check `src/serializer.ts` (co-changed in 78% of its commits), `src/formatter.ts` (65%), and 1 more"
  source: "Git co-change analysis -- 4 files frequently change together with this module"
  impact: "high"
  ```
- Cap at maxRules (default 5)

**Constants:**
```typescript
const MIN_COMMITS = 10;              // skip analysis if fewer commits available
const MAX_COMMITS = 500;             // analyze up to 500 commits (raised from 200 per review)
const MAX_DAYS = 90;
const MAX_FILES_PER_COMMIT = 30;     // raised from 15 per squash-merge feedback
const HUB_FILE_THRESHOLD = 0.7;      // for repos with >= 50 commits
const HUB_FILE_THRESHOLD_YOUNG = 0.9; // for repos with < 50 commits
const MIN_HUB_COMMITS = 50;          // adaptive hub threshold boundary
const MIN_JACCARD = 0.15;            // Jaccard threshold (calibrate on real repos)
const MIN_CO_CHANGES = 3;            // minimum co-change count
const MAX_EDGES = 50;                // cap stored edges
const MAX_RULES = 5;                 // cap generated rules
```

### Step 3: Integrate into pipeline (`src/pipeline.ts`)

**Run ONCE at repo level** — in `runPipeline()` BEFORE the per-package loop (~line 50):

```typescript
// Git history mining (repo-level, run once)
const gitHistoryMap = mineGitHistory(
  config.rootDir ?? config.packages[0],
  config.packages,
  warnings,
);
```

**In `analyzePackage()`** — receive pre-computed git data as parameter:

```typescript
// Store git history for this package
if (gitHistoryMap?.has(pkgPath)) {
  analysis.gitHistory = gitHistoryMap.get(pkgPath);
}
```

**In cross-package workflow rule generation** (after import-chain rules, ~line 127):

```typescript
// Collect files already covered by import-chain rules (structured data)
const importChainCoveredFiles = new Set(
  importChainEdges.map(e => e.source)  // raw edge data, not parsed strings
);

// Add co-change rules
const coChangeRules = generateCoChangeRules(
  packageAnalyses.flatMap(p => p.gitHistory?.coChangeEdges ?? []),
  importChainCoveredFiles,
);
if (coChangeRules.length > 0) {
  vlog(verbose, `Co-change rules: ${coChangeRules.length} rules from git history`);
  workflowRules.push(...coChangeRules);
}
```

### Step 4: No formatter changes needed

Co-change rules are WorkflowRule entries in the same array. They render automatically in `formatWorkflowRules()`. The `source` field ("Git co-change analysis") distinguishes them from import-chain and technology rules.

### Step 5: Threshold calibration (BEFORE finalizing implementation)

Run the algorithm on 3 benchmark repos with different characteristics:
- **synaps itself** (36 commits, single author, young repo)
- **knip** (2,427 files, active development, likely squash-merge)
- **sanity** (3,746 files, large team, long history)

For each, output:
- Number of commits analyzed
- Number filtered by size cap
- Number of hub files detected
- Top 10 co-change edges with Jaccard scores
- Whether results are useful/noisy/empty

Adjust MIN_JACCARD and other thresholds based on findings.

### Step 6: Tests (`test/git-history.test.ts`, ~25 tests)

**Testing approach**: Mock `runGitLog` at the I/O boundary. All computation is pure functions on parsed data.

1. **Parsing `--name-status` format** (5 tests)
   - Parse multi-commit output with `M`, `A`, `C`, `R` status codes
   - Exclude `D` (deletion) entries via `--diff-filter`
   - Non-source files filtered out
   - Files are repo-root-relative
   - Empty / malformed output returns empty array

2. **Co-change computation with Jaccard** (7 tests)
   - Two files always together -> Jaccard = 1.0
   - Asymmetric pair: file A in 100 commits, file B in 5 (3 co-changes) -> Jaccard = 3/102 = 0.029 (correctly rejected)
   - Three files in one commit -> 3 pair edges
   - Jaccard threshold filtering
   - Large commit exclusion (> 30 files -> commit skipped)
   - Hub file exclusion (adaptive: 70% for mature repos, 90% for young)
   - Deleted file filtering (files not in packageFiles set excluded)

3. **Rule generation** (5 tests)
   - Produces valid WorkflowRule with trigger/action/source/impact
   - Groups by file, shows top co-change partners with directional confidence in display text
   - Deduplication via structured coveredFiles set (NOT regex)
   - Cap at maxRules
   - "and N more" truncation

4. **Repo-level execution** (3 tests)
   - Returns Map keyed by package directory
   - Multiple packages share single git analysis
   - Files partitioned correctly to packages

5. **Edge cases & graceful degradation** (5 tests)
   - Returns null when git unavailable
   - Returns null for shallow clone (detected via `git rev-parse --is-shallow-repository`)
   - Returns null for < 10 commits
   - Warns when > 50% of commits filtered by size (squash-merge detection)
   - Single-file commits produce no edges

## Files Modified

| File | Change | Risk |
|------|--------|------|
| `src/types.ts` | Add `CoChangeEdge`, `GitHistoryAnalysis`; add `gitHistory?` to `PackageAnalysis` | Low -- additive |
| `src/git-history.ts` | **NEW** -- core module (~220 lines) | N/A |
| `src/pipeline.ts` | Add repo-level git mining before package loop + co-change rule generation in cross-package section | Low -- additive |
| `docs/ROADMAP.md` | Move co-change to shipped, add game-changer features | Low |
| `test/git-history.test.ts` | **NEW** -- ~25 tests | N/A |

## Key Design Decisions

1. **Jaccard index** for symmetric, unbiased co-change scoring (per all 4 adversarial reviews)
2. **Repo-level execution** -- git analysis runs once, results distributed to packages (avoids N redundant git calls in monorepos)
3. **`--name-status --diff-filter=AMCR`** -- excludes deletions, handles renames cleanly without full `--follow` complexity
4. **Structured dedup** -- pass `Set<string>` of covered files, never parse rendered rule text
5. **Deleted-file filtering** -- `fs.existsSync` check prevents ghost rules
6. **Adaptive hub detection** -- lenient (0.9) for young repos (< 50 commits), strict (0.7) for mature repos
7. **Raised commit-size cap to 30** -- accommodates squash-merge workflows; warns when > 50% filtered
8. **Directional confidence in display** -- Jaccard for gating (symmetric), but display text shows `coChangeCount / triggerFileCommits` (directional, more intuitive)
9. **Threshold calibration before shipping** -- run on 3 benchmark repos, adjust MIN_JACCARD based on findings

## Verification

1. `npm run typecheck` -- zero type errors
2. `npm test` -- all existing tests pass + ~25 new tests pass
3. Threshold calibration on 3 benchmark repos (synaps, knip, sanity)
4. Manual test: `npx tsx src/bin/synaps.ts analyze . --format json --dry-run` -- verify gitHistory field
5. Manual test: `--format agents.md` -- verify co-change rules in Workflow Rules section
6. Graceful degradation: temp directory without `.git` -- no errors
7. Monorepo test: run on a benchmark monorepo (wave3-workspace fixture or turbo-monorepo fixture)
