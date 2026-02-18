# Post-Bugfix Benchmark Results

> **Date:** 2026-02-18
> **Engine version:** Post-bugfix (16 algorithm bugs fixed in commit `8e4628e`)
> **Methodology:** 10 repos, three-way comparison: Engine v2 (new), Human (existing), Raw LLM (existing)
> **Scoring:** 7 dimensions (Commands, Budget, Signal/Noise, Workflow, Architecture, Domain, Accuracy), 1-10 scale

---

## Summary Table

| # | Repo | Engine v1 | Engine v2 | Human | Raw LLM | Delta (Engine) |
|---|------|-----------|-----------|-------|---------|----------------|
| 1 | sanity | 5.9 | 4.7 | 7.4 | 7.4 | -1.2 |
| 2 | medusa | 5.7 | 8.0 | 7.6 | 6.4 | +2.3 |
| 3 | vercel/ai | 6.7 | 7.6 | 7.6 | 6.4 | +0.9 |
| 4 | MCP SDK | 6.1 | 3.6 | 8.1 | 7.9 | -2.5 |
| 5 | knip | 5.1 | 4.4 | 8.4 | 7.1 | -0.7 |
| 6 | nitro | 5.4 | 6.3 | 7.9 | 7.7 | +0.9 |
| 7 | openstatus | 6.7 | 6.4 | 7.4 | 7.1 | -0.3 |
| 8 | documenso | 5.7 | 4.9 | 6.1 | 6.9 | -0.8 |
| 9 | effect | 5.4 | 5.7 | 7.3 | 5.9 | +0.3 |
| 10 | excalidraw | 6.6 | 6.9 | 5.7 | 6.9 | +0.3 |
| **Avg** | | **5.9** | **5.9** | **7.4** | **7.0** | **-0.1** |

---

## Bug Fix Verification

### Fixed Bugs

| Bug | Status | Evidence |
|-----|--------|----------|
| **Bug 2.1: Nitro title "# src"** | **FIXED** | Title is now `# nitro` |
| **Bug 1.2: Effect Bun hallucination** | **FIXED** | No mention of Bun in effect output |
| **Bug 3.1: Medusa React leakage** | **FIXED** | No React mentioned in medusa core-flows output |

### Unfixed / Partially Fixed Bugs

| Bug | Status | Evidence |
|-----|--------|----------|
| **Bug 1.1: Knip React hallucination** | **NOT FIXED** | Output still contains `react: JSX component analysis (17 imports)` — Knip is a CLI tool that does NOT use React |
| **Bug 5.1: Output density <80 lines** | **NOT FIXED** | 9 of 10 repos still under 80 lines (only excalidraw at 108 lines meets target) |

### New Issues Introduced

| Issue | Repos Affected | Description |
|-------|---------------|-------------|
| **Bun hallucination** | MCP SDK, documenso | MCP SDK output claims "Bun 1.3.8" as runtime (should be Node.js/pnpm). Documenso also has Bun in tech stack. This is a NEW bug not present in the specific repos before. |
| **Scope limitation in monorepos** | MCP SDK | Output scoped itself only to `@modelcontextprotocol/core` rather than the full SDK monorepo, missing client/server/middleware packages entirely |
| **useStorage() attribution** | nitro | Claims `useStorage()` is "from srvx" — actually from unstorage |
| **Rolldown omission** | nitro | Tech stack says "Rollup & Vite" but omits Rolldown entirely |
| **jest.mock() in Vitest repo** | sanity | Recommends `jest.mock()` pattern when the repo uses Vitest |

---

## Output Density

| Repo | Engine v1 (lines) | Engine v2 (lines) | Target (≥80) | Status |
|------|-------------------|-------------------|--------------|--------|
| sanity | ~60 | 71 | 80 | UNDER |
| medusa | ~55 | 71 | 80 | UNDER |
| vercel/ai | ~65 | 77 | 80 | UNDER |
| MCP SDK | ~50 | 79 | 80 | UNDER (by 1) |
| knip | ~50 | 66 | 80 | UNDER |
| nitro | ~55 | 64 | 80 | UNDER |
| openstatus | ~60 | 75 | 80 | UNDER |
| documenso | ~55 | 56 | 80 | UNDER |
| effect | ~50 | 67 | 80 | UNDER |
| excalidraw | ~72 | 108 | 80 | **PASS** |

**Result:** Line counts improved modestly (avg ~57 → ~73) but still fall short of the 80-line minimum in 9/10 cases. The budget enforcement fix did not achieve its target.

---

## Detailed Dimension Scores

### Engine v2

| Repo | Cmd | Budget | Signal | Workflow | Arch | Domain | Accuracy | Avg |
|------|-----|--------|--------|----------|------|--------|----------|-----|
| sanity | 5 | 3 | 6 | 5 | 5 | 4 | 5 | 4.7 |
| medusa | 7 | 8 | 9 | 9 | 8 | 7 | 8 | 8.0 |
| vercel/ai | 8 | 7 | 9 | 7 | 8 | 6 | 8 | 7.6 |
| MCP SDK | 3 | 3 | 6 | 5 | 3 | 3 | 2 | 3.6 |
| knip | 6 | 3 | 6 | 4 | 5 | 4 | 3 | 4.4 |
| nitro | 7 | 5 | 8 | 7 | 6 | 5 | 6 | 6.3 |
| openstatus | 7 | 7 | 8 | 7 | 6 | 4 | 6 | 6.4 |
| documenso | 4 | 4 | 8 | 5 | 5 | 3 | 5 | 4.9 |
| effect | 5 | 5 | 6 | 5 | 7 | 6 | 6 | 5.7 |
| excalidraw | 7 | 9 | 8 | 7 | 6 | 5 | 6 | 6.9 |
| **Avg** | **5.9** | **5.4** | **7.4** | **6.1** | **5.9** | **4.7** | **5.5** | **5.9** |

### Human

| Repo | Cmd | Budget | Signal | Workflow | Arch | Domain | Accuracy | Avg |
|------|-----|--------|--------|----------|------|--------|----------|-----|
| sanity | 9 | 5 | 7 | 9 | 7 | 6 | 9 | 7.4 |
| medusa | 9 | 4 | 6 | 7 | 9 | 9 | 9 | 7.6 |
| vercel/ai | 9 | 5 | 6 | 8 | 7 | 9 | 9 | 7.6 |
| MCP SDK | 9 | 6 | 8 | 7 | 10 | 8 | 9 | 8.1 |
| knip | 8 | 9 | 9 | 8 | 8 | 7 | 10 | 8.4 |
| nitro | 8 | 8 | 7 | 9 | 7 | 7 | 9 | 7.9 |
| openstatus | 7 | 9 | 7 | 6 | 8 | 7 | 8 | 7.4 |
| documenso | 8 | 5 | 9 | 6 | 2 | 3 | 10 | 6.1 |
| effect | 9 | 8 | 9 | 9 | 2 | 4 | 10 | 7.3 |
| excalidraw | 7 | 3 | 8 | 5 | 5 | 3 | 9 | 5.7 |
| **Avg** | **8.3** | **6.2** | **7.6** | **7.4** | **6.5** | **6.3** | **9.2** | **7.4** |

### Raw LLM

| Repo | Cmd | Budget | Signal | Workflow | Arch | Domain | Accuracy | Avg |
|------|-----|--------|--------|----------|------|--------|----------|-----|
| sanity | 7 | 7 | 7 | 7 | 8 | 9 | 7 | 7.4 |
| medusa | 7 | 4 | 6 | 7 | 7 | 7 | 7 | 6.4 |
| vercel/ai | 8 | 4 | 5 | 7 | 8 | 7 | 6 | 6.4 |
| MCP SDK | 8 | 7 | 8 | 9 | 8 | 9 | 6 | 7.9 |
| knip | 7 | 7 | 7 | 7 | 7 | 8 | 7 | 7.1 |
| nitro | 9 | 4 | 6 | 8 | 10 | 9 | 8 | 7.7 |
| openstatus | 8 | 4 | 6 | 7 | 9 | 9 | 7 | 7.1 |
| documenso | 9 | 3 | 5 | 7 | 9 | 9 | 6 | 6.9 |
| effect | 8 | 3 | 4 | 3 | 8 | 8 | 7 | 5.9 |
| excalidraw | 8 | 4 | 5 | 8 | 9 | 8 | 6 | 6.9 |
| **Avg** | **7.9** | **4.7** | **5.9** | **7.0** | **8.3** | **8.3** | **6.7** | **7.0** |

---

## Key Findings

### 1. Did the bug fixes improve the average score?

**No.** The overall average remained flat at 5.9 (vs 5.9 in v1). While specific bug fixes helped some repos (medusa +2.3, vercel/ai +0.9, nitro +0.9), regressions in others offset the gains (MCP SDK -2.5, sanity -1.2).

### 2. By how much did the engine-to-human gap close?

**It did not close.** The gap is now **1.5 points** (5.9 vs 7.4), slightly worse than the v1 gap of 1.3 (5.9 vs 7.2). The human baseline also scored higher in this evaluation (7.4 vs the original 7.2), possibly due to more rigorous scoring methodology.

### 3. Does the engine now beat the raw LLM on any repos?

**Yes, on 2 repos:**
- **Medusa** (8.0 vs 6.4) — The engine excels here because it focuses tightly on `core-flows` with actionable workflow rules, while the raw LLM produced a bloated 309-line tutorial.
- **Vercel/AI** (7.6 vs 6.4) — Dense, high-signal output with correct architecture.

**But the engine lost to the raw LLM on 7 repos** and tied on 1 (excalidraw: 6.9 vs 6.9).

### 4. What's the biggest remaining gap?

**Accuracy (5.5 engine vs 9.2 human)** is the widest dimension gap at 3.7 points. The engine continues to:
- Hallucinate runtime/framework info (Bun in MCP SDK/documenso, React in knip, jest.mock in sanity)
- Generate incorrect version numbers (TypeScript "5.9" frequently)
- Misattribute dependencies (useStorage from srvx instead of unstorage)
- Use wrong command prefixes (turbo run vs pnpm/yarn)

**Domain (4.7 engine vs 6.3 human vs 8.3 raw LLM)** is also weak — the engine lacks terminology, versions, and project-specific concepts that both humans and raw LLMs capture better.

### 5. Is the engine ready for v1.0 release?

**No.** The engine is not competitive with a raw LLM prompt (5.9 vs 7.0 average). Key blockers:

1. **Accuracy crisis** — Hallucinations in 7/10 repos make the engine less trustworthy than a raw LLM. The React/Bun leakage bugs are the highest-priority fix.
2. **Budget enforcement failure** — 9/10 outputs are under 80 lines despite the fix. The LLM prompt needs stronger minimum enforcement.
3. **Domain knowledge gap** — The engine's static analysis cannot capture domain terminology, version context, or project-specific concepts. This needs either LLM augmentation or richer analysis.
4. **Monorepo scope issues** — MCP SDK and sanity show that analyzing a single package in a monorepo can produce misleading results when cross-package context bleeds in incorrectly.

---

## Repo-by-Repo Highlights

### Wins (Engine v2 > v1)
- **Medusa (+2.3):** Best engine score overall (8.0). Tight focus on core-flows, excellent workflow rules, no React hallucination. Beats both human and raw LLM.
- **Vercel/AI (+0.9):** Clean, dense output. Good architecture and workflow. Ties with human.
- **Nitro (+0.9):** Title bug fixed ("# nitro" not "# src"). Improved architecture detail.
- **Excalidraw (+0.3):** Only repo to hit 80+ lines (108). Good budget score.

### Losses (Engine v2 < v1)
- **MCP SDK (-2.5):** Catastrophic regression. Scoped to core-only, hallucinated "Bun 1.3.8", missed entire client/server architecture. Analysis path issue compounded by engine bugs.
- **Sanity (-1.2):** Hallucinated `turbo run transit`, recommended `jest.mock()` in a Vitest repo, fabricated directory paths like `src/ui-components/`.
- **Documenso (-0.8):** Still hallucinating "Bun" in tech stack. Missing dev/test/prisma/translation commands entirely.
- **Knip (-0.7):** React hallucination persists. Too sparse at 66 lines. Missing critical debugging commands and fixture conventions.

---

## Recommendations for Next Iteration

1. **Fix Bun/React leakage (P0):** The monorepo scope analysis is incorrectly attributing sibling-package dependencies. Knip's React plugins and MCP SDK's lack of Bun should not appear in the output.

2. **Enforce minimum line count (P0):** The 80-line minimum is not being enforced. Consider a post-generation validation that rejects and retries outputs under the threshold.

3. **Add domain terminology section (P1):** The raw LLM consistently outperforms on domain knowledge (8.3 vs 4.7). Add a dedicated "Domain Terminology" section to the output template.

4. **Validate commands against actual scripts (P1):** Cross-reference generated commands with `package.json` scripts to catch hallucinated commands like `turbo run transit` or `pnpm start`.

5. **Improve monorepo context handling (P1):** When analyzing a package in a monorepo, include root-level commands and workspace structure context without leaking sibling-package dependencies.

6. **Version number validation (P2):** TypeScript "5.9" appears in many outputs and is often wrong. Pin version claims to what's actually in `package.json`.
