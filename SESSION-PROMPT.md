# Session Prompt — Post-Grounding Full Benchmark (10 Repos)

Open a new Claude Code session from: `/Users/mariosiric/Documents/autodocs-engine/`

Then paste everything between the triple-backtick block below.

---

```
# autodocs-engine — Full Benchmark After Grounded Prompting

The engine now has grounded prompting (XML tags, whitelist validator, temperature 0, fill-in-the-blank templates). Preliminary tests on 3 repos eliminated all hallucinations and doubled output density. This session runs the full 10-repo benchmark to get the definitive score.

## What's Already Done (DO NOT Regenerate)

Human (B) and Raw LLM (C) files are preserved from the previous benchmark:
- `/tmp/final-benchmark/results/{repo}/raw-llm/AGENTS.md` — all 10 exist
- `/tmp/final-benchmark/results/{repo}/human/` — all 10 exist

DO NOT rewrite these. ONLY regenerate engine output.

## Setup

Verify repos and comparison files exist:
```bash
for repo in sanity medusa ai mcp-sdk knip nitro openstatus documenso effect excalidraw; do
  echo -n "$repo: repo="
  ls -d /tmp/final-benchmark/$repo 2>/dev/null | wc -l | tr -d ' '
  echo -n " raw-llm="
  ls /tmp/final-benchmark/results/$repo/raw-llm/AGENTS.md 2>/dev/null | wc -l | tr -d ' '
  echo -n " human="
  ls /tmp/final-benchmark/results/$repo/human/*.md /tmp/final-benchmark/results/$repo/human/.cursorrules 2>/dev/null | wc -l | tr -d ' '
  echo ""
done
```

If any repos are missing, clone them:
```bash
cd /tmp/final-benchmark
git clone --depth 1 https://github.com/sanity-io/sanity.git 2>/dev/null
git clone --depth 1 https://github.com/medusajs/medusa.git 2>/dev/null
git clone --depth 1 https://github.com/vercel/ai.git 2>/dev/null
git clone --depth 1 https://github.com/modelcontextprotocol/typescript-sdk.git mcp-sdk 2>/dev/null
git clone --depth 1 https://github.com/webpro-nl/knip.git 2>/dev/null
git clone --depth 1 https://github.com/unjs/nitro.git 2>/dev/null
git clone --depth 1 https://github.com/openstatusHQ/openstatus.git 2>/dev/null
git clone --depth 1 https://github.com/documenso/documenso.git 2>/dev/null
git clone --depth 1 https://github.com/Effect-TS/effect.git 2>/dev/null
git clone --depth 1 https://github.com/excalidraw/excalidraw.git 2>/dev/null
```

Set the API key:
```bash
export ANTHROPIC_API_KEY=$(cat /Users/mariosiric/Documents/teams-modular-packages/tools/autodocs-engine/experiments/04-ab-comparison/.env 2>/dev/null | cut -d= -f2)
```

## Step 1: Generate Engine Output for All 10 Repos

Check `docs/BENCHMARK-REPOS.md` for exact analysis targets. Run all 10:

```bash
cd /Users/mariosiric/Documents/autodocs-engine

# 1. Sanity
mkdir -p /tmp/final-benchmark/results/sanity/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/sanity/packages/sanity \
  --root /tmp/final-benchmark/sanity \
  --format agents.md --output /tmp/final-benchmark/results/sanity/engine-v3 --verbose

# 2. Medusa
mkdir -p /tmp/final-benchmark/results/medusa/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/medusa/packages/core/core-flows \
  --root /tmp/final-benchmark/medusa \
  --format agents.md --output /tmp/final-benchmark/results/medusa/engine-v3 --verbose

# 3. Vercel/AI
mkdir -p /tmp/final-benchmark/results/ai/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/ai/packages/ai \
  --root /tmp/final-benchmark/ai \
  --format agents.md --output /tmp/final-benchmark/results/ai/engine-v3 --verbose

# 4. MCP SDK
mkdir -p /tmp/final-benchmark/results/mcp-sdk/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/mcp-sdk/src \
  --root /tmp/final-benchmark/mcp-sdk \
  --format agents.md --output /tmp/final-benchmark/results/mcp-sdk/engine-v3 --verbose

# 5. Knip
mkdir -p /tmp/final-benchmark/results/knip/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/knip/packages/knip \
  --root /tmp/final-benchmark/knip \
  --format agents.md --output /tmp/final-benchmark/results/knip/engine-v3 --verbose

# 6. Nitro
mkdir -p /tmp/final-benchmark/results/nitro/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/nitro/src \
  --root /tmp/final-benchmark/nitro \
  --format agents.md --output /tmp/final-benchmark/results/nitro/engine-v3 --verbose

# 7. OpenStatus
mkdir -p /tmp/final-benchmark/results/openstatus/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/openstatus/apps/web \
  --root /tmp/final-benchmark/openstatus \
  --format agents.md --output /tmp/final-benchmark/results/openstatus/engine-v3 --verbose

# 8. Documenso
mkdir -p /tmp/final-benchmark/results/documenso/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/documenso/apps/web \
  --root /tmp/final-benchmark/documenso \
  --format agents.md --output /tmp/final-benchmark/results/documenso/engine-v3 --verbose

# 9. Effect
mkdir -p /tmp/final-benchmark/results/effect/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/effect/packages/effect \
  --root /tmp/final-benchmark/effect \
  --format agents.md --output /tmp/final-benchmark/results/effect/engine-v3 --verbose

# 10. Excalidraw
mkdir -p /tmp/final-benchmark/results/excalidraw/engine-v3
npx tsx src/bin/autodocs-engine.ts analyze /tmp/final-benchmark/excalidraw/packages/excalidraw \
  --root /tmp/final-benchmark/excalidraw \
  --format agents.md --output /tmp/final-benchmark/results/excalidraw/engine-v3 --verbose
```

Note any failures and continue.

## Step 2: Sanity Checks

```bash
# Hallucination checks
echo "=== Hallucination Checks ==="
grep -i "react" /tmp/final-benchmark/results/knip/engine-v3/AGENTS.md && echo "FAIL: React in knip" || echo "✓ knip: no React"
grep -i "\bbun\b" /tmp/final-benchmark/results/mcp-sdk/engine-v3/AGENTS.md | grep -iv "bundle" && echo "FAIL: Bun in mcp-sdk" || echo "✓ mcp-sdk: no Bun"
grep -i "jest.mock" /tmp/final-benchmark/results/sanity/engine-v3/AGENTS.md && echo "FAIL: jest.mock in sanity" || echo "✓ sanity: no jest.mock"
grep -i "react" /tmp/final-benchmark/results/medusa/engine-v3/AGENTS.md && echo "FAIL: React in medusa" || echo "✓ medusa: no React"
head -1 /tmp/final-benchmark/results/nitro/engine-v3/AGENTS.md | grep -i "src" && echo "FAIL: # src title" || echo "✓ nitro: correct title"

# Word counts (target ≥800)
echo ""
echo "=== Word Counts ==="
for repo in sanity medusa ai mcp-sdk knip nitro openstatus documenso effect excalidraw; do
  words=$(wc -w < /tmp/final-benchmark/results/$repo/engine-v3/AGENTS.md 2>/dev/null || echo "0")
  lines=$(wc -l < /tmp/final-benchmark/results/$repo/engine-v3/AGENTS.md 2>/dev/null || echo "0")
  status=$( [ "$words" -ge 800 ] && echo "✓" || echo "✗" )
  echo "$status $repo: $words words, $lines lines"
done
```

## Step 3: Score All Three Outputs

For each repo, read:
- Engine (new): `/tmp/final-benchmark/results/{repo}/engine-v3/AGENTS.md`
- Human (existing): `/tmp/final-benchmark/results/{repo}/human/{AGENTS.md|CLAUDE.md|.cursorrules}`
- Raw LLM (existing): `/tmp/final-benchmark/results/{repo}/raw-llm/AGENTS.md`

Score on 7 dimensions (1-10):

| # | Dimension | 10/10 Means |
|---|-----------|------------|
| 1 | Commands | Exact, correct, build tool detected |
| 2 | Budget | 80-150 lines / 800-1500 words. No bloat, no sparsity |
| 3 | Signal/Noise | All content AI-actionable. No style rules, file paths, percentages |
| 4 | Workflow | Specific "when X → do Y" with actual commands |
| 5 | Architecture | Capabilities, specific implementations. Not file listings |
| 6 | Domain | Terminology, versions, concepts AI can't infer |
| 7 | Accuracy | Zero errors. Hallucinations are critical failures |

**Scoring guidance:**
- Longer ≠ better. Score by effectiveness, not length.
- Hallucinations → critical accuracy penalty.
- But too sparse is also bad.
- The engine should NO LONGER have hallucinated technologies (validator catches them).

## Step 4: Comparison Report

```markdown
## Post-Grounding Benchmark (engine-v3)

| # | Repo | Engine v1 | Engine v2 | Engine v3 | Human | Raw LLM |
|---|------|-----------|-----------|-----------|-------|---------|
| 1 | sanity | 5.9 | 4.7 | ? | 7.4 | 7.4 |
| 2 | medusa | 5.7 | 8.0 | ? | 7.6 | 6.4 |
| 3 | vercel/ai | 6.7 | 7.6 | ? | 7.6 | 6.4 |
| 4 | MCP SDK | 6.1 | 3.6 | ? | 8.1 | 7.9 |
| 5 | knip | 5.1 | 4.4 | ? | 8.4 | 7.1 |
| 6 | nitro | 5.4 | 6.3 | ? | 7.9 | 7.7 |
| 7 | openstatus | 6.7 | 6.4 | ? | 7.4 | 7.1 |
| 8 | documenso | 5.7 | 4.9 | ? | 6.1 | 6.9 |
| 9 | effect | 5.4 | 5.7 | ? | 7.3 | 5.9 |
| 10 | excalidraw | 6.6 | 6.9 | ? | 5.7 | 6.9 |
| **Avg** | | **5.9** | **5.9** | **?** | **7.4** | **7.0** |

### What Changed (v2 → v3)
- Grounded prompting: XML tags, fill-in-the-blank templates, grounding rules
- Temperature 0
- Whitelist technology validator with retry (catches hallucinations)
- Word count enforcement (800+ words minimum)
- Few-shot example demonstrating grounding

### Key Questions to Answer
1. Did hallucinations disappear across ALL 10 repos? (v2 had hallucinations in 7/10)
2. Is output density now adequate? (v2 was 50-79 lines, target ≥80)
3. What's the new average score?
4. Does the engine beat the raw LLM on any repos?
5. By how much did the accuracy dimension improve? (v2 was 5.5 avg)
6. Is the engine now competitive with human-written files?
```

## Save Results

Save to: `/Users/mariosiric/Documents/autodocs-engine/docs/BENCHMARK-GROUNDED.md`

## Be Honest

If the engine still falls short, say so. If hallucinations reappear on repos we didn't test in the preliminary run (medusa, vercel/ai, openstatus, documenso, effect, excalidraw), note every one. The goal is truth.
```
