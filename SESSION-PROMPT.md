# Session Prompt — Wave 3 Improvements

Open a new Claude Code session from: `/Users/mariosiric/Documents/autodocs-engine/`

Then paste everything between the triple-backtick block below.

---

```
# autodocs-engine — Wave 3: Closing the Semantic Gap

The engine scores 7.2/10, 1.2 points behind a raw LLM (8.4/10). We confirmed that switching LLM models (Sonnet → Opus) only gains +0.1-0.2. The real bottleneck is the DATA the engine feeds the LLM. This session enriches the structured analysis to close that gap.

## Before You Code

Read the complete Wave 3 plan:
`docs/WAVE3-PLAN.md`

It contains the 5 improvements with exact algorithms, data sources, expected outputs, and implementation order. Read the entire document.

Also verify test repos exist:
```bash
ls /tmp/benchmark-v3/midday-v1/package.json /tmp/benchmark-v3/hono/package.json /tmp/benchmark-v3/inversify/package.json
```
If missing, clone:
```bash
git clone --depth 1 https://github.com/midday-ai/v1.git /tmp/benchmark-v3/midday-v1
git clone --depth 1 https://github.com/honojs/hono.git /tmp/benchmark-v3/hono
git clone --depth 1 https://github.com/inversify/monorepo.git /tmp/benchmark-v3/inversify
```

## The 5 Improvements (Priority Order)

### W3-1: Workspace-Wide Command Scanning [HIGHEST]
Scan ALL package.json files in the workspace for operational commands (db:migrate, sync:bulk, dev:worker). Currently the engine only reads scripts from analyzed packages. Midday's `packages/db` has `db:generate`, `db:migrate`, `db:push`, `db:studio` — all invisible to the current engine.

**Change:** `src/command-extractor.ts` — add `scanWorkspaceCommands(rootDir)` that finds all package.json files and extracts scripts matching operational patterns (db:*, sync:*, worker*, deploy*, generate*).

### W3-2: Technology-Aware Workflow Rule Templates [HIGH]
Compose specific workflow rules from detected technology + discovered commands. Instead of "run migrations" → "run `bun run db:generate` then `bun run db:migrate`".

**Change:** New `src/workflow-rules.ts` — matches detected tech (Drizzle, Prisma, GraphQL, Turbo, Biome, Next.js) against actual commands found by W3-1 to generate specific "when X → do Y" rules.

### W3-3: Role Classification Fix [MEDIUM]
API servers classified as "utility library" because they have no barrel exports. Fix: detect HTTP framework imports (hono, express, fastify), Next.js/Nuxt framework, and route handler patterns.

**Change:** `src/role-inferrer.ts` — add HTTP/app framework checks. Add new types `"web-application"` and `"api-server"` to packageType union.

### W3-4: Remove Percentage Stats + Richer Architecture [MEDIUM]
Strip "42% of files use try-catch" noise. Instead, surface specific implementation names in architecture: "SmartRouter, RegExpRouter, TrieRouter, PatternRouter, LinearRouter" instead of "multiple router strategies."

**Change:** `src/llm-adapter.ts` — strip confidence percentages from convention serialization. Format directory exports as named implementations, not just file counts.

### W3-5: Default Model to Opus [LOW]
One-line change in `src/config.ts`. Already confirmed env var override works (`AUTODOCS_LLM_MODEL`).

## Implementation Order

1. Types: Add WorkflowRule, extend CommandSet, add new packageType values → `src/types.ts`
2. Workspace command scanning → `src/command-extractor.ts`
3. Workflow rule templates → new `src/workflow-rules.ts`
4. Serialize workspace commands + workflow rules → `src/llm-adapter.ts`, `src/templates/agents-md.ts`
5. Role classification fix → `src/role-inferrer.ts`
6. Remove percentage stats + richer architecture serialization → `src/llm-adapter.ts`
7. Default model to Opus → `src/config.ts`
8. Pipeline integration → `src/pipeline.ts`
9. Tests → `test/wave3-improvements.test.ts`

## Testing

### Critical Validation (midday-v1)
```bash
ANTHROPIC_API_KEY=<key> AUTODOCS_LLM_MODEL="claude-opus-4-20250514" \
  npx tsx src/bin/autodocs-engine.ts analyze \
  /tmp/benchmark-v3/midday-v1/apps/api-server \
  /tmp/benchmark-v3/midday-v1/apps/web \
  /tmp/benchmark-v3/midday-v1/packages/db \
  --root /tmp/benchmark-v3/midday-v1 \
  --format agents.md --hierarchical \
  --output /tmp/wave3-test/midday --verbose
```

**MUST verify:**
1. `grep "db:generate\|db:migrate" /tmp/wave3-test/midday/AGENTS.md` → finds both commands
2. Workflow rules include SPECIFIC migration command, not generic "run migrations"
3. API server package classified as `api-server`, not "utility library"
4. `grep "42%\|99%\|of files\|of exports" /tmp/wave3-test/midday/AGENTS.md` → returns NOTHING (no percentage stats)

### Hono validation
```bash
ANTHROPIC_API_KEY=<key> AUTODOCS_LLM_MODEL="claude-opus-4-20250514" \
  npx tsx src/bin/autodocs-engine.ts analyze /tmp/benchmark-v3/hono \
  --format agents.md --output /tmp/wave3-test/hono --verbose
```

**MUST verify:**
1. Architecture mentions specific router names (SmartRouter, RegExpRouter, TrieRouter)
2. No percentage stats in output

### All tests pass
```bash
npm test  # All 162 existing tests must pass
```

## API Key

Set as environment variable:
```bash
export ANTHROPIC_API_KEY="<your key>"
```

Or if the old location exists:
```bash
export ANTHROPIC_API_KEY=$(cat /Users/mariosiric/Documents/teams-modular-packages/tools/autodocs-engine/experiments/04-ab-comparison/.env 2>/dev/null | cut -d= -f2)
```

## What NOT to Change
- Don't modify Wave 1/2 modules (config-analyzer, output-validator, pattern-fingerprinter, ecosystem detectors)
- Don't change the hierarchical output mode
- Don't change the budget validator logic
- All 162 existing tests must pass

## What to Ask Me
- If workspace command scanning finds too many scripts (need filtering guidance)
- If workflow rule templates need additional technology mappings
- If the role classification conflicts with existing heuristics
```
