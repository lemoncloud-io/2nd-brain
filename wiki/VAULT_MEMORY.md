# Vault Memory

Loaded at the start of every vault operation. Keep this file under 200 lines.

## Vault Identity

- Vault root for this sandbox initialization environment: `/Users/dujung/sandbox`.
- This sandbox is an initial environment for a future real knowledge folder setup.
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
- Known initial issue: the vault starts with one pending clipping and no compiled wiki articles yet.
