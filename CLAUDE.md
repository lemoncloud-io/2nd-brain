# Claude Instructions

This repository is a markdown knowledge vault sandbox. It is the initial environment for a future production knowledge folder.

Before vault work, read:

1. `VAULT_RULES.md`
2. `wiki/VAULT_MEMORY.md`
3. `wiki/INDEX.md`
4. Matching files in `templates/` when creating notes or outputs

Vault root rules:

- Use the user-provided `VAULT_DIR` when present.
- Otherwise infer the vault root from the current working directory only when it contains `VAULT_RULES.md`, `wiki/`, `raw/`, `Clippings/`, `outputs/`, and `templates/`.
- Never silently fall back to `~/knowledge`; that path is only a setup example.
- Resolve `VAULT_DIR` to an absolute path before delegated or automated work.
- Only read or write under the resolved vault root.

Safety rules:

- Do not edit file contents in `raw/` or `archive/`; both are append-only.
- Use templates before inventing new note structures.
- Preserve raw source provenance as `"raw/<source-file-name>.md"`, not raw-file wikilinks.
- Use Obsidian aliases as `[[note-slug|Alias]]`, not escaped-pipe links.

Workflow priority:

- Ingest and lint automation should prefer Claude Code when available.
- If the `claude` CLI is missing, unavailable, or unauthenticated, report that and let Hermes run the Hermes-native fallback workflow.
- For delegated ingest, follow `projects/second-brain/config/skills/vault-ingest-claude.md`.
- For fallback ingest/query/lint, follow the relevant Hermes skill:
  - `vault-ingest`
  - `vault-query`
  - `vault-lint`
