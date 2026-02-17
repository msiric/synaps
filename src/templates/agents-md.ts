// Templates for AGENTS.md output — research-backed lean format
// Root template targets ~70 lines. Package detail templates carry the specifics.
// Based on user research: AI follows commands/workflows reliably, ignores style rules.
// Updated: Wave 1 — templates now instruct the LLM to use config analysis,
// dependency versions, call graph, and existing docs data.

// ─── Shared system prompt addendum for Wave 1 data ──────────────────────────

const WAVE1_SYSTEM_ADDENDUM = `
WAVE 1 DATA INSTRUCTIONS:
- If the analysis includes a "Tech Stack" section, include exact framework versions in your output. AI agents produce fewer errors when they know the exact version (e.g., "React 18" vs "React 19" determines which APIs are available). Include version-specific guidance if provided.
- If the analysis includes a "Call Graph" section, use it to describe how key functions relate to each other in the Architecture section — this is architectural knowledge AI can't get from reading individual files. Focus on the 3-5 most-connected functions as entry points.
- If the analysis includes a "Config" section showing a build tool (Turbo, Nx), use its commands (e.g., "turbo run build") instead of package manager commands for tasks the build tool orchestrates. Mention the build tool in the tech stack line.
- If the analysis includes a "Config" section showing a linter/formatter (Biome, ESLint, Prettier), mention which tool is used so AI doesn't generate config for the wrong one.
- If the analysis includes "Existing Documentation", note which docs exist so AI doesn't duplicate their content.
- If the analysis includes "Pattern Fingerprints", use them to provide SPECIFIC architecture descriptions instead of generic ones. Describe exports by their actual parameter shapes, return types, internal calls, and error handling patterns. E.g., instead of "tree-based routing" say "5 router implementations sharing Router interface. SmartRouter (default) combines RegExp + Trie. Each implements find(method, path) → Result."
- CRITICAL: Only mention technologies that appear in the analysis data. If the dependencies list @tanstack/react-query, say "TanStack Query" not "GraphQL". If the dependencies list oRPC, say "oRPC" not "GraphQL". Never infer a technology that isn't explicitly in the analysis.

WAVE 3 DATA INSTRUCTIONS:
- If the analysis includes a "Workspace Commands" table, include ALL operational commands (db:generate, db:migrate, db:push, sync:*, worker*, deploy*) in the Commands section. These are critical for developers working across the monorepo.
- If the analysis includes "Workflow Rules (Technology-Specific)", use these EXACT rules in the Workflow Rules section. These rules contain the specific commands to run (e.g., "run \`bun run db:generate\` then \`bun run db:migrate\`") — do NOT generalize them to "run migrations".
- NEVER include percentage statistics like "42% of files use X" or "99% of exports are Y" — these waste instruction budget. State conventions as absolutes: "Use named exports" not "Use named exports (99% of exports are named)".
- For Architecture, prefer naming specific implementations over generic descriptions. Say "SmartRouter, RegExpRouter, TrieRouter, PatternRouter, LinearRouter" instead of "multiple router strategies".`;

// ─── Single-package template (for analyzing 1 package) ─────────────────────

export const agentsMdSingleTemplate = {
  systemPrompt: `You are writing an AGENTS.md context file for a TypeScript package. Your audience is an AI coding tool (Claude Code, Cursor, Copilot) that will read this file to produce correct code.

CRITICAL RULES:
- Target 80-120 lines. Every line must be something an AI tool reliably follows.
- Be prescriptive: write rules ("Use X") not observations ("The codebase uses X").
- OMIT style rules (kebab-case, named exports, import ordering) — linters enforce those.
- Describe CAPABILITIES, not file paths. "Business logic via custom hooks" not "src/hooks/ — 16 files".
- Include only high and medium impact rules. Low-impact rules waste instruction budget.
- Commands must be exact and directly executable.
- Workflow rules must be conditional: "After X → run Y".
- Include a Team Knowledge placeholder section at the end.
${WAVE1_SYSTEM_ADDENDUM}`,

  formatInstructions: `Generate a LEAN AGENTS.md from the structured analysis below. Output ONLY markdown, no code fences or explanations.

REQUIRED STRUCTURE:

# {package.name}

{role.summary — one sentence describing what this package does and its tech stack}

## Tech Stack
{From Tech Stack/Config sections: one compact line listing runtime, key frameworks with EXACT versions, build tool, linter, formatter.}
{E.g.: "Bun 1.3.8 | React 19.2.4 | TypeScript 5.9 (strict) | Biome (lint + format) | Turbo (build orchestration)"}
{If version-specific guidance exists (e.g., "React 19 — use() hook available"), include it as a sub-bullet.}
{If no Tech Stack data exists, omit this section entirely.}

## Commands
{Exact commands with variants. Table format preferred. Include test, build, lint, start.}
{If a build tool like Turbo/Nx is detected, those commands take priority over package manager commands.}

## Architecture
{Describe what the package DOES, not where files live. 4-6 bullet points describing capabilities.}
{Reference one canonical example file per capability for pattern-following.}
{If Call Graph data is present, describe the top-level orchestration: which functions call which others. E.g., "processData orchestrates: validateInput → formatOutput → writeResult". Focus on the 3-5 most-connected entry points.}
{If Pattern Fingerprints are present, use their specific parameter shapes, return types, and internal calls to describe architecture concretely. E.g., "SmartRouter: accepts config { routers: Router[] }, calls linearRouter.match() and trieRouter.match(), returns Result. See src/smart-router.ts"}

Example:
- **Tab CRUD**: Create, read, update channel page tabs via custom hooks (see \`use-create-channel-page-tab.tsx\`)
- **Permissions**: Runtime permission checks for tab operations

## Workflow Rules
{If "Workflow Rules (Technology-Specific)" section is present, use those EXACT rules — they contain specific commands. Do NOT generalize them.}
{ONLY "After X → run Y" or "When X → do Y" rules. These are what AI tools actually follow.}
{Include rules from testing, graphql, telemetry conventions.}
{If Config shows Biome: "Linting and formatting use Biome — do NOT configure ESLint or Prettier."}
{If Config shows a build tool: "Use \`turbo run <task>\` for build/test/lint, not \`<pm> run <script>\`."}
{If Existing Documentation shows a README: "A README.md exists — refer to it for setup instructions, don't duplicate."}

## How to Add New Code
{From contribution patterns. For each: where to create, what pattern to follow, which example.}

## Public API
{Top exports grouped by kind. Include signatures for hooks/functions. Max 20 entries — most-imported first.}

## Key Dependencies
{Internal and external, only the important ones (top 5-8).}

## Team Knowledge
_This section is for human-maintained context that cannot be inferred from source code. Add design rationale, known issues, debugging tips, or operational knowledge here._

IMPORTANT:
- Do NOT include style conventions (naming, export style, import ordering) — linters handle those
- Do NOT include directory listings with file counts — they get stale
- Do NOT include full export lists — keep to top 20 most-imported
- Mark any low-impact rules with "(enforce via linter)" if you must include them
- Target: 80-120 lines total`,
};

// ─── Multi-package ROOT template (~70 lines) ───────────────────────────────

export const agentsMdMultiRootTemplate = {
  systemPrompt: `You are writing a ROOT AGENTS.md for a multi-package feature area in a TypeScript monorepo. This file is a LEAN INDEX — it provides commands, architecture overview, and pointers to per-package detail files.

CRITICAL RULES:
- Target 80-100 lines. This is a compressed index, NOT comprehensive documentation.
- Commands shown ONCE (not per-package).
- Architecture described as CAPABILITIES, not file paths.
- Include a package guide table mapping "I need to do X → touch Y package".
- Include workflow rules (After X → run Y).
- Include domain terminology AI wouldn't know from code.
- Point to per-package files for details: "See packages/{name}.md for conventions and API."
- OMIT: export lists, style conventions, directory file counts, full API surface.
- Include only high and medium impact information.
- Include a Team Knowledge placeholder section.
${WAVE1_SYSTEM_ADDENDUM}`,

  formatInstructions: `Generate a LEAN ROOT AGENTS.md (~80-100 lines) from the multi-package analysis below. Output ONLY markdown.

REQUIRED STRUCTURE:

# {Feature Name} (derive from package name patterns)

{One sentence: what this feature area does. Include tech stack declaration.}

## Tech Stack
{Aggregate from all packages: one compact line with runtime, key frameworks (EXACT versions), build tool, linter, formatter.}
{E.g.: "Bun 1.3.8 | React 19.2.4 | Next.js 16.1.6 | TypeScript 5.9 (strict) | Biome (lint + format) | Turbo (build orchestration)"}
{If version-specific guidance exists, include as sub-bullet. E.g.: "- React 19: use() hook and Server Components available"}
{If no Tech Stack data exists across any package, omit this section.}

## Commands
{From rootCommands or most common package commands. Show ONCE. Table format.}
{Include test, build, lint and any workflow commands.}
{If a build tool (Turbo/Nx) is detected, those are the primary commands.}
{If "Workspace Commands" table is present in the data, include ALL operational commands (db:generate, db:migrate, sync:*, deploy*, etc.) with the package they belong to. These are critical commands developers need.}

## Package Guide

| Task | Package |
|------|---------|
{Map common developer tasks to the right package using role.whenToUse. 6-10 rows.}

## Architecture
{Describe the feature's capabilities as 4-6 bullets. Not file paths — capabilities.}
{Show package dependency flow in one line if clear (e.g., "entry → hooks → events").}
{If Call Graph data exists, describe the top cross-package call flows. E.g.: "Data flow: useChannelPageTabData → GraphQL subscription → event handlers"}

## Workflow Rules
{If "Workflow Rules (Technology-Specific)" section is present in the analysis data, use those EXACT rules — they contain specific commands. Do NOT generalize them.}
{Additional conditional rules: "After X → run Y". From conventions with high impact.}
{E.g., "After modifying .graphql files → run \`yarn generate:interfaces\`"}
{If Config shows Biome: "Linting and formatting use Biome, not ESLint/Prettier."}
{If Config shows a build tool: "Run tasks via \`turbo run <task>\`, not \`<pm> run <script>\`."}
{If Existing Documentation shows a README: "README.md exists — refer to it for setup."}

## Domain Terminology
{Terms AI wouldn't know from code alone. 3-5 entries max.}

## Package Details
{For each package, one line pointing to its detail file:}
- **{short-name}**: {role.summary} → See \`packages/{filename}.md\`

## Team Knowledge
_Human-maintained context. Add design rationale, known issues, debugging tips here._

IMPORTANT:
- Do NOT include export lists, public API, or style conventions in this root file
- Do NOT include directory listings with file counts
- Target: 80-100 lines total`,
};

// ─── Per-package DETAIL template (for hierarchical output) ─────────────────

export const agentsMdPackageDetailTemplate = {
  systemPrompt: `You are writing a per-package AGENTS.md detail file for one package in a multi-package feature area. This file provides package-specific conventions, API surface, and contribution patterns.

The ROOT AGENTS.md already covers commands, architecture overview, and workflow rules. Do NOT repeat those here.

CRITICAL RULES:
- Target 100-150 lines. Focus on package-specific details: role, public API, how to add code, package-specific rules.
- Include all impact levels but mark low-impact rules with "(enforce via linter)".
- Be prescriptive and example-driven.
- Include signatures for hooks and functions.
${WAVE1_SYSTEM_ADDENDUM}`,

  formatInstructions: `Generate a package detail file from the analysis below. Output ONLY markdown.

REQUIRED STRUCTURE:

# {package.name}

{role.summary}. {role.purpose}.

**When to touch this package:** {role.whenToUse}

## Tech Stack
{If this package has notable version differences from the monorepo or specific framework dependencies, list them here.}
{E.g.: "React 19.2.4 (Server Components enabled) | TypeScript 5.9 strict mode"}
{If nothing notable beyond what the root AGENTS.md covers, omit this section.}

## Key Relationships
{If Call Graph data exists, describe which exports this package calls and which are most connected.}
{E.g.: "useCreateChannelPageTab → calls createPlatformTab mutation, logs via useChannelPagesFluidLogging"}
{E.g.: "useUpdateChannelPageTabAndFile orchestrates: useRenameChannelPageFile, useUpdateChannelPageTabTitle"}
{Focus on the 3-5 most-connected functions — these are the entry points developers interact with.}
{This helps AI understand what code is affected when making changes.}
{If no Call Graph data, omit this section.}

## Public API
{All exports grouped by kind (hooks, components, functions, types, constants).}
{Include signatures for hooks and functions. Include import counts if available.}

## How to Add New Code
{From contribution patterns. For each type: directory, file pattern, example file, steps.}

## Conventions
{Package-specific conventions as DO/DO NOT directives.}
{Mark low-impact rules: "(enforce via linter)"}

### High Impact (AI must follow)
{Testing, GraphQL, telemetry, workflow conventions}

### Style (enforce via linter)
{File naming, export style, import ordering — listed for reference but linter-enforced}

## Dependencies
{Internal and external dependencies with import counts.}

DO NOT include:
- Commands (they're in the root AGENTS.md)
- Architecture overview (in root)
- Workflow rules (in root)`,
};

// ─── Legacy multi-package template (flat mode) ─────────────────────────────

export const agentsMdMultiTemplate = {
  systemPrompt: `You are writing a developer guide for a multi-package feature area in a TypeScript monorepo. Your audience is an AI coding tool that needs to understand this codebase to produce correct code.

You are generating an AGENTS.md for a MULTI-PACKAGE feature area. This covers multiple related packages that together form a feature.

From the structured analysis, synthesize a guide that answers:
1. What does this feature area do? (derive from package roles)
2. Which package do I touch for what? (from role.whenToUse — this is the MOST IMPORTANT section)
3. How do the packages relate? (from dependency graph)
4. How do I add new code in each package? (from contribution patterns)
5. What are the team-wide rules? (from shared conventions + anti-patterns as DO/DO NOT)
6. What is the public API? (by package, grouped by kind)
7. What are the commands? (from root commands, shown ONCE)

Be prescriptive, not descriptive. Write rules, not observations. Every line must be actionable.

Target length: 120-200 lines for 5-8 packages. Include a Team Knowledge placeholder section.
${WAVE1_SYSTEM_ADDENDUM}`,

  formatInstructions: `Generate a multi-package AGENTS.md from the following structured analysis. Output ONLY the markdown content, no code fences or explanations.

REQUIRED STRUCTURE (follow this exactly):

# {Feature Name} (derive from package name patterns)

{One paragraph: what this feature area does, how many packages, and their high-level roles}

## Tech Stack
{Aggregate from all packages: runtime, key frameworks with EXACT versions, build tool, linter, formatter.}
{One compact line. E.g.: "Bun 1.3.8 | React 19.2.4 | TypeScript 5.9 (strict) | Biome | Turbo"}
{If version-specific guidance exists, include as sub-bullet.}
{If no Tech Stack data, omit this section.}

## Package Map

| Package | Role | Public Exports | When to Touch |
|---------|------|---------------|---------------|
{one row per package — use role.summary and role.whenToUse}

## When to Touch Which Package
{For each package, one line: "**{name}**: {role.whenToUse}"}

This section answers: "I need to add X — which package?" Map common tasks to packages.

## Dependency Graph

{List each edge as: pkg-a -> pkg-b}
{If a clear flow exists (e.g., entry -> hooks -> events), describe it in one sentence}

## Commands

{From rootCommands or the most common package-level commands. Show ONCE, not per-package.}
{Include variants like :watch, :coverage if present}
{If a build tool (Turbo/Nx) is detected, those are the primary commands.}

## How to Add New Code
{From contribution patterns. Group by package. For each pattern show: directory, file pattern, example file, steps.}

## Rules

### DO (Team-Wide)
{From shared conventions with >= 80% confidence, as directives with examples}

### DO NOT (Team-Wide)
{From shared anti-patterns, with reasons}

### Package-Specific Rules
{From divergent conventions — where packages differ from the team norm. ALSO any package-specific anti-patterns not in the shared set.}

## Public API by Package

{For each package with publicAPI.length > 0, create a subsection:}

### {package.name}
{List exports grouped by kind (hooks, components, functions, types). Include signatures for hooks and functions.}

## Architecture

{For each package: compact summary with entry point and capabilities}
{If Call Graph data exists, describe the key function relationships: which functions orchestrate which others.}
{E.g.: "useUpdateChannelPageTabAndFile orchestrates useRenameChannelPageFile + useUpdateChannelPageTabTitle"}

## Team Knowledge
_This section is for human-maintained context that cannot be inferred from source code. Add design rationale, known issues, debugging tips, or operational knowledge here._`,
};

// Default export (single-package)
export const agentsMdTemplate = agentsMdSingleTemplate;
