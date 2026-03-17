# MCP Server Expansion Plan: Making Codebase Intelligence Indispensable

## Context

synaps v0.5.0 is published on npm. The MCP server has 8 tools and works with Claude Code. The analysis pipeline computes significantly more data than is currently exposed. This plan identifies the highest-impact additions that would make the MCP server indispensable — meaning the AI performs *noticeably worse* without it.

## Current State

### 8 Existing Tools

| Tool | What It Returns | Value |
|------|----------------|-------|
| `get_commands` | Build/test/lint commands with flags and package manager | Proven safe (+2.6%, never hurts) |
| `get_architecture` | Directory structure, entry points, package type | High value for navigation |
| `get_conventions` | DO/DON'T rules with confidence (now filterable by category) | High value when non-obvious |
| `get_workflow_rules` | File coupling and co-change patterns (now filterable by filePath) | Unique — can't get this from code |
| `get_contribution_guide` | How to add new code in a directory (filterable by directory) | High value for new code |
| `get_exports` | Public API sorted by usage count | Moderate value |
| `analyze_impact` | Importers, callers, co-change partners for a file | High value for changes |
| `list_packages` | Monorepo package inventory | High value for monorepos |

### Data Computed But NOT Exposed

| Data | Location | Value |
|------|----------|-------|
| Usage examples from tests | `pkg.examples` (UsageExample[]) | Show how an export is actually called — eliminates hallucinated arguments |
| Pattern fingerprints | `pkg.patternFingerprints` (PatternFingerprint[]) | Parameter shapes, return types for top exports |
| Full call graph | `pkg.callGraph` (CallGraphEdge[]) | Who calls what — only partially exposed via analyze_impact |
| Import chain | `pkg.importChain` (FileImportEdge[]) | Who imports what — only partially exposed via analyze_impact |
| Git co-change edges | `pkg.gitHistory.coChangeEdges` | Raw Jaccard scores between file pairs |
| Test file patterns | `ContributionPattern.testPattern` | Which test file corresponds to which source file |
| Config analysis | `pkg.configAnalysis` | tsconfig paths, ESLint config, Biome settings |
| Existing docs | `pkg.existingDocs` | README/CONTRIBUTING content already parsed |

## Where AI Tools Actually Fail

From research (5 papers) and developer complaints (Reddit, HN, Stack Overflow 2025 survey):

### 1. Multi-File Awareness
"I changed the function signature in types.ts. What else breaks?"

The AI can grep for usages, but it doesn't know about *implicit* coupling — files that historically change together, registration patterns, barrel files that need updating. This data doesn't exist in the source code. It's in git history and project conventions.

### 2. Post-Change Checklist
"I added a new detector file but it doesn't work."

Because it wasn't registered in `convention-extractor.ts`. The AI doesn't know about this wiring step because it's a convention, not a compile error. This is exactly what our workflow rules and contribution patterns capture.

### 3. Idiomatic Usage
"How is buildConfidence actually called?"

The AI reads a function signature but doesn't know the idiomatic usage pattern. Is it called with 2 args or 4? What's the typical return shape? We have this data in `UsageExample[]` and `PatternFingerprint[]` — computed but not exposed.

### 4. Test Discovery
"How do I test this specific file?"

The AI runs the entire test suite or guesses the test file path. We know the test framework, the test file naming pattern, and the exact command. One tool call should give: "Run `pnpm vitest run test/detectors/file-naming.test.ts`."

## Proposed New Tools

### Tool 1: `get_test_command(filePath)` — "How do I test this?"

**Input:**
```typescript
{ filePath: string; packagePath?: string }
```

**Returns:**
- Exact test command for this specific file
- Corresponding test file path (if it exists)
- Test framework name
- Any test-specific conventions (e.g., "tests are co-located" vs "tests in separate directory")

**Implementation:** Compose `commands.test` + `ContributionPattern.testPattern` + directory convention detection. ~50-80 lines.

**Why it matters:** The AI currently either runs the entire test suite (slow, noisy) or guesses the test command (often wrong). Per Builder.io's AGENTS.md guide, per-file test commands are one of the highest-value things you can provide to an agent.

### Tool 2: `plan_change(description, files?)` — "What will this change affect?"

**Input:**
```typescript
{
  task?: string;       // "add rate limiting to the API endpoints"
  files?: string[];    // files being edited (if known)
}
```

**Returns:**
- **Primary files**: Files that directly need editing (from task + architecture)
- **Dependent files**: Files that import/depend on changed files (from import graph)
- **Co-change files**: Files that historically co-change (from git, Jaccard ≥ 0.3)
- **Registration files**: Barrel/index files that need updating (from contribution patterns)
- **Test files**: Corresponding test files (from test patterns)
- **Blast radius**: small (1-5 files) / medium (6-15) / large (16+)
- **Checklist**: Ordered list of steps ("1. Edit X, 2. Update barrel Y, 3. Run test Z")

**Implementation:** Compose import graph + co-change data + contribution patterns + test patterns. Keyword extraction from task description to identify relevant directories. ~150-200 lines.

**Why it matters:** This is the only tool that provides information the AI literally cannot get any other way. The combination of import graph + git co-change + registration patterns into a single change checklist is unique. No grep, no file reading, and no amount of context window can discover historical co-change patterns.

### Tool 3: `get_examples(exportName)` — "Show me how this is used"

**Input:**
```typescript
{ exportName: string; packagePath?: string; limit?: number }
```

**Returns:**
- Usage snippets extracted from test files showing real invocations
- Parameter shapes from pattern fingerprints
- Most common calling patterns

**Implementation:** Expose `pkg.examples` (already computed) filtered by export name. Add pattern fingerprint data for signature info. ~60-80 lines.

**Why it matters:** "Show, don't tell." One real usage example eliminates more hallucinated function arguments than any amount of type signature documentation. The data already exists — it just needs a delivery mechanism.

### Tool 4: `get_file_context(filePath)` — "Tell me everything about this file"

**Input:**
```typescript
{ filePath: string; packagePath?: string }
```

**Returns:**
- What this file exports (from public API)
- What it imports (from import chain)
- What depends on it (reverse imports)
- Co-change partners (from git history, top 5 by Jaccard score)
- Which contribution pattern it belongs to (if any)
- Applicable conventions for its directory
- Corresponding test file (if it exists)

**Implementation:** Compose queries across existing data. One file path → focused bundle of everything relevant. ~100-120 lines.

**Why it matters:** When an AI opens an unfamiliar file, it currently needs 4-5 separate tool calls (get_exports, analyze_impact, get_conventions, get_contribution_guide) and must mentally combine the results. This single tool call provides complete orientation.

## Improvements to Existing Tools

### `analyze_impact` — Add blast radius summary

Current: Returns raw lists of importers, callers, co-changes.
Improved: Add a one-line summary at the top: "Blast radius: medium (8 direct importers, 23 transitive dependents). High-risk change."

### `get_contribution_guide` — Include example code

Current: Returns pattern description (file naming, steps, registration file).
Improved: Include the first 15-20 lines of the `exampleFile` as an inline code snippet. One real code example is worth more than a description.

### `get_conventions` — Show confidence levels

Current: Returns rules without indicating strength.
Improved: Add confidence: "DO: Use kebab-case filenames (98% confidence — 49/50 files)" vs "DO: Export default from components (76% confidence — 19/25 files)." The AI can weight how strictly to follow each rule.

### `get_architecture` — Richer directory descriptions

Current: "Feature: benchmark" (generic).
Improved: "Benchmark system (12 files, 7 exports: orchestrateBenchmark, scorePROutput, ...)" — file count + key exports per directory.

## Prioritization

| # | Tool/Change | Effort | Impact | Data Exists? |
|---|-------------|--------|--------|-------------|
| 1 | `get_test_command` | Small (~50 lines) | High — every edit session needs this | Yes |
| 2 | `plan_change` | Medium (~200 lines) | Very High — unique capability, no alternative | Yes |
| 3 | `get_examples` | Small (~80 lines) | High — eliminates hallucinated arguments | Yes |
| 4 | Improve `analyze_impact` (blast radius) | Small (~20 lines) | Medium — better UX for existing data | Yes |
| 5 | Improve `get_contribution_guide` (example code) | Small (~30 lines) | Medium — show don't tell | Yes |
| 6 | Improve `get_conventions` (confidence) | Small (~15 lines) | Medium — weighted rule following | Yes |
| 7 | `get_file_context` | Medium (~120 lines) | High — single-call orientation | Yes |
| 8 | Improve `get_architecture` (richer) | Small (~30 lines) | Low-Medium — better navigation | Yes |

All data already exists in the analysis pipeline. These are query/formatting changes, not new analysis.

## Design Principles (From Research)

1. **Small, focused responses beat comprehensive dumps** (AGENTS.md evaluation paper). Every tool should return the minimum viable context.
2. **Block-level precision over file-level recall** (ContextBench). Return function signatures and key patterns, not whole files.
3. **Pointers over content** (Anthropic context engineering). Return file paths, function names, and short descriptions. Let the agent read full content only when needed.
4. **Correctly selected summaries help; unselected dumps hurt** (SWE-ContextBench). The `plan_change` composite tool only works if its selection logic is good.
5. **Tool descriptions are critical routing signals** (GitHub MCP Server). Each tool needs clear WHEN TO CALL / DO NOT CALL descriptions so agents know when to use them.

## Success Criteria

The MCP server is indispensable when:
- Developers feel the difference when it disconnects (qualitative)
- The AI makes fewer multi-file errors with the server connected (measurable)
- `plan_change` catches registration/barrel updates the AI would otherwise miss (testable)
- `get_test_command` saves >30 seconds per edit-test cycle vs guessing (measurable)
- Tool invocation frequency is >5 calls per session (telemetry)
