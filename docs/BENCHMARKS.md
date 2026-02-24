# Benchmarks

## Summary

Two benchmark systems exist, measuring different things:

### Synthetic Benchmark (v1) — 20 Repos
Tests whether AGENTS.md improves AI adherence to detected contribution patterns.
- **10/20 positive, 5/20 neutral, 5/20 negative** (original run)
- Commands: +2.6% avg (safest section — almost never hurts)
- Architecture: +20.2% avg (highest value when available)
- Patterns: +2.3% avg but -59% to +59% range (high variance)
- Full data: [docs/benchmarks/BENCHMARK-RESULTS-20-REPOS.md](benchmarks/BENCHMARK-RESULTS-20-REPOS.md)
- Root cause analysis: [docs/benchmarks/BENCHMARK-ANALYSIS-ROOT-CAUSE.md](benchmarks/BENCHMARK-ANALYSIS-ROOT-CAUSE.md)

### PR-Based Benchmark (v2) — 3 Repos (Pilot)
Tests whether AGENTS.md helps AI match real developer commits.
- File placement A-B delta: -3.1% (AGENTS.md slightly hurts on average)
- 77% of tasks: all conditions tied (directories are obvious)
- Strongest signal: barrel update behavior (A=50% vs B=0%)
- Methodology: [docs/plans/BENCHMARK-V2-PLAN.md](plans/BENCHMARK-V2-PLAN.md)

### Key Finding
Comprehensive AGENTS.md can hurt through "directory anchoring" — the AI treats listed directories as a closed set and misses unlisted locations. The inferability scoring system and minimal mode directly address this by suppressing sections when they'd be redundant or harmful.

## Running Benchmarks

```bash
# PR-based benchmark (recommended)
ANTHROPIC_API_KEY=sk-... npx tsx src/bin/autodocs-engine.ts benchmark . --mode pr --verbose

# Synthetic benchmark (legacy)
ANTHROPIC_API_KEY=sk-... npx tsx src/bin/autodocs-engine.ts benchmark . --verbose

# Calibrate inferability on a repo
npx tsx scripts/calibrate-inferability.ts /path/to/repo
```

Results are saved to `benchmark-results/` (gitignored — regenerate locally).
