# Next Steps — Post-Benchmark Action Items

## Context

After benchmarking across 6 repos (expanding to 9), we have clear, data-backed direction. These are the actionable tasks in priority order.

## Benchmark Data Summary (6 repos, expanding to 9)

| Task Type | Average A-B Delta | Repos | Signal |
|-----------|:---:|:---:|---|
| Commands | +10.5% | 6 | Positive — never hurts, helps on complex repos |
| Architecture | +12.5% | 3 | Positive — helps on complex repos, neutral on simple |
| Patterns | **-18.2%** | 6 | **Negative — actively hurts on 3/6 repos** |

---

## Priority 1: Remove Pattern Sections from Default AGENTS.md Output

**Why:** Patterns hurt performance on 3/6 repos (-22% to -59%). The AI infers patterns from sibling files better than from AGENTS.md instructions. Adding pattern text creates token noise that competes with useful content.

**What to change in `src/deterministic-formatter.ts`:**
- Remove from default output: convention DO/DON'T lists, contribution pattern recipes
- Keep in default output: commands, architecture, workflow rules, change impact, team knowledge
- Add `--full-output` flag to restore all sections for users who want them
- Reduce MAX_RULES from 120 to 60

**Estimated effort:** 2-3 hours
**Validation:** Re-run benchmark on 3 repos, verify A-B delta improves (pattern noise removed)

---

## Priority 2: Build MCP Server Benchmark (Direct Tool Response Comparison)

**Why:** We proved the MCP server is accurate (22 ground-truth tests), but haven't measured whether tool responses improve AI coding outcomes compared to no tool responses.

**What to build:**
- New benchmark mode that tests MCP tool responses directly
- Two conditions per task:
  - **A (with tool response):** Task prompt + injected MCP tool response
  - **B (without tool response):** Task prompt + basic project context only
- Score the AI's answer for correctness (command accuracy, directory placement, impact identification)
- Compare A-B delta per tool to measure marginal value of each MCP tool

**Task types to test:**
- Command tasks: inject `get_commands` response → does AI use correct command?
- Architecture tasks: inject `get_architecture` response → does AI pick correct directory?
- Impact tasks: inject `analyze_impact` response → does AI identify correct dependents?

**Estimated effort:** 1-2 days (reuse existing benchmark infrastructure)
**Expected result:** Per-tool marginal value data. E.g., "get_commands tool response improves command accuracy by +25%"

---

## Priority 3: Improve Command Detection for Complex Repos

**Why:** Commands showed +37% on knip but +0% on simple repos. The value is in non-obvious, project-specific scripts — not standard `npm test`.

**What to improve:**
- Detect workspace-level commands (turbo tasks, nx run-many) more prominently
- Highlight non-standard scripts (db:migrate, codegen, deploy) over standard ones
- Add version-specific command guidance ("React 19: use `use()` hook, not `useContext()`")

**Estimated effort:** 1 day
**Validation:** Re-benchmark on sanity (turbo monorepo) and knip, verify command delta increases

---

## Priority 4: Expand Architecture Detection Coverage

**Why:** Only 3/6 repos generated architecture tasks. Those that did showed +37.5% delta. More coverage = more value.

**What to improve:**
- Lower the minimum directory threshold (currently requires 3+ directories with known purposes)
- Add more directory purpose mappings (currently limited set in ARCHITECTURE_FEATURE_MAP)
- Generate architecture tasks for monorepo root-level structure (which package does what?)

**Estimated effort:** 1 day
**Validation:** Re-benchmark on repos that previously had 0 architecture tasks

---

## Priority 5: Publish v0.5.0 to npm

**Why:** The engine is feature-complete, tested, and benchmarked. Delaying further adds features without user validation.

**What to do:**
1. `npm publish` — package is configured and ready
2. Write blog post: "We benchmarked our own product. Commands +10%, Architecture +12%, Patterns -18%. Here's what we learned."
3. Post to dev.to, agents.md community, X/Twitter
4. Target: 50 developers run `npx autodocs-engine init` in week 1

**Estimated effort:** 1 day (publish) + 1 day (blog post)

---

## Priority 6: Iterate Based on User Feedback

**Why:** 50 user conversations > 50 features. We don't know what real users want until they tell us.

**What to do:**
- Monitor MCP telemetry logs (which tools get called?)
- Talk to 5 users directly: "What was useful? What was useless? What's missing?"
- Track: do users configure MCP, or do they use static AGENTS.md? Or neither?

---

## Deferred (after user validation)

- HTTP transport for MCP server
- Disk cache for analysis persistence across restarts
- Multi-language support (Python, Go)
- Cross-repo portfolio analysis
- AI correction learning (self-improving from developer fixes)
