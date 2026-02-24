# Adversarial Review Results: MCP Server Plan v2

## Review Context

Five models (Gemini, Opus, Grok, GPT, GLM) reviewed MCP Server Plan v2. This was the second round — v1 had 7 critical issues, all addressed in v2.

**Overall verdict: 3 APPROVE, 2 REVISE (minor)**

| Model | Verdict | Rating |
|-------|---------|--------|
| Gemini | APPROVE (with one constraint) | 9/10 |
| Opus | APPROVE (with 3 required fixes) | Ready to build |
| Grok | APPROVE (minor adjustments) | Strong, shippable |
| GPT | REVISE (gating fixes) | Directionally excellent |
| GLM | REVISE (fix -uno bug) | Solid after fix |

This is dramatically better than v1 (all 5 returned REVISE). The core architecture is approved.

---

## Remaining Issues (Consensus)

### Issue 1: `-uno` Flag Excludes Untracked Files (4/5 flagged)

`git status --porcelain -uno` excludes untracked files. When a user creates `src/newFile.ts` without `git add`, the cache doesn't invalidate.

**Fix:** Remove `-uno` or use separate checks for tracked changes + untracked files. Cost: ~10ms extra.

### Issue 2: Binary Dirty Flag Misses Changes Within Dirty State (2/5 flagged)

`dirtyFlag = "1"` doesn't distinguish WHICH files are dirty. User modifies file A, cache invalidates. User also modifies file B — cache key is still `HEAD:1`, cache hit with stale data.

**Fix:** Hash the `git status --porcelain` output instead of reducing to binary. Catches different-files-modified.

### Issue 3: `safeToolHandler` Doesn't Catch Async Errors (2/5 flagged)

Missing `async`/`await` means promise rejections bypass the try/catch.

**Fix:** `async function safeToolHandler(fn) { try { return await fn(); } catch ... }`

### Issue 4: Warmup Error Silently Swallowed (3/5 flagged)

`warm(): void { void this.get().catch(() => {}); }` — empty catch produces no diagnostic output.

**Fix:** Log the error to stderr: `"[autodocs] Background analysis failed: {message}. Will retry on first tool call."`

### Issue 5: Event Loop Blocking During AST Parsing (1/5 flagged, but critical)

Gemini uniquely identified: `analyze()` runs synchronous TypeScript AST parsing, which blocks the event loop. Eager warmup means analysis runs while the MCP handshake is processing — potentially blocking the JSON-RPC initialize message.

**Fix:** Either (A) move analysis to Worker thread, (B) yield between pipeline stages with `setImmediate()`, or (C) ensure `server.connect()` completes before `cache.warm()`.

### Issue 6: Non-Git Repos Have No Invalidation (3/5 flagged)

When git isn't available, cache key is always `"no-git:0"` — cache never invalidates.

**Fix:** Time-based TTL fallback (e.g., 10-30s) for non-git environments.

---

## Consensus: No Fundamental Issues Remain

All 5 models agree:
- Tool inventory (8 tools) is correct
- STDIO transport is right for v1
- Eager background init is the right approach
- No LLM calls in tools is correct
- Error handling with typed errors + hints is good
- Monorepo support with list_packages is correct
- queries.ts data access layer is good architecture
- Tool descriptions with "WHEN TO CALL / NOT TO CALL" work well

The remaining issues are implementation details, not architectural problems. The plan is ready to build.

---

## Changes to Apply Before Implementation

| # | Change | Effort | Impact |
|---|--------|--------|--------|
| 1 | Remove `-uno` from git status | 1 line | Fixes untracked file blindness |
| 2 | Hash git status output instead of binary flag | 5 lines | Catches within-dirty-state changes |
| 3 | Add `async`/`await` to `safeToolHandler` | 1 word | Prevents server crashes on async errors |
| 4 | Add warmup error logging | 3 lines | Users see why analysis failed |
| 5 | Warm after `server.connect()`, not before | Reorder 2 lines | Prevents event loop blocking during handshake |
| 6 | Add TTL fallback for non-git repos | 10 lines | Non-git projects get fresh data |
