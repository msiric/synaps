# Benchmark: Post-Grounding (Engine v3)

> **Date:** 2026-02-18
> **Engine version:** v3 (grounded prompting: XML tags, fill-in-the-blank templates, temperature 0, whitelist validator with retry)
> **Repos tested:** 10
> **Comparison:** Engine v3 vs Human-written vs Raw LLM (Claude reading code directly)

---

## Results Summary

| # | Repo | Engine v1 | Engine v2 | Engine v3 | Human | Raw LLM |
|---|------|-----------|-----------|-----------|-------|---------|
| 1 | sanity | 5.9 | 4.7 | **5.1** | 7.4 | 7.4 |
| 2 | medusa | 5.7 | 8.0 | **6.1** | 7.6 | 6.4 |
| 3 | vercel/ai | 6.7 | 7.6 | **6.4** | 7.6 | 6.4 |
| 4 | MCP SDK | 6.1 | 3.6 | **3.4** | 8.1 | 7.9 |
| 5 | knip | 5.1 | 4.4 | **4.6** | 8.4 | 7.1 |
| 6 | nitro | 5.4 | 6.3 | **5.7** | 7.9 | 7.7 |
| 7 | openstatus | 6.7 | 6.4 | **6.6** | 7.4 | 7.1 |
| 8 | documenso | 5.7 | 4.9 | **4.4** | 6.1 | 6.9 |
| 9 | effect | 5.4 | 5.7 | **6.3** | 7.3 | 5.9 |
| 10 | excalidraw | 6.6 | 6.9 | **6.7** | 5.7 | 6.9 |
| **Avg** | | **5.9** | **5.9** | **5.5** | **7.4** | **7.0** |

### Verdict: Regression. Engine v3 scored 5.5, down from 5.9 (v1/v2).

---

## Dimension Breakdown (Engine v3)

| # | Repo | Commands | Budget | Signal | Workflow | Architecture | Domain | Accuracy | Avg |
|---|------|----------|--------|--------|----------|--------------|--------|----------|-----|
| 1 | sanity | 5 | 6 | 4 | 5 | 5 | 4 | 7 | 5.1 |
| 2 | medusa | 7 | 5 | 6 | 6 | 7 | 5 | 7 | 6.1 |
| 3 | vercel/ai | 7 | 8 | 6 | 5 | 7 | 5 | 7 | 6.4 |
| 4 | MCP SDK | 4 | 6 | 3 | 3 | 3 | 3 | 2 | 3.4 |
| 5 | knip | 7 | 7 | 5 | 6 | 5 | 4 | 2 | 5.1 |
| 6 | nitro | 7 | 5 | 6 | 5 | 6 | 5 | 6 | 5.7 |
| 7 | openstatus | 7 | 7 | 6 | 6 | 7 | 6 | 7 | 6.6 |
| 8 | documenso | 7 | 6 | 4 | 4 | 2 | 3 | 6 | 4.6 |
| 9 | effect | 6 | 7 | 6 | 5 | 6 | 7 | 7 | 6.3 |
| 10 | excalidraw | 7 | 8 | 6 | 6 | 7 | 6 | 7 | 6.7 |
| **Avg** | | **6.4** | **6.5** | **5.2** | **5.1** | **5.5** | **4.8** | **5.8** | **5.5** |

### Weakest dimensions: Domain (4.8), Workflow (5.1), Signal/Noise (5.2)

---

## Hallucination Audit

### Did hallucinations disappear? NO.

| Repo | Hallucination | Severity | Caught by validator? |
|------|--------------|----------|---------------------|
| **knip** | "React-based components and HTTP server capabilities" + "react: React library for graph explorer UI components (17 imports)" | **Critical** — knip has zero React dependencies, zero .tsx files | **NO** |
| **MCP SDK** | Entire output fabricated: MCPClient, MCPServer, HTTPTransport, IPCTransport, WebSocketTransport — none of these classes exist | **Critical** — 100% hallucinated content | **NO** |
| **nitro** | Tech stack says "Vite (dev bundler) | Rollup (production bundler)" — actual build tool is obuild (Rust-based, uses rolldown) | Moderate | NO |

### Root causes:

1. **MCP SDK (`mcp-sdk/src/` doesn't exist):** The repository was restructured into a monorepo with `packages/core/`, `packages/server/`, `packages/client/`. The target path `mcp-sdk/src/` is empty/non-existent. The engine received no source files and generated the entire output from LLM training knowledge of "what an MCP SDK should look like." The validator cannot catch fabricated classes because it doesn't know which classes are real.

2. **Knip (React hallucinated):** The LLM saw `graph-explorer/` directory and inferred React UI components. In reality, `graph-explorer/` is a code analysis module with zero React dependencies. The validator whitelist likely includes "react" as a valid technology, so it passed validation.

3. **Documenso (`apps/web` doesn't exist):** The actual app is at `apps/remix`. The engine fell back to analyzing the root `package.json` only, producing an output about "root package of a Turbo monorepo that orchestrates builds... contains no source code." Accurate for what it found, but useless.

---

## Target Path Issues

Two of the 10 repos had invalid analysis targets specified in the benchmark commands:

| Repo | Target Given | Actual Path | Impact |
|------|-------------|-------------|--------|
| MCP SDK | `mcp-sdk/src` | `packages/core/src`, `packages/server/src`, `packages/client/src` | Engine fabricated entire output |
| documenso | `documenso/apps/web` | `documenso/apps/remix` | Engine analyzed root only |

**Note:** These are command errors in the benchmark setup, not engine bugs. However, the engine should detect empty/missing targets and fail gracefully rather than generating hallucinated content. This is an engine robustness issue.

---

## Word Count Results

| Repo | Words | Lines | Meets 800w target? |
|------|-------|-------|-------------------|
| sanity | 784 | 105 | No (by 16 words) |
| medusa | 682 | 90 | No |
| **vercel/ai** | **1096** | **134** | **Yes** |
| mcp-sdk | 744 | 139 | No |
| **knip** | **924** | **130** | **Yes** |
| nitro | 683 | 109 | No |
| **openstatus** | **912** | **139** | **Yes** |
| documenso | 738 | 131 | No |
| **effect** | **881** | **111** | **Yes** |
| **excalidraw** | **978** | **130** | **Yes** |

**5/10 hit the 800-word target.** Average: 842 words (up from ~400-600 in v2).

---

## v2 → v3 Comparison (Per Repo)

| Repo | v2 | v3 | Delta | Notes |
|------|-----|-----|-------|-------|
| sanity | 4.7 | 5.1 | +0.4 | Slight improvement, still weak on domain |
| medusa | 8.0 | 6.1 | **-1.9** | Major regression — different target (core-flows vs full) |
| vercel/ai | 7.6 | 6.4 | **-1.2** | Regression — less domain-specific content |
| MCP SDK | 3.6 | 3.4 | -0.2 | Same failure (invalid target path) |
| knip | 4.4 | 4.6 | +0.2 | Still has React hallucination |
| nitro | 6.3 | 5.7 | -0.6 | Regression — less specific |
| openstatus | 6.4 | 6.6 | +0.2 | Slight improvement |
| documenso | 4.9 | 4.4 | -0.5 | Different target (apps/web doesn't exist) |
| effect | 5.7 | 6.3 | **+0.6** | Best improvement — good domain coverage |
| excalidraw | 6.9 | 6.7 | -0.2 | Essentially unchanged |

**Improved:** 4 repos (sanity, knip, openstatus, effect)
**Regressed:** 6 repos (medusa, ai, mcp-sdk, nitro, documenso, excalidraw)

---

## Key Questions Answered

### 1. Did hallucinations disappear across ALL 10 repos?

**NO.** Hallucinations remain in at least 2/10 repos (knip: React, MCP SDK: fabricated classes). A third (nitro) has a moderate inaccuracy in build tool identification. The whitelist validator does not catch:
- Hallucinated classes/functions (only checks technology names)
- Technologies that are valid in general but wrong for this repo (React is a real technology, just not used by knip)
- Empty source targets (produces fabricated content instead of erroring)

### 2. Is output density now adequate?

**Partially.** Average word count rose to 842 (from ~400-600 in v2). 5/10 repos meet the 800-word minimum. Line counts range 90-139 (above the 80-line floor). The word count enforcement works but isn't consistent — repos with fewer source files (medusa core-flows, nitro src/) produce shorter output.

### 3. What's the new average score?

**5.5** — a regression from 5.9 (v1/v2). The grounding changes did not improve overall quality.

### 4. Does the engine beat the raw LLM on any repos?

**1 out of 10.** Effect (6.3 vs 5.9). Ties on vercel/ai (6.4 vs 6.4). Loses on 8/10.

### 5. By how much did the accuracy dimension improve?

**v3 accuracy avg: 5.8 vs v2: 5.5** — improvement of +0.3. Minimal. The two critical hallucinations (knip: 2, MCP SDK: 2) drag the average down. Excluding the two invalid-target repos, accuracy is 6.6.

### 6. Is the engine now competitive with human-written files?

**NO.** Engine v3 (5.5) vs Human (7.4) = gap of 1.9 points. The engine is also below the Raw LLM (7.0) by 1.5 points. The engine adds negative value compared to simply asking Claude to read the code.

---

## What Grounding Changed (and Didn't)

### What improved:
- **Word count enforcement** mostly works (5/10 hit 800+, avg 842 vs ~500 before)
- **Temperature 0** produces more deterministic output
- **XML tags** give consistent section structure
- **Effect and openstatus** outputs are the best the engine has ever produced

### What didn't improve:
- **Hallucination rate** — still present in 2-3/10 repos. The validator catches technology-name hallucinations but not:
  - Fabricated class/function names
  - Technologies valid globally but wrong for the specific repo
  - Content generated from empty source targets
- **Domain knowledge** — still the weakest dimension (4.8 avg). The engine can't infer domain terminology, design rationale, or workflow conventions that aren't literally written in source code
- **Workflow specificity** — rules remain generic ("after modifying X → run build"). Human files have highly specific rules like "bug fixes MUST include a failing test first" or "use `pathe` not `node:path`"
- **Signal/noise ratio** — file counts, import counts, and useMemo/useCallback statistics are noise. The LLM fills space with quantitative observations rather than qualitative insights

### What regressed:
- **medusa and vercel/ai** scored significantly lower than v2 (unclear why — possibly the grounding constraints prevented the LLM from using training knowledge that was actually correct)
- The fill-in-the-blank template may be too rigid, preventing the LLM from producing naturally structured output for repos it actually knows well

---

## Diagnosis: Why the Engine Underperforms

### 1. The engine analyzes source code; the LLM has read documentation

The Raw LLM (7.0 avg) beats the engine (5.5 avg) because Claude has read README files, documentation, and tutorials during training. When asked to write AGENTS.md for "Medusa" or "Excalidraw," it draws on comprehensive knowledge of these projects. The engine only sees file structures and import graphs — it can count files and trace call graphs but can't infer *why* the code is structured this way or *how* developers should work with it.

### 2. The validator catches the wrong things

The whitelist validator checks if technology names exist (e.g., "is React a real framework?"). But the critical hallucinations are:
- "React is used in this project" (real tech, wrong attribution)
- "MCPClient is the main class" (plausible name, doesn't exist)
- "17 imports from react" (specific number, completely fabricated)

The validator needs to cross-reference against actual `package.json` dependencies and actual source exports — not just check if a technology name is valid globally.

### 3. Empty source targets produce hallucinated output

When the engine receives an empty or non-existent directory, it should error out. Instead, it generates plausible-sounding content from LLM training knowledge. The MCP SDK output reads like a generic "how to build an SDK" guide because that's exactly what it is — the LLM had no source files to ground against.

### 4. Grounding constraints may be too rigid for well-known repos

The fill-in-the-blank template forces a specific output structure. For well-known repos (medusa, vercel/ai), the unconstrained LLM can produce better output by drawing on its training knowledge. The grounding constraints may have prevented v3 from using correct information that v2 used freely.

---

## Recommendations

### Immediate fixes:
1. **Fail on empty targets:** If the analysis directory has <5 source files, error out instead of generating
2. **Validate against package.json:** Cross-reference hallucinated dependencies against actual `package.json` — if "react" isn't in dependencies/devDependencies/peerDependencies, flag it
3. **Validate class/function names against actual exports:** Parse source files for actual export names and reject fabricated ones
4. **Fix benchmark target paths:** MCP SDK should use `mcp-sdk/packages/core/src`, documenso should use `documenso/apps/remix`

### Architectural changes needed:
5. **Incorporate README/docs content:** The engine should read README.md, CONTRIBUTING.md, and existing context files to extract domain knowledge, workflow rules, and conventions that can't be inferred from source code alone
6. **Reduce quantitative noise:** File counts, import counts, and hook counts add no value for AI coding assistants. Focus on capabilities, patterns, and rules instead
7. **Improve workflow extraction:** Parse CI configs, pre-commit hooks, and package.json scripts to extract specific workflow rules rather than generating generic ones
8. **Allow LLM knowledge for well-known repos:** Consider a hybrid approach where the engine's source analysis is supplemented by the LLM's training knowledge for repos it knows well

---

## Raw Data: Engine v3 Hallucination Details

### Knip — React hallucination
```
Location: Architecture section + Key Dependencies section
Text: "The package is structured as a CLI tool with React-based components and HTTP server capabilities"
Text: "react: React library for graph explorer UI components (17 imports)"
Reality: knip has zero React dependencies, zero .tsx files, zero React imports.
         The graph-explorer/ directory is a code analysis module, not a UI component.
```

### MCP SDK — Fabricated entire output
```
Location: Entire file
Examples of fabricated content:
- "MCPClient: Main client class" — actual class is "Client"
- "MCPServer: Base server class" — actual class is "McpServer" (different casing)
- "HTTPTransport: HTTP/REST-based communication" — doesn't exist (actual: StreamableHTTPClientTransport)
- "IPCTransport: Inter-process communication" — doesn't exist
- "WebSocketTransport" — might partially exist but not as described
- "src/messages/", "src/client/", "src/server/", "src/transport/", "src/utils/" — none exist at target path
- "validateMessage()", "serializeMessage()", "deserializeMessage()", "createError()" — all fabricated
Root cause: mcp-sdk/src/ is an empty/non-existent path (repo restructured to packages/*)
```

### Nitro — Build tool misidentification
```
Location: Tech Stack section
Text: "Vite (dev bundler) | Rollup (production bundler)"
Reality: Primary build tool is obuild (Rust-based, uses rolldown). Rollup and rolldown are both
         available as build options, not "dev vs production" split. Vite is used for dev server.
```
