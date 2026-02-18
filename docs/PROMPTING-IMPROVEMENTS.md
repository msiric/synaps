# Prompting Improvements Plan — Grounding LLM Output to Structured Data

**Date:** 2026-02-18
**Problem:** The engine's JSON analysis is accurate, but the LLM formatting layer hallucinates technologies, ignores line minimums, and adds content beyond the provided data.
**Evidence:** Post-bugfix benchmark shows JSON has no React for Knip, but the AGENTS.md output still mentions "react: JSX component analysis (17 imports)". The LLM is making things up.
**Research:** docs/research/llm-prompting-research.md (50+ sources on grounding techniques)

---

## Root Cause

The current prompt architecture mixes instructions and data in a single markdown blob. The LLM can't reliably distinguish "this is data to format faithfully" from "this is context I should elaborate on." When it sees patterns in the serialized data (e.g., import counts mentioning React), it infers "this project uses React" even when React isn't in the frameworks list.

## The 6 Changes (in implementation order)

### Change 1: Temperature = 0

**File:** `src/llm/client.ts`
**Current:** No temperature parameter in the API call.
**Change:** Add `temperature: 0` to the request body.

```typescript
body: JSON.stringify({
  model: llmConfig.model,
  max_tokens: llmConfig.maxOutputTokens,
  system: systemPrompt,
  messages: [{ role: "user", content: userPrompt }],
  temperature: 0,  // NEW: maximize determinism, minimize hallucination
}),
```

**Why:** Temperature 1.0 (default) maximizes creativity. For data-to-text formatting, we want minimal creativity and maximal faithfulness.

**Effort:** 1 line.

---

### Change 2: XML Tag Restructuring

**Files:** `src/llm/adapter.ts`, `src/llm/serializer.ts`, `src/templates/agents-md.ts`

**Current approach:** The user prompt is:
```
{formatInstructions}

---

{serialized markdown data}
```

Instructions and data are separated only by `---`. The LLM treats the whole thing as free-form input.

**New approach:** Use XML tags that Claude was specifically trained to recognize:

```xml
<system>
{systemPrompt — hard constraints like "only use data from <analysis>"}
</system>

<instructions>
{formatInstructions — the template structure to follow}
</instructions>

<analysis>
{serialized structured data — the ONLY source of truth}
</analysis>
```

**Specific changes:**

**In `src/llm/client.ts`:**
The system prompt goes in the API's `system` parameter (already correct). The user prompt becomes:

```typescript
const userPrompt = `<instructions>
${template.formatInstructions}
</instructions>

<analysis>
${serializedData}
</analysis>

Generate the AGENTS.md now. Use ONLY data from the <analysis> section. Do NOT add technologies, frameworks, runtimes, or version numbers that are not explicitly present in <analysis>.`;
```

**In `src/templates/agents-md.ts`:**
Add to EVERY system prompt:

```
GROUNDING RULES (these override all other instructions):
- You are a DATA FORMATTER, not a knowledge source. Your ONLY source of truth is the <analysis> section.
- NEVER add technologies, frameworks, runtimes, or libraries not explicitly listed in the analysis.
- NEVER infer a technology from code patterns. If "useQuery" appears in imports but "GraphQL" is not in frameworks, do NOT mention GraphQL.
- If a field is empty or missing in the analysis, leave that section out or write "Not detected" — do NOT fill it from your training data.
- Every technology name, version number, and command in your output MUST have a corresponding entry in the <analysis> data.
```

**Effort:** ~30 lines across 3 files.

---

### Change 3: Fill-in-the-Blank Template

**File:** `src/templates/agents-md.ts`

**Current approach:** The format instructions describe the STRUCTURE ("## Tech Stack → list frameworks...") and the LLM generates freely within that structure.

**New approach:** Provide a more rigid skeleton with explicit field references:

```markdown
# {INSERT: analysis.packages[0].name}

{INSERT: analysis.packages[0].role.summary}

## Tech Stack
{INSERT: For each item in analysis.packages[0].dependencyInsights.frameworks, write "name version". Separate with " | ". If empty, write "No frameworks detected."}
{INSERT: If analysis.packages[0].dependencyInsights.runtime exists, prepend runtime name and version.}

## Commands
| Command | Description |
|---------|-------------|
{INSERT: For each command in analysis.packages[0].commands (build, test, lint, start, other), write one table row with the exact command string.}
{INSERT: If analysis.crossPackage.workspaceCommands exists, add rows for operational commands (db:*, sync:*, deploy:*).}

## Architecture
{INSERT: For each entry in analysis.packages[0].architecture.directories where exports.length > 0, write one bullet: "**{purpose}**: {describe the exports from this directory}"}
{INSERT: If analysis.packages[0].callGraph has edges, describe the top 3-5 connections: "functionA orchestrates: functionB, functionC"}

## Workflow Rules
{INSERT: If analysis.crossPackage.workflowRules exists, copy each rule VERBATIM. These contain specific commands — do NOT paraphrase.}
{INSERT: Additional rules from analysis.packages[0].conventions where impact is "high" and category is "testing" or "ecosystem", formatted as "After X → run Y"}
```

**Key principle:** The `{INSERT: ...}` directives tell the LLM EXACTLY which analysis field to pull from. This eliminates the "I'll just add what I know" failure mode.

**Effort:** ~100 lines (rewrite format instructions for all 4 templates).

---

### Change 4: One Few-Shot Example

**File:** `src/templates/agents-md.ts` (or a new `src/templates/example.ts`)

**Add one complete example** of a correct transformation. This goes in the system prompt or as a prefix to the format instructions:

```
<example_input>
{
  "packages": [{
    "name": "my-api",
    "role": { "summary": "REST API server for user management" },
    "dependencyInsights": {
      "frameworks": [{ "name": "fastify", "version": "5.2.0", "guidance": "Fastify 5 — async hooks, type providers" }],
      "runtime": [{ "name": "node", "version": "22.0.0" }]
    },
    "commands": {
      "build": { "run": "turbo run build" },
      "test": { "run": "turbo run test" },
      "lint": { "run": "biome check ." }
    }
  }]
}
</example_input>

<example_output>
# my-api

REST API server for user management.

## Tech Stack
Node 22.0.0 | Fastify 5.2.0 | Biome (lint) | Turbo (build orchestration)
- Fastify 5: async hooks, type providers

## Commands
| Command | Description |
|---------|-------------|
| `turbo run build` | Build |
| `turbo run test` | Run tests |
| `biome check .` | Lint |

## Architecture
- **User management**: CRUD endpoints for user accounts
...
</example_output>

NOTICE: The example output mentions ONLY "Fastify" and "Node" because those are the ONLY frameworks and runtimes in the analysis. It does NOT mention Express, React, or any other technology. Follow this pattern exactly.
```

**Why this works:** The few-shot example demonstrates the grounding principle concretely. The LLM sees "analysis has Fastify → output has Fastify. Analysis doesn't have React → output doesn't have React."

**Effort:** ~50 lines.

---

### Change 5: Stricter Mechanical Validation

**File:** `src/output-validator.ts`

**Current validator checks:** Technology keywords against dep list, version consistency, symbol verification, budget, commands.

**Problem:** The technology check uses `allDeps` which comes from the (now-correct) structured analysis. But the LLM adds technologies from its own knowledge that aren't in the dep list. The current check catches "GraphQL" if graphql isn't in deps — but it doesn't catch "React" when React appears in the serialized data as an import pattern but NOT in the frameworks list.

**New validation approach — whitelist instead of blacklist:**

```typescript
function checkTechnologyWhitelist(
  output: string,
  analysis: StructuredAnalysis | PackageAnalysis,
  issues: ValidationIssue[],
): void {
  // Build the complete whitelist of technologies the output MAY mention
  const allowed = new Set<string>();

  const packages = "packages" in analysis ? analysis.packages : [analysis as PackageAnalysis];
  for (const pkg of packages) {
    // Frameworks
    for (const fw of pkg.dependencyInsights?.frameworks ?? []) {
      allowed.add(fw.name.toLowerCase());
      // Also allow common aliases
      if (fw.name === "next") allowed.add("next.js");
      if (fw.name === "react") allowed.add("react");
      if (fw.name === "vue") allowed.add("vue.js");
      // etc.
    }
    // Runtimes
    for (const rt of pkg.dependencyInsights?.runtime ?? []) {
      allowed.add(rt.name.toLowerCase());
    }
    // Config tools
    if (pkg.configAnalysis?.linter) allowed.add(pkg.configAnalysis.linter.name.toLowerCase());
    if (pkg.configAnalysis?.formatter) allowed.add(pkg.configAnalysis.formatter.name.toLowerCase());
    if (pkg.configAnalysis?.buildTool) allowed.add(pkg.configAnalysis.buildTool.name.toLowerCase());
  }

  // Scan output for technology keywords NOT in the whitelist
  const TECH_PATTERNS = [
    /\breact\b/gi, /\bvue\b/gi, /\bangular\b/gi, /\bsvelte\b/gi,
    /\bnext\.?js?\b/gi, /\bnuxt\b/gi, /\bremix\b/gi, /\bastro\b/gi,
    /\bexpress\b/gi, /\bfastify\b/gi, /\bhono\b/gi, /\bkoa\b/gi,
    /\bgraphql\b/gi, /\bprisma\b/gi, /\bdrizzle\b/gi,
    /\bbun\b/gi, /\bdeno\b/gi,
    /\bjest\b/gi, /\bvitest\b/gi, /\bmocha\b/gi,
    /\bwebpack\b/gi, /\bvite\b/gi, /\besbuild\b/gi, /\brollup\b/gi,
    /\bbiome\b/gi, /\bprettier\b/gi, /\beslint\b/gi,
  ];

  for (const pattern of TECH_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      const techName = pattern.source.replace(/\\b/g, "").replace(/\\\.?/g, ".").replace(/\?/g, "").toLowerCase();
      // Skip if in negation context ("not React", "instead of GraphQL")
      const negationRegex = new RegExp(`(not|no|without|instead of|rather than|don't use)\\s+${pattern.source}`, "gi");
      if (negationRegex.test(output)) continue;

      if (!allowed.has(techName) && !allowed.has(techName.replace(".", ""))) {
        issues.push({
          severity: "error",
          type: "hallucinated_technology",
          message: `Output mentions "${techName}" but it is NOT in the analysis frameworks, runtimes, or config tools. This is likely hallucinated.`,
          suggestion: `Remove all mentions of "${techName}" — it does not appear in the structured analysis.`,
        });
      }
    }
  }
}
```

**Also add line count validation with retry:**

```typescript
function checkMinimumLength(
  output: string,
  targetMin: number,
  issues: ValidationIssue[],
): void {
  const lineCount = output.split("\n").length;
  if (lineCount < targetMin) {
    issues.push({
      severity: "error",
      type: "under_minimum_length",
      message: `Output is ${lineCount} lines but minimum is ${targetMin}. Expand the Architecture, Workflow Rules, and Public API sections.`,
      suggestion: `Add more detail to reach at least ${targetMin} lines. Include all commands, workflow rules, and top 20 public API exports.`,
    });
  }
}
```

**Effort:** ~80 lines.

---

### Change 6: Word Count Instead of Line Count

**File:** `src/templates/agents-md.ts`

**Current:** "You MUST produce at least 90 lines."
**Change:** Use word count as the primary metric (LLMs are better at estimating words than lines):

```
- You MUST produce at least 900 words (approximately 90-110 lines). Do not go below 900 words.
- Target 1000-1300 words for comprehensive coverage.
```

**For package detail:** "You MUST produce at least 1200 words (approximately 100-130 lines)."

**For multi-package root:** "You MUST produce at least 800 words (approximately 80-100 lines)."

**Effort:** ~10 lines (change in all 4 templates).

---

## Implementation Order

| Step | Change | Files | Effort |
|------|--------|-------|--------|
| 1 | Temperature = 0 | llm/client.ts | 1 line |
| 2 | XML tag restructuring | llm/adapter.ts, templates/agents-md.ts | ~30 lines |
| 3 | Grounding rules in system prompt | templates/agents-md.ts | ~20 lines |
| 4 | Fill-in-the-blank template rewrite | templates/agents-md.ts | ~100 lines |
| 5 | Few-shot example | templates/agents-md.ts (or new file) | ~50 lines |
| 6 | Word count instead of line count | templates/agents-md.ts | ~10 lines |
| 7 | Whitelist-based technology validator | output-validator.ts | ~80 lines |
| 8 | Line count validation with retry | output-validator.ts, llm/adapter.ts | ~20 lines |
| 9 | Tests | test/prompting-improvements.test.ts | ~100 lines |
| **Total** | | | **~411 lines** |

---

## Validation

### After implementation, run on the 4 worst-performing benchmark repos:

```bash
# The benchmark repos and comparison files are preserved at /tmp/final-benchmark/

# Knip (was 4.4 — React hallucination)
mkdir -p /tmp/final-benchmark/results/knip/engine-v3
ANTHROPIC_API_KEY=<key> npx tsx src/bin/autodocs-engine.ts analyze \
  /tmp/final-benchmark/knip/packages/knip --root /tmp/final-benchmark/knip \
  --format agents.md --output /tmp/final-benchmark/results/knip/engine-v3 --verbose

# Verify: NO React
grep -i "react" /tmp/final-benchmark/results/knip/engine-v3/AGENTS.md && echo "FAIL" || echo "PASS: No React"

# Verify: ≥80 lines (or ≥800 words)
wc -l -w /tmp/final-benchmark/results/knip/engine-v3/AGENTS.md

# MCP SDK (was 3.6 — Bun hallucination, too narrow)
mkdir -p /tmp/final-benchmark/results/mcp-sdk/engine-v3
ANTHROPIC_API_KEY=<key> npx tsx src/bin/autodocs-engine.ts analyze \
  /tmp/final-benchmark/mcp-sdk/src --root /tmp/final-benchmark/mcp-sdk \
  --format agents.md --output /tmp/final-benchmark/results/mcp-sdk/engine-v3 --verbose

# Verify: NO Bun
grep -i "bun" /tmp/final-benchmark/results/mcp-sdk/engine-v3/AGENTS.md | grep -iv "bundle" && echo "FAIL" || echo "PASS: No Bun"
```

### Success criteria:

1. **Zero hallucinated technologies** across all test repos (React, Bun, GraphQL not in analysis → not in output)
2. **All outputs ≥80 lines / ≥800 words**
3. **All 222 existing tests still pass**
4. **Validator catches and retries any hallucination that slips through**
