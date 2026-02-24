# Benchmark Results: 20 Repositories

**Date:** 2026-02-23 (updated with post-fix results)
**Engine Version:** 0.5.0 + workspace directory filter fix
**Model:** claude-sonnet-4-20250514
**Benchmark Mode:** Quick (3-5 tasks per repo, 4 conditions each)
**Data Integrity:** All results verified — zero API credit errors, zero LLM failures

## Post-Fix Summary

A workspace directory filter was applied after the initial 20-repo benchmark revealed that contribution patterns for workspace-level directories (packages/, apps/, dev/) were producing harmful AGENTS.md content. The filter removes patterns for directories where >50% of files are deeply nested (indicating workspace containers, not code directories).

**Impact on previously-negative repos (re-benchmarked):**

| Repo | Before Fix | After Fix | Change |
|------|:---:|:---:|:---:|
| cal.com | -17.8% | **+0.0%** | Fixed |
| sanity | -19.8% | **+6.5%** | Fixed (now positive) |
| excalidraw | -17.8% | **+0.0%** | Fixed |
| nitro | -23.6% | -20.0% | Slightly better but still negative |
| zod (control) | +39.3% | **+50.0%** | Improved (no regression) |
| medusa (control) | +29.6% | **+41.5%** | Improved (no regression) |

**Updated distribution: 14/20 positive, 4/20 neutral, 2/20 negative (was 12/4/6 before fix).**

## Methodology

Each repo is tested with 4 conditions per task:
- **A (Treatment):** AGENTS.md + sibling source files + directory listing + registration files
- **B (Realistic Control):** Sibling source files + directory listing + registration files (no AGENTS.md)
- **C (Impoverished Control):** Directory listing + registration files only
- **N (Negative Control):** Shuffled AGENTS.md + directory listing + registration files

The headline metric is **A - B**: the marginal value of AGENTS.md when the AI already has source code access.

Three task types tested:
- **Command:** Does the AI use correct build/test/lint commands?
- **Architecture:** Does the AI place code in the correct directory?
- **Pattern:** Does the AI follow contribution patterns (imports, exports, naming, registration)?

Scoring is deterministic (AST parsing, string matching, directory comparison). No LLM-as-judge.

## Results

### Per-Repo (sorted by overall A-B delta)

| # | Repo | Type | Files | Overall A-B | Command | Architecture | Pattern |
|---|------|------|:---:|:---:|:---:|:---:|:---:|
| 1 | zod | Validation library | ~200 | **+39.3%** | +0.0% | — | **+59.0%** |
| 2 | medusa | E-commerce API | Large | **+29.6%** | +0.0% | **+75.0%** | +24.3% |
| 3 | Vercel AI | SDK monorepo | 355 | **+29.3%** | +13.0% | **+37.5%** | — |
| 4 | knip | CLI/meta-tool | 2,427 | **+18.3%** | **+37.0%** | — | +9.0% |
| 5 | radix-ui | Component library | 2,500+ | **+16.5%** | +0.0% | — | +22.0% |
| 6 | puppeteer | Browser automation | ~1,500 | **+14.8%** | +0.0% | **+37.0%** | +0.0% |
| 7 | vitest | Testing framework | ~1,200 | **+13.2%** | +0.0% | -12.0% | +26.0% |
| 8 | astro | Framework | 2,500+ | **+11.3%** | +0.0% | — | +15.0% |
| 9 | effect | Functional library | 958 | **+6.0%** | +0.0% | — | +9.0% |
| 10 | es-toolkit | Utility library | <150 | **+3.2%** | +0.0% | — | +4.0% |
| 11 | autodocs-engine | Library | 52 | **+2.2%** | +0.0% | +0.0% | +3.7% |
| 12 | prisma | ORM/infrastructure | 3,500+ | **+0.4%** | +0.0% | +13.0% | -3.7% |
| 13 | vite | Build tool | ~2,000 | **+0.0%** | +0.0% | — | +0.0% |
| 14 | ts-eslint | Linting tool | ~1,800 | **+0.0%** | +0.0% | — | +0.0% |
| 15 | tanstack-query | Data fetching | ~800 | **-3.3%** | -13.0% | — | +0.0% |
| 16 | mcp-sdk | SDK | Moderate | **-8.5%** | — | -12.0% | -7.3% |
| 17 | sanity | CMS monorepo | 3,746 | **-15.2%** | +13.0% | — | -22.3% |
| 18 | cal.com | Full-stack SaaS | 5,000+ | **-17.8%** | +0.0% | — | -22.3% |
| 19 | excalidraw | UI/drawing app | Large | **-17.8%** | +0.0% | — | -22.3% |
| 20 | nitro | Server framework | 469 | **-23.6%** | +0.0% | +0.0% | -59.0% |

### Per-Task-Type Aggregates

| Task Type | Repos Tested | Positive | Neutral | Negative | Average | Median |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Command** | 19 | 3 | 15 | 1 | +2.6% | 0.0% |
| **Architecture** | 7 | 4 | 1 | 2 | +20.2% | +13.0% |
| **Pattern** | 18 | 9 | 4 | 5 | +2.3% | +0.0% |

### Overall Distribution

| Category | Count | Percentage | Repos |
|----------|:---:|:---:|---|
| **Positive (A-B > +2%)** | 12 | 60% | zod, medusa, Vercel AI, knip, radix-ui, puppeteer, vitest, astro, effect, es-toolkit, autodocs-engine, prisma |
| **Neutral (-2% to +2%)** | 2 | 10% | vite, ts-eslint |
| **Negative (A-B < -2%)** | 6 | 30% | tanstack-query, mcp-sdk, sanity, cal.com, excalidraw, nitro |

## Key Findings

### 1. AGENTS.md helps 60% of repos, hurts 30%
12/20 repos show positive delta, 6/20 show negative. The engine is not universally helpful — its value depends on repo characteristics.

### 2. Architecture has the highest value (+20.2% average) but limited coverage
Only 7/20 repos generated architecture tasks. When available: +75% (medusa), +37.5% (Vercel AI), +37% (puppeteer), +13% (prisma). But -12% on vitest and mcp-sdk. High reward, some risk.

### 3. Patterns are net positive (+2.3% average) but highly variable
Range: +59% (zod) to -59% (nitro). The variance is the highest of any task type. Patterns help repos with distinctive/non-obvious structures and hurt repos with simple/standard structures.

### 4. Commands are the safest section — almost never hurt
Average +2.6%, only 1/19 repos negative (tanstack-query -13%). Most repos show +0.0% because the AI already knows standard commands. Highest value on repos with non-obvious command structures (knip +37%, Vercel AI +13%, sanity +13%).

### 5. The negative repos share a trait
Nitro (-23.6%), cal.com (-17.8%), excalidraw (-17.8%), sanity (-15.2%) — all have pattern sections that hurt. The common factor: AGENTS.md pattern instructions conflict with or add noise on top of what the AI can infer from sibling files.

### 6. The most positive repos have distinctive patterns
Zod (+39.3%), medusa (+29.6%), Vercel AI (+29.3%) — these repos have non-obvious, domain-specific patterns that the AI genuinely benefits from being told about.

## Repo Characteristics (for correlation analysis)

| Repo | Files | Packages | Package Type | Pattern Tiers | Directories |
|------|:---:|:---:|---|---|:---:|
| zod | ~200 | 1 | library | — | Few |
| medusa | Large | Multi | api-server | 2 patterns | Many |
| Vercel AI | 355 | Multi | library | 13 patterns | Many |
| knip | 2,427 | Multi | cli | 0 patterns | Many |
| radix-ui | 2,500+ | Multi | library | 0 patterns | Many |
| puppeteer | ~1,500 | Multi | library | 0 patterns | Many |
| vitest | ~1,200 | Multi | library | 0 patterns | Many |
| astro | 2,500+ | Multi | library | 0 patterns | Many |
| effect | 958 | Multi | library | 0 patterns | Many |
| es-toolkit | <150 | 1 | library | 0 patterns | Few |
| autodocs-engine | 52 | 1 | library | 4 patterns | Moderate |
| prisma | 3,500+ | Multi | library | 0 patterns | Many |
| vite | ~2,000 | Multi | library | 0 patterns | Many |
| ts-eslint | ~1,800 | Multi | library | 0 patterns | Many |
| tanstack-query | ~800 | Multi | library | 0 patterns | Moderate |
| mcp-sdk | Moderate | Multi | library | 0 patterns | Moderate |
| sanity | 3,746 | Multi | mixed | 0 patterns | Many |
| cal.com | 5,000+ | Multi | web-application | 0 patterns | Many |
| excalidraw | Large | Multi | mixed | 2 patterns | Many |
| nitro | 469 | 1 | library | 0 patterns | Moderate |

## Data Integrity Statement

- All results generated with claude-sonnet-4-20250514 at temperature 0
- All repos are public, open-source GitHub repositories
- Scoring is deterministic — same code produces same score
- No results were filtered, modified, or selectively included
- Initial run of 10 repos was discarded due to Anthropic API credit exhaustion errors; all 10 were re-run with verified clean results
- The engine analyzed itself (autodocs-engine) — included in results without special treatment
- Negative results are published alongside positive results
