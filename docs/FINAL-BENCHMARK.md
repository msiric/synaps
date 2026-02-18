# autodocs-engine Final Pre-Release Benchmark

> **Date:** 2026-02-18
> **Engine version:** v1.0 candidate (Wave 5, 201 tests)
> **Methodology:** Three-way blind comparison across 10 diverse TypeScript repos
> **Scoring:** 7 dimensions, research-backed criteria (Vercel 8KB study, 100-150 instruction budget)

---

## Scoring Criteria Reference

| # | Dimension | 10/10 Means |
|---|-----------|-------------|
| 1 | **Commands** | All commands exact, correct, build tool detected, variants listed |
| 2 | **Budget** | Within 100-150 lines. ~4-8KB. Not too sparse, not too verbose |
| 3 | **Signal/Noise** | All content is actionable for AI tools. No style rules, file listings, percentages |
| 4 | **Workflow** | Specific "when X -> do Y" with actual commands. Not generic advice |
| 5 | **Architecture** | Describes capabilities, names specific implementations. Not file listings |
| 6 | **Domain** | Terminology, version guidance, concepts AI can't infer from code |
| 7 | **Accuracy** | Zero errors. Wrong info heavily penalized. Hallucinations are critical failures |

---

## Per-Repo Results

### 1. Sanity (CMS monorepo)

**Files compared:**
- Engine: 51 lines
- Human: 387 lines
- Raw LLM: 253 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 5/10 | 9/10 | 7/10 |
| Budget | 7/10 | 4/10 | 5/10 |
| Signal/Noise | 8/10 | 6/10 | 6/10 |
| Workflow | 5/10 | 9/10 | 7/10 |
| Architecture | 5/10 | 7/10 | 8/10 |
| Domain | 3/10 | 5/10 | 8/10 |
| Accuracy | 8/10 | 9/10 | 7/10 |
| **Average** | **5.9** | **7.0** | **6.9** |

**Best for AI context:** B (Human) -- Practical CI checks table and auth/no-auth distinction is uniquely valuable for AI agents.

**Engine strengths:** Lean and focused. Key dependencies with import counts provide data-driven insight. Good signal-to-noise.
**Engine weaknesses:** Missing critical commands (pnpm install, lint:fix, check:types, clean). No domain terminology (GROQ, Portable Text, Content Lake). Workflow rules are generic.

---

### 2. Medusa (E-commerce API)

**Files compared:**
- Engine: 66 lines
- Human: 342 lines
- Raw LLM: 310 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 5/10 | 8/10 | 7/10 |
| Budget | 7/10 | 5/10 | 5/10 |
| Signal/Noise | 8/10 | 6/10 | 6/10 |
| Workflow | 5/10 | 9/10 | 7/10 |
| Architecture | 6/10 | 9/10 | 7/10 |
| Domain | 3/10 | 9/10 | 8/10 |
| Accuracy | 6/10 | 8/10 | 7/10 |
| **Average** | **5.7** | **7.7** | **6.7** |

**Best for AI context:** B (Human) -- Deep architecture patterns with code examples (service decorators, workflow composition, error handling) provide exactly what AI tools need.

**Engine strengths:** Good public API section. Architecture identifies HTTP layer, modules, permissions, workflows. Lean.
**Engine weaknesses:** Lists "React 18.3.1" for a backend API package (likely pulled from monorepo root -- misleading). Missing integration test commands. No service decorator patterns, no workflow step/compensation pattern, no MedusaError types. The human file's code examples are worth more than the engine's entire output.

---

### 3. Vercel/AI (AI SDK monorepo)

**Files compared:**
- Engine: 72 lines
- Human: 285 lines
- Raw LLM: 261 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 7/10 | 9/10 | 7/10 |
| Budget | 7/10 | 5/10 | 5/10 |
| Signal/Noise | 8/10 | 7/10 | 6/10 |
| Workflow | 5/10 | 8/10 | 7/10 |
| Architecture | 7/10 | 7/10 | 7/10 |
| Domain | 5/10 | 7/10 | 8/10 |
| Accuracy | 8/10 | 9/10 | 7/10 |
| **Average** | **6.7** | **7.4** | **6.7** |

**Best for AI context:** B (Human) -- Task completion criteria and development workflow sections give AI tools clear "done" criteria that neither engine nor raw LLM capture.

**Engine strengths:** Best engine performance. Names specific functions (streamText, generateText, ToolLoopAgent). Public API with signatures. Test command variants.
**Engine weaknesses:** Workflow rules are generic. Missing development workflow (build before test, changeset process). Missing contribution guidelines.

---

### 4. MCP TypeScript SDK

**Files compared:**
- Engine: 60 lines (root) + 4 package detail files
- Human: 267 lines
- Raw LLM: 236 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 7/10 | 9/10 | 7/10 |
| Budget | 7/10 | 5/10 | 6/10 |
| Signal/Noise | 8/10 | 6/10 | 6/10 |
| Workflow | 3/10 | 7/10 | 7/10 |
| Architecture | 6/10 | 9/10 | 7/10 |
| Domain | 5/10 | 9/10 | 7/10 |
| Accuracy | 7/10 | 9/10 | 7/10 |
| **Average** | **6.1** | **7.7** | **6.7** |

**Best for AI context:** B (Human) -- Three-layer architecture with protocol versioning and message flow documentation provides deep understanding no automated tool can match.

**Engine strengths:** Package guide table directing tasks to packages. Hierarchical output with per-package detail files.
**Engine weaknesses:** First run failed (ENOENT on `/src` -- mono-package assumed). Workflow rules are extremely generic ("After modifying source files -> Run pnpm test"). Missing protocol versioning, transport implementation patterns, migration guidance.

---

### 5. Knip (CLI tool)

**Files compared:**
- Engine: 56 lines
- Human: 184 lines
- Raw LLM: 228 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 7/10 | 7/10 | 7/10 |
| Budget | 7/10 | 8/10 | 6/10 |
| Signal/Noise | 5/10 | 9/10 | 6/10 |
| Workflow | 5/10 | 9/10 | 6/10 |
| Architecture | 6/10 | 9/10 | 7/10 |
| Domain | 3/10 | 9/10 | 6/10 |
| Accuracy | 3/10 | 9/10 | 7/10 |
| **Average** | **5.1** | **8.6** | **6.4** |

**Best for AI context:** B (Human) -- Execution sequence walkthrough, plugin development guide, and debugging with trace flags make this the gold standard for CLI tool documentation.

**Engine strengths:** Identified test:node and test:bun variants. Architecture categories are reasonable.
**Engine weaknesses:** **Critical accuracy failures.** Lists "React" and "Vike" as key dependencies for a CLI dead-code finder -- these come from the knip monorepo's documentation website, not the CLI tool itself. Lists "Zod 4.1.11" which appears incorrect. Missing the execution flow walkthrough that makes the human file exceptional. No trace flag documentation. No plugin entry type explanations.

---

### 6. Nitro (Backend server)

**Files compared:**
- Engine: 52 lines
- Human: 165 lines
- Raw LLM: 284 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 7/10 | 7/10 | 7/10 |
| Budget | 7/10 | 8/10 | 5/10 |
| Signal/Noise | 6/10 | 9/10 | 6/10 |
| Workflow | 6/10 | 8/10 | 6/10 |
| Architecture | 6/10 | 7/10 | 7/10 |
| Domain | 2/10 | 9/10 | 7/10 |
| Accuracy | 4/10 | 9/10 | 7/10 |
| **Average** | **5.4** | **8.1** | **6.4** |

**Best for AI context:** B (Human) -- "Bug fixes MUST include failing test first" and specific unjs ecosystem tool recommendations (pathe not path, defu, consola) are exactly the kind of rules AI tools follow.

**Engine strengths:** Test variants (rollup, rolldown). Build pipeline description. Dual bundler workflow rule.
**Engine weaknesses:** **Title is "src" instead of "nitro"** -- analyzed target path leaked into output. Build tool detected as "none" (should be obuild). Missing unjs ecosystem guidance (pathe, defu, consola, unstorage). Missing cross-platform compatibility patterns. Missing "failing test first" contribution rule.

---

### 7. OpenStatus (Web app, Bun)

**Files compared:**
- Engine: 60 lines
- Human: 107 lines
- Raw LLM: 222 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 7/10 | 7/10 | 7/10 |
| Budget | 7/10 | 9/10 | 6/10 |
| Signal/Noise | 7/10 | 7/10 | 6/10 |
| Workflow | 6/10 | 6/10 | 7/10 |
| Architecture | 7/10 | 7/10 | 7/10 |
| Domain | 6/10 | 7/10 | 7/10 |
| Accuracy | 7/10 | 9/10 | 7/10 |
| **Average** | **6.7** | **7.4** | **6.7** |

**Best for AI context:** B (Human) -- Compact, accurate, covers the essential tech stack and commands without bloat.

**Engine strengths:** Data flow description (TanStack Query -> tRPC -> Hono -> Drizzle -> DB). Package guide table. DB migration commands. Close to human on several dimensions.
**Engine weaknesses:** "Unknown test framework" is an honest but unhelpful note. Missing some environment setup context.

---

### 8. Documenso (Remix web app)

**Files compared:**
- Engine: 56 lines
- Human: 60 lines (AGENTS.md) + 76 lines (.cursorrules) = 136 lines
- Raw LLM: 311 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 4/10 | 6/10 | 8/10 |
| Budget | 7/10 | 8/10 | 5/10 |
| Signal/Noise | 7/10 | 5/10 | 5/10 |
| Workflow | 5/10 | 6/10 | 7/10 |
| Architecture | 6/10 | 5/10 | 7/10 |
| Domain | 5/10 | 6/10 | 8/10 |
| Accuracy | 6/10 | 9/10 | 7/10 |
| **Average** | **5.7** | **6.4** | **6.7** |

**Best for AI context:** C (Raw LLM) -- Deepest domain coverage (Envelope, Recipients, Fields, Templates), most complete commands including `npm run d` for dev setup, and richer architecture description.

**Engine strengths:** Detected Hono, Prisma, TanStack Query. Package guide table.
**Engine weaknesses:** Missing `npm run d` (the main dev setup command). Validator caught hallucinated commands (turbo run db:generate). The human file has low signal-to-noise (.cursorrules is mostly style rules), but even so, the engine doesn't surpass it.

---

### 9. Effect-TS (Functional library)

**Files compared:**
- Engine: 66 lines
- Human: 78 lines
- Raw LLM: 221 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 4/10 | 7/10 | 7/10 |
| Budget | 7/10 | 8/10 | 6/10 |
| Signal/Noise | 7/10 | 9/10 | 6/10 |
| Workflow | 3/10 | 9/10 | 6/10 |
| Architecture | 6/10 | 5/10 | 7/10 |
| Domain | 6/10 | 8/10 | 7/10 |
| Accuracy | 5/10 | 9/10 | 7/10 |
| **Average** | **5.4** | **7.9** | **6.6** |

**Best for AI context:** B (Human) -- "All functions must have dual (data-last) variants", mandatory validation steps before submitting, changeset process, barrel file management -- these are irreplaceable project-specific rules.

**Engine strengths:** Public API listing with types and signatures. Architecture categories.
**Engine weaknesses:** **Lists "Bun" in tech stack** -- Effect uses pnpm, not Bun. Only 3 commands (test, build, lint) -- missing check, circular, etc. Workflow rules are extremely generic. Missing core principles (dual functions, pipe pattern). Missing changeset process. Missing `it.effect` test pattern.

---

### 10. Excalidraw (Component library)

**Files compared:**
- Engine: 70 lines
- Human: 35 lines
- Raw LLM: 232 lines

| Dimension | Engine (A) | Human (B) | Raw LLM (C) |
|-----------|-----------|-----------|-------------|
| Commands | 7/10 | 6/10 | 7/10 |
| Budget | 7/10 | 5/10 | 6/10 |
| Signal/Noise | 8/10 | 7/10 | 6/10 |
| Workflow | 6/10 | 4/10 | 7/10 |
| Architecture | 7/10 | 5/10 | 7/10 |
| Domain | 4/10 | 3/10 | 7/10 |
| Accuracy | 7/10 | 9/10 | 6/10 |
| **Average** | **6.6** | **5.6** | **6.6** |

**Best for AI context:** Tie A/C -- Engine provides better signal-to-noise and public API; Raw LLM provides deeper domain context and element model explanations.

**Engine strengths:** Best relative performance. Public API with specific components (Excalidraw, Sidebar, Footer) and hooks (useEditorInterface). Action system description. The 35-line human file was too sparse to compete.
**Engine weaknesses:** Still sparse on domain context (doesn't explain elements, scenes, collaborative editing patterns).

---

## Overall Results

| # | Repo | Engine (A) | Human (B) | Raw LLM (C) | Best |
|---|------|-----------|-----------|-------------|------|
| 1 | sanity | 5.9/10 | 7.0/10 | 6.9/10 | B |
| 2 | medusa | 5.7/10 | 7.7/10 | 6.7/10 | B |
| 3 | vercel/ai | 6.7/10 | 7.4/10 | 6.7/10 | B |
| 4 | MCP SDK | 6.1/10 | 7.7/10 | 6.7/10 | B |
| 5 | knip | 5.1/10 | 8.6/10 | 6.4/10 | B |
| 6 | nitro | 5.4/10 | 8.1/10 | 6.4/10 | B |
| 7 | openstatus | 6.7/10 | 7.4/10 | 6.7/10 | B |
| 8 | documenso | 5.7/10 | 6.4/10 | 6.7/10 | C |
| 9 | effect | 5.4/10 | 7.9/10 | 6.6/10 | B |
| 10 | excalidraw | 6.6/10 | 5.6/10 | 6.6/10 | A/C |
| **Average** | **5.9** | **7.2** | **6.6** | **B: 8, C: 1, A/C: 1** |

### Win/Loss Record

| Comparison | Engine Wins | Ties | Engine Loses |
|-----------|------------|------|-------------|
| Engine vs Human | 1 (excalidraw) | 0 | 9 |
| Engine vs Raw LLM | 1 (sanity) | 3 (ai, openstatus, excalidraw) | 6 |

---

## Key Findings

### 1. The engine loses to human-written files in 9 of 10 repos

Average gap: **1.3 points** (5.9 vs 7.2). The gap is largest for repos with high-quality human files that contain deep project-specific knowledge (knip: 3.5pt gap, effect: 2.5pt gap, nitro: 2.7pt gap).

The engine only wins when the human file is extremely sparse (excalidraw: 35 lines). This suggests the engine provides value as a **starting point** but not as a replacement for human knowledge.

### 2. The engine loses to the raw LLM baseline in 6 of 10 repos

Average gap: **0.7 points** (5.9 vs 6.6). The raw LLM consistently produces more domain context, more workflow rules, and more architecture detail -- at the cost of verbosity (220-310 lines vs 50-70 lines).

The engine's leanness (which should be an advantage per research) becomes a liability when it's SO lean that it omits critical information. The sweet spot is 100-150 lines, and the engine consistently produces only 50-70.

### 3. Where the engine excels

- **Signal-to-noise ratio**: Engine averages ~7.2/10 on signal/noise, beating both human (6.4) and raw LLM (5.9). Every line earns its place.
- **Public API documentation**: The engine's pattern fingerprinting and export analysis produces unique value that neither humans nor raw LLMs typically provide.
- **Key dependencies with import counts**: Data-driven dependency analysis is unique to the engine.
- **Package guide tables**: For multi-package repos, the "what to work on -> which package" table is useful.
- **Consistency**: The engine produces a predictable, structured output every time.
- **Speed**: Analysis completes in seconds (1-10s for AST, 20-40s for LLM formatting).

### 4. Where the engine falls short (consistent gaps)

**a) Too sparse (50-70 lines when 100-150 is optimal)**
The engine's budget enforcement is too aggressive. Research says 100-150 instructions. The engine produces 50-70 lines with only 5-27 actionable rules (4-23% of the 120 budget). It should be targeting 80-120 lines.

**b) Domain context is the biggest weakness**
Engine averages 4.2/10 on domain context vs Human 7.0 and Raw LLM 7.3. The engine cannot infer project-specific terminology, conventions, or "tribal knowledge" from AST analysis alone. Examples:
- Knip: Missing execution flow, trace flags, plugin entry types
- Medusa: Missing service decorators, workflow compensation, MedusaError types
- Effect: Missing dual function requirement, pipe pattern, changeset process
- Nitro: Missing unjs ecosystem tool recommendations

**c) Accuracy issues (hallucinations)**
Three significant accuracy failures across 10 repos:
1. **Knip**: Lists React and Vike as key dependencies (from docs website, not CLI)
2. **Effect**: Lists "Bun" in tech stack (uses pnpm)
3. **Nitro**: Title says "src" instead of "nitro"; build tool shows "none" (should be obuild)

These are the most dangerous failures. Per research: "Hallucinations are critical failures (wrong > missing)."

**d) Workflow rules are generic**
Engine averages 4.9/10 on workflow rules vs Human 7.5 and Raw LLM 6.7. The engine produces rules like "After modifying source files -> run pnpm test" which is obvious and unhelpful. Human files have rules like "Bug fixes MUST include failing test first" and "All functions must have dual (data-last) variants" which are genuinely useful.

**e) Command detection is incomplete**
Misses dev setup commands (documenso's `npm run d`), CI-specific commands, and variant commands that humans know to document.

### 5. Is the engine ready for v1.0 release?

**No.** The engine underperforms both human-written files AND a raw LLM reading the same code. It cannot be marketed as producing "better" or "equivalent" AI context files when it scores 5.9/10 average against 7.2 for humans and 6.6 for a raw LLM.

---

## Dimension Averages Across All Repos

| Dimension | Engine | Human | Raw LLM |
|-----------|--------|-------|---------|
| Commands | 6.2 | 7.3 | 7.1 |
| Budget | 7.0 | 6.4 | 5.5 |
| Signal/Noise | 7.2 | 6.4 | 5.9 |
| Workflow | 4.9 | 7.5 | 6.7 |
| Architecture | 6.2 | 6.5 | 7.1 |
| Domain | 4.2 | 7.0 | 7.3 |
| Accuracy | 6.3 | 8.9 | 6.9 |

**Engine's best dimension:** Signal/Noise (7.2) -- ahead of both competitors
**Engine's worst dimension:** Domain (4.2) -- far behind both competitors
**Biggest gap:** Accuracy (Engine 6.3 vs Human 8.9) -- hallucinations are the critical issue

---

## Specific Bugs and Issues Found

| Repo | Issue | Severity |
|------|-------|----------|
| knip | React and Vike listed as key dependencies (from docs site, not CLI) | Critical (hallucination) |
| effect | "Bun" listed in tech stack (uses pnpm) | Critical (hallucination) |
| nitro | Title is "src" instead of package name | High (path leaking into output) |
| nitro | Build tool detected as "none" (should be obuild) | High (detection failure) |
| documenso | Validator caught hallucinated commands (turbo run db:generate) | Medium (caught by validator) |
| mcp-sdk | First analysis failed (ENOENT on /src) -- needed packages/* paths | Medium (path assumption) |
| medusa | React 18.3.1 listed for backend API package | Medium (misleading context bleed) |
| all repos | Only 4-23% of 120-rule budget used (too sparse) | High (systematic under-generation) |

---

## Recommendation

### Don't ship as v1.0. Ship as v0.9-beta with clear positioning.

**The engine has real value, but not where it currently claims.**

**What to ship as:**
> "autodocs-engine generates a structured starting point for your AGENTS.md. It detects your tech stack, commands, and architecture from code analysis. Run it, then add your project-specific domain knowledge, workflow rules, and conventions."

**What NOT to ship as:**
> "autodocs-engine generates production-ready AI context files that replace hand-written documentation."

### Priority fixes before v1.0:

1. **Fix accuracy (P0)**: The hallucinations are unacceptable. React in knip, Bun in effect, "src" as title. These are trust-destroying. The output validator should catch impossible dependencies (React in a CLI with no JSX) and analysis target paths in titles.

2. **Increase output density (P0)**: Target 100-120 lines, not 50-70. The LLM prompt is over-constraining the output. The engine has rich analysis data (conventions, call graphs, examples) that never makes it into the output because the budget is set too low.

3. **Better workflow rule generation (P1)**: Current rules are generic ("run tests after changes"). Analyze CONTRIBUTING.md, CI configs, and pre-commit hooks to extract project-specific rules ("conventional commits required", "build before test", "changeset required").

4. **Domain context extraction (P1)**: Read README.md intro for project-specific terminology. Extract JSDoc @description tags. Identify custom types used in >50% of files. Include framework version compatibility notes.

5. **Fix title generation (P1)**: Use package.json `name` field, not the analysis target directory path.

6. **Dependency scope filtering (P1)**: When analyzing a package, only list dependencies actually imported by that package's source, not all monorepo dependencies. This would have prevented the React-in-knip hallucination.

### What the engine already does well (keep these):
- Signal-to-noise ratio (best in class)
- Public API with export fingerprints
- Key dependencies with import counts
- Package guide tables for multi-package repos
- Fast, automated, consistent output
- Output validation (caught documenso command hallucination)
