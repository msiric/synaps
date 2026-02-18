# Benchmark Repos for autodocs-engine

> **Purpose:** 10 TypeScript repositories with existing human-written AI context files, enabling a three-way comparison:
> - **A (Engine):** autodocs-engine's generated AGENTS.md
> - **B (Human):** The repo's existing hand-written context file
> - **C (Raw LLM):** A raw LLM reading the code and writing AGENTS.md
>
> **Selection date:** 2026-02-17
> **Candidates evaluated:** 30+ repositories, 15 rejected (see Rejection Log)

---

## Summary Table

| # | Repo | Stars | TS % | Context File | Lines | Archetype | Pkg Mgr | Build Tool | Bun | pnpm | Turbo | Est. Files |
|---|------|-------|------|--------------|-------|-----------|---------|------------|-----|------|-------|------------|
| 1 | sanity-io/sanity | 6k | 98% | AGENTS.md | 386 | CMS monorepo | pnpm | Turbo | | ✓ | ✓ | 300-800 |
| 2 | medusajs/medusa | 32.1k | 85.7% | CLAUDE.md | 341 | E-commerce API | Yarn | Turbo | | | ✓ | 800-1200 |
| 3 | vercel/ai | 21.8k | ~95% | AGENTS.md | 284 | AI SDK monorepo | pnpm | Turbo | | ✓ | ✓ | 300-600 |
| 4 | modelcontextprotocol/typescript-sdk | 11.6k | 97.2% | CLAUDE.md | 266 | SDK | pnpm | tsc | | ✓ | | 150-250 |
| 5 | webpro-nl/knip | 10.3k | 83.6% | AGENTS.md | 183 | CLI tool | pnpm | none | | ✓ | | 200-250 |
| 6 | unjs/nitro | 10.4k | 98.6% | AGENTS.md | 164 | Backend server | pnpm | obuild | | ✓ | | 300-800 |
| 7 | openstatusHQ/openstatus | 8.3k | 81.2% | CLAUDE.md | 106 | Web app (monitoring) | pnpm | Turbo | ✓ | ✓ | ✓ | 200-500 |
| 8 | documenso/documenso | 12.4k | 99.5% | .cursorrules + AGENTS.md | 75+? | Web app (Remix) | npm | Turbo | | | ✓ | 800-1000 |
| 9 | Effect-TS/effect | 13.2k | ~99% | AGENTS.md | 77 | Functional library | pnpm | tsc | | ✓ | | 178 (core) |
| 10 | excalidraw/excalidraw | 117k | 93.9% | CLAUDE.md | 34 | Component library | Yarn | Vite | | | | 200-400 |

---

## Variety Coverage Matrix

| Requirement | Repos Covering It |
|---|---|
| **Monorepo** (need 2+) | sanity, vercel/ai, effect, medusa, openstatus, documenso |
| **Single-package library** (need 2+) | MCP SDK, nitro, knip |
| **CLI tool** (need 1+) | knip |
| **Web application** (need 1+) | documenso (Remix), openstatus (Next.js), excalidraw |
| **Backend/API server** (need 1+) | nitro, medusa |
| **Component library** (need 1+) | excalidraw |
| **Uses Bun** (need 1+) | openstatus (bunfig.toml) |
| **Uses pnpm workspaces** (need 1+) | sanity, vercel/ai, effect, nitro, knip, MCP SDK, openstatus |
| **Uses Turborepo** (need 1+) | sanity, vercel/ai, medusa, openstatus, documenso |

All 9 variety requirements are covered.

---

## Detailed Repo Profiles

### Repo 1: sanity-io/sanity

- **URL:** https://github.com/sanity-io/sanity
- **Stars:** 6,000
- **Language:** TypeScript (98.0%)
- **Context file(s):** AGENTS.md + CLAUDE.md (1-line redirect) — VERIFIED EXISTS
- **Context file location:** `/AGENTS.md` (root, main branch)
- **Context file quality:** High (386 lines — detailed workflow guide with prerequisites, package structure, build system, CI/CD requirements, quick reference commands, troubleshooting)
- **Archetype:** CMS monorepo
- **Package manager:** pnpm 10.28.2
- **Build tool:** Turbo 2.7.5 + Vite + esbuild
- **Key frameworks:** React, Vite, esbuild, TypeDoc
- **Approximate source files:** 300-800
- **Last commit:** February 17, 2026
- **Why selected:** Highest-quality AGENTS.md (386 lines) with practical, execution-focused guidance. Real-world CMS used by 131k+ projects. Covers pnpm+Turbo monorepo pattern.
- **Analysis target:** `packages/sanity` (main package) or full repo root

---

### Repo 2: medusajs/medusa

- **URL:** https://github.com/medusajs/medusa
- **Stars:** 32,100
- **Language:** TypeScript (85.7%), JavaScript (14.1%)
- **Context file(s):** CLAUDE.md — VERIFIED EXISTS
- **Context file location:** `/CLAUDE.md` (root, develop branch)
- **Context file quality:** High (341 lines — covers 30+ package structure, build commands, testing conventions, architecture patterns including service decorators, API routes, workflow composition, error handling)
- **Archetype:** E-commerce API / backend platform
- **Package manager:** Yarn 3.2.1
- **Build tool:** Turbo + Rollup + esbuild + Vite
- **Key frameworks:** Express, TypeORM, Jest, Vitest
- **Approximate source files:** 800-1,200
- **Last commit:** January 25, 2026
- **Why selected:** High-quality CLAUDE.md (341 lines), 32k+ stars, Yarn+Turbo monorepo (different from pnpm repos). Backend/API archetype with deep architecture docs.
- **Analysis target:** `packages/medusa` (core) + `packages/modules/` or full repo root
- **Note:** Default branch is `develop`, not `main`

---

### Repo 3: vercel/ai

- **URL:** https://github.com/vercel/ai
- **Stars:** 21,800
- **Language:** TypeScript (predominant, ~95%)
- **Context file(s):** AGENTS.md + CLAUDE.md (symlink) — VERIFIED EXISTS
- **Context file location:** `/AGENTS.md` (root, main branch)
- **Context file quality:** High (284 lines — covers project fundamentals, development workflow, core APIs, code standards, architecture patterns, contribution workflows, task completion criteria)
- **Archetype:** AI SDK monorepo
- **Package manager:** pnpm 10.11.0
- **Build tool:** Turbo
- **Key frameworks:** React, Vitest, TypeDoc
- **Approximate source files:** 300-600 (across @ai-sdk/* packages)
- **Last commit:** February 17, 2026
- **Why selected:** Well-known Vercel project, excellent AGENTS.md (284 lines), pnpm+Turbo monorepo, good size. Multi-package SDK with clean architecture.
- **Analysis target:** `packages/ai` (core) or full repo root

---

### Repo 4: modelcontextprotocol/typescript-sdk

- **URL:** https://github.com/modelcontextprotocol/typescript-sdk
- **Stars:** 11,600
- **Language:** TypeScript (97.2%), JavaScript (2.5%)
- **Context file(s):** CLAUDE.md — VERIFIED EXISTS
- **Context file location:** `/CLAUDE.md` (root, main branch)
- **Context file quality:** High (266 lines — comprehensive three-layer architecture guide, build/test commands, code style, protocol layers, JSDoc conventions, migration guidance, experimental features, concrete code examples)
- **Archetype:** SDK / library
- **Package manager:** pnpm 10.26.1
- **Build tool:** tsc + tsdown (bundler)
- **Key frameworks:** Vitest, TypeDoc, ESLint, Prettier
- **Approximate source files:** 150-250
- **Last commit:** February 13, 2026
- **Why selected:** Excellent CLAUDE.md (266 lines) with detailed architectural guidance. Perfect size (150-250 files). Nearly pure TypeScript (97.2%). The MCP protocol is highly relevant.
- **Analysis target:** Full repo root (or `src/`)

---

### Repo 5: webpro-nl/knip

- **URL:** https://github.com/webpro-nl/knip
- **Stars:** 10,300
- **Language:** TypeScript (83.6%), JavaScript (8.6%), MDX (3.3%)
- **Context file(s):** AGENTS.md + CLAUDE.md (symlink) — VERIFIED EXISTS
- **Context file location:** `/AGENTS.md` (root, main branch)
- **Context file quality:** High (183 lines — execution sequence walkthrough, plugin development guide, debugging with trace flags, testing with fixture patterns, code style rules, performance expectations)
- **Archetype:** CLI tool
- **Package manager:** pnpm 10.24.0
- **Build tool:** none (pnpm workspaces only)
- **Key frameworks:** Vitest, TypeScript
- **Approximate source files:** 200-250 (main package: 19 src files + 135 plugin dirs)
- **Last commit:** February 6, 2026
- **Why selected:** Only qualifying CLI tool found. Excellent AGENTS.md (183 lines) with architecture walkthrough. 135-plugin architecture provides interesting modularity patterns. Good size.
- **Analysis target:** `packages/knip` (main CLI package)

---

### Repo 6: unjs/nitro

- **URL:** https://github.com/unjs/nitro
- **Stars:** 10,400
- **Language:** TypeScript (98.6%), JavaScript (1.4%)
- **Context file(s):** AGENTS.md + CLAUDE.md (1-line redirect) — VERIFIED EXISTS
- **Context file location:** `/AGENTS.md` (root, main branch)
- **Context file quality:** High (164 lines — project setup requirements, detailed repo structure, code patterns for cross-platform compatibility, testing strategy with "bug fixes MUST include failing test first", specific tool recommendations: pathe, defu, consola, unstorage)
- **Archetype:** Backend server framework (single-package)
- **Package manager:** pnpm 10.29.3
- **Build tool:** obuild (Rust-based)
- **Key frameworks:** Vitest, unjs ecosystem (pathe, defu, consola, unstorage)
- **Approximate source files:** 300-800
- **Last commit:** January 21, 2026
- **Why selected:** Near-pure TypeScript (98.6%), backend server framework archetype, single-package structure (contrasts with monorepos), interesting unjs ecosystem tooling.
- **Analysis target:** `src/` (full repo)

---

### Repo 7: openstatusHQ/openstatus

- **URL:** https://github.com/openstatusHQ/openstatus
- **Stars:** 8,300
- **Language:** TypeScript (81.2%), MDX (13.0%), Go (4.3%)
- **Context file(s):** CLAUDE.md — VERIFIED EXISTS
- **Context file location:** `/CLAUDE.md` (root, main branch)
- **Context file quality:** High (106 lines — project overview, complete tech stack, 3-app architecture, build/run instructions, testing procedures, development conventions)
- **Archetype:** Web application (synthetic monitoring platform)
- **Package manager:** pnpm 10.26.0
- **Build tool:** Turbo
- **Key frameworks:** Next.js, React, Tailwind, shadcn/ui, tRPC, Hono, Drizzle ORM, Turso/libSQL, Tinybird, NextAuth.js
- **Approximate source files:** 200-500
- **Uses Bun:** Yes (bunfig.toml present)
- **Last commit:** Recent (1,822 commits, actively maintained)
- **Why selected:** Only qualifying Bun repo. Rich tech stack (Next.js + Hono + Drizzle + tRPC). pnpm+Turbo monorepo. CLAUDE.md covers the full architecture.
- **Analysis target:** `apps/dashboard` + `apps/server` + `packages/` or full repo root

---

### Repo 8: documenso/documenso

- **URL:** https://github.com/documenso/documenso
- **Stars:** 12,400
- **Language:** TypeScript (99.51%)
- **Context file(s):** .cursorrules + AGENTS.md — VERIFIED EXISTS
- **Context file location:** `/.cursorrules` (root) + `/AGENTS.md` (root, main branch)
- **Context file quality:** Medium-High (.cursorrules: ~75 lines covering TypeScript/React conventions, Shadcn UI, tRPC, Remix patterns; AGENTS.md: build/test commands, code style, error handling, UI/styling, tRPC routes, translations)
- **Archetype:** Web application (document signing, Remix)
- **Package manager:** npm 10.7.0
- **Build tool:** Turbo 1.13.4 + Vite 7.2.4
- **Key frameworks:** Remix, React, Prisma, tRPC, Tailwind, Shadcn UI, Lingui (i18n)
- **Approximate source files:** 800-1,000
- **Last commit:** February 17, 2026
- **Why selected:** Only repo with .cursorrules (required for variety). Near-pure TypeScript (99.51%). Remix web app archetype. Has BOTH .cursorrules AND AGENTS.md for richer comparison.
- **Analysis target:** `apps/remix` + `packages/` or full repo root

---

### Repo 9: Effect-TS/effect

- **URL:** https://github.com/Effect-TS/effect
- **Stars:** 13,200
- **Language:** TypeScript (~99%)
- **Context file(s):** AGENTS.md — VERIFIED EXISTS
- **Context file location:** `/AGENTS.md` (root, main branch)
- **Context file quality:** Medium-High (77 lines — development workflow, core principles, mandatory validation steps, code style, barrel file management, changesets, testing conventions with `it.effect` pattern, learning resources)
- **Archetype:** Functional programming library (monorepo)
- **Package manager:** pnpm 10.17.1
- **Build tool:** tsc (TypeScript compiler directly)
- **Key frameworks:** Vitest (@effect/vitest), TypeScript
- **Approximate source files:** 178 (core `effect` package src/), 1000+ across all 31 packages
- **Last commit:** February 17, 2026
- **Why selected:** Unique functional programming paradigm. 31-package monorepo but core package is ideal size (178 files). Advanced TypeScript usage. Provides architectural diversity.
- **Analysis target:** `packages/effect` (core package, 178 src files)

---

### Repo 10: excalidraw/excalidraw

- **URL:** https://github.com/excalidraw/excalidraw
- **Stars:** 117,000
- **Language:** TypeScript (93.9%), SCSS (2.8%)
- **Context file(s):** CLAUDE.md — VERIFIED EXISTS
- **Context file location:** `/CLAUDE.md` (root, master branch — NOTE: uses `master`, not `main`)
- **Context file quality:** Medium (34 lines — 6 sections covering monorepo architecture, development workflow, essential commands; concise but well-structured quick reference)
- **Archetype:** Component library + web app (virtual whiteboard)
- **Package manager:** Yarn 1.22.22
- **Build tool:** Vite 5.0.12
- **Key frameworks:** React, Vite, Yarn workspaces
- **Approximate source files:** 200-400
- **Last commit:** February 17, 2026
- **Why selected:** Most popular repo in the set (117k stars). Component library archetype (the `@excalidraw/excalidraw` npm package). Yarn+Vite pattern (no Turbo). Brief but real context file enables quality comparison.
- **Analysis target:** `packages/excalidraw` (component library) or `excalidraw-app`
- **Note:** Default branch is `master`

---

## Clone Commands

```bash
# Create benchmark directory
mkdir -p /tmp/benchmark-v4/repos && cd /tmp/benchmark-v4/repos

# Clone all 10 repos (shallow clone for speed)
git clone --depth 1 https://github.com/sanity-io/sanity.git
git clone --depth 1 https://github.com/medusajs/medusa.git -b develop
git clone --depth 1 https://github.com/vercel/ai.git
git clone --depth 1 https://github.com/modelcontextprotocol/typescript-sdk.git
git clone --depth 1 https://github.com/webpro-nl/knip.git
git clone --depth 1 https://github.com/unjs/nitro.git
git clone --depth 1 https://github.com/openstatusHQ/openstatus.git
git clone --depth 1 https://github.com/documenso/documenso.git
git clone --depth 1 https://github.com/Effect-TS/effect.git
git clone --depth 1 https://github.com/excalidraw/excalidraw.git
```

## Engine Analysis Commands

```bash
# Run autodocs-engine against each repo's analysis target
# Adjust paths based on your engine binary location

# 1. sanity (CMS monorepo)
autodocs-engine analyze sanity/packages/sanity --root sanity

# 2. medusa (E-commerce API)
autodocs-engine analyze medusa/packages/medusa --root medusa

# 3. vercel/ai (AI SDK)
autodocs-engine analyze ai/packages/ai --root ai

# 4. MCP TypeScript SDK
autodocs-engine analyze typescript-sdk --root typescript-sdk

# 5. knip (CLI tool)
autodocs-engine analyze knip/packages/knip --root knip

# 6. nitro (Backend server)
autodocs-engine analyze nitro --root nitro

# 7. openstatus (Web app + Bun)
autodocs-engine analyze openstatus/apps/dashboard openstatus/apps/server openstatus/packages --root openstatus

# 8. documenso (Remix web app)
autodocs-engine analyze documenso/apps/remix documenso/packages --root documenso

# 9. effect (Functional library — core package only)
autodocs-engine analyze effect/packages/effect --root effect

# 10. excalidraw (Component library)
autodocs-engine analyze excalidraw/packages/excalidraw --root excalidraw
```

---

## Rejection Log

### Rejected for being too large (>1,000 source files):

| Repo | Stars | TS % | Context File | Est. Files | Reason |
|------|-------|------|-------------|------------|--------|
| vercel/next.js | 138k | 29.8% | AGENTS.md (428 lines) | 2,000-3,000+ | Not primarily TS, far too large |
| withastro/astro | 56.9k | 53.8% | AGENTS.md (58 lines) | 1,800-2,500+ | Too large |
| calcom/cal.com | 40.2k | 97.3% | AGENTS.md (244 lines) | 3,000-5,000+ | Far too large |
| n8n-io/n8n | 175k | 91.4% | AGENTS.md (177 lines) | 2,000-5,000+ | Far too large |
| lobehub/lobe-chat | 72.3k | ~90% | AGENTS.md + CLAUDE.md | 2,000-4,000+ | Too large |
| twentyhq/twenty | 39.8k | 79% | .cursor/rules/ + CLAUDE.md | 1,500-3,000+ | Too large, uses Nx (not covered) |
| payloadcms/payload | 40.6k | 96.3% | CLAUDE.md (~9.5KB) | 100+ packages | Far too large |

### Rejected for language/composition issues:

| Repo | Stars | Primary Lang | Reason |
|------|-------|-------------|--------|
| prisma/prisma | 45.3k | TS + Rust/WASM | Multi-language, Rust engine core |
| QwikDev/qwik | 21.9k | TS 57% + Rust 3.9% | Only 57% TypeScript |

### Rejected for inactivity:

| Repo | Stars | Last Commit | Reason |
|------|-------|------------|--------|
| inkline/inkline | 1.4k | Nov 2024 | No commits in 15+ months |

### Rejected for no/insufficient context file:

| Repo | Stars | Reason |
|------|-------|--------|
| elysiajs/elysia | 17.2k | No AGENTS.md, CLAUDE.md, or .cursorrules |
| trpc/trpc | 39.5k | No context files in repo |
| drizzle-team/drizzle-orm | 32.8k | No context files |

### Borderline (considered but not selected):

| Repo | Stars | Reason |
|------|-------|--------|
| triggerdotdev/trigger.dev | 13.7k | Borderline at ~1,000-1,300 files, similar archetype to openstatus |
| remix-run/remix | 32.3k | AGENTS.md only 63 lines; framework archetype covered by nitro |
| vercel/vercel | 14.8k | 44+ packages, TS only 69.6% |
| openai/openai-agents-js | 2.3k | Lower stars (2.3k), similar archetype to vercel/ai |

---

## Notes

### Verification methodology
Every repo was verified by:
1. Fetching the GitHub repo page to confirm stars, language breakdown, and activity
2. Fetching the specific context file URL to confirm existence and assess content quality
3. Fetching package.json to confirm package manager and build tool
4. Estimating source file count from repo structure and language percentages

### Context file naming patterns observed
- **AGENTS.md as primary, CLAUDE.md as symlink:** sanity, vercel/ai, knip, effect
- **CLAUDE.md as primary, no AGENTS.md:** MCP SDK, medusa, openstatus, excalidraw
- **AGENTS.md + CLAUDE.md redirect (1-line `@AGENTS.md`):** nitro
- **.cursorrules + AGENTS.md:** documenso (only repo with .cursorrules)

### Branch conventions
- Most repos use `main` as default branch
- **Exceptions:** excalidraw uses `master`, medusa uses `develop`
