# autodocs-engine

Codebase intelligence engine for generating AI context files

## Commands

Standard `npm` scripts — see `package.json` for details.

## Workflow Rules

- For linting and formatting → Use Biome (`npm run lint`), NOT ESLint or Prettier — they are not configured
- After modifying source files → Run `npm run test` to verify changes
- When modifying `src/types.ts` → Also check: `src/analysis-builder.ts` (17 symbols), `src/mcp/queries.ts` (12 symbols), `src/ast-parser.ts` (8 symbols), and 11 more
- When modifying `test/wave2-improvements.test.ts` → Also check: `src/output-validator.ts` (co-changed in 60% of its commits), `src/templates/agents-md.ts` (co-changed in 38% of its commits)
- When modifying `src/bin/autodocs-engine.ts` → Also check: `src/config.ts` (co-changed in 64% of its commits), `src/index.ts` (co-changed in 57% of its commits)

## Conventions

- **DO**: Tests use Vitest (e.g., `41 test files`)
- **DO**: Tests use Vitest 4.0.18 (e.g., `41 test files detected`)
- **DON'T**: Do NOT use camelCase or PascalCase for filenames

## Key Directories (non-exhaustive)

- `src/benchmark/` — Feature: benchmark
- `src/detectors/` — Feature: detectors
- `src/llm/` — Feature: llm
- `src/mcp/` — Feature: mcp
- `src/templates/` — Feature: templates

> **Example**: See `src/detectors/build-tool.ts` for the canonical pattern (register in `src/convention-extractor.ts`).