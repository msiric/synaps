# Session Prompt — Prompting Improvements (Grounding LLM Output)

Open a new Claude Code session from: `/Users/mariosiric/Documents/autodocs-engine/`

Then paste everything between the triple-backtick block below.

---

```
# autodocs-engine — Grounding the LLM Output to Structured Data

The engine's JSON analysis is accurate (verified: no React for Knip, no Bun for MCP SDK in the JSON). But the LLM formatting layer hallucinates — it adds technologies from its own knowledge that aren't in the structured data. This session fixes the prompting architecture to ground the LLM's output strictly to the analysis data.

## Before You Code

Read the complete plan:
`docs/PROMPTING-IMPROVEMENTS.md`

It has 6 specific changes with exact code modifications, based on research into LLM grounding techniques (Anthropic's XML tag training, data-to-text generation best practices, mechanical validation patterns).

Also read the research:
`docs/research/llm-prompting-research.md`

Key principles driving these changes:
- Claude was **specifically trained** to recognize XML tags for separating instructions from data
- Temperature 0 maximizes determinism, minimizes creative hallucination
- Fill-in-the-blank templates constrain the output space more than free-form generation
- Few-shot examples concretely demonstrate the grounding principle
- Whitelist-based validation catches hallucinations that blacklist approaches miss
- Word counts are more reliable than line counts for LLM enforcement

## The 6 Changes

### 1. Temperature = 0 (1 line)
**File:** `src/llm/client.ts`
Add `temperature: 0` to the API request body. Currently no temperature is set (defaults to 1.0 = maximum creativity).

### 2. XML Tag Restructuring (~30 lines)
**Files:** `src/llm/adapter.ts`, `src/templates/agents-md.ts`
Wrap the prompt in XML tags that Claude natively understands:
- `<instructions>` for format template
- `<analysis>` for serialized structured data
- Final instruction: "Generate AGENTS.md now. Use ONLY data from <analysis>."

### 3. Grounding Rules in System Prompt (~20 lines)
**File:** `src/templates/agents-md.ts`
Add to EVERY system prompt:
```
GROUNDING RULES (override all other instructions):
- You are a DATA FORMATTER, not a knowledge source.
- NEVER add technologies not in <analysis>.
- NEVER infer a technology from code patterns.
- Every technology, version, and command MUST have a corresponding entry in <analysis>.
```

### 4. Fill-in-the-Blank Template Rewrite (~100 lines)
**File:** `src/templates/agents-md.ts`
Replace free-form section descriptions with explicit field references:
```
## Tech Stack
{INSERT: For each framework in analysis.dependencyInsights.frameworks, write "name version". If empty, write "No frameworks detected."}
```
This tells the LLM EXACTLY which field to pull from, eliminating "I'll add what I know."

### 5. One Few-Shot Example (~50 lines)
**File:** `src/templates/agents-md.ts` (or new `src/templates/example.ts`)
Add one complete example showing: JSON analysis with Fastify → AGENTS.md mentions ONLY Fastify. Explicitly note: "The output does NOT mention Express, React, or any other technology because they are NOT in the analysis."

### 6. Word Count Instead of Line Count (~10 lines)
**File:** `src/templates/agents-md.ts`
Change "at least 90 lines" → "at least 900 words (approximately 90-110 lines)". LLMs handle word counts more reliably.

### 7. Whitelist-Based Technology Validator (~80 lines)
**File:** `src/output-validator.ts`
Replace blacklist approach (check if mentioned tech is in deps) with whitelist (build set of allowed technologies from analysis, flag ANYTHING not in that set). Also add minimum length validation with retry.

### 8. Length Validation with Retry (~20 lines)
**File:** `src/output-validator.ts`, `src/llm/adapter.ts`
If output is under minimum word/line count, retry with specific expansion instructions.

## Implementation Order

1. Temperature = 0 → `src/llm/client.ts`
2. XML tags + grounding rules → `src/llm/adapter.ts`, `src/templates/agents-md.ts`
3. Fill-in-the-blank template rewrite → `src/templates/agents-md.ts`
4. Few-shot example → `src/templates/agents-md.ts`
5. Word count enforcement → `src/templates/agents-md.ts`
6. Whitelist technology validator → `src/output-validator.ts`
7. Length validation + retry → `src/output-validator.ts`, `src/llm/adapter.ts`
8. Tests → `test/prompting-improvements.test.ts`

## Testing

### Preserved benchmark repos and comparison files at /tmp/final-benchmark/

Verify repos exist:
```bash
ls /tmp/final-benchmark/knip /tmp/final-benchmark/mcp-sdk /tmp/final-benchmark/sanity /tmp/final-benchmark/effect
```

If missing, clone:
```bash
cd /tmp/final-benchmark
git clone --depth 1 https://github.com/webpro-nl/knip.git
git clone --depth 1 https://github.com/modelcontextprotocol/typescript-sdk.git mcp-sdk
git clone --depth 1 https://github.com/sanity-io/sanity.git
git clone --depth 1 https://github.com/Effect-TS/effect.git
```

### After ALL changes, test on the 4 worst repos:

```bash
export ANTHROPIC_API_KEY="<key or read from /Users/mariosiric/Documents/teams-modular-packages/tools/autodocs-engine/experiments/04-ab-comparison/.env>"

# Knip (was 4.4 — React hallucination)
mkdir -p /tmp/final-benchmark/results/knip/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/knip/packages/knip \
  --root /tmp/final-benchmark/knip \
  --format agents.md --output /tmp/final-benchmark/results/knip/engine-v3 --verbose

grep -i "react" /tmp/final-benchmark/results/knip/engine-v3/AGENTS.md && echo "FAIL: React found" || echo "✓ No React"
wc -w /tmp/final-benchmark/results/knip/engine-v3/AGENTS.md  # Should be ≥800 words

# MCP SDK (was 3.6 — Bun hallucination)
mkdir -p /tmp/final-benchmark/results/mcp-sdk/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/mcp-sdk/src \
  --root /tmp/final-benchmark/mcp-sdk \
  --format agents.md --output /tmp/final-benchmark/results/mcp-sdk/engine-v3 --verbose

grep -i "\bbun\b" /tmp/final-benchmark/results/mcp-sdk/engine-v3/AGENTS.md | grep -iv "bundle" && echo "FAIL: Bun found" || echo "✓ No Bun"

# Sanity (was 4.7 — jest.mock in Vitest repo)
mkdir -p /tmp/final-benchmark/results/sanity/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/sanity/packages/sanity \
  --root /tmp/final-benchmark/sanity \
  --format agents.md --output /tmp/final-benchmark/results/sanity/engine-v3 --verbose

grep -i "jest.mock" /tmp/final-benchmark/results/sanity/engine-v3/AGENTS.md && echo "FAIL: jest.mock found" || echo "✓ No jest.mock"
```

### Success criteria:
1. **Zero hallucinated technologies** (React, Bun, GraphQL not in analysis → not in output)
2. **All outputs ≥800 words**
3. **All 222 existing tests pass**
4. **Validator catches and retries any slipthrough**

## API Key

```bash
export ANTHROPIC_API_KEY=$(cat /Users/mariosiric/Documents/teams-modular-packages/tools/autodocs-engine/experiments/04-ab-comparison/.env 2>/dev/null | cut -d= -f2)
```

## What NOT to Change
- Don't modify the analysis pipeline (ast-parser, symbol-graph, dependency-analyzer, etc.)
- Don't change the Wave 5 LLM adapter split structure (src/llm/*.ts)
- Don't remove any existing validation checks — ADD the whitelist check alongside them
- All 222 existing tests must pass
```
