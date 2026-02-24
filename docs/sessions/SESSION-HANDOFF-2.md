# Session Handoff 2: autodocs-engine (2026-02-23)

## What Happened This Session

### Phase 1: Deep Investigation of V1 Benchmark
- Found benchmark data document is internally contradictory (3 separate runs mixed)
- Real post-fix distribution: 12/20 positive (60%), 5/20 neutral (25%), 3/20 negative (15%)
- Methodology has fundamental weaknesses (n=3-5, generic tasks, self-referential scoring)
- All three code fixes (non-exhaustive dirs, obvious dir filtering, workspace filter) ARE implemented

### Phase 2: PR-Based Benchmark V2 Built
- 4 new modules: pr-miner.ts, pr-task-gen.ts, pr-scorer.ts, pr-runner.ts
- 38 new tests (477 total, all passing, 0 type errors)
- CLI wired up: `--mode pr` flag
- Pilot run on 3 repos with real LLM calls (13 tasks total)
- Results: A-B delta = -3.1% (AGENTS.md slightly hurts on file placement)
- Positive signal: barrel update behavior (A=50% vs B=0%)

### Phase 3: Research Literature Review
- "Evaluating AGENTS.md" (2602.11988): LLM-generated context hurts (-2%), developer-written helps (+4%)
- "AGENTS.md Efficiency" (2601.20404): Focused real files reduce runtime 29%
- ContextBench, SWE Context Bench, "Less is More" — all support "focused > comprehensive"
- Full synthesis: RESEARCH-CONTEXT-FILES-2026.md

### Phase 4: 6-Model Product Direction Brainstorm
- Universal consensus: MCP server = primary product, static AGENTS.md = compatibility export
- Publish honest benchmark data as marketing
- Ship NOW to npm
- Full synthesis: BRAINSTORM-SYNTHESIS.md

### Phase 5: Minimal Mode Design
- Detailed plan: MINIMAL-MODE-PLAN.md
- Adversarial review by 6 models: ADVERSARIAL-REVIEW-MINIMAL-MODE-SYNTHESIS.md
- Key revisions: kill switch for "correct but useless," boolean signal gates, ≥95% convention confidence, capped commands, example pointer

### Phase 6: Implementation Plan (APPROVED, ready to build)
- Implementation plan: .claude/plans/nifty-cuddling-wind.md
- One new function: generateMinimalAgentsMd in deterministic-formatter.ts
- 5 files modified, 1 new test file
- No existing code modified (additive only)

## Current State
- 477 tests passing, 0 type errors
- v0.5.0 ready but not published to npm
- Minimal mode implementation plan approved, coding about to start

## Key Files Created This Session
- src/benchmark/pr-miner.ts — PR mining
- src/benchmark/pr-task-gen.ts — task prompt generation
- src/benchmark/pr-scorer.ts — file placement scoring
- src/benchmark/pr-runner.ts — benchmark orchestrator
- RESEARCH-CONTEXT-FILES-2026.md — literature review
- BRAINSTORM-PRODUCT-DIRECTION.md — brainstorm prompt
- BRAINSTORM-SYNTHESIS.md — product direction synthesis
- MINIMAL-MODE-PLAN.md — minimal mode design
- ADVERSARIAL-REVIEW-MINIMAL-MODE-SYNTHESIS.md — review synthesis
- benchmark-results/pr-pilot-*/ — pilot benchmark data

## Next Steps (In Order)
1. Implement minimal mode (plan approved)
2. npm publish v0.5.0
3. Blog post with honest benchmark data
4. GitHub Action for drift detection
5. Get 10-20 real users
