# Vault Memory

Loaded at the start of every vault operation. Keep this file under 200 lines.

## Vault Identity

- Vault root is the resolved `$VAULT_DIR` (the cloned repo folder); never hardcode an absolute machine path.
- This repo is an initial environment for a future real knowledge folder setup.
- Runtime tools must not silently fall back to `~/knowledge`; use explicit `VAULT_DIR` or a verified vault root.

## Operating Defaults

- `Clippings/` is the inbox for new markdown sources.
- Processed source originals move to `raw/` unchanged; `raw/` is append-only.
- Durable query and lint outputs are saved under `outputs/` unless project-scoped.
- Reusable concepts belong in `wiki/`; project execution context belongs in `projects/`.
- Use matching files in `templates/` before creating new note structures.

## Automation Policy

- Ingest and lint automation should prefer Claude Code when the `claude` CLI is installed and authenticated.
- If Claude Code is unavailable, blocked, or unauthenticated, Hermes must run the Hermes-native fallback workflow instead of failing silently.
- Delegated agents must receive the resolved absolute `VAULT_DIR` and must only read/write below that path.

## Current State

- Created: 2026-07-08
- Last Lint Pass: never
- Last Ingest: 2026-07-23 — processed 1 clipping (Hermes + Codex + Claude Code multi-agent setup) into 3 wiki notes under the `ai-agents` topic.
- Topics so far: `ai-agents`, `knowledge-management`.
- Open needs-update: Claude Code programmatic-billing change effective 2026-06-15 and related billing caveats (see [[claude-code]]); orchestrator model choice and backup/failover unclear (see [[hermes-agent]]).
