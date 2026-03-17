# Adversarial Review: Efficiency Measurement Plan

## Instructions for Reviewer

You are reviewing an implementation plan for adding lightweight telemetry to an MCP server (Model Context Protocol). The server provides 13 codebase intelligence tools to AI coding assistants like Claude Code.

**Your role:** Find flaws, missing edge cases, bad assumptions, and security/privacy risks. Be specific — cite line numbers or design choices you disagree with. Propose concrete alternatives.

**Severity levels:**
- **P0 (must fix before shipping):** Security issues, data leaks, crashes, fundamentally wrong approach
- **P1 (should fix):** Missing edge cases, questionable defaults, unclear behavior
- **P2 (nice to have):** Optimization opportunities, future-proofing, style preferences

## Context

**Project:** synaps — TypeScript codebase intelligence engine serving 13 MCP tools via Model Context Protocol. Published on npm (v0.8.1). Tools include: get_commands, get_architecture, get_conventions, diagnose (root cause analysis), plan_change (blast radius), etc.

**Current state:** 565 tests, 0 type errors, 83% accuracy on real bug-fix commit validation. MCP server communicates via JSON-RPC over stdio.

**Existing telemetry:** `withTelemetry` wrapper logs tool name, latency, cache hit/miss to stderr when `--verbose`. No token tracking, no session aggregation, no persistent logging.

**Goal:** Answer "do these tools save tokens and time?" with data. Two channels:
1. Session summary → stderr (always on shutdown)
2. Per-event JSONL → file (opt-in via env var)

## The Plan

### Token Estimation
```typescript
const inputTokens = Math.round(JSON.stringify(args).length / 3.5);
const outputTokens = Math.round(result.content.map(c => c.text).join('').length / 3.5);
```

### Session State
```typescript
const session = {
  startTime: Date.now(),
  calls: new Map<string, number>(),
  totalInputTokens: 0,
  totalOutputTokens: 0,
  errors: 0,
};
```
Updated in `withTelemetry` on every call. Returned from server factory.

### Shutdown Summary (always, stderr)
```
[autodocs] Session: 14 calls, 2.3K input tokens, 4.1K output tokens, 42s
[autodocs] Tools: plan_change (4), get_test_info (3), diagnose (2), get_commands (1)
```

### JSONL Events (opt-in, file)
Per-call:
```json
{"ts":"2026-02-25T12:00:00Z","tool":"diagnose","latencyMs":45,"cache":"hit","inputTokens":120,"outputTokens":890,"error":false}
```
Session summary:
```json
{"ts":"2026-02-25T12:05:00Z","type":"session","durationMs":300000,"totalCalls":14,"inputTokens":2340,"outputTokens":4120,"tools":{"plan_change":4,"diagnose":2}}
```

### File Location
`.autodocs/telemetry.jsonl` in the project directory. Created on first write if `AUTODOCS_TELEMETRY=1`.

### Opt-in Mechanism
Environment variable `AUTODOCS_TELEMETRY=1` or CLI flag `--telemetry`.

### What's NOT Tracked
- No PII, no code content, no file paths, no arguments
- No external transmission
- No comparison benchmark (this is instrumentation, not A/B testing)

## Questions to Address

Please address these specific questions and any other issues you identify:

1. **Token estimation accuracy:** Is `chars / 3.5` good enough? For tool responses that are markdown-heavy (headers, tables, code blocks), does the ratio hold? Should we use a different divisor for input (JSON) vs output (markdown)?

2. **Session lifecycle:** The MCP server is long-running (started by Claude Code, killed on session end). SIGTERM/SIGINT handlers in serve.ts call `process.exit(0)`. Is the shutdown summary reliable? What happens if the process is killed with SIGKILL? What about uncaught exceptions?

3. **File location:** `.autodocs/telemetry.jsonl` in the project directory. This means:
   - It will appear in git status (should we add to .gitignore automatically? Or suggest in docs?)
   - Multiple concurrent sessions could write to the same file (race condition?)
   - CI environments may not have write access
   - The file grows unbounded (should we rotate/truncate?)

4. **Privacy:** We claim "no PII, no code content." But tool arguments could contain file paths (which reveal project structure). Are file paths PII? Should we hash them?

5. **The fundamental question:** This telemetry measures "how much token/time overhead do our tools add" — not "how much do they save." To answer "do tools save tokens," we'd need a counterfactual: what would the AI have done WITHOUT the tools? Is our approach sufficient for the marketing claim we want to make?

6. **stderr noise:** The session summary prints on every server shutdown. For users who run `npx synaps serve` frequently (e.g., restart Claude Code often), this could get noisy. Should it only print when there were actual tool calls?

7. **Integration test feasibility:** Testing that stderr contains the session summary requires spawning the server, making calls, then killing it and reading stderr. The existing integration test spawns a server — can we reliably capture stderr after SIGTERM?

8. **Schema versioning:** If we change the JSONL event format later, old files become unparseable. Should we include a schema version field?

## Deliverable

For each issue you identify, provide:
1. Severity (P0/P1/P2)
2. The specific problem
3. Your recommended fix
4. Why it matters (what goes wrong if we don't fix it)
