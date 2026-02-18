# Session Prompt — Comprehensive Bug Fixes (16 Issues)

Open a new Claude Code session from: `/Users/mariosiric/Documents/autodocs-engine/`

Then paste everything between the triple-backtick block below.

---

```
# autodocs-engine — Comprehensive Algorithm Bug Fixes

A 10-repo benchmark revealed 16 bugs in the engine, with 4 CRITICAL issues causing hallucinated frameworks, wrong runtimes, and broken titles. This session fixes ALL 16 issues.

## Before You Code

Read these documents in order:

1. **The bug fix plan (complete spec for all 16 fixes):**
   `docs/BUGFIX-PLAN.md`
   Read the ENTIRE document. It has 11 implementation steps, exact code changes, new test fixtures, and validation criteria.

2. **The algorithm audit (root cause analysis):**
   `docs/ALGORITHM-AUDIT.md`
   Explains WHY each bug exists and how they're interconnected. The systemic root cause is monorepo scope leakage.

3. **The benchmark that found these bugs:**
   `docs/FINAL-BENCHMARK.md`
   Shows the specific failures: React in CLI tool (knip), "# src" title (nitro), Bun in pnpm project (effect).

After reading, confirm you understand:
- The 4 CRITICAL bugs and their root cause (monorepo dep leakage)
- The 11 implementation steps in order
- The validation commands to verify each fix

## The 16 Bugs (Grouped by Severity)

### CRITICAL (4 bugs — hallucinations and broken output)
- **1.1:** Root deps merged into package deps → React appears in CLI tools
- **2.1:** Analysis path leaks as title → "# src" instead of "# nitro"
- **1.2:** Root runtime contaminates package → Bun shown for pnpm projects
- **5.1:** Templates produce under-target output → 50-70 lines instead of 80-120

### HIGH (4 bugs — incorrect or missing data)
- **3.1:** Framework guidance for irrelevant frameworks → React guidance in backend
- **5.2:** Validator can't catch root dep contamination
- **6.1:** Analyzing src/ directly fails → missing metadata
- **3.3:** "Unknown test framework" in monorepo packages

### MEDIUM (4 bugs — suboptimal but not broken)
- **1.3:** Config analyzer reads root config → sometimes wrong linter
- **4.2:** Workspace commands may include irrelevant packages
- **7.3:** Validator doesn't check for "src" title
- **6.4:** Multiple exports subpaths (document as V2 limitation)

### LOW (4 bugs — cosmetic)
- **2.2:** Package name inconsistency
- **5.3:** Percentage stats not fully removed
- **6.2:** workspace:* protocol in version → skip from framework detection
- **6.3:** .tsx-only packages → don't report extension split

## Implementation Order (11 Steps)

Follow BUGFIX-PLAN.md exactly:

1. **dependency-analyzer.ts** — STOP merging root deps. Fix runtime source tracking. Skip workspace:* deps. (~60 lines)
2. **analysis-builder.ts** — Walk up to find nearest package.json name. Handle src/ analysis. (~50 lines)
3. **dependency-analyzer.ts** — Add import-verified framework detection (frameworks must be actually imported by source files). (~25 lines)
4. **detectors/test-framework-ecosystem.ts** — Fallback to root devDeps for test framework. Infer from test file patterns. (~20 lines)
5. **config-analyzer.ts** — Add source tracking ("package" vs "root") for linter/formatter. (~25 lines)
6. **output-validator.ts** — Add framework relevance check + meaningless title check. (~40 lines)
7. **command-extractor.ts** — Ensure workspace commands include package source. (~30 lines)
8. **templates/agents-md.ts** — Change "target X lines" to "MUST produce at least X lines". (~15 lines)
9. **llm/serializer.ts** — Strip remaining percentage patterns from conventions. (~10 lines)
10. **detectors/file-naming.ts** — Don't report extension split when all files are same type. (~5 lines)
11. **test/bugfix-audit.test.ts** — Tests for all fixes + new fixtures. (~250 lines)

## Testing

### Benchmark repos (preserved from previous run)

Verify repos still exist:
```bash
ls /tmp/final-benchmark/sanity /tmp/final-benchmark/knip /tmp/final-benchmark/nitro /tmp/final-benchmark/effect /tmp/final-benchmark/medusa
```

If missing, re-clone:
```bash
cd /tmp/final-benchmark
git clone --depth 1 https://github.com/sanity-io/sanity.git
git clone --depth 1 https://github.com/webpro-nl/knip.git
git clone --depth 1 https://github.com/unjs/nitro.git
git clone --depth 1 https://github.com/Effect-TS/effect.git
git clone --depth 1 https://github.com/medusajs/medusa.git
```

### After ALL fixes, verify:

```bash
# All existing tests pass
npm test

# Bug 1.1: Knip should NOT mention React
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/knip/packages/knip --dry-run 2>/dev/null | python3 -c "
import json,sys; d=json.loads(sys.stdin.read())
fws = [f['name'] for f in d['packages'][0].get('dependencyInsights',{}).get('frameworks',[])]
print('Frameworks:', fws)
assert 'react' not in [f.lower() for f in fws], 'BUG 1.1 NOT FIXED: React found in knip!'
print('✓ Bug 1.1 fixed: No React in knip')
"

# Bug 2.1: Nitro should NOT have "src" as name
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/nitro/src --root /tmp/final-benchmark/nitro --dry-run 2>/dev/null | python3 -c "
import json,sys; d=json.loads(sys.stdin.read())
name = d['packages'][0]['name']
print('Name:', name)
assert name != 'src', 'BUG 2.1 NOT FIXED: Name is still src!'
print('✓ Bug 2.1 fixed: Name is', name)
"

# Bug 1.2: Effect should NOT show Bun as runtime
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/effect/packages/effect --root /tmp/final-benchmark/effect --dry-run 2>/dev/null | python3 -c "
import json,sys; d=json.loads(sys.stdin.read())
runtimes = [r['name'] for r in d['packages'][0].get('dependencyInsights',{}).get('runtime',[])]
print('Runtimes:', runtimes)
# Bun should NOT be listed as a package-level runtime for Effect
print('✓ Bug 1.2 check: Runtimes =', runtimes)
"

# Bug 3.1: Medusa core-flows should NOT mention React
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/medusa/packages/core/core-flows --root /tmp/final-benchmark/medusa --dry-run 2>/dev/null | python3 -c "
import json,sys; d=json.loads(sys.stdin.read())
fws = [f['name'] for f in d['packages'][0].get('dependencyInsights',{}).get('frameworks',[])]
print('Frameworks:', fws)
assert 'react' not in [f.lower() for f in fws], 'BUG 3.1 NOT FIXED: React found in medusa core-flows!'
print('✓ Bug 3.1 fixed: No React in medusa core-flows')
"
```

### LLM output test (needs API key)
```bash
export ANTHROPIC_API_KEY="<key>"

# Generate new engine output for knip
mkdir -p /tmp/final-benchmark/results/knip/engine-v2
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/knip/packages/knip \
  --root /tmp/final-benchmark/knip \
  --format agents.md --output /tmp/final-benchmark/results/knip/engine-v2 --verbose

# Verify: no React, title not "src", ≥80 lines
grep -i "react" /tmp/final-benchmark/results/knip/engine-v2/AGENTS.md && echo "FAIL: React found" || echo "✓ No React"
wc -l /tmp/final-benchmark/results/knip/engine-v2/AGENTS.md
```

## What NOT to Change

- Don't modify the AST parser, symbol graph, or tier classifier
- Don't change the LLM adapter split (src/llm/*.ts)
- Don't remove any ecosystem detectors
- Don't change the pipeline architecture
- All 201 existing tests must pass after changes

## What to Ask Me

- If fixing Bug 1.1 causes unexpected test failures (some tests may depend on root dep merging)
- If the name resolution walk-up hits unexpected edge cases
- If the import-verified framework check is too aggressive (removing frameworks that ARE relevant)
- If you need the API key for LLM output testing
```
