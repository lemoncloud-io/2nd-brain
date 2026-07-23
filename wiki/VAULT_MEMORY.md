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
- Project-specific skills, prompts, generated tools, and automation config live under `projects/<name>/config/` as source-of-truth files; runtime settings are derived from them.
- Execution-generated runtime state/intermediate files under project outputs stay untracked and ignored unless explicitly promoted to retained documentation.
- Use matching files in `templates/` before creating new note structures.
- New wiki article body prose is written in Korean; headings, frontmatter, code, and proper nouns stay English (effective 2026-07-09, see `VAULT_RULES.md` § Language Convention). Existing English-body articles convert opportunistically, not in bulk.
- External GitHub repos are tracked as lightweight `projects/@<owner>/<repo>/README.md` notes (identity `org/repo`; local clones at `$GITHUB_DIR/<org>/<repo>`, default `~/Documents`; team orgs and personal accounts share the structure, personal marked `scope: personal`); agents propose sync changes, the user approves final status/goal/next_action, and sync coverage follows each runner's GitHub permissions. See `VAULT_RULES.md` § GitHub-Linked Projects.

## Automation Policy

- Ingest and lint automation should prefer Claude Code when the `claude` CLI is installed and authenticated.
- If Claude Code is unavailable, blocked, or unauthenticated, Hermes must run the Hermes-native fallback workflow instead of failing silently.
- Delegated agents must receive the resolved absolute `VAULT_DIR` and must only read/write below that path.
- Claude-led ingest runs on an `ingest/<date>-<author-slug>` branch (author-slug = GitHub login, or a slugified git user name), commits the result, then automatically pushes and opens a PR (base `master`) without waiting for confirmation; merging the PR still requires explicit user approval. See `projects/second-brain/config/skills/vault-ingest-claude.md`.

## Current State

- Created: 2026-07-08
- Last Lint Pass: never
- Last Ingest: 2026-07-23 — processed 1 clipping (Hermes multi-agent setup); created wiki `multi-agent-orchestration`, `hermes-agent` and topic `ai-agents`.
- Open items: `claude-code` referenced by new notes but has no wiki article yet; both new articles are `stub` and carry `needs-update` on provider-billing claims.
