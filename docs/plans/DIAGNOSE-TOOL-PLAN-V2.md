# Implementation Plan: `diagnose` MCP Tool (v2 — Post-Review)

## Context

AI coding tools treat every test failure as a text-matching problem — read the error, guess at a fix. This creates "death spirals" where the AI fixes one thing, breaks another, and loops. The `diagnose` tool provides structural understanding that the AI literally cannot derive from reading error text alone.

**Validated by:** 5 adversarial reviewers, PRAXIS paper (3.8x RCA accuracy with graph traversal), Sentry's approach (combines multiple data sources for 95% accuracy).

**This is v2 of the plan**, incorporating all P0 feedback from the first review round.

## Key Changes from v1

| Issue | v1 Plan | v2 Revision | Source |
|-------|---------|-------------|--------|
| Recency scoring | `1/hoursAgo` (division-by-zero) | Exponential decay `e^(-0.1 * hours)` clamped [0.05, 1] | All 5 models |
| Uncommitted changes | Not detected | `git diff --name-only` as primary recency signal | Opus, GPT, Gemini |
| Call graph | Not used for ranking | Score multiplier: 1.5x if call graph edge exists | All 5 models |
| Error parsing | Single regex | 4 regex patterns: V8, TypeScript, Vitest, generic fallback | Opus, Gemini, GPT |
| Scoring weights | Static 40/30/20/10 | Dynamic: recency-dominant when recent changes exist, coupling-dominant when not | All 5 models |
| Config files | Not checked | Detect tsconfig.json/package.json/.env changes for out-of-graph failures | GPT, Grok, MiniMax |
| Flaky tests | Not handled | Heuristic: no recent changes + timeout/network error patterns → flag | Opus, Grok |
| **Missing co-change** | **Not in v1** | **New signal: file that SHOULD have changed but didn't (35% weight when active)** | **Opus** |

## Input Schema

```typescript
{
  errorText?: string;     // Raw test output / stack trace / error message
  filePath?: string;      // Specific file with the error
  testFile?: string;      // Failing test file
  packagePath?: string;
}
```

At least one of `errorText`, `filePath`, or `testFile` required.

## Scoring Formula (Revised)

### Dynamic Weights

```typescript
const hasRecentChanges = changes.some(c => c.hoursAgo < 24);
const weights = hasRecentChanges
  ? { missingCoChange: 35, recency: 25, coupling: 20, dependency: 10, workflow: 10 }
  : { missingCoChange: 0, recency: 0, coupling: 50, dependency: 35, workflow: 15 };
```

### Per-Signal Computation

| Signal | Formula | Range | What It Captures |
|--------|---------|-------|-----------------|
| Missing co-change | `partner.jaccard` if partner changed but this file didn't, AND Jaccard > 0.4 | 0-1 | File that SHOULD have changed but didn't |
| Recency | `e^(-0.1 * hoursAgo)`, uncommitted = 1.0 | 0.05-1 | Recently modified files |
| Coupling | Jaccard score from co-change data | 0-1 | Historically co-changing files |
| Dependency | `min(symbolCount / 10, 1)` | 0-1 | Import graph proximity |
| Workflow | 1.0 if workflow rule matches, else 0 | 0-1 | Expected cascading patterns |

### Call Graph Bonus
After computing composite score: `score *= callGraphHasEdge ? 1.5 : 1.0`

### Final Score
`score = Σ(weight_i × signal_i) × callGraphBonus`
Top 5 suspects by score, with reason string explaining each signal's contribution.

## Implementation: 4 Query Functions + 1 Tool Handler

### 1. `parseErrorText(errorText, rootDir?)` → queries.ts (~40 lines)

4 regex patterns covering 90%+ of real errors:
- V8 stack frames: `at func (file:line:col)`
- TypeScript compiler: `file(line,col): error TSxxxx`
- Vitest/Jest: `❯ file:line:col`
- Generic fallback: `src/file.ts:line`

Filters out node_modules, node:internal. Normalizes paths. Extracts test file from Vitest `FAIL` header.

### 2. `getRecentFileChanges(rootDir, files)` → queries.ts (~60 lines)

Two git queries:
1. `git diff --name-only` + `git diff --cached --name-only` → uncommitted changes (hoursAgo = 0)
2. `git log --pretty=COMMIT:%H|%at|%s --name-only -n 50 --since=7d` → batch committed changes

Returns `FileChange[]` with hoursAgo, commitMessage, isUncommitted. Sorted by hoursAgo ascending.

### 3. `buildSuspectList(analysis, errorFiles, rootDir)` → queries.ts (~100 lines)

The core engine:
1. Collect candidates from importers + co-change partners of error files
2. Get recent changes for all candidates (batch git query)
3. Determine dynamic weights based on whether recent changes exist
4. Score each candidate with 5 signals + call graph bonus
5. Build "missing co-change" signal: for each recently changed file, check if high-coupling partners were NOT updated
6. Sort by score, return top 5 with detailed reason strings

### 4. `traceImportChain(analysis, from, to)` → queries.ts (~30 lines)

BFS on import graph. Bidirectional adjacency from `pkg.importChain`. Returns shortest path array or null. Max depth 10.

### 5. `handleDiagnose(analysis, args)` → tools.ts (~120 lines)

Composes all queries:
1. Parse error text → extract files + error message
2. Determine error files (from stack frames / filePath / testFile's imports)
3. Build suspect list with scoring
4. Check for config file changes (out-of-graph failures)
5. Detect flaky test patterns (no changes + timeout/network error)
6. Trace dependency chain from test to top suspect
7. Find at-risk tests (importers of suspect files)
8. Format output with suspect table, chain, at-risk tests, suggested actions

### 6. Server Registration → server.ts (~25 lines)

WHEN TO CALL: "IMMEDIATELY after a test failure — before attempting any fix."
DO NOT CALL: "For syntax errors, import-not-found, or when the fix is obvious."

## Output Format

```markdown
## Diagnosis

**Error:** TypeError: Cannot read property 'name' of undefined
**Error site:** `src/pipeline.ts:142` (function: processStage)
**Likely root cause:** `src/validator.ts` — usually co-changes with `src/types.ts` (65%) but wasn't updated

### Suspect Files
| # | File | Score | Reason |
|---|------|-------|--------|
| 1 | src/validator.ts | 82 | Missing co-change: types.ts changed but validator.ts didn't (65% coupling) |
| 2 | src/types.ts | 71 | Changed 2h ago: "refactor: split User type" |
| 3 | src/pipeline.ts | 45 | Direct error site, 8 symbols imported |

### Dependency Chain
test/pipeline.test.ts → src/pipeline.ts → src/types.ts (changed 2h ago)

### Configuration Changes
- `tsconfig.json` was recently modified

### At-Risk Tests
- test/validator.test.ts, test/types.test.ts

### Suggested Actions
1. Check what changed: `git diff HEAD~3 -- src/types.ts`
2. Inspect the forgotten file: `git diff HEAD~3 -- src/validator.ts`
3. Run related tests: `npx vitest run test/pipeline.test.ts test/validator.test.ts`

⚠️ Note: Analysis data from 5 minutes ago. Re-analyze if you've restructured imports since then.
```

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `src/mcp/queries.ts` | 4 new functions + types + helpers | +230 |
| `src/mcp/tools.ts` | handleDiagnose | +120 |
| `src/mcp/server.ts` | Register diagnose tool | +25 |
| `test/diagnose.test.ts` | Parsing + scoring + edge case tests | +200 |
| `README.md` | Tool count + table | +3 |
| `CHANGELOG.md` | Entry | +10 |

**Total: ~590 lines**

## Edge Cases Handled

| Edge Case | How Handled |
|-----------|------------|
| No recent git changes | Dynamic reweight: coupling=50%, dependency=35%, workflow=15% |
| Flaky test (timeout/network) | Warning: "No code changes correlate. May be flaky — try re-running." |
| Config/env changes | Check tsconfig.json, package.json, .env for modifications |
| Deleted/missing files | If stack trace references file not in graph, flag it |
| Stale analysis cache | Show cache age, suggest re-analysis if >5 min |
| Uncommitted changes | `git diff` as primary signal (hoursAgo = 0) |
| Barrel file noise | Call graph bonus filters to actually-called code |

## Test Plan

| Category | Test Cases |
|----------|-----------|
| **Parsing** | V8 stack, TS compiler, Vitest, mixed format, no parseable location |
| **Scoring** | Uncommitted ranks highest, missing co-change beats raw recency, dynamic weights, call graph bonus |
| **Edge cases** | No git changes, flaky pattern, config changes, stale cache |
| **Integration** | Run on own repo with `src/types.ts` as error file |

## Verification

1. `npx tsc --noEmit` — zero type errors
2. `npx vitest run` — all tests pass
3. Manual test on own repo with real test failure
4. Dogfood: deliberately break something, verify diagnose catches it
5. Multi-repo: test on nitro and vitest
6. Build + docs update + version bump + publish in one commit
