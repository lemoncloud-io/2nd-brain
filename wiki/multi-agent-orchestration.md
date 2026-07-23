---
type: pattern
topics:
  - ai-agents
status: draft
sources:
  - "raw/드디어 나에게 딱 맞았던 AI 에이전트 설정 Hermes + OpenAI Codex + Claude Code.md"
created: "2026-07-23"
updated: "2026-07-23"
---

# Multi-Agent Orchestration

## Summary

Multi-agent orchestration is the pattern of assigning distinct roles to
specialized AI agents and tools instead of forcing a single model in a single
chat window to do everything. An always-on coordinator routes work to the tool
best suited for each role, reads back results, verifies them, and reports. In
one documented hobbyist setup this replaced a "chatbot loop" and reportedly
worked better than using a single strong model as the sole brain.

## Principles

- **Stop forcing one model to do everything.** The single-model trap is the
  main thing that stops most people; splitting by role solves flow problems.
- **Match each role to the best-fit tool.** Coordinator, main reasoning brain,
  and focused coding worker are separate concerns with different ideal tools.
- **Use subscription-authenticated tools over per-token APIs when possible.**
  In the source setup, both the orchestrator and the coding specialist ran on
  flat-rate subscriptions (OAuth / CLI subscription auth) rather than metered
  API keys, so the worst case was a temporary rate limit, not a bill.
- **Prefer capable hosted tools over weak local models for full agent use.** A
  local Ollama model technically worked but was too slow for the whole loop.

## Workflow

1. The user tells the orchestrator what they want.
2. The orchestrator decides whether to handle it directly or delegate the
   coding portion to the coding specialist.
3. The coding specialist writes, reviews, or edits code.
4. The orchestrator checks results, runs quick tests, wires into the system,
   and reports back.

A concrete role assignment from the source:

- **Orchestrator / automation layer** — [[hermes-agent|Hermes]]
- **Main agent brain** — OpenAI Codex
- **Coding specialist** — [[claude-code|Claude Code]]
- **Execution environment** — the local machine (files, cron, email, shell)
- **Remote control interface** — Telegram

## When To Use

- You already have an always-on box (mini PC, NUC, small Linux server), a
  coding-model subscription, and a general agent subscription.
- You are comfortable with a little terminal setup.
- You want a practical personal operating system rather than a novelty, and are
  hitting the limits of a single-model chat loop.

## Related Concepts

- [[hermes-agent|Hermes]] — the orchestrator role in the source setup
- [[claude-code|Claude Code]] — the coding-specialist role
