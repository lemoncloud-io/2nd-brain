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

# Hermes

## Summary

Hermes is an always-on AI agent used as the coordinator (orchestrator) in a
[[multi-agent-orchestration|multi-agent setup]]. It holds memory, tools,
scheduled tasks, and messaging, and can actually act on the local machine: send
email, run scripts, check files, communicate over Telegram, manage cron, and
coordinate work. In the source setup its main reasoning brain was OpenAI Codex,
authenticated through a ChatGPT subscription over OAuth rather than a metered
API key.

## Use Cases

- Central orchestrator that decides whether to act directly or delegate.
- Delegating scoped coding tasks to [[claude-code|Claude Code]] via a plain CLI
  subprocess call, then reading results and reporting.
- Scheduling and automation (cron, email, shell, Home Assistant, messaging).

## Setup Notes

- The source author shells out directly with no wrapper, e.g.
  `claude -p "task here" --max-turns 10`, so Hermes never touches the Anthropic
  API — to Anthropic it looks like a normal terminal command. `needs-update`:
  this delegation pattern has a billing caveat (see [[claude-code|Claude Code]]).
- Hermes-managed Node drops the `claude` binary at `~/.hermes/node/bin/claude`,
  which is not on `PATH` by default. The author added it to `bashrc` and
  symlinked it into `~/.local/bin/` so Hermes could find it cleanly.
- For longer sessions the author runs Claude interactively inside `tmux` while
  Hermes monitors, instead of headless `-p`.

## Related Concepts

- [[multi-agent-orchestration|Multi-Agent Orchestration]]
- [[claude-code|Claude Code]]

## Open Questions

- Which model the author uses for the orchestrator itself (asked in comments,
  unanswered in the source). `needs-update`.
- Reliable backup / failover model when the primary subscription hits a rate
  limit (source only speculates about OpenRouter + DeepSeek / Gemini 2.5 Flash).
