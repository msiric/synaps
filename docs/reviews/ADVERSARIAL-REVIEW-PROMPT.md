# Adversarial Review Prompt — Meta-Tool Detection Plan

Send the contents of `docs/META-TOOL-DETECTION-PLAN.md` followed by this prompt to each model (Claude, GPT, Gemini, Grok).

---

## Prompt

```
You are a senior systems engineer conducting an adversarial review of an implementation plan. Your goal is to find every flaw, edge case, false assumption, and failure mode. Be harsh — the goal is to find problems BEFORE implementation, not validate the plan.

The document you just read proposes a "meta-tool heuristic" for a codebase analysis engine. The engine analyzes TypeScript repos and generates AI context files (AGENTS.md). The problem: tools like Knip (a CLI that finds unused dependencies) import 15+ frameworks for their plugin system, and the engine currently reports "Uses Express," "Uses React hooks," etc. as conventions — which is misleading because Knip doesn't USE these frameworks, it ANALYZES projects that use them.

The proposed fix: if a package imports from >5 distinct "major frameworks," classify it as a meta-tool and suppress framework-specific conventions.

## Review These Specific Aspects:

### 1. Is the heuristic correct?
- Is counting distinct major framework imports the right signal for meta-tool detection?
- Is the threshold of >5 too high, too low, or about right?
- Are there packages that would be incorrectly classified as meta-tools?
- Are there meta-tools that would NOT be detected by this heuristic?
- Is the MAJOR_FRAMEWORKS list missing important entries or including things that shouldn't be there?

### 2. Is the response correct?
- When a meta-tool is detected, is suppressing ecosystem detectors the right response?
- Should ANY ecosystem information survive for meta-tools? (e.g., "this tool supports React, Vue, and Angular" IS useful context)
- Is splitting dependencies into "Core" vs "Supported Frameworks" the right UX?
- Could the meta-tool classification confuse users who don't expect their tool to be treated differently?

### 3. Edge cases
- What about packages that are BOTH a meta-tool AND use a specific framework? (e.g., a Storybook addon that supports multiple frameworks but is itself built with React)
- What about monorepo packages where one package is a meta-tool and others aren't?
- What about packages where framework imports are in devDependencies only?
- What about packages that import framework types but not the framework runtime? (e.g., `import type { Component } from 'react'`)
- What about frameworks that aren't in the MAJOR_FRAMEWORKS list?

### 4. Architecture concerns
- Is adding `isMetaTool` to PackageAnalysis the right abstraction? Or should this be handled differently?
- Should the meta-tool detection be an analysis step (computed once) or a formatting concern (applied at output time)?
- Does this create coupling between the meta-tool detector and the convention extractors?

### 5. Alternative approaches
- Is there a fundamentally better way to solve this problem?
- Could we use the LOCATION of imports (plugins/ vs src/) instead of counting frameworks?
- Could we use the RELATIONSHIP between imports and exports (does the package export React components, or just import React internally)?
- Could we let the user explicitly mark their package as a meta-tool in configuration?

### 6. Testing adequacy
- Are the proposed test cases sufficient?
- What test cases are missing?
- How would you test the borderline cases (exactly 5 frameworks)?

## Output Format

Return your findings as:
1. **CRITICAL** — Issues that would cause the implementation to be wrong or harmful
2. **HIGH** — Issues that would significantly degrade quality
3. **MEDIUM** — Issues worth addressing but not blocking
4. **LOW** — Minor improvements
5. **ALTERNATIVE APPROACHES** — If you think the fundamental approach is wrong, describe what you'd do instead
6. **OVERALL ASSESSMENT** — Is this plan ready for implementation? What must be fixed first?
```

---

## How to Use This

1. Copy the full contents of `docs/META-TOOL-DETECTION-PLAN.md` into each model
2. Append the adversarial review prompt above
3. Collect responses from Claude, GPT, Gemini, and Grok
4. Compare findings — issues found by 3+ models are definitely real
5. Update the plan based on accepted findings
6. Then implement
