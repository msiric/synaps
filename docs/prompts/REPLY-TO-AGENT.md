# Reply to the Opus Agent

Copy everything below into the chat.

---

Thank you for the thorough re-review and the direct answers. We went through every point systematically and here's where we land:

## Where We Strongly Agree

### The deterministic template insight is the one we missed.

Your recommendation #2 — "stop using the LLM to generate prose for data-grounded sections" — is the most actionable advice we've received. We've spent 5+ template iterations trying to make the LLM faithfully format structured data. The answer isn't better prompting; it's not using the LLM for things code can do.

Looking at our AGENTS.md sections:
- **Commands:** We have exact command strings. Code can format a markdown table.
- **Public API:** We have names, kinds, signatures, import counts. Code can list them.
- **Tech Stack:** We have framework names and versions. Code can format a one-liner.
- **Dependencies:** Same. Code.
- **Conventions:** Same. Code.
- **Contribution Patterns:** Same. Code.

The LLM is only genuinely needed for:
- One-sentence project summary (synthesis)
- Architecture capabilities (combining call graph + patterns into natural language)
- Domain terminology (needs external context like README)

This is maybe 20-30% of the output. We've been sending 100% through the LLM and getting hallucinations in the 70% that should have been deterministic.

### "Don't give the LLM more information, give it less freedom."

We were considering a hybrid approach (structured analysis + source code → LLM). Your argument against it is convincing: it would give the LLM more material to hallucinate from while degrading our budget and signal-to-noise advantages. The right direction is constraining the LLM's scope, not expanding its input.

### We are over-benchmarking and under-shipping.

You're right. Four benchmark iterations, docs larger than source code, zero users. The "99% of projects have no AGENTS.md at all" framing is the correct competitive reference, not the hand-written files from dedicated maintainers.

One caveat we're holding firm on: we won't ship with known hallucination issues. "React" in a CLI tool's AGENTS.md isn't "better than nothing" — it's actively misleading. The deterministic template approach fixes this for the majority of the output, making shipping safe.

### README extraction for domain context.

Smart, bounded, low-risk. We already detect README presence but don't read it. Extracting the first paragraph for domain terminology is a targeted use of the LLM that's much less hallucination-prone than generating a full AGENTS.md.

### "Accurate foundation + add your domain knowledge" framing.

This is exactly the right positioning given our strengths (structural accuracy) and structural weakness (domain knowledge). The Team Knowledge placeholder section we already include is the mechanism for this.

## Where We Partially Agree

### Eval framework deprioritized, not abandoned.

You're right that our benchmark IS an eval framework and more evaluation won't fix hallucinations. But the long-term metric — "does this AGENTS.md actually help AI tools produce better code?" — is different from "does this AGENTS.md look good to an evaluator?" We'll revisit task-completion eval after shipping and getting usage data.

### "The approach is sound."

Agree, but the data also shows the approach has a natural ceiling. AST analysis → structured data → formatting produces excellent structural output but can't capture semantic understanding. We're accepting this ceiling rather than fighting it, and positioning accordingly.

## Where We're Slightly Skeptical

### "Ship v1.0 — version number matters less than you think."

For developer tools, "1.0" signals production-ready. Given that the hallucination fix (deterministic templates) isn't implemented yet, shipping as "0.9-beta" or "0.5" is more honest. We'll call it 1.0 after the deterministic approach proves out.

### Scoring calibration.

You evaluated based on our benchmark scores, but there's a methodological issue we discovered: different evaluator sessions produce meaningfully different scores for the same output. The V2→V3 "regression" (5.9→5.5) was partly calibration shift plus 2 repos with invalid target paths, not purely quality degradation. Our actual quality on valid repos improved. This doesn't change your recommendations but it means the headline numbers are noisier than they appear.

## What We're Doing Next

1. **Implement deterministic template generation.** Code-generate Commands, Public API, Tech Stack, Dependencies, Conventions, Contribution Patterns sections. No LLM for data-grounded content.

2. **Use LLM only for synthesis sections.** Project summary, architecture capabilities, domain terminology. Small, constrained prompts for each.

3. **Add README first-paragraph extraction.** Bounded domain context for the LLM synthesis step.

4. **Ship.** After verifying the deterministic approach eliminates hallucinations on our benchmark repos.

5. **Get users.** Community posts, GitHub Action, `npx autodocs-engine init` convenience command.

We'll share the results of the deterministic template approach if you're interested in seeing whether it closes the accuracy gap as predicted. Thanks again for the honest analysis — the "fill in blanks, don't generate prose" insight is exactly what we needed to hear.
