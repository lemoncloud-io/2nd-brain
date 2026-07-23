---
type: tool
topics:
  - ai-agents
status: stub
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
created: "2026-07-23"
updated: "2026-07-23"
---

# Claude Code

## Summary

Claude Code is Anthropic's CLI coding tool, used in the source setup as a
focused coding specialist within a [[multi-agent-orchestration|multi-agent
setup]]. Because it authenticates against the user's own Claude subscription
(e.g. Claude Max) via its own OAuth, an orchestrator like [[hermes-agent|Hermes]]
can call it as a subprocess without consuming Anthropic API credits — from
Anthropic's side it looks like the user typing commands in a terminal.

## Use Cases

- Scoped coding worker: write, review, or edit code on delegated tasks.
- Called non-interactively as `claude -p "task" --max-turns N`, or run
  interactively inside a `tmux` session for longer work.

## Setup Notes

- Authentication is via the Claude subscription's own OAuth. What you *cannot*
  do is use the Claude subscription as a model provider that the orchestrator
  calls directly over the API — running the Claude Code CLI as a subprocess is
  the supported path.
- `needs-update` (time-sensitive, per a 2026-05-14 edit in the source):
  Anthropic announced that from **2026-06-15**, `claude -p` and Agent SDK usage
  are split out of the Claude subscription pool. Each tier gets separate monthly
  credits billed at API rates (Pro $20, Max 5x $100, Max 20x $200), which do not
  roll over. Interactive Claude Code in the terminal stays on the subscription;
  programmatic use (`-p`, SDK, GitHub Actions, third-party harnesses) moves to
  the new credit buckets. Verify current billing before relying on this.
- Known billing escape hatches to watch (per source, unverified): a `claude -p`
  headless bug that silently routes to API rates even without
  `ANTHROPIC_API_KEY` set, and harness signatures (e.g. a `HERMES.md` string in
  project files / commit messages) tripping a classifier that flags third-party
  harness use. The author suggests checking `claude /status`,
  `echo $ANTHROPIC_API_KEY`, and platform API usage. `needs-update`.

## Related Concepts

- [[multi-agent-orchestration|Multi-Agent Orchestration]]
- [[hermes-agent|Hermes]]

## Open Questions

- After the 2026-06 programmatic-usage change, what is the cleanest supported
  way to run Claude Code under an orchestrator (interactive `tmux` vs headless)?
