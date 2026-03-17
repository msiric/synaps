# Efficiency Measurement — Implementation Plan

## Context

synaps (v0.8.1) serves 13 MCP tools for AI coding assistants. The tools work — 83% diagnose accuracy on real bug-fix commits, 565 tests, 0 type errors. But we can't answer the fundamental question: **do the tools actually save tokens and time?**

Research reference: arxiv 2601.20404 found focused AGENTS.md reduces runtime by 29% and tokens by 17%. Our MCP tools are even more focused (task-specific queries vs static file). We need data to verify this.

## What Exists Today

`withTelemetry` in `server.ts` (lines 42-66) wraps every tool call:
- Logs tool name, latency (ms), cache hit/miss to stderr when `--verbose` or `AUTODOCS_DEBUG=1`
- Appends freshness metadata to every tool response

**What's missing:** token estimates per call, session-level aggregation, shutdown summary, persistent event log.

## Design

### Two Output Channels

1. **Session summary → stderr** (always on shutdown): quick human-readable overview
2. **Per-event JSONL → `.autodocs/telemetry.jsonl`** (opt-in via `AUTODOCS_TELEMETRY=1`): machine-readable event log for historical analysis

### Token Estimation

Characters ÷ 3.5 ≈ Claude tokens (standard approximation for English text).
- **Input tokens**: `Math.round(JSON.stringify(args).length / 3.5)`
- **Output tokens**: `Math.round(result.content.map(c => c.text).join('').length / 3.5)`

These are estimates, not exact counts. Sufficient for answering "is tool X returning 5K tokens when 500 would suffice?"

### Session State

Plain object (not a class) created once in `createAutodocsServer`:

```typescript
const session = {
  startTime: Date.now(),
  calls: new Map<string, number>(),
  totalInputTokens: 0,
  totalOutputTokens: 0,
  errors: 0,
};
```

Updated inside `withTelemetry` on every tool call. Returned from `createAutodocsServer` so `serve.ts` can access it for shutdown reporting.

### Shutdown Summary Format

Printed to stderr on SIGTERM/SIGINT (always — not gated behind `--verbose`):

```
[autodocs] Session: 14 calls, 2.3K input tokens, 4.1K output tokens, 42s
[autodocs] Tools: plan_change (4), get_test_info (3), diagnose (2), get_commands (1)
```

### JSONL Event Format

Per-call event (opt-in):
```json
{"ts":"2026-02-25T12:00:00Z","tool":"diagnose","latencyMs":45,"cache":"hit","inputTokens":120,"outputTokens":890,"error":false}
```

Session summary event (on shutdown):
```json
{"ts":"2026-02-25T12:05:00Z","type":"session","durationMs":300000,"totalCalls":14,"inputTokens":2340,"outputTokens":4120,"tools":{"plan_change":4,"diagnose":2}}
```

No PII, no code content, no file paths. Just tool names, counts, sizes, timestamps.

## Implementation Steps

### Step 1: Session state + token tracking in `server.ts` (~25 lines)

- Create `session` object at `createAutodocsServer` scope
- In `withTelemetry`: compute input/output token estimates, increment session.calls map and token totals
- Update return type: `{ server, cache, session }`

### Step 2: JSONL file logging in `server.ts` (~20 lines)

- Check `options.telemetry` or `AUTODOCS_TELEMETRY=1`
- If enabled: `mkdirSync(".autodocs", { recursive: true })` on first write
- `appendFileSync` per-call JSON line to `.autodocs/telemetry.jsonl`

### Step 3: Shutdown summary in `serve.ts` (~15 lines)

- Access `session` from `createAutodocsServer` return value
- In SIGTERM/SIGINT handlers: format session summary, write to stderr
- If telemetry enabled: append session summary line to JSONL

### Step 4: `--telemetry` CLI flag (~5 lines)

- Parse `--telemetry` in `synaps.ts`
- Pass to `runServe` → `createAutodocsServer` options

### Step 5: Tests (~30 lines)

- Integration test: start server, make calls, kill it, verify stderr contains "Session:" summary
- Unit test: token estimation produces reasonable numbers

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `src/mcp/server.ts` | Session state, token tracking, JSONL logging, return session | +45 |
| `src/bin/serve.ts` | Shutdown summary, telemetry passthrough | +20 |
| `src/bin/synaps.ts` | Parse --telemetry flag | +5 |
| `test/mcp/integration.test.ts` | Verify session summary on stderr | +10 |

**Total: ~80 lines**

## What This Does NOT Do

- No LLM token counting (character-based estimates only)
- No comparison benchmark (with-MCP vs without-MCP A/B test)
- No dashboard, UI, or external analytics
- No user tracking or personally identifiable information
- No auto-upload — all data stays local

## Open Questions for Review

1. Should the session summary print on every shutdown, or only when at least 1 tool was called?
2. Should the JSONL file go in `.autodocs/telemetry.jsonl` (project dir) or `~/.autodocs/telemetry.jsonl` (home dir)?
3. Is chars/3.5 a good enough token estimate, or should we use a tiktoken-compatible library?
4. Should we also track the tool description token overhead (each tool's schema/description is sent to the LLM)?
5. Is there value in tracking which tools are called together in sequence (call patterns)?
