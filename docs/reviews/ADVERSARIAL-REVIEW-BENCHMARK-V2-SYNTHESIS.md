# Adversarial Review Synthesis: Benchmark V2

**Reviewers:** Gemini, Opus, Grok, GPT-4, MiniMax/GLM
**Date:** 2026-02-23

## Universal Agreement (All/Most Reviewers)

### 1. CRITICAL: Time Travel / HEAD vs Commit State

**Every reviewer flagged this.** Reading ground truth and sibling files from HEAD instead of at commit time is a fatal flaw. If the repo refactored `src/auth/` to `packages/core/auth/` since the commit, AGENTS.md (generated from HEAD) describes the NEW structure, but ground truth expects the OLD location. The AI gets punished for following current documentation.

**Consensus fix:** Use `git show <sha>:<path>` for ground truth and `git show <sha>^:<path>` for context (siblings, barrels, dir listing). Generate AGENTS.md at the parent commit state, not HEAD.

### 2. CRITICAL: Multiple Valid Solutions Destroys Import/Export Scoring

**All 5 reviewers independently identified this as the biggest scoring problem.** A cache adapter using Redis vs in-memory Map are both valid but score ~0% on import Jaccard. This means 40% of the composite score (imports 25% + exports 15%) measures "did you guess the same library as this developer" — not convention adherence.

**Consensus fix:**
- Drastically reduce import weight (from 25% to 5-15%)
- Only score LOCAL (intra-project) imports, not external packages
- Score import PATTERNS (relative path depth, barrel usage) not specific specifiers
- Score export SHAPE (class vs function, named vs default) not identity

### 3. HIGH: Sample Size Underpowered

**All reviewers ran power calculations.** n=15 gives ~45-55% power for medium effects (d=0.5). You need n≥30 for 80% power.

| Reviewer | Minimum n (d=0.5, 80% power) |
|----------|------------------------------|
| Opus     | 33                           |
| GPT      | 32                           |
| Grok     | 22                           |
| MiniMax  | 28                           |
| GLM      | 35                           |

**Consensus fix:** Minimum 30 tasks per repo for quick mode, 50 for full mode.

### 4. HIGH: Token Confound Not Controlled

**4/5 reviewers said dropping the shuffled/token-matched condition was a mistake.** Without it, A > B could mean "AGENTS.md content is good" OR "more context always helps."

**Consensus fix:** Add a 4th condition. Options:
- Opus (strongest argument): **B+ = wrong repo's AGENTS.md** — tests "does ANY documentation help, or the RIGHT documentation?"
- Gemini/Grok: Reinstate shuffled N with sibling files
- GPT: B+ on a 25-33% stratified subsample to control costs

### 5. MEDIUM-HIGH: Compilability is Worthless

**All reviewers agreed.** Syntactic parsing is too low a bar. Almost any LLM output passes.

**Consensus fix:**
- Gemini: Make it a gate (fail → all other scores become 0), not a scored dimension
- Opus/GPT/GLM: Replace with `tsc --noEmit` type-checking against the repo's tsconfig
- Pragmatic: At minimum, verify that local import paths resolve to real files

### 6. HIGH (Opus only, but critical): Training Data Contamination

**Only Opus raised this prominently,** but it's devastating. Popular repos (zod, astro, medusa) are in the training data. The model may have memorized exact files. This inflates baseline scores and compresses A-B deltas.

**Opus's fix:**
- Filter to commits after the model's training cutoff (last 2-3 months)
- Add contamination probes (ask model to generate the file given ONLY the path — if it can, the task is contaminated)
- Report contamination-filtered and unfiltered results side by side

## Key Disagreements

### Test Suites as Ground Truth

| Position | Reviewers |
|----------|-----------|
| **NO** — too complex, slow, tests coupled to implementation | Gemini, Opus |
| **YES** — selectively, as optional validation layer | GPT, MiniMax, GLM |

**My take:** Implement as optional "gold standard" stratum for repos with good test coverage. Don't make it the primary scoring method.

### LLM-as-Judge

| Position | Reviewers |
|----------|-----------|
| YES, for functional equivalence only | Gemini, Opus, GLM |
| Only as auxiliary on small sample | GPT, Grok |

**My take:** Use as a FILTER (not scorer) for the import equivalence problem. Before penalizing import differences, ask: "Are these imports from different valid approaches to the same task?" If yes, don't penalize.

### Single Metric vs Multi-Dimensional

| Position | Reviewers |
|----------|-----------|
| Lead with file placement as PRIMARY, others secondary | Opus, GPT, Grok, GLM |
| Keep composite but fix weights | Gemini |

**My take:** Strong consensus for file placement as the headline metric. Report per-dimension breakdowns but don't combine into a weighted composite. This avoids arbitrary weight debates.

### Cross-Repo Validation

**MiniMax uniquely proposed:** Generate AGENTS.md for repo X, test on repo Y to fully break circularity. Interesting but impractical for v2 — AGENTS.md is repo-specific by design.

### Multi-Model Testing

| Position | Reviewers |
|----------|-----------|
| Essential for credibility | Grok, GLM |
| Important but can defer | Opus, GPT |
| Not mentioned | Gemini |

**My take:** Test Sonnet + one other (GPT-4o or Haiku) for v2. Multi-model is important for credibility but shouldn't block the initial run.

## Revised Design Decisions

### Must Change from Original Plan

| Original Plan | Revised |
|--------------|---------|
| Read ground truth from HEAD | Read from commit SHA via `git show` |
| Context from current repo state | Context from parent commit via `git show <sha>^:` |
| Generate AGENTS.md from HEAD | Generate from parent commit state |
| Import Jaccard at 25% weight | Local imports only at 10-15%, pattern-based scoring |
| 3 conditions (A/B/C) | 4 conditions (A/B/B+/C) — B+ uses wrong repo's AGENTS.md |
| 15 tasks quick mode | 30 tasks quick mode, 50 full |
| Compilability at 15% | Type-check gate (pass/fail via tsc), not weighted score |
| Weighted 5-dim composite | File placement as primary headline; others reported separately |

### Revised Scoring

| Dimension | Original Weight | Revised | Rationale |
|-----------|----------------|---------|-----------|
| File placement | 25% | **Primary metric (reported alone)** | Universal consensus: clearest signal, least ambiguous |
| Naming convention | 20% | **Secondary metric** | Measurable, convention-driven |
| Local import patterns | 25% | **Secondary metric** | Only intra-project imports; pattern-based, not Jaccard |
| Export shape | 15% | **Secondary metric** | Class vs function vs const; named vs default |
| Compilability | 15% | **Gate** (fail = 0 on everything) | Replace with tsc --noEmit where possible |

Report each dimension separately with its own CI. No weighted composite.

### Revised Conditions

| Condition | What the AI Gets | Purpose |
|-----------|-----------------|---------|
| **A (Treatment)** | AGENTS.md + siblings + dir listing + barrel | Full treatment |
| **B (Realistic)** | Siblings + dir listing + barrel | Source-code-only baseline |
| **B+ (Token-Matched)** | Wrong repo's AGENTS.md + siblings + dir listing + barrel | Controls token confound |
| **C (Impoverished)** | Dir listing only | Lower bound |

### Revised Cost Estimate

- 20 repos × 30 tasks × 4 conditions = **2,400 LLM calls** (~$8, ~3.5 hours)
- Pilot (3 repos × 30 tasks × 4 conditions) = **360 calls** (~$1.20, ~30 min)

### Contamination Mitigation

1. Prefer commits from last 3-6 months (post training cutoff for most models)
2. Add contamination probe: ask model to generate file given ONLY path + task prompt (condition C). If C scores > 80%, flag task as potentially contaminated.
3. Report results with and without flagged tasks.

### Statistical Plan

- **Per-repo:** Wilcoxon signed-rank + permutation test on 30 paired (A, B) scores
- **Cross-repo:** Random-effects meta-analysis (inverse-variance weighted) on repo-level deltas
- **Effect size:** Cohen's d_z with bootstrap 95% CI
- **Supplementary:** Sign test (simplest, fewest assumptions), win rate (% tasks where A > B)
- **Report heterogeneity:** I² statistic, forest plot of per-repo effects
- **Power:** With n=30, ~75% power for d=0.5 (honest about limitation)

## Implementation Impact

### New Complexity from Review Feedback

1. **Git checkout / git show infrastructure** — must read files at specific commits
2. **B+ condition** — need to cross-match repos for AGENTS.md swapping
3. **Contamination probes** — extra LLM call per task
4. **tsc --noEmit** — need to set up TypeScript compilation per repo at specific commits
5. **Meta-analysis** — random-effects model in statistics.ts

### Complexity Worth Adding
- Git show for time-travel reads (CRITICAL)
- B+ condition (HIGH value for credibility)
- Contamination probes (HIGH value, low cost)
- Per-dimension reporting without composite (simplifies, doesn't add complexity)

### Complexity to Defer
- Full tsc --noEmit type-checking (MEDIUM — complex repo setup; start with import path resolution check)
- Test suite validation (MEDIUM — defer to v3)
- LLM-as-judge for import equivalence (LOW priority — nice to have)
- Cross-repo validation (DEFER — interesting but impractical for v2)
- Random-effects meta-analysis (CAN use simpler inverse-variance weighting first)
