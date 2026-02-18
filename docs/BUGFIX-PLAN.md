# Comprehensive Bug Fix Plan — All 16 Issues

**Date:** 2026-02-18
**Source:** Algorithm Audit (docs/ALGORITHM-AUDIT.md)
**Benchmark evidence:** 10-repo Final Benchmark (docs/FINAL-BENCHMARK.md)
**Goal:** Fix ALL 16 identified bugs. Eliminate hallucinations. Improve output density. Handle edge cases.

---

## Implementation Order

Bugs are grouped by the file they affect, ordered so dependencies resolve correctly:

| Step | Bugs Fixed | Files Modified | Est. Lines Changed |
|------|-----------|----------------|-------------------|
| 1 | 1.1, 1.2, 3.2, 6.2 | dependency-analyzer.ts | ~60 |
| 2 | 2.1, 2.2, 6.1 | analysis-builder.ts | ~50 |
| 3 | 3.1 | dependency-analyzer.ts (additional) | ~25 |
| 4 | 3.3 | detectors/test-framework-ecosystem.ts | ~20 |
| 5 | 1.3 | config-analyzer.ts | ~25 |
| 6 | 5.2, 7.3 | output-validator.ts | ~40 |
| 7 | 4.2 | command-extractor.ts | ~30 |
| 8 | 5.1 | templates/agents-md.ts | ~15 |
| 9 | 5.3 | llm/serializer.ts | ~10 |
| 10 | 6.3 | detectors/file-naming.ts | ~5 |
| 11 | Tests for all fixes | test/bugfix-audit.test.ts | ~250 |
| **Total** | **16 bugs** | **~10 files** | **~530 lines** |

---

## Step 1: Fix Monorepo Dependency Scope (Bugs 1.1, 1.2, 3.2, 6.2)

**File:** `src/dependency-analyzer.ts`

### Bug 1.1: Stop Merging Root Deps Into Package Deps

**Current code (lines 41-57):**
```typescript
// Also read root package.json for monorepo-level deps
if (rootDir) {
  const rootPkgPath = join(rootDir, "package.json");
  if (existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
      const rootDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
      for (const [name, version] of Object.entries(rootDeps)) {
        if (!(name in deps)) {
          deps[name] = version;  // BUG: Merges root deps into package deps
        }
      }
    } catch {}
  }
}
```

**Fix:** REMOVE the root dep merge entirely. Only read the package's own deps:

```typescript
// DO NOT merge root deps — they may include unrelated dependencies
// (e.g., React for a docs site in a monorepo with a CLI tool)
// Root deps are reported separately in cross-package analysis.

// Only read THIS package's own package.json for dependencies
const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
```

### Bug 1.2: Fix Root Runtime Contamination

**Current code (lines 120-152):** Falls back to root `engines`, `packageManager`, and lockfile for runtime.

**Fix:** Only fall back to root runtime if the PACKAGE has zero source files indicating runtime (no lockfile, no engines, no packageManager in its own package.json). And when falling back, mark it as uncertain:

```typescript
// Only fall back to root runtime if the package itself has NO runtime signals
if (result.runtime.length === 0 && rootDir) {
  // Check root, but mark as "from monorepo root" so downstream knows
  // ... existing root check code ...
  // Add source annotation:
  for (const r of result.runtime) {
    r.version = r.version + " (monorepo root)";
  }
}
```

Actually, a cleaner approach: add `source: "package" | "root"` to the runtime type. The serializer can then decide whether to include root-sourced runtimes.

**Better fix:**
```typescript
interface RuntimeInfo {
  name: string;
  version: string;
  source: "package" | "root" | "lockfile";  // NEW
}
```

Mark every runtime detection with its source. The serializer includes only `"package"` runtimes by default. `"root"` runtimes are only included in cross-package analysis.

### Bug 6.2: Skip workspace:* Deps from Framework Detection

**Current code (line 66):** `const cleanVersion = cleanVersionRange(version);` — this strips `workspace:*` to `"*"`.

**Fix:** Before framework detection, skip workspace protocol deps:

```typescript
for (const [name, version] of Object.entries(deps)) {
  if (typeof version !== "string") continue;
  if (version.startsWith("workspace:")) continue;  // NEW: skip internal workspace deps
  const cleanVersion = cleanVersionRange(version);
  // ... rest of framework detection
}
```

### Bug 3.2: Zod Version — Fixed by Bug 1.1

If root deps aren't merged, Zod from the root won't appear in the package's analysis. No additional fix needed.

---

## Step 2: Fix Package Name Resolution (Bugs 2.1, 2.2, 6.1)

**File:** `src/analysis-builder.ts`

### Bug 2.1 + 6.1: Walk Up to Find Nearest package.json

**Current code (lines 143-157):** Only checks `join(absPackageDir, "package.json")`.

**Fix:** Add a `resolvePackageName` function that walks up:

```typescript
function resolvePackageMetadata(
  analysisDir: string,
  rootDir?: string,
): { name: string; version: string; description: string } {
  const stopAt = rootDir ? resolve(rootDir) : undefined;
  let dir = resolve(analysisDir);

  // Walk up from analysis dir to find nearest package.json with a name
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name) {
          return {
            name: pkg.name,
            version: pkg.version ?? "0.0.0",
            description: pkg.description ?? "",
          };
        }
      } catch {}
    }

    // Stop at root dir boundary
    if (stopAt && dir === stopAt) break;

    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Last resort: use the analysis directory name
  // But filter out common directory names that are meaningless
  const dirName = basename(resolve(analysisDir));
  const MEANINGLESS_NAMES = new Set(["src", "lib", "dist", "app", "packages", "core", "main"]);
  if (MEANINGLESS_NAMES.has(dirName)) {
    // Try one more level up
    const parentName = basename(dirname(resolve(analysisDir)));
    return { name: parentName, version: "0.0.0", description: "" };
  }

  return { name: dirName, version: "0.0.0", description: "" };
}
```

**Update `buildPackageAnalysis` (line 144):**
```typescript
// OLD:
let name = basename(absPackageDir);
// NEW:
const meta = resolvePackageMetadata(packageDir, rootDir);
let name = meta.name;
let version = meta.version;
let description = meta.description;
```

### Bug 2.2: Consistent Name Usage

Use `name` from `resolvePackageMetadata` everywhere. Remove any fallback to `basename()` in other code paths.

---

## Step 3: Import-Verified Framework Detection (Bug 3.1)

**File:** `src/dependency-analyzer.ts` (additional change)

**After fixing Bug 1.1 (no root deps), add an import-relevance check:**

When framework guidance is generated, it's based on what's in `package.json` deps. But even package-level deps can include things that aren't actually used in the analyzed source files (e.g., a package lists React as a dep but no source file imports from React).

**Fix:** Add an optional `sourceImports` parameter to `analyzeDependencies`:

```typescript
export function analyzeDependencies(
  packageDir: string,
  rootDir?: string,
  warnings: Warning[] = [],
  sourceImports?: Set<string>,  // NEW: modules actually imported by source files
): DependencyInsights {
  // ... after building frameworks list ...

  // If sourceImports provided, filter frameworks to only those actually used
  if (sourceImports && result.frameworks.length > 0) {
    const verified = result.frameworks.filter(f => sourceImports.has(f.name));
    const unverified = result.frameworks.filter(f => !sourceImports.has(f.name));

    if (unverified.length > 0) {
      warnings.push({
        level: "info",
        module: "dependency-analyzer",
        message: `Frameworks in package.json but not imported: ${unverified.map(f => f.name).join(", ")}`,
      });
    }

    result.frameworks = verified;
  }

  return result;
}
```

**Pipeline integration:** After AST parsing, collect all unique module specifiers from imports across source files. Pass this set to `analyzeDependencies`.

```typescript
// In pipeline.ts, after parsing all files:
const allImportedModules = new Set<string>();
for (const pf of parsedFiles) {
  for (const imp of pf.imports) {
    // Extract base package name from specifier
    // "@scope/pkg/deep/path" → "@scope/pkg"
    // "react" → "react"
    const parts = imp.moduleSpecifier.split("/");
    const basePkg = imp.moduleSpecifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    if (!basePkg.startsWith(".") && !basePkg.startsWith("/")) {
      allImportedModules.add(basePkg);
    }
  }
}

const depInsights = analyzeDependencies(pkgPath, config.rootDir, warnings, allImportedModules);
```

---

## Step 4: Fix "Unknown Test Framework" (Bug 3.3)

**File:** `src/detectors/test-framework-ecosystem.ts`

**Current behavior:** Checks the package's own `devDependencies` for test frameworks. In monorepos, the test framework is often in the ROOT devDependencies.

**Fix:** Accept the dependency context (which now comes from `DetectorContext.dependencies`) and ALSO check root-level devDependencies for test frameworks specifically:

```typescript
// If no test framework found in package deps, check root deps
// Test frameworks are commonly hoisted to root in monorepos
if (!detectedFramework && context?.rootDevDeps) {
  for (const [name] of Object.entries(context.rootDevDeps)) {
    if (TEST_FRAMEWORKS.includes(name)) {
      detectedFramework = name;
      fromRoot = true;
      break;
    }
  }
}
```

**Pipeline change:** Pass root devDependencies through `DetectorContext`:
```typescript
// In pipeline.ts, extend DetectorContext:
const detectorContext: DetectorContext = {
  dependencies: depInsights,
  config: configResult,
  rootDevDeps: rootPkgJson?.devDependencies,  // NEW
};
```

**Also:** Infer test framework from test file patterns as a fallback:
- If `*.test.ts` files exist and `vitest.config.*` exists → Vitest
- If `*.test.ts` files exist and `jest.config.*` exists → Jest
- If `*.test.ts` files exist and bun runtime detected → Bun test

---

## Step 5: Config Analyzer Scope Awareness (Bug 1.3)

**File:** `src/config-analyzer.ts`

**Current behavior:** All `detect*` functions search both `packageDir` and `rootDir` equally.

**Fix:** For linter/formatter detection, prioritize package-level config. Add `source` field:

```typescript
interface ToolDetection {
  name: string;
  configFile: string;
  source: "package" | "root";  // NEW
}
```

**Detection logic change:**
```typescript
function detectLinter(packageDir: string, rootDir?: string, warnings: Warning[]): ToolDetection | undefined {
  // Check package dir FIRST
  const pkgResult = checkLinterIn(packageDir);
  if (pkgResult) return { ...pkgResult, source: "package" };

  // Fall back to root
  if (rootDir) {
    const rootResult = checkLinterIn(rootDir);
    if (rootResult) return { ...rootResult, source: "root" };
  }

  return undefined;
}
```

The serializer can then note "(from monorepo root)" for root-sourced configs if appropriate.

---

## Step 6: Enhanced Output Validator (Bugs 5.2, 7.3)

**File:** `src/output-validator.ts`

### Bug 5.2: Cross-Check Frameworks Against Source Imports

**Add a new validation check:**

```typescript
function checkFrameworkRelevance(
  output: string,
  analysis: StructuredAnalysis | PackageAnalysis,
  issues: ValidationIssue[],
): void {
  // For each framework mentioned in the output, check if it's actually
  // imported by any source file in the package
  const packages = "packages" in analysis ? analysis.packages : [analysis as PackageAnalysis];

  for (const pkg of packages) {
    if (!pkg.dependencyInsights?.frameworks) continue;

    for (const fw of pkg.dependencyInsights.frameworks) {
      // Check if framework name appears in the output
      const regex = new RegExp(`\\b${escapeRegex(fw.name)}\\b`, "i");
      if (!regex.test(output)) continue;

      // Check if any source file actually imports from this framework
      // This data would need to be passed through or computed
      // For now: flag frameworks that are in deps but have 0 import count
      const hasImports = pkg.dependencies.external.some(
        d => d.name === fw.name && d.importCount > 0
      );

      if (!hasImports) {
        issues.push({
          severity: "warning",
          type: "unused_framework",
          message: `"${fw.name}" is in dependencies but no source file imports from it — may be a monorepo root dependency`,
          suggestion: `Consider removing "${fw.name}" from the output or adding a caveat`,
        });
      }
    }
  }
}
```

### Bug 7.3: Check for Meaningless Titles

```typescript
function checkTitle(output: string, issues: ValidationIssue[]): void {
  const MEANINGLESS = ["# src", "# lib", "# dist", "# app", "# packages", "# core", "# main"];
  const firstLine = output.split("\n")[0]?.trim().toLowerCase();
  if (MEANINGLESS.some(m => firstLine === m)) {
    issues.push({
      severity: "error",
      type: "meaningless_title",
      message: `Title "${firstLine}" appears to be a directory name, not a project name`,
      suggestion: "Use the package name from package.json or the monorepo name",
    });
  }
}
```

---

## Step 7: Workspace Command Relevance Filtering (Bug 4.2)

**File:** `src/command-extractor.ts`

**Current behavior:** `scanWorkspaceCommands` returns ALL operational commands from ALL workspace packages.

**Fix:** Add a `relevantPackages` parameter — only include commands from packages that are in the dependency graph of the analyzed packages:

```typescript
export function scanWorkspaceCommands(
  rootDir: string,
  warnings: Warning[] = [],
  analyzedPackageNames?: Set<string>,  // NEW: names of packages being analyzed
): WorkspaceCommand[] {
  // ... existing scanning logic ...

  // If analyzedPackageNames provided, filter to commands from:
  // 1. Packages being analyzed directly
  // 2. Packages that are dependencies of analyzed packages
  // 3. Root-level commands (always included)
  if (analyzedPackageNames && result.length > 0) {
    result = result.filter(cmd => {
      if (cmd.packageName === "root") return true;  // Root commands always relevant
      if (analyzedPackageNames.has(cmd.packageName)) return true;  // Direct analysis target
      // TODO: Could also check if cmd.packageName is a dependency of any analyzed package
      return true;  // For now, include all — but mark with source package
    });
  }

  return result;
}
```

For now, the main fix is ensuring every workspace command includes its `packageName` so the LLM can attribute it correctly. The serializer should format as:

```
| `bun run db:migrate` | packages/db | Run database migrations |
```

Not just:
```
| `bun run db:migrate` | Run database migrations |
```

---

## Step 8: Fix Template Output Density (Bug 5.1)

**File:** `src/templates/agents-md.ts`

**Current wording (various places):** "Target 80-120 lines" / "Target 80-100 lines"

**Fix:** Change wording to enforce a MINIMUM, not just a target:

**Single-package template (line 31):**
```
OLD: "- Target 80-120 lines. Every line must be something an AI tool reliably follows."
NEW: "- You MUST produce at least 90 lines. Target 100-130 lines. Do not go below 90. Every line must be actionable for AI tools."
```

**Multi-package root template (line 103):**
```
OLD: "- Target 80-100 lines."
NEW: "- You MUST produce at least 80 lines. Target 90-120 lines. Do not go below 80."
```

**Package detail template (line 178):**
```
OLD: "- Target 100-150 lines."
NEW: "- You MUST produce at least 100 lines. Target 120-160 lines. Do not go below 100. Include usage examples and complete public API."
```

**Also update the budget validator to match:**
In `src/budget-validator.ts`, adjust the warning thresholds upward to match.

---

## Step 9: Remove Remaining Percentage Stats (Bug 5.3)

**File:** `src/llm/serializer.ts`

**Current behavior:** Convention descriptions may still contain percentage patterns like "32 of 33 files (97%)".

**Fix:** Add a sanitization step to the convention serialization:

```typescript
function sanitizeConventionForOutput(conv: Convention): string {
  let desc = conv.description;
  // Strip percentage patterns
  desc = desc.replace(/\s*\(\d+%\)/g, "");
  desc = desc.replace(/\s*\d+ of \d+ files/g, "");
  desc = desc.replace(/\s*\d+ of \d+ exports/g, "");
  desc = desc.replace(/\s*\d+ of \d+ imports/g, "");
  return desc.trim();
}
```

Apply this function when serializing conventions in both `serializePackage` and `serializeToMarkdown`.

---

## Step 10: Handle .tsx-Only Packages (Bug 6.3)

**File:** `src/detectors/file-naming.ts`

**Current behavior:** Reports "extension split" convention that may flag 0% .ts as unusual.

**Fix:** If ALL files are .tsx (or ALL are .ts), don't report the extension split as a convention — it's not a convention, it's just the file type:

```typescript
// Only report extension split if there's a meaningful split (both types present)
if (tsCount > 0 && tsxCount > 0) {
  // Report the split
} else {
  // All one type — not a convention worth noting
}
```

---

## Step 11: Tests

**New file:** `test/bugfix-audit.test.ts`

### Test cases per bug:

**Bug 1.1 (root deps NOT merged):**
```typescript
it("does not include root package.json deps in package analysis", () => {
  // Fixture: monorepo root has React, package/cli does not
  // Verify: depInsights.frameworks does NOT include React
});
```

**Bug 1.2 (root runtime not used when package has signals):**
```typescript
it("uses package-level runtime, not root, when package has its own signals", () => {
  // Fixture: root has bun, package has pnpm-lock.yaml
  // Verify: runtime does NOT include bun
});
```

**Bug 2.1 (name resolution walks up):**
```typescript
it("resolves package name from parent package.json when analyzing src/", () => {
  // Fixture: project/src/ directory with no package.json, project/package.json has name "my-project"
  // Verify: analysis.name === "my-project", NOT "src"
});
```

**Bug 6.1 (analyzing src/ directly):**
```typescript
it("finds metadata from parent package.json when analyzing src/", () => {
  // Same fixture as 2.1
  // Verify: version, description also resolved from parent
});
```

**Bug 3.1 (import-verified frameworks):**
```typescript
it("excludes frameworks that are in deps but not imported by source files", () => {
  // Fixture: package.json has "react", but no source file imports from "react"
  // Verify: frameworks list does NOT include react (or includes with warning)
});
```

**Bug 3.3 (test framework fallback to root):**
```typescript
it("detects test framework from root devDeps in monorepo", () => {
  // Fixture: package has no devDeps, root has vitest
  // Verify: convention detects "Vitest" as test framework
});
```

**Bug 5.2 (validator catches unused framework):**
```typescript
it("flags framework in output that has zero source imports", () => {
  // Verify: validation issues include "unused_framework" warning
});
```

**Bug 7.3 (validator catches "# src" title):**
```typescript
it("flags meaningless title like '# src'", () => {
  // Verify: validation issues include "meaningless_title" error
});
```

**Bug 6.2 (workspace:* skipped):**
```typescript
it("skips workspace:* deps from framework detection", () => {
  // Fixture: package.json has "my-internal-pkg": "workspace:*"
  // Verify: not in frameworks list
});
```

### Test Fixtures Needed

New fixture: `test/fixtures/monorepo-scope/`:
```
root/
├── package.json    (has react, bun packageManager)
├── bun.lockb
├── packages/
│   └── cli/
│       ├── package.json  (no react, only typescript)
│       └── src/
│           └── index.ts
│   └── web/
│       ├── package.json  (has react)
│       └── src/
│           └── app.tsx
```

New fixture: `test/fixtures/src-analysis/`:
```
my-project/
├── package.json    (name: "my-project", version: "1.0.0")
└── src/
    ├── index.ts
    └── utils.ts
```

---

## Validation After All Fixes

### Re-run on the 10 benchmark repos

The benchmark repos and their human/raw-LLM outputs are preserved at `/tmp/final-benchmark/`. After fixing all bugs, re-generate ONLY the engine outputs:

```bash
cd /Users/mariosiric/Documents/autodocs-engine

for repo in sanity medusa ai mcp-sdk knip nitro openstatus documenso effect excalidraw; do
  mkdir -p /tmp/final-benchmark/results/$repo/engine-v2
  ANTHROPIC_API_KEY=<key> npx tsx src/bin/autodocs-engine.ts analyze \
    /tmp/final-benchmark/{analysis-target-per-repo} \
    --root /tmp/final-benchmark/{repo} \
    --format agents.md --output /tmp/final-benchmark/results/$repo/engine-v2 --verbose
done
```

### Specific Verifications

| Bug | Verification Command | Expected |
|-----|---------------------|----------|
| 1.1 | `grep -i "react" /tmp/.../knip/engine-v2/AGENTS.md` | NOTHING (React gone) |
| 2.1 | `head -1 /tmp/.../nitro/engine-v2/AGENTS.md` | `# nitro` (not `# src`) |
| 1.2 | `grep -i "bun" /tmp/.../effect/engine-v2/AGENTS.md` | NOT listed as runtime |
| 3.1 | `grep -i "react" /tmp/.../medusa/engine-v2/AGENTS.md` | NOTHING (React gone from API) |
| 5.1 | `wc -l /tmp/.../*/engine-v2/AGENTS.md` | All ≥80 lines |
| 7.3 | `head -1 /tmp/.../*/engine-v2/AGENTS.md` | No `# src`, `# lib`, etc. |

### Success Criteria

1. **Zero hallucinations** across all 10 repos (no wrong frameworks, no wrong runtimes)
2. **All titles correct** (package name, not directory name)
3. **All outputs ≥80 lines** (no under-target sparsity)
4. **All 201+ existing tests pass** (no regressions)
5. **New test fixtures validate monorepo scope isolation**
