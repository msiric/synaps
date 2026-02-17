# Wave 3 Implementation Plan — Closing the Semantic Gap

**Date:** 2026-02-17
**Starting point:** Engine 7.2/10 (V4), Raw LLM 8.4/10. Gap: 1.2 points.
**Root cause confirmed:** The LLM model isn't the bottleneck. Switching from Sonnet to Opus produced marginal improvement (+0.1-0.2). The gap is in the structured analysis DATA — what the engine extracts and serializes for the LLM.
**Goal:** Close the gap to ≤0.3 points by enriching what the engine tells the LLM.

---

## The Specific Data Gaps (Verified by Examining Actual Outputs)

We compared the engine output vs raw LLM output for all 3 benchmark repos. Here are the exact gaps, each traced to what the engine's structured analysis is missing:

### Gap 1: Missing Operational Commands

**What the raw LLM produces:** `db:generate`, `db:migrate`, `db:push`, `db:studio`, `dev:listener`, `dev:worker`, `sync:bulk`, `sync:priority`

**What the engine produces:** `turbo run build`, `turbo run lint`, `bun run format`

**Root cause:** The engine scans the ROOT package.json for commands and the ANALYZED packages' package.json scripts. But operational commands like `db:generate` live in OTHER workspace packages (`packages/db/package.json`). The engine analyzes `apps/web`, `apps/api-server`, `packages/db` — but the command extractor only reads the scripts from the package being analyzed, not related workspace packages.

**Verified data:** midday-v1's root has `turbo run build/dev/lint`, `biome check .` for lint. `packages/db` has `db:generate`, `db:migrate`, `db:push`, `db:studio`. `apps/api` has `db:migrate`, `bun test`, `dev` (bun watch). None of the db commands appear in the engine output.

### Gap 2: Generic Workflow Rules

**What the raw LLM produces:** "After modifying `packages/db/src/schema.ts`, run `bun run db:generate` to create a migration, then `bun run db:migrate` to apply it."

**What the engine produces:** "After modifying Drizzle schema → regenerate types and run migrations" (no specific command)

**Root cause:** The engine detects Drizzle as an ORM (via ecosystem detector) but doesn't generate the specific migration workflow command. It knows Drizzle exists but doesn't know WHICH command runs migrations because it doesn't scan `packages/db` scripts for `db:*` patterns.

### Gap 3: Wrong Role Classification

**What the raw LLM says:** "apps/api: Bun HTTP server exposing oRPC endpoints at `/rpc` (internal) and REST at `/v1/*` (OpenAPI)"

**What the engine says:** "Utility library" or "Package"

**Root cause:** The role inferrer classifies by export patterns (hooks → hooks, components → react-components). An API server that exports nothing from its barrel (it's an app, not a library) gets "unknown" or "utility library." The engine doesn't check for HTTP server signals (Hono imports, route definitions, server.listen).

### Gap 4: Percentage Stats as Noise

**What the engine produces:** "42% of files use try-catch", "99% of exports are named"

**What the raw LLM produces:** None of this. Instead: actionable rules like "Use named exports" without the percentage.

**Root cause:** Convention detectors output confidence metrics. The serialization includes them verbatim. The template says to omit low-impact content but the LLM sometimes includes percentages anyway.

### Gap 5: Shallow Architecture Descriptions

**What the raw LLM produces:** "5 pluggable router implementations: SmartRouter (default, combines RegExpRouter + TrieRouter), RegExpRouter, TrieRouter, PatternRouter, LinearRouter"

**What the engine produces:** "Multiple router strategies (RegExpRouter, TrieRouter) for different performance profiles"

**Root cause:** The engine extracts export NAMES (RegExpRouter, TrieRouter, etc.) but the serialization doesn't highlight them architecturally. The architecture section describes directories by purpose, not by the specific implementations they contain. The export names ARE in the structured analysis — they're just buried in the flat publicAPI list, not organized by architectural significance.

---

## The 5 Improvements

### W3-1: Workspace-Wide Command Scanning [HIGHEST IMPACT]

**Problem:** The engine only reads scripts from analyzed packages. Operational commands (db:migrate, sync:bulk) in other workspace packages are invisible.

**Fix:** When `--root` is provided, scan ALL package.json files in the workspace (not just analyzed ones) for commands matching operational patterns.

**New logic in `command-extractor.ts`:**

```typescript
function scanWorkspaceCommands(rootDir: string): Command[] {
  // Find all package.json files in the workspace
  const packageJsonPaths = glob.sync('**/package.json', {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**']
  });

  // For each, extract scripts matching operational patterns
  const operationalPatterns = [
    // Database
    /^db[:\-]/, /migrate/, /generate/, /push/, /studio/, /seed/,
    // Workers/queues
    /^dev[:\-](worker|listener|queue)/, /^sync[:\-]/, /^worker/,
    // Deployment
    /^deploy/, /^release/,
    // Code generation
    /^generate/, /^codegen/,
    // Email
    /^email/,
  ];

  // Collect unique commands, group by category
  // Return as additional commands in CommandSet.other[]
}
```

**Integration:** Call from pipeline when rootDir is set. Merge results into cross-package `rootCommands`. The serialization should include these under a "Workspace Commands" section.

**Expected result for midday-v1:**
```
## Workspace Commands
| Command | Package | Description |
|---------|---------|-------------|
| `bun run db:generate` | packages/db | Generate Drizzle migration files |
| `bun run db:migrate` | packages/db | Run database migrations |
| `bun run db:push` | packages/db | Push schema changes |
| `bun run db:studio` | packages/db | Open Drizzle Studio |
| `bun test` | apps/api | Run API tests |
| `bun run --watch src/index.ts` | apps/api | Dev with hot reload |
```

**Effort:** ~120 lines (command-extractor extension + pipeline integration)

### W3-2: Technology-Aware Workflow Rule Templates [HIGH IMPACT]

**Problem:** Workflow rules are generic: "After modifying schema → run migrations." The engine knows Drizzle is present (ecosystem detector) and now will know the exact db:generate command (W3-1), but doesn't compose them into a specific rule.

**Fix:** After ecosystem detection AND command scanning, compose technology-specific workflow rules by matching detected technologies to discovered commands.

**New file: `src/workflow-rules.ts`**

```typescript
interface WorkflowRule {
  trigger: string;      // "After modifying database schema files"
  action: string;       // "run `bun run db:generate` then `bun run db:migrate`"
  source: string;       // "Drizzle ORM detected + db:generate/db:migrate commands found"
  impact: "high";       // All workflow rules are high-impact
}

function generateWorkflowRules(
  configAnalysis: ConfigAnalysis,
  conventions: Convention[],
  commands: CommandSet,
  workspaceCommands: Command[],
  dependencyInsights: DependencyInsights,
): WorkflowRule[]
```

**Rule templates:**

| Detection | Trigger | Action Template |
|-----------|---------|----------------|
| Drizzle + db:generate + db:migrate scripts | "After modifying schema files" | "Run `{db:generate command}` to create migration, then `{db:migrate command}` to apply" |
| Prisma + prisma generate/migrate scripts | "After modifying schema.prisma" | "Run `{prisma generate}` then `{prisma migrate dev}`" |
| GraphQL + codegen/generate:interfaces script | "After modifying .graphql files" | "Run `{codegen command}` to regenerate types" |
| Turbo monorepo | "Before running tests" | "Run `{build command}` first — tests depend on built output" |
| Next.js + ISR pages | "After adding new pages" | "Set `revalidate` export for ISR timing" |
| Test framework detected | "After modifying source files" | "Run `{test command}` to verify changes" |
| Biome detected (not ESLint) | "For linting and formatting" | "Use `{lint command}` (Biome), not ESLint/Prettier" |
| Docker/Railway config + standalone output | "For deployment" | "Don't change `output: 'standalone'` in next.config" |

**Integration:** Run after ecosystem detection and command scanning in pipeline. Add `workflowRules: WorkflowRule[]` to PackageAnalysis. The serialization includes these in the Workflow Rules section, REPLACING generic conventions-based workflow rules with these specific ones.

**Expected result for midday-v1:**
```
## Workflow Rules
- After modifying `packages/db/src/schema.ts` → run `bun run db:generate` then `bun run db:migrate`
- Run tasks via `turbo run <task>`, not direct `bun run <script>`
- Linting and formatting use Biome (`biome check .`), not ESLint/Prettier
- Before running tests → ensure dependencies are built (`turbo run build`)
```

**Effort:** ~180 lines (new module + pipeline integration)

### W3-3: Role Classification Fix [MEDIUM IMPACT]

**Problem:** API servers and apps classified as "utility library" or "unknown" because they don't export from a barrel file.

**Fix:** Add HTTP/app signals to role classification:

```typescript
// In role-inferrer.ts, add these checks BEFORE the default "library" classification:

// Check for HTTP server frameworks
const httpFrameworks = ['hono', 'express', 'fastify', 'koa', 'nest', '@hono/node-server'];
const hasHttpFramework = dependencyInsights.frameworks.some(f =>
  httpFrameworks.includes(f.name)
);

// Check for Next.js / app framework
const appFrameworks = ['next', 'nuxt', 'remix', 'astro', 'svelte'];
const hasAppFramework = dependencyInsights.frameworks.some(f =>
  appFrameworks.includes(f.name)
);

// Check for route/handler patterns in exports
const hasRoutePatterns = publicAPI.some(e =>
  /route|handler|controller|middleware|endpoint|procedure/.test(e.name.toLowerCase())
);

// Check bin field
const hasBin = configAnalysis?.taskRunner || packageJson.bin;

// Classify
if (hasAppFramework) return "web-application";  // Next.js, Nuxt, etc.
if (hasHttpFramework || hasRoutePatterns) return "api-server";  // Express, Hono, etc.
if (hasBin) return "cli";
```

Also add new role types: `"web-application"` and `"api-server"` to the `packageType` union.

**Update `whenToUse` generation:** For `api-server` → "Touch this package when adding API endpoints, routes, or middleware." For `web-application` → "Touch this package when adding pages, components, or client-side features."

**Effort:** ~60 lines (role-inferrer.ts modification)

### W3-4: Remove Percentage Stats / Improve Serialization [MEDIUM IMPACT]

**Problem:** The serialization includes "42% of files use try-catch", "99% of exports are named." These waste instruction budget and the raw LLM never includes them.

**Fix:** Two changes:

**A) Strip percentage stats from convention serialization.** In `llm-adapter.ts`, when serializing conventions, don't include the confidence metrics in the text. Instead of "Use named exports (85 of 86 exports, 99%)" → "Use named exports exclusively."

**B) For architecture, surface specific implementation names.** Instead of just listing directories, include the NAMES of key exports per directory. The data is already in `architecture.directories[].exports`. Format it as:

```
- **Routing**: SmartRouter (default), RegExpRouter, TrieRouter, PatternRouter, LinearRouter (see `src/router/`)
- **Middleware**: 34 built-in modules: cors, compress, jwt, cache, csrf, etag, timeout, ... (see `src/middleware/`)
```

Instead of:
```
- **src/router/**: Router implementations (5 files)
- **src/middleware/**: Middleware modules (34 files)
```

**Effort:** ~80 lines (llm-adapter.ts serialization changes)

### W3-5: Use Opus as Default Model [LOW EFFORT, MARGINAL IMPACT]

**Problem:** Opus produces slightly better output than Sonnet (cleaner language, better API coverage).

**Fix:** Change default model in config.ts from `claude-sonnet-4-20250514` to `claude-opus-4-20250514`. Users can still override via `AUTODOCS_LLM_MODEL` env var.

**Effort:** 1 line change.

**Note:** This is worth doing but marginal — the Opus comparison showed +0.1-0.2 improvement. The real gains come from W3-1 through W3-4.

---

## Implementation Order

| Step | What | Files | Depends On | Est. Lines |
|------|------|-------|-----------|------------|
| 1 | Workspace-wide command scanning (W3-1) | command-extractor.ts, pipeline.ts | — | ~120 |
| 2 | Workflow rule templates (W3-2) | new: workflow-rules.ts, pipeline.ts, types.ts | W3-1 (needs workspace commands) | ~180 |
| 3 | Serialize workflow rules + workspace commands | llm-adapter.ts, templates/agents-md.ts | W3-1, W3-2 | ~60 |
| 4 | Role classification fix (W3-3) | role-inferrer.ts, types.ts | — | ~60 |
| 5 | Remove percentage stats + richer architecture serialization (W3-4) | llm-adapter.ts | — | ~80 |
| 6 | Default model to Opus (W3-5) | config.ts | — | ~1 |
| 7 | Tests | test/wave3-improvements.test.ts | All above | ~150 |
| **Total** | | | | **~651** |

---

## Testing

### Validation Criteria

1. **midday-v1 commands:** Output includes `db:generate`, `db:migrate`, `db:push`, `db:studio` from workspace scanning
2. **midday-v1 workflow:** Output says "After modifying schema → run `bun run db:generate` then `bun run db:migrate`" (specific command, not generic)
3. **midday-v1 role:** API server package classified as `api-server`, not "utility library"
4. **hono architecture:** Mentions specific router names (SmartRouter, RegExpRouter, TrieRouter, PatternRouter, LinearRouter)
5. **No percentage stats:** Output doesn't contain patterns like "42% of files" or "99% of exports"
6. **All 162 existing tests pass**

### Test Commands

```bash
cd /Users/mariosiric/Documents/autodocs-engine

# midday-v1 (the critical test)
ANTHROPIC_API_KEY=<key> AUTODOCS_LLM_MODEL="claude-opus-4-20250514" \
  npx tsx src/bin/autodocs-engine.ts analyze \
  /tmp/benchmark-v3/midday-v1/apps/api-server \
  /tmp/benchmark-v3/midday-v1/apps/web \
  /tmp/benchmark-v3/midday-v1/packages/db \
  --root /tmp/benchmark-v3/midday-v1 \
  --format agents.md --hierarchical \
  --output /tmp/wave3-test/midday --verbose

# Verify: grep for db commands and specific workflow rules
grep -i "db:generate\|db:migrate\|db:push\|db:studio" /tmp/wave3-test/midday/AGENTS.md
grep -i "42%\|99%\|percentage\|of files\|of exports" /tmp/wave3-test/midday/AGENTS.md  # should return NOTHING

# hono
ANTHROPIC_API_KEY=<key> AUTODOCS_LLM_MODEL="claude-opus-4-20250514" \
  npx tsx src/bin/autodocs-engine.ts analyze /tmp/benchmark-v3/hono \
  --format agents.md --output /tmp/wave3-test/hono --verbose

# Verify: grep for specific router names
grep -i "SmartRouter\|RegExpRouter\|TrieRouter\|PatternRouter\|LinearRouter" /tmp/wave3-test/hono/AGENTS.md
```

---

## Expected Impact

| Gap | Before (V4) | After (W3) | Evidence |
|-----|-------------|------------|----------|
| Missing operational commands | 0 db/worker commands | 6+ workspace commands | W3-1 scans all package.json |
| Generic workflow rules | "run migrations" | "run `db:generate` then `db:migrate`" | W3-2 templates + W3-1 commands |
| Wrong role ("utility library") | API server misclassified | "api-server" with correct whenToUse | W3-3 HTTP detection |
| Percentage noise | "42% of files" | No percentages | W3-4 strips stats |
| Shallow architecture | "tree-based routing" | "SmartRouter, RegExpRouter, TrieRouter..." | W3-4 names exports |

**Target score improvement: Engine from 7.2 → 8.0+ (closing gap to ≤0.4 with raw LLM)**

The workspace command scanning (W3-1) and workflow templates (W3-2) together address the two highest-scoring dimensions where the raw LLM leads: Commands (raw LLM: 9, engine: 7-8) and Workflow Rules (raw LLM: 8, engine: 5-6). Gaining 1-2 points on these dimensions alone would add ~0.3-0.6 to the average score.
