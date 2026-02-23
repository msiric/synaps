# Root Cause Analysis: Why AGENTS.md Helps Some Repos and Hurts Others

## Date: 2026-02-23
## Dataset: 20 repos, verified clean (zero API errors)

## The Core Finding

AGENTS.md's directory listing creates an **anchoring effect**. When the AI reads a directory roster from AGENTS.md, it treats that list as the complete set of valid locations. Directories not prominently featured get skipped — even if they exist and are the correct placement for new code.

**When directories are non-obvious** (scripts/, integration-tests/, internal/, docs/), AGENTS.md acts as a discovery map → **+22% to +59% improvement**.

**When directories are standard** (src/, lib/, components/) or when AGENTS.md's listing is incomplete, the anchoring effect blocks exploration → **-22% to -59% regression**.

## The Two Mechanisms

### HURT Mechanism: Directory-Level False Confidence

**How it works:**
1. AGENTS.md lists: "Key directories: src/types, src/utils, src/cli"
2. AI needs to place code in src/config/ (which exists but isn't prominently listed)
3. WITH AGENTS.md: AI anchors on the listed directories, skips src/config/ → 0% score
4. WITHOUT AGENTS.md: AI explores source tree freely, discovers src/config/ → 100% score

**Evidence:**
- nitro: AI scored 0% with AGENTS.md on src/config/ task, 100% without
- cal.com: AI scored 0% with AGENTS.md on apps/ task, 78% without
- sanity: AI scored 0% with AGENTS.md on dev/ task, 78% without

**The -22.3% artifact:** This exact delta appears on 3 repos (cal.com, excalidraw, sanity) because they all have 4 pattern tasks, and AGENTS.md causes exactly 1 directory failure per repo. The cost of one failed directory = 22.3% of the total pattern score.

### HELP Mechanism: Non-Obvious Directory Discovery

**How it works:**
1. AGENTS.md lists: "scripts/, packages/, internal/"
2. AI needs to place code in scripts/ (which is non-obvious — not a standard directory)
3. WITH AGENTS.md: AI knows scripts/ exists and is valid → places code correctly
4. WITHOUT AGENTS.md: AI doesn't discover scripts/ from sibling files → generates nothing

**Evidence:**
- zod: scripts/ listed in AGENTS.md → +59% (B couldn't find scripts/ at all)
- radix-ui: internal/ listed → +22% (B couldn't infer internal/)
- vitest: docs/ listed → +26% (B didn't know to try docs/)
- medusa: integration-tests/ listed → +24% (B missed this unique directory)

## Predictor Variables (Correlation with A-B Delta)

| Predictor | Correlation | Mechanism |
|-----------|:---:|---|
| Non-obvious directories present | r ≈ +0.68 | AGENTS.md acts as discovery map |
| Codebase size >40K lines | r ≈ -0.65 | Too much AGENTS.md noise dilutes attention |
| Large monorepo (10+ packages) | r ≈ -0.58 | Convention fragmentation across packages |
| Architecture section quality | r ≈ +0.68 | Clear architecture → highest deltas |
| Directory listing completeness | **Critical** | Incomplete listing causes anchoring failures |

## The Fix: Two Changes

### Fix 1: Never Present Directories as a Closed Set

**Current (causes anchoring):**
```markdown
## Architecture
Entry point: src/index.ts
Directories:
  src/types/ — Type definitions
  src/utils/ — Utilities
  src/cli/ — CLI entry points
```

**Fixed (encourages exploration):**
```markdown
## Architecture
Entry point: src/index.ts
Key directories (non-exhaustive — explore the source tree for others):
  src/types/ — Type definitions
  src/utils/ — Utilities
  src/cli/ — CLI entry points
```

The phrase "non-exhaustive — explore the source tree for others" breaks the anchoring effect.

### Fix 2: Only List Non-Obvious Directories

Compute an "obviousness score" for each directory:
- Standard names (src/, lib/, components/, utils/, types/, test/) → obvious, don't list
- Non-standard names (scripts/, internal/, integration-tests/, perf/) → non-obvious, DO list
- Domain-specific names (detectors/, plugins/, adapters/) → non-obvious, DO list

If ALL directories are obvious, omit the directory listing entirely — the AI handles these fine on its own.

## Expected Impact

If these fixes work:
- The 6 negative repos should move to neutral (0%) or slightly positive
- The 12 positive repos should remain positive (no regression — we're not removing helpful info)
- The 2 neutral repos should remain neutral

**Target: 16-18/20 positive or neutral, 0-2 negative (down from 6).**

## Validation Plan

1. Implement the two fixes in deterministic-formatter.ts
2. Re-run the benchmark on the 4 worst repos (nitro, cal.com, excalidraw, sanity)
3. Also re-run on 2 best repos (zod, medusa) to verify no regression
4. If the negative repos improve without the positive repos regressing, the fix is validated
