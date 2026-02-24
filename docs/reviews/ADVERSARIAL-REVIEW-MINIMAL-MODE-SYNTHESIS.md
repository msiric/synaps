# Adversarial Review Synthesis: Minimal Mode

**Reviewers:** Gemini, Opus, Grok, GPT-4, MiniMax, GLM
**Date:** 2026-02-23

## Unanimous Findings (All 6 Models)

### 1. CRITICAL: "Correct But Useless" Output Needs a Kill Switch

Every reviewer independently flagged this as the biggest gap. If all content is inferrable (standard commands, obvious conventions), generating the file adds cost without benefit.

**Consensus fix:** Add a minimum-value threshold. If the output would contain < ~80 tokens of genuinely non-inferrable content, either:
- Don't generate the file at all, OR
- Generate a stub: "Standard project structure — conventions inferrable from source code"

**Apply triviality check to commands too** — `npm test` with no special flags is noise the AI already knows.

### 2. CRITICAL: Inferability Thresholds Are Arbitrary — Simplify

All models said the 4-factor weighted score (directoryObviousness 30% + namingConsistency 25% + ...) is overengineered and uncalibrated. Replace with boolean signal checks:

```
include_conventions = (
  has_registration_pattern OR
  has_non_standard_imports OR
  has_barrel_files_with_manual_exports
)
```

Keep the weighted score for logging/analytics, but gate decisions on concrete signals.

### 3. HIGH: Include ONE Code Example Reference

Zero examples contradicts the GitHub research that found "1-2 code examples" in successful files. But including full code is too expensive.

**Consensus fix:** Include a POINTER (not content):
```markdown
Example: See `src/detectors/file-naming.ts` for the canonical detector pattern.
```
~20 tokens. Only if a contribution pattern with registration exists.

### 4. HIGH: Cap Commands at 5-7, Not "All Scripts"

Don't dump every package.json script. Priority order:
1. build, test, lint, typecheck (core 4 — always)
2. dev/start (if non-standard flags)
3. 1-2 project-specific (db:generate, storybook — only if CI uses them or high git frequency)

Skip: prepare, prepublish, format, clean, aliases.

### 5. HIGH: Convention Confidence Must Be ≥95%

At 90% consistency, you get the kebab-case/PascalCase problem (90% kebab but React components are PascalCase). This misleads the AI.

**Consensus fix:** Only report conventions at ≥95% consistency. Below that, either scope it ("Files in `src/utils/` use kebab-case") or skip it entirely.

### 6. Add "Standard Project" Note for Near-Empty Output

When minimal mode produces only title + commands, users think it's broken.

**Fix:** Always add a one-line note when optional sections are skipped:
```markdown
Standard TypeScript project — conventions are inferrable from source code.
```
~15 tokens. Prevents bug reports AND tells the AI "this is straightforward, just write code."

## Strong Consensus (4-5 Models)

### 7. Workflow Rules Get More Budget Than Conventions

Workflow rules (co-change patterns, registration) are highest value and lowest risk. Conventions are highest risk (can mislead). Rebalance:
- Workflow rules: up to 5 items, ~100 token budget
- Conventions: up to 2 items, ~50 token budget

### 8. Token Budget: 300-450 Typical, 500-650 Ceiling

| Model | Typical Target | Ceiling |
|-------|---------------|---------|
| Gemini | ~270 | 500 |
| Opus | 150-250 | 365 |
| Grok | ~300-400 | 600 (monorepo) |
| GPT | 300-450 | 600/650 |
| MiniMax | 220-300 | 400 |
| GLM | 300-600 | 600 |

**Consensus:** ~300-400 typical, ~500-600 ceiling for monorepos.

### 9. Use Real Tokenizer (tiktoken), Not chars/4

Multiple models showed chars/4 can undercount by 30-37% for code-heavy content. At tight budgets, this matters. Use tiktoken for enforcement, chars/4 for quick estimates.

**Practical note:** tiktoken adds a dependency. Alternative: use chars/3.5 as a more conservative approximation if we want to avoid the dep.

### 10. Don't Make Minimal Default Yet

Ship as `--minimal` flag. Flip default after validation shows it works. The "I ran it and only got 5 lines" perception problem is real.

### 11. Monorepo Variant

For repos with 8+ packages:
- List top 5 by centrality/git activity
- Group rest: "and 12 other packages"
- Show root-level commands only
- Raise ceiling to ~600 tokens

### 12. Framework-Standard Conventions Are Inferrable

Next.js routing, Rails MVC, Django app structure — the AI already knows these from training data. Don't include conventions that are framework-standard even if they technically match registration patterns.

**Fix:** Add an "AI knowledge baseline" — a list of framework conventions the AI already knows. Skip these even if detected.

## Divergences

### Workflow Rules: Commands vs Information
- **Gemini, GLM:** Use information ("schema.prisma ↔ Prisma client") to avoid stale commands
- **Opus, Grok, MiniMax:** Use commands ("After X → run Y") but only when validated against package.json
- **GPT:** Hybrid — command if validated, informational if not

**My recommendation:** Opus's hybrid approach. If a matching script exists in package.json, phrase as command. Otherwise, phrase as coupling info.

### Include Anti-Patterns (DON'T Rules)?
- **Gemini, Opus, GPT:** Yes, exactly 1 high-confidence DON'T
- **Grok:** Yes, 1 if high-confidence
- **MiniMax:** No, one rule without context is misleading
- **GLM:** No, skip in minimal

**My recommendation:** Include 1 DON'T if it prevents real damage (e.g., "Don't edit `__generated__/`"). Fold into conventions slot, not a separate section.

### Should Commands Section Be Skippable?
- **GLM, MiniMax:** Yes — if all commands are trivially standard, skip entirely
- **Others:** Keep commands always (proven safe by research)

**My recommendation:** Keep commands always but apply triviality filter. If every command is just `<pm> <script-name>` with no flags, reduce to a one-liner: "Standard npm scripts — see package.json"

## Revised Design (Post-Review)

### Sections (ordered by inclusion priority)

| # | Section | Condition | Max Tokens |
|---|---------|-----------|-----------|
| 1 | Title + one-line description | Always | 15 |
| 2 | "Standard project" note | If no optional sections qualify | 15 |
| 3 | Commands (core 4 + 1-2 custom) | Always (but triviality-checked) | 80 |
| 4 | Workflow rules (coupling + registration) | If co-change data ≥ 5 count OR registration patterns | 100 |
| 5 | Non-obvious conventions (≥95% confidence) | If boolean signal gate passes | 50 |
| 6 | Example pointer | If contribution pattern with registration exists | 25 |
| 7 | Key directories (non-exhaustive) | If non-obvious + non-framework-standard dirs exist | 50 |
| 8 | Package guide | If monorepo with 3+ packages | 60 |
| **Total typical** | | | **~200-350** |
| **Ceiling** | | | **~500 (single), ~600 (monorepo)** |

### Kill Switch Logic

```
1. Run full analysis
2. Compute which optional sections qualify (boolean gates)
3. Count non-inferrable tokens across qualifying sections
4. If non-inferrable tokens < 80:
     → Generate stub: title + "Standard project" note + commands (if non-trivial)
5. Else:
     → Generate full minimal output with qualifying sections
```

### Boolean Signal Gates (Replace Weighted Score)

```typescript
const includeConventions = (
  hasRegistrationPatterns ||
  hasNonStandardImportPaths ||
  hasBarrelFilesWithManualExports
) && !isFrameworkStandard(conventions);

const includeWorkflowRules = (
  coChangeRulesWithCount5Plus.length > 0 ||
  registrationPatterns.length > 0
);

const includeArchitecture = (
  nonObviousDirs.length > 0 &&
  !allDirsAreFrameworkStandard()
);

const includeExample = (
  topContributionPattern?.registrationFile != null
);
```

## Must-Fix Before Implementation

1. Add minimum-value threshold (kill switch for "correct but useless")
2. Replace weighted inferability with boolean signals
3. Add ≥95% confidence requirement for conventions
4. Cap commands at 6, with triviality check
5. Add "standard project" note for near-empty output
6. Include one example pointer (conditional)
7. Add framework-knowledge baseline (skip framework-standard conventions)

## Should-Fix

8. Use tiktoken or chars/3.5 (not chars/4)
9. Hybrid workflow rule phrasing (command if validated, info if not)
10. Monorepo variant with different limits
11. Allow up to 5 workflow rules (more budget than conventions)

## Nice-to-Have (v2)

12. Per-tool output (`--target claude|copilot`)
13. "Reverse Turing" test validation
14. Setup hints ("Use Node 20 via Volta")
15. Generated-code boundaries ("Don't edit `__generated__/`")
