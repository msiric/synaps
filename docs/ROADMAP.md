# Roadmap

## Current State (v0.6.0)

**501 tests. ~18K lines. 65+ modules. 10 MCP tools. Zero technology hallucinations.**

- **MCP server** — 10 tools with path-scoped filtering, blast radius, confidence levels, example code, freshness metadata
- **Flagship tools**: `plan_change` (full change impact analysis) and `get_test_info` (per-file test mapping)
- **Minimal mode** (`--minimal`) — <500 token output matching developer-written file characteristics
- **Full mode** — 14 deterministic sections + 2 optional micro-LLM sections
- **Staleness detection** — `check` command for CI pipelines
- **Published on npm** — `npx autodocs-engine serve` / `npx autodocs-engine init --minimal`

## Priorities

### Get Users (Now)
- [ ] Blog post: "What We Learned Measuring AGENTS.md Effectiveness"
- [ ] HN launch: Show HN with honest benchmark data
- [ ] GitHub Action wrapping `check` command for drift detection
- [ ] Collect user feedback on which MCP tools get used

### Validate (Next)
- [ ] Track MCP tool invocation frequency
- [ ] Measure user retention (do they keep it in their workflow?)
- [ ] Identify which tools are never called (candidates for removal)

### Expand (Later, driven by user feedback)
- [ ] Python support via tree-sitter (researched, 4-5 week effort)
- [ ] Additional MCP tools: `check_registration`, `get_dependency_path`, `get_recent_changes`
- [ ] Convention enforcement in CI (PR review comments)
- [ ] Session memory — learn project-specific workflow patterns
- [ ] HTTP transport for MCP server

## Research Findings

The product direction is grounded in peer-reviewed research:
- Developer-written focused AGENTS.md: **+4% accuracy, -29% runtime** ([arxiv 2601.20404](https://arxiv.org/abs/2601.20404))
- LLM-generated comprehensive AGENTS.md: **-0.5% to -2%** ([arxiv 2602.11988](https://arxiv.org/abs/2602.11988))
- Only correctly-selected, curated summaries help; unfiltered context hurts ([arxiv 2602.08316](https://arxiv.org/abs/2602.08316))

Full research synthesis: [docs/research/RESEARCH-CONTEXT-FILES-2026.md](research/RESEARCH-CONTEXT-FILES-2026.md)
