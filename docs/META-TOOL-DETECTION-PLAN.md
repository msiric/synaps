# Plan: Meta-Tool Detection V4 — Final Implementation Plan

## Context

Tools like Knip import 15+ frameworks for plugin support. The engine reports "Uses Express," "Uses React hooks" — misleading because Knip ANALYZES these frameworks, it doesn't USE them.

This plan has been through 3 rounds of adversarial review (12 reviews total from GPT-5, Grok 4, Opus 4.6, Gemini 3 Pro). V3 was approved by 2 of 4 reviewers (Gemini: READY, Opus: READY with 3 HIGHs resolvable during impl). V4 applies the 5 consensus fixes from the v3 round.

### V3→V4 Fixes Applied

| # | Issue (consensus across reviews) | V4 Fix |
|---|----------------------------------|--------|
| 1 | Convention filtering uses brittle string matching | Add `source` field to Convention; detectors set it; formatter checks detector name |
| 2 | `optionalDependencies` wrongly merged with `peerDependencies` | Use `peerDependencies` + `peerDependenciesMeta` only; NOT `optionalDependencies` |
| 3 | Signal 2 "ALL member packages in devDeps" too strict | Changed to "at least one imported package from the family in devDeps, none in deps" |
| 4 | No Knip verification in test plan | Added explicit Knip + normal app verification |
| 5 | Type-only import gap (audit result: 3 detectors + pipeline affected) | Filter `isTypeOnly` in pipeline's `allImportedModules` + 3 detector fallback paths |

---

## Design: 3-Signal Cascade

```
Signal 1: peerDependencies     (highest confidence — explicit author declaration)
    ↓ inconclusive
Signal 2: Dependency placement  (high confidence — devDep-only framework families in source)
    ↓ inconclusive
Signal 3: Family count fallback  (lowest confidence — static list, deduped, filtered)
    ↓ inconclusive
Result: NOT a meta-tool

After ANY signal triggers → completeness pass collects ALL supported families
```

### Framework Families (shared across all 3 signals)

All signals count **distinct framework families**, never raw package names:

```
react     → [react, react-dom]
next      → [next]
vue       → [vue]
angular   → [@angular/core, @angular/common, @angular/router, @angular/platform-browser]
svelte    → [svelte]
solid     → [solid-js]
preact    → [preact]
nuxt      → [nuxt]
remix     → [@remix-run/react, @remix-run/node]
astro     → [astro]
sveltekit → [@sveltejs/kit]
express   → [express]
fastify   → [fastify]
hono      → [hono]
koa       → [koa]
nestjs    → [@nestjs/core]
hapi      → [@hapi/hapi]
webpack   → [webpack]
vite      → [vite]
esbuild   → [esbuild]
rollup    → [rollup]
rspack    → [@rspack/core]
parcel    → [parcel]
prisma    → [prisma, @prisma/client]
drizzle   → [drizzle-orm]
typeorm   → [typeorm]
sequelize → [sequelize]
knex      → [knex]
mongoose  → [mongoose]
redux     → [redux, @reduxjs/toolkit]
zustand   → [zustand]
mobx      → [mobx]
jotai     → [jotai]
recoil    → [recoil]
```

34 families. Reverse map `PACKAGE_TO_FAMILY` for O(1) lookup.

### Signal 1: peerDependencies (family-deduped)

Map `peerDependencies` (including those marked optional via `peerDependenciesMeta`) to framework families. Count distinct families that are also imported (value, T1/T2) in source. If **≥3 distinct families** → meta-tool.

**V4 change:** Does NOT include `optionalDependencies`. Only `peerDependencies` + entries in `peerDependenciesMeta` with `optional: true`.

### Signal 2: Dependency placement (family-restricted, relaxed membership)

Find framework families where **at least one imported package** from the family is in `devDependencies` but **none of the imported packages** from the family are in `dependencies`. If **≥4 devDep-only families** → meta-tool.

**V4 change:** Relaxed from "ALL member packages in devDeps" to "at least one imported member in devDeps, none in deps." This prevents undercounting families like `react` where a tool might only import `react` (not `react-dom`).

### Signal 3: Family count fallback

Count distinct framework families from value imports in T1/T2 files. If **>5 families** → meta-tool. Safety net for packages with messy dep structures.

### Completeness Pass

After any signal triggers, collect ALL framework families from source imports (T1/T2, value-only) into `supportedFamilies`.

### Dominant Family Detection

Find the framework family with the highest import count. Classify as "core" only if:
1. At least one of its packages is in production `dependencies`
2. Its import count is ≥3x the second-highest family

### Format-Time Reclassification

Analysis runs ALL detectors. No data lost. Formatting decides presentation based on `isMetaTool` and `metaToolInfo`.

**Convention matching uses the `source` field** (V4 change). Each ecosystem detector sets `source` to its detector name. The formatter maintains a set of ecosystem detector names:

```typescript
const ECOSYSTEM_DETECTOR_NAMES = new Set([
  "dataFetching", "database", "webFramework", "buildTool"
]);
```

When `isMetaTool`, conventions with `source` in this set are reclassified. Conventions with `source` NOT in this set (file-naming, hooks, testing, testFrameworkEcosystem) render normally.

To match a convention to a specific family for core-family exemption, each ecosystem detector also embeds the family name in a consistent way. The lookup uses the detector's convention `name` field which follows predictable patterns set by the detectors themselves (e.g., "Express web framework" always contains "express").

---

## Implementation

### File Changes

| # | File | Change | Lines |
|---|------|--------|------:|
| 1 | new: `src/meta-tool-detector.ts` | Family map, 3-signal cascade, completeness, dominant | ~130 |
| 2 | `src/types.ts` | `isMetaTool`, `metaToolInfo` on PackageAnalysis; `source` on Convention; config fields | ~20 |
| 3 | `src/pipeline.ts` | Insert detection; fix type-only in `allImportedModules` | ~20 |
| 4 | `src/detectors/*.ts` | Each ecosystem detector sets `source` field; fix type-only in 3 fallback paths | ~25 |
| 5 | `src/deterministic-formatter.ts` | Reclassify conventions, split deps, Supported Frameworks section | ~50 |
| 6 | `src/config.ts` | `metaToolThreshold`, `noMetaTool` defaults and parsing | ~10 |
| 7 | new: `test/meta-tool-detection.test.ts` | 18 test cases | ~220 |
| | **Total** | | **~475** |

### Step 1: `src/meta-tool-detector.ts` (new, ~130 lines)

Exports: `PACKAGE_TO_FAMILY`, `detectMetaTool(input, warnings?)`

```typescript
interface MetaToolDetectionInput {
  parsedFiles: ParsedFile[];
  tiers: Map<string, TierInfo>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDeps: Record<string, string>;   // peerDependencies only (not optionalDependencies)
  threshold?: number;                  // Signal 3, default 5
}

interface MetaToolResult {
  isMetaTool: boolean;
  signal: "peer-dependencies" | "dep-placement" | "family-count" | "none";
  supportedFamilies: string[];
  coreFamilies: string[];
}
```

Internal functions:
- `collectSourceFamilyCounts(parsedFiles, tiers)` → `Map<string, number>` — T1/T2, value-only, mapped to families
- `checkSignal1(peerDeps, sourceFamilyCounts)` → ≥3 peer families in source → trigger
- `checkSignal2(deps, devDeps, sourceFamilyCounts)` → ≥4 devDep-only families (relaxed: at least one imported member in devDeps, none in deps) → trigger
- `checkSignal3(sourceFamilyCounts, threshold)` → >threshold families → trigger
- `completenessPass(sourceFamilyCounts)` → all family names
- `findCoreFamilies(sourceFamilyCounts, deps)` → gated: in production deps + ≥3x margin

### Step 2: `src/types.ts` (~20 lines)

Add to `Convention`:
```typescript
source?: string;  // detector name that produced this convention (e.g., "dataFetching")
```

Add to `PackageAnalysis`:
```typescript
isMetaTool?: boolean;
metaToolInfo?: {
  signal: "peer-dependencies" | "dep-placement" | "family-count";
  supportedFamilies: string[];
  coreFamilies: string[];
};
```

Add to `ResolvedConfig`:
```typescript
metaToolThreshold: number;  // default 5
noMetaTool: boolean;        // default false
```

### Step 3: `src/pipeline.ts` (~20 lines)

**Fix type-only gap** in `allImportedModules` collection (line ~198):
```typescript
// Add: skip type-only imports
if (imp.isTypeOnly) continue;
```

**Insert meta-tool detection** between dependency analysis and convention extraction:
```typescript
let pkgJsonRaw: Record<string, any> | null = null;
try { pkgJsonRaw = JSON.parse(readFileSync(join(pkgPath, "package.json"), "utf-8")); } catch {}

let metaToolResult = { isMetaTool: false, signal: "none" as const, supportedFamilies: [] as string[], coreFamilies: [] as string[] };
if (!config.noMetaTool && pkgJsonRaw) {
  metaToolResult = detectMetaTool({
    parsedFiles: parsed, tiers,
    dependencies: pkgJsonRaw.dependencies ?? {},
    devDependencies: pkgJsonRaw.devDependencies ?? {},
    peerDeps: pkgJsonRaw.peerDependencies ?? {},
    threshold: config.metaToolThreshold,
  }, warnings);
}
```

Store on PackageAnalysis, annotate role summary if triggered.

### Step 4: `src/detectors/*.ts` (~25 lines total)

**Each ecosystem detector** adds `source` to its conventions:

| Detector | `source` value | Additional fix |
|----------|---------------|----------------|
| `data-fetching.ts` | `"dataFetching"` | None (already filters isTypeOnly) |
| `database.ts` | `"database"` | Add `!imp.isTypeOnly` to fallback path (line ~43) |
| `web-framework.ts` | `"webFramework"` | Add `!imp.isTypeOnly` to fallback path (line ~40) |
| `build-tool.ts` | `"buildTool"` | Add `!imp.isTypeOnly` to fallback path (line ~56) |

Each detector already constructs Convention objects with `category: "ecosystem"`. Adding `source: "detectorName"` is a one-field addition to each `conventions.push({...})` call.

### Step 5: `src/deterministic-formatter.ts` (~50 lines)

**`formatConventions()`:** When `pkg.isMetaTool`:
```typescript
const ECOSYSTEM_DETECTORS = new Set(["dataFetching", "database", "webFramework", "buildTool"]);

for (const conv of pkg.conventions) {
  if (pkg.isMetaTool && conv.source && ECOSYSTEM_DETECTORS.has(conv.source)) {
    // Check if this convention belongs to a core family
    const isCore = pkg.metaToolInfo?.coreFamilies.some(family =>
      conv.name.toLowerCase().includes(family)
    );
    if (isCore) {
      doRules.push(`- **DO**: ${desc}${examples}`);
    } else {
      continue; // Listed in Supported Frameworks section instead
    }
  } else {
    doRules.push(`- **DO**: ${desc}${examples}`);
  }
}
```

**New `formatSupportedFrameworks()`:** Renders when `pkg.isMetaTool`:
```markdown
## Supported Frameworks
This package has integrations for N framework ecosystems:
react, vue, angular, express, webpack, vite, prisma, drizzle, ...
_These indicate what this tool supports, not conventions to follow._
```

**`formatDependencies()`:** Split core deps vs supported framework packages using `PACKAGE_TO_FAMILY`.

### Step 6: `src/config.ts` (~10 lines)

Add defaults: `metaToolThreshold: 5`, `noMetaTool: false`.
Parse `--no-meta-tool` boolean flag, config file field `metaToolThreshold`.

### Step 7: Tests (~220 lines)

| # | Test Case | Signal | Expected | Validates |
|---|-----------|--------|----------|-----------|
| 1 | 3 peerDep families (react, vue, angular) imported in src | S1 | IS meta-tool | Signal 1 basics |
| 2 | 5 peerDep packages, 1 family (react+react-dom+emotion+styled+framer) | S1 | NOT meta-tool | Family dedup |
| 3 | 2 peerDep families (below threshold) | S1 | Falls through | Signal 1 threshold |
| 4 | 4 devDep-only framework families imported in T1/T2 | S2 | IS meta-tool | Signal 2 basics |
| 5 | 5 devDep-only non-framework packages | S2 | NOT meta-tool | Framework restriction |
| 6 | 3 devDep-only families (below threshold) | S2 | Falls through | Signal 2 threshold |
| 7 | Family with only `react` imported (not react-dom), react in devDeps | S2 | Counts as 1 family | Relaxed membership (V4 fix) |
| 8 | 6+ framework families in T1/T2 value imports | S3 | IS meta-tool | Signal 3 basics |
| 9 | Standard Next.js+Prisma+Redux+Express (5 families) | S3 | NOT meta-tool | V1 regression |
| 10 | Type-only imports don't count | All | Filtered | Type-only filtering |
| 11 | Test file (T3) imports don't count | All | Filtered | Tier filtering |
| 12 | react+react-dom = 1 family | S3 | 1 family | Family dedup |
| 13 | Signal 1 triggers → completeness returns ALL families | S1 | Full list | Completeness pass |
| 14 | Dominant in production deps + 3x margin → core | — | coreFamilies=["react"] | Dominant detection |
| 15 | Dominant in devDeps only → no core | — | coreFamilies=[] | Production gate |
| 16 | Dominant without 3x margin → no core | — | coreFamilies=[] | Margin gate |
| 17 | --no-meta-tool disables detection | — | NOT meta-tool | Escape hatch |
| 18 | Formatter: core conventions preserved, supported section rendered | Format | Correct output | End-to-end |

---

## Type-Only Import Fix (Bonus Code Quality)

The v3 review audit revealed ecosystem detectors fire on `import type` in 3 of 4 fallback paths, and `pipeline.ts` includes type-only imports in `allImportedModules`. This is fixed as part of this implementation:

| File | Line | Fix |
|------|------|-----|
| `pipeline.ts` | ~199 | Add `if (imp.isTypeOnly) continue;` to `allImportedModules` loop |
| `database.ts` | ~43 | Add `&& !i.isTypeOnly` to fallback import filter |
| `web-framework.ts` | ~40 | Add `&& !i.isTypeOnly` to fallback import filter |
| `build-tool.ts` | ~56 | Add `&& !i.isTypeOnly` to fallback import filter |

---

## Verification

```bash
# All existing tests pass
npm test

# Type check passes
npm run typecheck

# Own repo: NOT meta-tool (3 deps: typescript, mri, picomatch)
npx tsx src/bin/autodocs-engine.ts analyze . --dry-run 2>/dev/null | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
  console.log('isMetaTool:', d.packages[0].isMetaTool ?? false)"
# Expected: false

# If Knip repo is available locally:
# npx tsx src/bin/autodocs-engine.ts analyze /path/to/knip/packages/knip \
#   --root /path/to/knip --dry-run 2>/dev/null | \
#   node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
#   console.assert(d.packages[0].isMetaTool === true, 'FAIL: Knip not detected'); \
#   console.log('Signal:', d.packages[0].metaToolInfo?.signal)"
```

## Files to Modify

- new: `src/meta-tool-detector.ts` — all detection logic + family map
- `src/types.ts` — Convention.source, PackageAnalysis.isMetaTool/metaToolInfo, ResolvedConfig fields
- `src/pipeline.ts` — meta-tool detection insertion + type-only fix in allImportedModules
- `src/detectors/data-fetching.ts` — add source field
- `src/detectors/database.ts` — add source field + type-only fix in fallback
- `src/detectors/web-framework.ts` — add source field + type-only fix in fallback
- `src/detectors/build-tool.ts` — add source field + type-only fix in fallback
- `src/deterministic-formatter.ts` — formatConventions reclassification, formatSupportedFrameworks, formatDependencies split
- `src/config.ts` — defaults, CLI flag
- new: `test/meta-tool-detection.test.ts` — 18 test cases
