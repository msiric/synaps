# Diagnose Tool Review Synthesis

**Models:** Gemini, Opus, Grok, GPT-4, MiniMax/GLM
**Date:** 2026-02-24

## Unanimous Must-Fix (All 5 Models)

### 1. Replace `1/hoursAgo` with exponential decay
Use `e^(-λ * hoursAgo)` clamped to [0.05, 1]. Avoids divide-by-zero, smooth decay, tunable λ.

### 2. Detect uncommitted changes
Add `git diff --name-only` + `git diff --cached --name-only`. Uncommitted files in the dependency chain get maximum recency score. Fixes the most common use case.

### 3. Call graph as score multiplier
Import graph finds suspects (wide net). Call graph refines ranking (does test actually call into suspect?). `callGraphBonus = callGraphHasEdge(errorFile, suspect) ? 1.5 : 1.0`. ~10 lines.

### 4. Multiple error format parsers
- V8 stack: `at func (file:line:col)`
- TS compiler: `file(line,col): error TSxxxx`
- Vitest: `❯ file:line:col`
- Generic fallback: `src/file.ts:line`

### 5. Dynamic weight adjustment
When recent changes exist → recency dominates. When no recent changes → coupling + dependency absorb weight.

### 6. Config file change detection
Check tsconfig.json, package.json, vitest.config.ts, .env for recent modifications.

### 7. Flaky test heuristic
If no suspects have recent changes AND error matches timeout/network patterns → flag as potentially flaky.

## The Killer Insight: "Missing Co-Change" Signal (Opus)

**The most valuable diagnostic signal is the INVERSE of coupling + recency:**

> File X changed, but file Y — which co-changes with X 60% of the time — did NOT change.

This is the "forgotten file" pattern. The tool finds not just what changed, but what SHOULD have changed but didn't.

**Revised weight proposal:**
| Signal | Weight | What it captures |
|--------|--------|-----------------|
| Missing co-change | 35% | File that should have changed but didn't |
| Recency (exponential) | 25% | Recently changed files |
| Coupling | 20% | Historically co-changing files |
| Dependency proximity | 10% | Import/call graph distance |
| Workflow rules | 10% | Expected cascading patterns |

## Estimated Impact on Implementation

All P0 fixes: ~65 extra lines on top of the ~445 planned.
Total implementation: ~510 lines.

## The "Wow" Moment

> "Your test pipeline.test.ts is failing because types.ts changed 2 hours ago. But the root cause isn't in types.ts — it's that validator.ts usually changes with types.ts (65% co-change rate) and wasn't updated."

The AI finds the file that SHOULD have changed but DIDN'T. No other tool does this.
