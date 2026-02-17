# Session Prompt — Wave 5: Cleanup, Refactoring, and New Features

Open a new Claude Code session from: `/Users/mariosiric/Documents/autodocs-engine/`

Then paste everything between the triple-backtick block below.

---

```
# autodocs-engine — Wave 5: Cleanup, Refactoring, and New Features

A code review identified 371 lines of noise-producing convention detectors, a monolithic 610-line LLM adapter, overly aggressive budget limits, and missing high-value features. This session addresses all of it.

## Before You Code

Read these documents:

1. **The Wave 5 plan (complete spec):**
   `docs/WAVE5-PLAN.md`
   Read the entire document. It has 3 workstreams, 14 steps, exact files to modify/delete, and test plans.

2. **The code review that motivated these changes:**
   `docs/CODE-REVIEW.md`
   The "REMOVE" and "IMPROVE" sections explain why each detector is being deleted and why the adapter needs splitting.

3. **Current convention extractor (shows what to clean up):**
   `src/convention-extractor.ts` (108 lines)

## Three Workstreams (Execute in Order)

### Workstream A: Cleanup — Remove Noisy Detectors

**DELETE these 6 files:**
- `src/detectors/import-patterns.ts` (89 lines — "barrel imports", "relative imports" — universal noise)
- `src/detectors/export-patterns.ts` (66 lines — "named exports" — linter's job)
- `src/detectors/component-patterns.ts` (54 lines — "displayName" — DevTools, not AI)
- `src/detectors/error-handling.ts` (52 lines — "try-catch" — redundant with contentSignals)
- `src/detectors/graphql-patterns.ts` (57 lines — superseded by data-fetching detector)
- `src/detectors/telemetry-patterns.ts` (53 lines — org-specific)

**UPDATE `src/convention-extractor.ts`:**
- Remove all 6 imports and registry entries
- Remove the GraphQL suppression logic (lines 79-92)
- Registry should have 8 detectors: fileNaming, hookPatterns, testPatterns + 5 ecosystem detectors

**UPDATE `src/types.ts`:**
- Remove unused ConventionCategory values: "imports", "exports", "components", "error-handling", "graphql", "telemetry", "state-management"

**UPDATE `src/impact-classifier.ts` and `src/anti-pattern-detector.ts`:**
- Remove rules referencing deleted categories

**UPDATE tests:**
- Fix any test fixtures that reference deleted categories
- Remove detector-specific test cases if any exist

**VERIFY:** Run `npm test` — all remaining tests pass. Run on a real package — convention count drops but no "barrel imports" or "displayName" noise.

### Workstream B: Refactoring

**B1: Split LLM Adapter**

Create `src/llm/` directory. Split `src/llm-adapter.ts` (610 lines) into:

| File | Responsibility | Functions |
|------|---------------|-----------|
| `src/llm/client.ts` | HTTP only | `callLLM()`, `callLLMWithRetry()` |
| `src/llm/serializer.ts` | StructuredAnalysis → markdown | `serializeToMarkdown()`, `serializePackageToMarkdown()`, `serializePackage()`, `sanitize()` |
| `src/llm/template-selector.ts` | Pick template for format | `getTemplate()`, template imports |
| `src/llm/hierarchical.ts` | Multi-file output | `formatHierarchical()`, `toPackageFilename()` |
| `src/llm/adapter.ts` | Orchestration | `formatWithLLM()`, `validateAndCorrect()` |

**Keep `src/llm-adapter.ts` as a re-export barrel** for backward compatibility:
```typescript
export { formatWithLLM, formatHierarchical, type HierarchicalOutput } from "./llm/adapter.js";
```

**B2: Adjust Budget Limits**

In `src/budget-validator.ts` and `src/templates/agents-md.ts`:
- Root: 80-100 lines (was 60-80)
- Package detail: 100-150 lines (was 60-90)
- Warning thresholds adjusted accordingly

**B3: Simplify Pattern Fingerprinter**

In `src/pattern-fingerprinter.ts` (370 → ~200 lines):
- Remove abstract shapes ("parameterShape: single config object")
- Keep: actual parameter names, return value keys, internal call names
- Produce: 1-line summaries per export with concrete details

### Workstream C: New Features

**C1: Example Extractor** — New file: `src/example-extractor.ts` (~200 lines)

For each public API export, find test files that import it, extract 3-7 line usage snippets from test blocks. Add `examples: UsageExample[]` to PackageAnalysis.

**C2: Plugin System** — New file: `src/plugin-loader.ts` (~120 lines)

`DetectorPlugin` interface + loading from package.json `autodocs.plugins` field, `.autodocs/plugins/` directory, or `--plugin <path>` CLI flag. Move telemetry detector to `examples/plugins/` as reference implementation.

**C3: Mermaid Diagram Generator** — New file: `src/mermaid-generator.ts` (~80 lines)

Generate Mermaid `graph TD` diagrams from dependency graphs. Color-code by package type. Include in cross-package analysis output.

## Implementation Order (14 Steps)

1. Delete 6 detector files
2. Update convention-extractor registry
3. Clean up ConventionCategory type
4. Clean up impact-classifier
5. Clean up anti-pattern-detector
6. Update tests for cleanup
7. Split LLM adapter into src/llm/ directory
8. Adjust budget limits
9. Simplify pattern-fingerprinter
10. Example extractor (new module)
11. Plugin system (new module)
12. Mermaid diagram generator (new module)
13. Pipeline integration for new modules
14. Tests for all changes

## Testing

After each workstream, run `npm test` to verify no regressions.

After all workstreams, verify on real packages:
```bash
# Convention noise check
npx tsx src/bin/autodocs-engine.ts analyze test/fixtures/hooks-pkg --dry-run 2>/dev/null | \
  python3 -c "import json,sys; convs=[c['name'] for c in json.loads(sys.stdin.read())['packages'][0]['conventions']]; print(convs)"
# Should NOT contain: "Barrel imports", "Named exports", "displayName", "Try-catch", "GraphQL hooks"

# LLM adapter split check
node -e "const m = require('./dist/llm-adapter.js'); console.log(typeof m.formatWithLLM)"
# Should print: "function"
```

## What NOT to Change
- Don't modify Wave 1/2/3 analysis modules (config-analyzer, output-validator, etc.)
- Don't change the pipeline architecture (just plug in new modules)
- Don't remove ecosystem detectors (data-fetching, test-framework, database, web-framework, build-tool)
- Don't remove hooks or file-naming detectors

## What to Ask Me
- If deleting a detector breaks an unexpected test
- If the LLM adapter split creates circular dependency issues
- If the plugin system needs more complex loading logic
- If the example extractor can't find useful snippets in the test fixtures
```
