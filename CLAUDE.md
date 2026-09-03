# Claude Instructions

Before vault work, read:

1. `VAULT_RULES.md` — directory contract, note contracts, workflows
2. `wiki/VAULT_MEMORY.md` — current state and pointers
3. `wiki/INDEX.md` — canonical wiki article list
4. The matching file in `templates/` when creating a note or output

## Vault Root

`VAULT_DIR` is the vault root. Use the user-provided value when present; otherwise infer it
from the current working directory **only** when `VAULT_RULES.md`, `wiki/`, `raw/`,
`Clippings/`, `outputs/`, and `templates/` are all present. Never silently fall back to
`~/knowledge` — that path is only a setup example. If the root is unclear, ask before reading
or writing. Read and write only under the resolved root.

## Hard Invariants

- `raw/` and `archive/` are append-only. Never edit, rename, or delete files there.
  Contract: `docs/raw-layout.md`.
- Never commit personal experiment data — per-item labels over personal media, personal
  photo/file content descriptions, or local sample folder names/paths. Aggregate metrics
  only. Contract: `VAULT_RULES.md` § Core Rules.
- `wiki/VAULT_MEMORY.md` is loaded every session and capped at 8 KB (`wc -c`) — bytes, not
  lines. Never append per-run narrative to it. Contract: `VAULT_RULES.md` § Core Rules.

## Gotchas

- Never leave machine-specific absolute paths in vault documents. Prefer relative vault
  paths (`wiki/INDEX.md`, `raw/<file>.md`); in user-facing docs use `$VAULT_DIR` or
  `~/knowledge`, not resolved paths like `/Users/.../knowledge`.
- Source provenance is the string `"raw/<source-file-name>.md"`, not a raw-file wikilink.
- Obsidian aliases are `[[note-slug|Alias]]`. Do not escape the pipe.
- Use the matching `templates/` file before inventing a note or output structure.

## Development Work

This file governs vault operations only. Frontend/backend service development for the
organization that owns this vault is documented separately: if `projects/devops/README.md`
exists, read it before any such task — it holds the organization-specific entry points
(canonical docs, skills, layer model). If it does not exist, say that development guidance
is not written for this vault rather than inferring conventions from this file.

## Workflows

Skills in `projects/second-brain/config/skills/` are the source of truth for procedures.
Prefer Claude Code for ingest and lint; if the `claude` CLI is missing, unavailable, or
unauthenticated, report that and let Hermes run the native fallback (`vault-ingest`,
`vault-query`, `vault-lint`). Delegated ingest follows `vault-ingest-claude.md`.
