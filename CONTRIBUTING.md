# Contributing to synaps

## Quick Start

```bash
git clone https://github.com/msiric/synaps.git
cd synaps
npm install
npm test          # 713 tests
npm run typecheck # 0 errors
npm run lint      # Biome linter + formatter
npm run build     # Compile to dist/
```

## Development Workflow

1. Create a branch from `main`
2. Make changes
3. Run `npm run lint:fix` to format
4. Run `npm run typecheck && npm test` — both must pass
5. Open a PR against `main`

## Conventions

- **File naming:** kebab-case (e.g., `import-chain.ts`, `git-history.ts`)
- **Test files:** `test/` directory mirroring `src/` structure (e.g., `test/diagnose.test.ts`)
- **Test framework:** Vitest
- **Linter/formatter:** Biome (run `npm run lint:fix`)
- **Imports:** Use `node:` protocol for Node.js builtins (e.g., `import { resolve } from "node:path"`)
- **No default exports:** Use named exports exclusively
- **Docs:** Update in the same commit as features

## Project Structure

- `src/` — Source code (TypeScript)
- `src/mcp/` — MCP server, tool handlers, queries, cache
- `src/detectors/` — Convention detectors (9 total)
- `src/bin/` — CLI entry points
- `test/` — Test files
- `docs/` — Plans, research, reviews, session handoffs

## Adding a New Convention Detector

See `src/detectors/` for examples. Each detector exports a function matching the `ConventionDetector` type. Register it in `src/convention-extractor.ts`.

## Branch Protection

The `main` branch requires:
- All CI checks passing (lint, typecheck, build, test)
- At least 1 review approval
- No direct pushes — all changes via PR

## Adding a New MCP Tool

1. Add query function(s) to `src/mcp/queries.ts`
2. Add handler to `src/mcp/tools.ts`
3. Register in `src/mcp/server.ts` with zod schema + WHEN TO CALL / DO NOT CALL
4. Add tests
5. Update README tool table
