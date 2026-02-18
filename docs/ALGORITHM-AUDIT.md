# Algorithm Audit — Systematic Bug Investigation

**Date:** 2026-02-18
**Methodology:** Traced every data flow path in the engine, looking for places where monorepo root data leaks into package-level analysis, where wrong defaults are used, or where edge cases produce incorrect output.
**Scope:** All 44 source modules, focused on the 10 modules that handle package vs monorepo scope.
**Benchmark evidence:** 10-repo final benchmark at docs/FINAL-BENCHMARK.md

---

## Category 1: Monorepo Scope Leakage (CRITICAL)

The engine reads data from both the analyzed package AND the monorepo root. In several places, root-level data incorrectly contaminates the package-level analysis.

### Bug 1.1: Root Dependencies Merged Into Package Dependencies
**File:** `src/dependency-analyzer.ts` lines 41-57
**What happens:** When `rootDir` is provided, ALL root package.json dependencies are merged into the package's dependency list (with lower priority — root fills in what's not in package-level).
**Why it's wrong:** A monorepo root often has deps for documentation sites, CI tools, or other packages that have nothing to do with the analyzed package. Knip's root has React (for the docs website). Medusa's root has React (for the admin UI). Effect's root has Bun (as the package manager, not a runtime dependency).
**Benchmark evidence:**
- Knip (CLI tool) shows React in tech stack — because root package.json has React for the docs site
- Medusa (backend API) shows React 18.3.1 — because root has React for the admin UI
- Effect shows Bun as runtime — because root has `packageManager: "bun@..."`
**Severity:** CRITICAL — produces trust-destroying hallucinations in 3 of 10 benchmark repos.
**Fix:** Do NOT merge root dependencies into package dependencies by default. Instead:
1. Read ONLY the package-level package.json for `dependencies` and `devDependencies`
2. If the package-level package.json references `workspace:*` deps, those are the internal monorepo deps — keep them
3. Root-level dependencies should only be reported in the CROSS-PACKAGE analysis (rootCommands, etc.), never in per-package analysis
4. Exception: if the package has NO package.json of its own (analyzing a bare `src/` directory), THEN use root deps as fallback with a warning

### Bug 1.2: Root Runtime Detection Contaminates Package Runtime
**File:** `src/dependency-analyzer.ts` lines 120-152
**What happens:** If the package-level analysis finds no runtime info, it falls back to the root package.json's `engines`, `packageManager`, and even checks for `bun.lockb` in the root directory.
**Why it's wrong:** A monorepo might use Bun as the package manager (root has `packageManager: "bun@1.3.8"`) but individual packages might target Node.js. The root lockfile format doesn't determine the runtime of each package.
**Benchmark evidence:** Effect shows "Bun" as runtime. Effect actually uses pnpm workspaces — the root has both `bun.lockb` AND `pnpm-lock.yaml` (common in polyglot monorepos).
**Severity:** HIGH — wrong runtime information leads to wrong commands and wrong version guidance.
**Fix:**
1. For runtime detection, prioritize the package-level signals (its own `engines`, `packageManager`, lockfile)
2. Only fall back to root runtime if the package has literally NO signals of its own
3. When falling back, mark it as `"runtime_source": "monorepo_root"` so the serialization can add a caveat

### Bug 1.3: Config Analyzer Reads Root Config Files
**File:** `src/config-analyzer.ts` — pattern repeated in every `detect*` function
**What happens:** Every config detector (build tool, linter, formatter, task runner, env vars) searches BOTH `packageDir` AND `rootDir` for config files. The root's `turbo.json`, `biome.json`, etc. are applied to every package.
**Why it's sometimes wrong:** This is actually CORRECT for build tools (if the root has turbo.json, every package uses Turbo). But it's WRONG for linters if different packages use different linters (package A has eslint, package B has biome, but root has biome — all packages report biome).
**Severity:** MEDIUM — usually correct for build tools, sometimes wrong for linter/formatter.
**Fix:** For build tools: keep root-level detection (correct). For linters/formatters: check package-level config first. Only fall back to root if no package-level config exists. Add `"config_source": "package" | "root"` to the config result.

---

## Category 2: Package Name / Title Resolution (HIGH)

### Bug 2.1: Analysis Target Path Leaks as Package Name
**File:** `src/analysis-builder.ts` lines 144-151
**What happens:**
```typescript
let name = basename(absPackageDir);  // "src" when analyzing "nitro/src"
// Try to read package.json
const pkgPath = join(absPackageDir, "package.json");
if (existsSync(pkgPath)) {
  const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  name = pkgJson.name ?? name;
}
```
If the analysis target is `nitro/src` and there's no `package.json` in `src/`, the name becomes `"src"`.
**Benchmark evidence:** Nitro's output title is `"# src"` instead of `"# nitro"`.
**Severity:** HIGH — makes the output look broken.
**Fix:** Walk up from the analysis target to find the nearest `package.json` with a `name` field:
```typescript
function resolvePackageName(analysisDir: string, rootDir?: string): string {
  let dir = analysisDir;
  const stopAt = rootDir || '/';
  while (dir !== stopAt && dir !== path.dirname(dir)) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name) return pkg.name;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return basename(analysisDir); // last resort
}
```

### Bug 2.2: Monorepo Package Names Not Normalized
**File:** `src/analysis-builder.ts`
**What happens:** The `name` field comes directly from `package.json` which might be `"@medusajs/core-flows"` or `"@inversifyjs/container"`. In the LLM output, this appears as-is. But in the Package Guide table, the engine sometimes uses the directory name instead.
**Severity:** LOW — cosmetic but inconsistent.
**Fix:** Use the package.json `name` consistently. If no name, use directory name. Never mix.

---

## Category 3: Framework Detection False Positives (HIGH)

### Bug 3.1: Framework Guidance Fires for ALL Detected Frameworks Including Irrelevant Ones
**File:** `src/dependency-analyzer.ts` lines 62-75
**What happens:** Every dependency that matches the `getFrameworkGuidance` switch statement gets added to `frameworks`. If React is in the dep list (even from root leakage per Bug 1.1), it gets full version guidance.
**Combined with Bug 1.1:** Root deps → package deps → framework detection → "React 18 — no use() hook" in a backend API package.
**Severity:** HIGH when combined with Bug 1.1 (which is how it manifests in practice).
**Fix:** Fixing Bug 1.1 (don't merge root deps) fixes this too. But additionally, add a relevance check: if a framework is detected but the package has NO source files that import from it, emit a warning instead of guidance.

### Bug 3.2: Zod Version Detection May Be Wrong
**File:** `src/dependency-analyzer.ts` line 224
**Benchmark evidence:** Knip engine output says `"Zod 4.1.11"` but the benchmark evaluator flagged this as "appears incorrect."
**Root cause:** Likely the same root dep leakage — Zod might be in the root package.json with a different version than what the CLI tool actually uses (or doesn't use at all).
**Fix:** Same as Bug 1.1 — don't merge root deps.

### Bug 3.3: "Unknown Test Framework" Still Occurs
**Benchmark evidence:** OpenStatus engine output says "Unknown test framework."
**Root cause:** The test-framework-ecosystem detector checks `devDependencies` for known test frameworks. If the package doesn't have its own devDependencies (uses root-level devDeps in a monorepo), the detector finds nothing.
**Fix:** Two options: (a) check root devDependencies for test frameworks (intended behavior — root often has test framework for all packages), or (b) infer from test file patterns (presence of `*.test.ts` files + `vitest.config.*` = Vitest).

---

## Category 4: Command Extraction Issues (MEDIUM)

### Bug 4.1: Package Manager Detection from Root vs Package
**File:** `src/command-extractor.ts` lines 118-136
**What happens:** `detectPackageManager()` checks for lockfiles in the directory tree. In a monorepo, the root has the lockfile. The package directory usually doesn't have its own lockfile.
**Current behavior:** Checks packageDir first, then rootDir. This is correct.
**Potential issue:** If a monorepo uses pnpm at the root but an individual package has a local `bun.lockb` (for its own scripts), the package-level lockfile wins. This is usually correct but could be surprising.
**Severity:** LOW — current behavior is generally correct.

### Bug 4.2: Workspace Commands May Include Irrelevant Packages
**File:** `src/command-extractor.ts` lines 233-315 (scanWorkspaceCommands)
**What happens:** Workspace scanning finds ALL package.json files in the workspace and extracts operational commands (db:*, sync:*, etc.). These are reported in the output even if they belong to packages the user isn't analyzing.
**Why it could be wrong:** If analyzing only `apps/web`, the output might include `db:migrate` from `packages/db` which is useful. But it might also include `email:preview` from `packages/email` which is irrelevant to the web app.
**Severity:** MEDIUM — the commands are real (they exist), but may not all be relevant to the analyzed packages.
**Fix:** Filter workspace commands by relevance: only include commands from packages that are in the dependency graph of the analyzed packages. OR mark each command with which package it comes from (already done per the implementation) and let the LLM decide relevance.

---

## Category 5: Output Quality Issues (MEDIUM)

### Bug 5.1: Template Targets Interpreted as Ceilings
**File:** `src/templates/agents-md.ts`
**What happens:** The template says "target 80-120 lines" but the LLM consistently produces 50-72 lines. It treats the target as a maximum, not a range.
**Benchmark evidence:** All 10 repos have engine output of 51-72 lines, well below the 80-100 target.
**Severity:** MEDIUM — the engine is under-utilizing its budget, producing sparser output than intended.
**Fix:** Change template wording from "target X-Y lines" to "you MUST produce at least X lines. Target Y lines. Do not go below X." Make the minimum explicit.

### Bug 5.2: Output Validator Doesn't Catch Root Dep Leakage
**File:** `src/output-validator.ts`
**What happens:** The validator checks that mentioned technologies exist in the `dependencyInsights.frameworks` list. But since Bug 1.1 already put React into that list for Knip, the validator sees "React is in frameworks ✓" and doesn't flag it.
**Severity:** HIGH — the validator was designed to catch hallucinations but can't catch upstream data pollution.
**Fix:** This is fixed by fixing Bug 1.1 (if React isn't in the framework list, the validator correctly flags it). But additionally, the validator could cross-check: "does any source file actually import from this framework?" If React is in frameworks but 0 source files import from React, flag as suspicious.

### Bug 5.3: Percentage Stats Not Fully Removed
**File:** `src/llm/serializer.ts` (post-Wave 5 split)
**Benchmark evidence:** While the main convention percentages were removed in Wave 5, some still leak through in specific serialization paths (convention confidence descriptions can contain percentages).
**Severity:** LOW — mostly handled but not completely.
**Fix:** Strip all percentage patterns from serialized convention text before sending to LLM.

---

## Category 6: Edge Cases with Diverse Repo Structures (MEDIUM)

### Bug 6.1: Analyzing `src/` Directory Directly (No package.json)
**What happens:** When a user runs `analyze path/to/project/src`, the engine looks for `package.json` in `src/` (not found), so:
- Package name becomes "src" (Bug 2.1)
- No dependencies detected (no package.json)
- No commands detected
- Tier classification has no barrel file
**Benchmark evidence:** Nitro was analyzed as `nitro/src`, causing the "# src" title and missing dependencies.
**Severity:** HIGH — common user error (pointing at src/ instead of project root).
**Fix:** If no `package.json` found in the analysis target, walk UP to find one. If found within `rootDir` boundary, use that package.json for name, deps, and commands. The analysis still runs on the `src/` files, but metadata comes from the nearest ancestor package.json.

### Bug 6.2: Workspaces with `workspace:*` Protocol
**What happens:** Many monorepos use `"dependency": "workspace:*"` in package.json. The `cleanVersionRange` function strips this to `"*"` which has no version info.
**Severity:** LOW — internal workspace deps don't need version guidance. But if the engine tries to report `"@internal/pkg: *"` as a framework, it looks odd.
**Fix:** Skip `workspace:*` deps from framework detection entirely. They're internal — not external frameworks.

### Bug 6.3: Packages with Only `.tsx` Files (No `.ts`)
**What happens:** Some component libraries have only `.tsx` files. The file discovery correctly finds them. But convention detectors that check "file extension split" may report 0% `.ts` files as an anomaly.
**Severity:** LOW — cosmetic.

### Bug 6.4: Multiple Entry Points / No Single Barrel
**What happens:** Modern packages may use `package.json` `exports` field with multiple entry points (`.`, `./server`, `./client`). The engine resolves the main `.` entry but doesn't analyze subpath exports.
**Benchmark evidence:** vercel/ai has `exports: { "./rsc": "...", "./svelte": "...", "./vue": "..." }`. The engine only analyzes the main export.
**Severity:** MEDIUM for certain library types. Most packages have one main entry.
**Fix:** For V2: analyze all `exports` subpaths. For now: document this limitation.

---

## Category 7: Validator Gaps (MEDIUM)

### Bug 7.1: Validator Can't Catch Root Dep Contamination
**(Duplicate of 5.2 — listed here for completeness)**
The output validator checks mentioned technologies against `dependencyInsights.frameworks`, but if the frameworks list itself is polluted (from root deps), the validator is ineffective.

### Bug 7.2: Validator Doesn't Check Command Source
**File:** `src/output-validator.ts`
**What happens:** The validator checks that commands in the output exist in the `commands` data. But it doesn't verify that the commands are appropriate for the PACKAGE being described.
**Example:** If workspace commands include `db:migrate` from `packages/db`, the validator allows it in the output for `apps/web`. The command exists, but it's not a web app command.
**Severity:** LOW — workspace commands are useful context even if not package-specific.

### Bug 7.3: Validator Doesn't Check for "src" as Title
**What happens:** Nothing prevents the LLM from using `"# src"` as the title. The validator doesn't check that the package name makes sense.
**Fix:** Add a check: if the package name matches common directory names (`src`, `lib`, `dist`, `app`, `packages`), flag as likely wrong.

---

## Summary: Priority-Ordered Fix List

### CRITICAL (Must fix before any release)
| # | Bug | Impact | Fix Effort |
|---|-----|--------|-----------|
| 1.1 | Root deps merged into package deps | React in CLI tool, Bun in pnpm project | ~40 lines |
| 2.1 | Analysis path leaks as package name | "# src" title | ~30 lines |
| 1.2 | Root runtime contaminates package | Wrong runtime (Bun vs Node) | ~20 lines |
| 5.1 | Templates produce under-target output | 50-70 lines instead of 80-120 | ~10 lines |

### HIGH (Fix before v1.0)
| # | Bug | Impact | Fix Effort |
|---|-----|--------|-----------|
| 3.1 | Framework guidance for irrelevant frameworks | React guidance in backend package | Fixed by 1.1 + ~20 lines |
| 5.2 | Validator can't catch root dep contamination | Hallucinations pass validation | ~30 lines |
| 6.1 | Analyzing src/ directly fails gracefully | Missing metadata | ~30 lines |
| 3.3 | "Unknown test framework" in monorepo packages | Missing test info | ~20 lines |

### MEDIUM (Fix in next iteration)
| # | Bug | Impact | Fix Effort |
|---|-----|--------|-----------|
| 1.3 | Config analyzer reads root config | Usually correct, sometimes wrong linter | ~20 lines |
| 4.2 | Workspace commands may include irrelevant packages | Useful but noisy | ~30 lines |
| 7.3 | Validator doesn't check for "src" title | Silent bad output | ~10 lines |
| 6.4 | Multiple exports subpaths not analyzed | Missing API surface for some libraries | Larger effort (V2) |

### LOW (Nice to have)
| # | Bug | Impact | Fix Effort |
|---|-----|--------|-----------|
| 2.2 | Package name inconsistency | Cosmetic | ~10 lines |
| 5.3 | Percentage stats not fully removed | Minor noise | ~10 lines |
| 6.2 | workspace:* protocol in version | Cosmetic | ~5 lines |
| 6.3 | .tsx-only packages | Cosmetic | ~5 lines |

**Total CRITICAL + HIGH fixes: ~220 lines of changes.**
