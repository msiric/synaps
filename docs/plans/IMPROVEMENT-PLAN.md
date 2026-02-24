# Engine Improvement Plan: From 60/30 to 90/0

## Context

20-repo benchmark revealed AGENTS.md helps 12/20 repos (60%) and hurts 6/20 (30%). Root cause identified: directory listings create an anchoring effect that blocks AI exploration. Two targeted fixes should eliminate the negative cases without regressing the positives.

## Step 1: Fix Directory Listing Anchoring (deterministic-formatter.ts)

### What to change

**In `formatArchitecture()` / `formatContributionPatterns()`:**

1. Add "non-exhaustive" language to all directory listings:
   - Append "(non-exhaustive — explore the source tree for additional directories)" to any directory roster
   - This breaks the AI's anchoring on AGENTS.md as the sole directory authority

2. Classify directories by obviousness:
   ```typescript
   const OBVIOUS_DIRS = new Set([
     "src", "lib", "dist", "build", "test", "tests", "__tests__",
     "components", "utils", "types", "hooks", "styles", "assets",
     "public", "pages", "app", "api", "config", "constants",
   ]);
   ```
   - If a directory name (last segment) is in OBVIOUS_DIRS, don't list it in architecture section
   - Only list directories with non-obvious names or non-standard purposes

3. When ALL directories are obvious, replace the directory section with:
   ```
   Standard project structure — the AI can infer directory purposes from file contents.
   ```

### Files to modify
- `src/deterministic-formatter.ts` — `formatArchitecture()` function (~20 lines changed)
- `src/mcp/tools.ts` — `handleGetArchitecture()` to apply same filtering (~10 lines)

### Estimated effort: 1-2 hours

## Step 2: Compute Inferability Score (new module)

### What to build

A lightweight function that scores how "inferable" a repo's patterns are from sibling files alone:

```typescript
// src/inferability.ts (~60 lines)

export interface InferabilityScore {
  score: number;           // 0-100 (higher = more inferable = AGENTS.md less needed)
  factors: {
    directoryObviousness: number;    // % of dirs with standard names
    namingConsistency: number;       // % of files following dominant pattern
    patternUniqueness: number;       // how many non-standard patterns detected
    registrationComplexity: number;  // how many files have registration patterns
  };
  recommendation: "full" | "minimal" | "skip";
}

export function computeInferabilityScore(
  analysis: PackageAnalysis
): InferabilityScore {
  // High score = AI can figure it out from source
  // Low score = AI needs AGENTS.md guidance
}
```

**Scoring logic:**
- Directory obviousness (25% weight): What fraction of directories have standard names?
- Naming consistency (25% weight): Is there one dominant naming pattern (>90% kebab-case)?
- Pattern uniqueness (25% weight): Are there deep signals (commonImports, exportSuffix, registrationFile)?
- Registration complexity (25% weight): Do files need to register in a central location?

**Thresholds:**
- Score 0-30: "full" — include all sections (repo has non-obvious patterns)
- Score 31-70: "minimal" — include architecture + commands, skip verbose patterns
- Score 71-100: "skip" — omit pattern sections entirely (AI can infer everything)

### Files to create
- `src/inferability.ts` (~60 lines)
- `test/inferability.test.ts` (~80 lines)

### Files to modify
- `src/deterministic-formatter.ts` — use score to decide which sections to include
- `src/pipeline.ts` — compute score and store on PackageAnalysis

### Estimated effort: 3-4 hours

## Step 3: Apply Inferability Score to AGENTS.md Output

### What to change

In `assembleFinalOutput()` (deterministic-formatter.ts):

```typescript
const score = computeInferabilityScore(pkg);

// Always include (never hurts):
sections.push(formatCommands(...));
sections.push(formatWorkflowRules(...));
sections.push(formatChangeImpact(...));
sections.push(formatTeamKnowledge(...));

// Include based on score:
if (score.recommendation !== "skip") {
  sections.push(formatArchitecture(...));  // with non-obvious dirs only
}
if (score.recommendation === "full") {
  sections.push(formatContributionPatterns(...));
  sections.push(formatConventions(...));
  sections.push(formatPublicAPI(...));
}

// Always available via --full-output flag regardless of score
```

### Files to modify
- `src/deterministic-formatter.ts` — section inclusion logic (~15 lines)
- `src/types.ts` — add `inferabilityScore?: InferabilityScore` to PackageAnalysis

### Estimated effort: 1 hour

## Step 4: Apply Same Logic to MCP Server

### What to change

The MCP server already serves sections on demand, so the inferability score is less critical there — the AI only gets data it explicitly requests. But:

1. Add the score to `get_architecture` response as metadata:
   ```
   ## Architecture (inferability: 35/100 — AGENTS.md guidance recommended)
   ```

2. In `get_contribution_guide`, if score is high:
   ```
   Patterns in this directory are standard and can be inferred from sibling files.
   This guidance may be redundant with what you can see in the source code.
   ```

### Files to modify
- `src/mcp/tools.ts` — add score to architecture and contribution responses (~10 lines)
- `src/mcp/queries.ts` — add `getInferabilityScore()` query function

### Estimated effort: 30 minutes

## Step 5: Validate with Targeted Re-benchmarks

### What to test

Run benchmark on the 6 repos that showed negative delta:
1. nitro (-23.6% → target: 0% or positive)
2. cal.com (-17.8% → target: 0% or positive)
3. excalidraw (-17.8% → target: 0% or positive)
4. sanity (-15.2% → target: 0% or positive)
5. mcp-sdk (-8.5% → target: 0% or positive)
6. tanstack-query (-3.3% → target: 0% or positive)

Also re-run on 3 positive repos to verify no regression:
7. zod (+39.3% → target: still positive)
8. medusa (+29.6% → target: still positive)
9. vitest (+13.2% → target: still positive)

### Success criteria
- 0/6 previously-negative repos still negative (down from 6/6)
- 3/3 previously-positive repos still positive (no regression)
- Overall: 18-20/20 repos positive or neutral

### Estimated effort: 1-2 hours (9 benchmark runs × ~5-10 min each)

## Step 6: Update Benchmark Data and Documentation

### What to update
- `BENCHMARK-RESULTS-20-REPOS.md` — add "post-fix" column showing improvement
- `CHANGELOG.md` — add entry for the inferability fix
- `README.md` — update if needed

### Estimated effort: 30 minutes

## Implementation Order

```
Step 1: Fix directory anchoring          (1-2 hours)   ← highest impact, simplest change
Step 2: Build inferability score         (3-4 hours)   ← enables adaptive output
Step 3: Apply score to AGENTS.md output  (1 hour)      ← connects score to formatter
Step 4: Apply to MCP server             (30 min)       ← consistency across surfaces
Step 5: Validate with benchmarks        (1-2 hours)    ← prove it works
Step 6: Update documentation            (30 min)       ← record results
```

**Total estimated effort: 8-10 hours**

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|---|
| Non-exhaustive language doesn't break anchoring | Medium | High | Test on nitro specifically before full run |
| Inferability score thresholds are wrong | Medium | Medium | Calibrate against 20-repo dataset before shipping |
| Removing pattern sections hurts positive repos | Low | High | Always allow --full-output override |
| New scoring logic has bugs | Low | Medium | 80+ lines of tests, validate against known repos |

## What Success Looks Like

**Before (current state):**
- 12/20 positive (60%), 2/20 neutral (10%), 6/20 negative (30%)
- Pattern average: +2.3% (highly variable: +59% to -59%)
- Users have a 30% chance of the engine making things worse

**After (target state):**
- 18-20/20 positive or neutral (90-100%), 0-2 negative (0-10%)
- Pattern average: +5-10% (low variance, never strongly negative)
- Users can trust the engine won't hurt their AI tools

This is the difference between "interesting research project" and "product people recommend."
