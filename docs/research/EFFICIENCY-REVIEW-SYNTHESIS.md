# Efficiency Measurement — Review Synthesis

**Models:** Gemini, Opus, Grok, GPT-4, MiniMax/GLM
**Date:** 2026-02-25

## Unanimous (All 5 Models)

### 1. Shutdown summary won't fire on normal MCP exit path (P0)

SIGTERM/SIGINT handlers never fire when Claude Code closes — it closes stdin, the event loop drains, process exits. **Use `process.on('exit')` as the primary hook.** Only synchronous operations allowed (which is compatible with `appendFileSync` and `process.stderr.write`).

### 2. Output token estimation unsafe for non-text content (P0)

`result.content.map(c => c.text)` produces `"undefined"` for non-text blocks. All 13 tools return text today, but this is a latent crash/corruption bug. **Filter to `type === 'text'` blocks before measuring.**

### 3. File writes must be wrapped in try/catch (P0)

`appendFileSync`/`mkdirSync` will throw in CI, read-only filesystems, or disk-full scenarios. **Wrap in try/catch, warn once, disable file telemetry on failure.** Never crash the server for telemetry.

### 4. Gate summary on `calls.size > 0` (P1 — all 5)

Empty sessions (0 calls) should not print. Users who restart Claude Code frequently would see noise.

### 5. Map serialization produces `{}` (P1 — all 5)

`JSON.stringify(new Map())` → `"{}"`. **Use `Object.fromEntries(session.calls)` when serializing.**

### 6. Add schema version `"v": 1` to all events (P1 — all 5)

Future format changes need a discriminator. Three bytes per line, high value.

### 7. Telemetry measures cost, not savings — reframe the goal (P1 — all 5)

The implementation answers "what overhead do tools add?" not "do tools save tokens?" The marketing claim requires a separate A/B benchmark. **Reframe as overhead/usage measurement. Don't overclaim.**

## Strong Consensus (4-5 Models)

### 8. File location: home dir preferred over project dir (4/5)

Project dir risks: git pollution, CI write failures, concurrent session corruption. **Write to `~/.autodocs/telemetry/` with project identifier.** Avoids all repo-related issues.

### 9. Add `"type": "call"` to per-call events (4/5)

Session events have `"type": "session"` but per-call events lack a type field. Makes parsing unambiguous.

### 10. Add session/run identifier to events (4/5)

Without `sessionId` or `runId`, concurrent sessions produce unmergeable data. Use `${Date.now()}-${process.pid}` or `crypto.randomUUID()`.

### 11. Token estimation: keep chars/3.5, label as estimates (4/5)

Don't add tiktoken dependency (3MB+ WASM). The approximation is ±20%, sufficient for "is tool X bloated?" Label fields as `estInputTokens`/`estOutputTokens`.

### 12. Handle uncaughtException/unhandledRejection (4/5)

These bypass SIGTERM/SIGINT. Add handlers that write summary before crashing.

## Split Decision

### 13. Separate divisors for input vs output (3/5 recommend, 2/5 say single is fine)

JSON input is denser (~3.0 chars/token), markdown output is sparser (~3.7-4.0). Three models recommend separate divisors; two say single 3.5 is fine for v1.

**Decision:** Keep single 3.5 for v1, label as estimates. The purpose is order-of-magnitude, not precision.

### 14. Track tool call sequences (3/5 recommend, 2/5 say timestamps suffice)

`diagnose → plan_change` suggests success; `diagnose → diagnose → diagnose` suggests confusion. Three models recommend explicit sequence tracking; two say JSONL timestamps are sufficient for offline reconstruction.

**Decision:** Add `seq` counter (incrementing integer per session). Cheap, enables sequence analysis without complex state.

## Revised Implementation Parameters

| Parameter | Original Plan | Post-Review Revision |
|-----------|--------------|---------------------|
| Shutdown hook | SIGTERM/SIGINT handlers | **`process.on('exit')` primary** + signals as secondary |
| Output token extraction | `c.text` direct | **Filter `type === 'text'` blocks** |
| File I/O | Raw appendFileSync | **try/catch + warn once + disable on failure** |
| Summary gate | Always print | **Only when `calls.size > 0`** |
| Map serialization | Direct JSON.stringify | **`Object.fromEntries()`** |
| Schema version | None | **`"v": 1` on all events** |
| Event type field | Missing on per-call | **`"type": "call"` added** |
| Session identifier | None | **`runId: ${timestamp}-${pid}`** |
| File location | `.autodocs/telemetry.jsonl` | **`~/.autodocs/telemetry/` with project hash** |
| Token field names | inputTokens/outputTokens | **estInputTokens/estOutputTokens** |
| Goal framing | "Do tools save tokens?" | **"Tool overhead and usage patterns"** |

## Estimated Lines After All Revisions: ~100

(+20 over original 80-line estimate, mostly error handling and content filtering)
