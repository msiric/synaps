# Plan: Feedback Loop — Benchmark System (v3 — Post Two Adversarial Rounds)

## Context

The engine produces AGENTS.md files, but we have zero evidence they help AI tools write better code. This benchmark measures the **marginal value** of AGENTS.md: does AI-generated code improve when the AI has AGENTS.md **in addition to** source code access?

**Key insight:** The engine IS the scorer — convention detectors and contribution pattern checks that generate AGENTS.md rules can verify compliance. Deterministic, reproducible, aligned with the engine's methodology.

**Revision history:**
- v1: Initial design. 4 adversarial reviews returned REVISE (unfair control, circular logic, integration bias).
- v2: Fixed control conditions, added negative control, rebalanced rubric. 4 more reviews returned REVISE (treatment still missing sibling files, sibling selection unspecified, token confound).
- v3 (this version): Treatment now includes sibling files (marginal value measurement). Deterministic sibling selection. Shuffled negative control. Token reporting.

## Experimental Design (4 Conditions)

| Condition | AGENTS.md | Sibling Files | Dir Listing | Reg/Barrel | Measures |
|-----------|-----------|--------------|-------------|------------|----------|
| **A (Treatment)** | Real | 2-3 files | Yes | Yes | Real-world AGENTS.md scenario |
| **B (Realistic Control)** | None | 2-3 files | Yes | Yes | Real-world no-AGENTS.md scenario |
| **C (Impoverished)** | None | None | Yes | Yes | Lower bound / maximum delta |
| **N (Negative)** | Shuffled | None | Yes | Yes | Structured-prompt vs correct-content |

**Headline metric: A - B** (marginal value of AGENTS.md when AI already has source code access)
**Supporting metrics:** A - C (upper bound), N vs C (does any structured document help?)
**Negative control:** Shuffled AGENTS.md — programmatically scramble import specifiers, export suffixes, registration file paths. Preserves document structure, tests content specificity. No second repo needed.

## Sibling File Selection (Deterministic)

Pre-registered algorithm (eliminates researcher degree of freedom):

1. Always include `ContributionPattern.exampleFile` (the engine identified it as most representative)
2. Add the most recently modified sibling file that isn't the exampleFile (represents current conventions)
3. If directory has >= 5 source files, add one more: file with median modification date
4. Skip test files, index/barrel files, and generated files
5. Truncate each sibling to first 100 lines if longer (with `// ... truncated` marker)
6. Log which siblings were selected in results.json for reproducibility

## Scoring Rubric (25 points, Tier A)

**Convention (10 pts):**
- Common imports present AND used (4) — AST-parse for specifier presence + verify at least one imported symbol is referenced in the code
- Export naming follows suffix (3) — primary export ends with `exportSuffix`
- File naming convention (2) — run fileNamingDetector
- No anti-pattern violations (1) — cross-reference against antiPatterns

**Integration (8 pts):**
- Registration file updated (4) — AST-parse registrationFile: verify `aiImports >= originalImports` AND new module path present
- Barrel file updated (2) — AST-parse barrel for new re-export (accept `export *`, `export { X } from`, named re-export)
- File in correct directory (2) — fs.existsSync

**Structure (4 pts):**
- Filename matches filePattern (2) — regex
- Test file co-located (2) — fs.existsSync if testPattern exists

**Quality (3 pts):**
- File compiles without syntax errors (2) — `ts.createSourceFile()` syntax-only (no semantic/import resolution)
- Exports at least one non-type symbol (1) — AST check

**Integration check detail:** Both original and AI-modified files are AST-parsed. Import specifiers extracted from each. Check: `aiImports supseteq originalImports AND aiImports includes newModulePath`. This is formatting-immune. If the AI outputs a "lazy" file with `// ... existing code`, the import superset check fails (missing original imports), correctly scoring 0.

## Prompt Design

**System prompt (identical for ALL conditions):**
```
You are an expert TypeScript developer working on the {packageName} project.
Your task is to add new code to this codebase.
For each file you create or modify, output it in this format:

\`\`\`filepath
// file content here
\`\`\`

If you modify an existing file, output the COMPLETE modified file (all existing code plus your changes).
Include ALL files needed: implementation, tests, and any existing files that need updates.
Do not add explanations outside the code blocks.
```

**Shared context (ALL conditions):**
```
Here are files you may need to modify:
<file path="{registrationFile}">
{registrationFileContent}
</file>
<file path="{barrelFile}">
{barrelFileContent}
</file>
```

**Condition A (Treatment):** shared + AGENTS.md + siblings + dir listing
```
<agents-md>
{AGENTS.md content}
</agents-md>
<file path="{sibling1}">{sibling1Content}</file>
<file path="{sibling2}">{sibling2Content}</file>
Directory: {dirListing}
Task: {task.prompt}
```

**Condition B (Realistic Control):** shared + siblings + dir listing (no AGENTS.md)
```
<file path="{sibling1}">{sibling1Content}</file>
<file path="{sibling2}">{sibling2Content}</file>
Directory: {dirListing}
Task: {task.prompt}
```

**Condition C (Impoverished):** shared + dir listing only
```
Directory: {dirListing}
Task: {task.prompt}
```

**Condition N (Negative):** shared + shuffled AGENTS.md + dir listing
```
<agents-md>
{shuffledAgentsMd}
</agents-md>
Directory: {dirListing}
Task: {task.prompt}
```

## Shuffled AGENTS.md Generation

Programmatic scrambling of the real AGENTS.md for Condition N:
- Swap `commonImports` specifiers between contribution patterns
- Randomize `exportSuffix` values (rotate among detected suffixes)
- Point `registrationFile` to wrong paths (swap between patterns)
- Preserve document structure, headings, formatting
- Generated deterministically from the real analysis (seeded random)

This controls for "structured document helps" vs "correct content helps" without needing a second repo.

## Implementation

### File Structure
```
src/benchmark/
  types.ts              (~80 lines)   All interfaces
  task-generator.ts     (~140 lines)  Tasks from ContributionPatterns + sibling collection
  code-generator.ts     (~130 lines)  Multi-condition prompts + robust parsing
  scorer.ts             (~200 lines)  Deterministic scoring in temp workspace
  shuffler.ts           (~60 lines)   Shuffle AGENTS.md for negative control
  statistics.ts         (~80 lines)   t-test, Wilcoxon, bootstrap CI, Cohen's d
  report.ts             (~100 lines)  Markdown + JSON reports
  runner.ts             (~150 lines)  Orchestration
src/bin/
  benchmark.ts          (~80 lines)   CLI entry point
test/benchmark/
  task-generator.test.ts
  scorer.test.ts
  statistics.test.ts
  code-generator.test.ts
  integration.test.ts   (~50 lines)   End-to-end with mocked LLM
```

**Total: ~1200 lines (source) + ~300 lines (tests)**

### Key Implementation Details

**Robust code block parser** accepts:
- ` ```filepath\ncontent``` ` (standard)
- ` ```ts\n// filepath: path/to/file.ts\ncontent``` ` (language tag + comment)
- ` ```typescript path/to/file.ts\ncontent``` ` (language then path)
- Path normalization: strip `./`, convert `\` to `/`

**Temp workspace isolation:** One fresh copy per task per condition. Copy only: source files, tsconfig.json, package.json. Exclude: node_modules, .git, dist, build, coverage. Apply AI-generated files as overwrites. Score against workspace state. Discard after scoring.

**Syntax-only compilation:** Use `ts.createSourceFile(path, content, ScriptTarget.Latest)` directly, checking only for parse diagnostics. Do NOT create a `ts.Program` (avoids import resolution).

**Registration file validation:** Parse original and AI-modified registration files. Extract import specifiers from both. Check: `Set(aiSpecifiers) >= Set(originalSpecifiers)` AND `aiSpecifiers.has(newModulePath)`. This catches lazy `// ... existing code` outputs (missing originals) and verifies the new import was added.

## Statistical Design

**Quick mode (default):**
- 3-5 tasks, 1 run per condition
- NO statistical tests — report only: mean scores, pass rates, win/loss/tie per task
- Labeled explicitly: "Directional results only. Not statistically powered."
- Cost: ~$1-2 (Sonnet), ~$5-8 (Opus)

**Full mode (`--full`):**
- Minimum 15 tasks (combine Tier A + B + C to reach threshold)
- 1 run per condition (no pseudo-replicates at T=0)
- Paired t-test + Wilcoxon signed-rank on per-task A-B deltas
- Bootstrap 95% CI (1000 resamples)
- Cohen's d for effect size
- Per-tier breakdown reported separately
- Report token counts per condition for confound analysis
- Cost: ~$8-15 (Sonnet), ~$40-70 (Opus)

## CLI Command

```
synaps benchmark [repo-path] [options]

Options:
  --quick               Quick mode: 3-5 tasks, directional only (default)
  --full                Full mode: 15+ tasks, statistical analysis
  --model <model>       LLM model (default: claude-sonnet-4-20250514)
  --output <dir>        Output directory (default: ./benchmark-results/)
  --root <dir>          Monorepo root
  --max-tasks <n>       Max tasks to generate (default: 20)
  --dry-run             Show tasks + prompts, no LLM calls
  --verbose             Detailed per-check scoring
```

## Cost Model

| Mode | Tasks | Conditions | Runs | LLM Calls | Sonnet Cost | Opus Cost |
|------|-------|-----------|------|-----------|-------------|-----------|
| Quick | 5 | A, B, C, N | 1 | 20 | ~$1.50 | ~$7 |
| Full | 15 | A, B, C, N | 1 | 60 | ~$10 | ~$50 |

Plus 3 micro-LLM calls for AGENTS.md generation (~$0.10 Sonnet, ~$0.50 Opus).

## Claim Scoping

> "AGENTS.md improves AI adherence to contribution patterns (file placement, naming conventions, import patterns, export suffixes, registration integration) **beyond what an AI can infer from reading source code alone**."

Does NOT claim: general code quality improvement, help with all task types, replacement for source code reading.

## Verification

1. `npm run typecheck` — 0 errors
2. `npm test` — all existing 355+ tests + ~30 new tests pass
3. `synaps benchmark . --dry-run` — shows tasks, prompts, sibling selection, no LLM
4. `synaps benchmark . --quick` — runs on synaps itself
5. Negative control: shuffled AGENTS.md scores similar to or worse than Condition B
6. Token counts reported per condition in results.json
7. REPORT.md has properly scoped claims, per-condition breakdowns, and sibling file disclosure

## Key Design Decisions

1. **Marginal value measurement** — Treatment includes sibling files. A-B measures what AGENTS.md adds beyond source code access
2. **Deterministic sibling selection** — exampleFile + most recent + median. Logged in results. Eliminates cherry-picking
3. **Shuffled negative control** — scramble real AGENTS.md programmatically. No second repo, fully reproducible
4. **Engine as scorer** — deterministic, claim scoped to "pattern adherence"
5. **Import superset check** — AST-level registration validation, catches lazy outputs, formatting-immune
6. **Common imports: presence AND usage** — prevents gaming via unused imports
7. **Syntax-only compilation** — ts.createSourceFile(), no semantic checks in temp workspace
8. **No pseudo-replicates** — 1 run per condition at T=0, invest budget in more tasks
9. **Token reporting** — per-condition counts to acknowledge confound
10. **Fresh workspace per task/condition** — no cross-contamination
