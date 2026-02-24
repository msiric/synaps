# Roadmap

## Current State (v0.5.0)

**501 tests. ~18K lines. 65+ modules. Zero technology hallucinations.**

The engine produces focused AGENTS.md files via deterministic static analysis:
- **Minimal mode** (`--minimal`) — <500 token output matching developer-written file characteristics
- **Full mode** — 14 deterministic sections + 2 optional micro-LLM sections
- **MCP server** — 8 tools with path-scoped filtering for live codebase queries
- **Staleness detection** — `check` command for CI pipelines

## Priorities

### Ship (Now)
- [ ] npm publish v0.5.0
- [ ] Blog post: "What We Learned Measuring AGENTS.md Effectiveness"
- [ ] GitHub Action wrapping `check` command for drift detection

### Validate (Next)
- [ ] Get 10-20 real users
- [ ] Track which MCP tools get called and how often
- [ ] Measure user retention (do they keep it in their workflow?)

### Expand (Later, driven by user feedback)
- [ ] Python support via tree-sitter (researched, 4-5 week effort)
- [ ] Additional MCP tools: `get_test_command`, `get_examples`, `get_task_context`
- [ ] Convention enforcement in CI (PR review comments)
- [ ] HTTP transport for MCP server

## Research Findings

The product direction is grounded in peer-reviewed research:
- Developer-written focused AGENTS.md: **+4% accuracy, -29% runtime** ([arxiv 2601.20404](https://arxiv.org/abs/2601.20404))
- LLM-generated comprehensive AGENTS.md: **-0.5% to -2%** ([arxiv 2602.11988](https://arxiv.org/abs/2602.11988))
- Only correctly-selected, curated summaries help; unfiltered context hurts ([arxiv 2602.08316](https://arxiv.org/abs/2602.08316))

Full research synthesis: [docs/research/RESEARCH-CONTEXT-FILES-2026.md](research/RESEARCH-CONTEXT-FILES-2026.md)
