# Diagnose v2 Review Synthesis

**Models:** Gemini, Opus, Grok, GPT-4, MiniMax/GLM
**Date:** 2026-02-24

## Unanimous (All 5 Models)

### 1. Missing co-change needs minimum sample size
Add `coChangeCount >= 5` (or 10) threshold before activating the signal. Without it, 2-3 coincidental co-changes produce false positives at the strongest signal weight.

### 2. Decay constant λ=0.1 is too aggressive
A 24-hour-old change scores 9% — too low. Real debugging cycles span 1-3 days.
- **Consensus:** Change to λ=0.05 (half-life ~14 hours instead of ~7)
- 24h change → 30% (usable), 48h → 9% (correctly fading), 7h → 70% (same session)

### 3. Call graph multiplier: don't boost the error site itself
If the error IS in file X, boosting X by 1.5x because it has call graph edges is circular. Exclude error files from the bonus. Only boost *suspects* that connect to the error via call graph.

### 4. Handle "no parseable files" gracefully
If errorText contains no project file references, return a helpful message suggesting filePath/testFile input. Don't fail silently or crash.

### 5. BFS barrel file handling needs verification
If `pkg.importChain` doesn't include re-export edges, BFS will dead-end at barrel files. Must verify and either fix the data or acknowledge in output.

## Strong Consensus (4-5 Models)

### 6. Shallow clone / no git graceful degradation
CI environments with `depth=1` will have no git log data. Handle with try/catch and fallback to import graph + coupling only.

### 7. Output format: list over table for AI
Numbered lists parse more reliably than markdown tables across AI models. Keep tables for optional detail/debug mode.

### 8. Include score breakdown per suspect
Show individual signal contributions (recency=25, coupling=20, missingCoChange=35...) not just combined reason string. Helps AI reason about WHY.

### 9. Explicitly suggest `plan_change` as next step
After diagnosis, the natural workflow is diagnose → plan_change → fix. Make this explicit in output.

### 10. Add "recently added test" detection
If the test file itself was recently modified but no suspects have recent changes, flag: "Test was recently added — may be exposing a pre-existing bug."

## MVP vs Full: Split Decision

- **Gemini, Opus:** Ship full (~590 lines). The missing co-change IS the value proposition.
- **Grok, MiniMax, GLM:** Ship MVP (~250-300 lines) first. Core parsing + basic scoring + missing co-change (with threshold). Add flaky detection + config file check + detailed breakdown in v1.1.
- **GPT:** Middle ground (~350-400 lines). Ship most signals but defer at-risk tests and detailed chain visualization.

**My recommendation:** Ship full with graceful degradation. Each signal returns 0 when data is insufficient. No feature flags, no phasing — just robust defaults.

## Key Test Case (All Models Agreed)

```
Setup:
- types.ts changed 2h ago (added email field)
- validator.ts NOT changed (but co-changes with types.ts: Jaccard 0.65, 12 co-changes)
- test/pipeline.test.ts fails: "Cannot read property 'validate' of undefined"

Expected:
- validator.ts ranks #1 (missing co-change signal)
- types.ts ranks #2 (recently changed)
- Reason for #1 explicitly says "Missing co-change"
```

## Revised Implementation Parameters

| Parameter | v2 Plan | v2.1 Revision |
|-----------|---------|---------------|
| Decay constant λ | 0.1 | **0.05** |
| Missing co-change min count | (none) | **≥5 co-changes** |
| Missing co-change Jaccard threshold | >0.4 | >0.4 (keep) |
| Call graph multiplier | 1.5x for all | 1.5x **excluding error site** |
| No parseable files | (unhandled) | **Helpful error message** |
| Git unavailable | (unhandled) | **try/catch + coupling-only fallback** |
| Output format | Markdown table | **Numbered list (primary) + table (optional)** |
| Score breakdown | Combined reason only | **Per-signal breakdown** |
| plan_change suggestion | Not mentioned | **Explicit next-step recommendation** |

## Estimated Lines After All Revisions: ~560
(Slightly less than original 590 — list format is shorter than table format)
