# Vault Rules

This vault is an AI Second Brain operated through Hermess and Obsidian.

These rules are model-neutral. Use them with GPT, Claude, Codex, or any other LLM that can read and edit this vault.

## Session Start

Before any vault operation, read:

1. `wiki/VAULT_MEMORY.md`
2. `wiki/INDEX.md`
3. The relevant Hermess skill in `projects/second-brain/config/skills/`

If a task is project-specific, also read the matching `projects/<name>/README.md`.

## Directory Contract

| Directory | Role |
| --- | --- |
| `Clippings/` | New source inbox |
| `raw/` | Processed source originals. Append-only |
| `wiki/` | Concept articles, one concept per file |
| `wiki/topics/` | Topic index pages |
| `outputs/` | Query answers, analysis reports, lint results |
| `projects/` | Project execution context and project-scoped outputs |
| `docs/` | System specs, setup notes, and configuration docs |

## Core Rules

- Do not edit file contents in `raw/`.
- Preserve source provenance.
- Prefer updating existing wiki notes over creating duplicate notes.
- Use English kebab-case filenames for wiki notes.
- Use `[[wikilinks]]` for related wiki concepts.
- Do not use wikilinks for raw source files unless a corresponding wiki source note exists.
- Use Obsidian aliases as `[[note-slug|Alias]]`; do not escape the pipe character.
- Save durable answers under `outputs/` or `projects/<name>/outputs/`.
- Query-style answers that should be retained must not finish as chat-only output.
- If `outputs/` does not exist when saving a retained answer, create it.
- Keep project execution context in `projects/`; move reusable concepts to `wiki/`.
- Mark unsupported claims as inference or `needs-update`.

## Wiki Frontmatter

Every normal `wiki/` article should include:

```yaml
---
type: concept
topics:
  - knowledge-management
status: draft
sources:
  - "raw/source-file-name.md"
---
```

Use `sources` for direct provenance. If the source is a processed raw clipping, store the
`raw/...` path as a string. Use `[[wikilinks]]` only when the source is an actual wiki note.

Allowed `type` values:

- `concept`
- `tool`
- `model`
- `framework`
- `pattern`
- `protocol`
- `topic`

Allowed `status` values:

- `stub`
- `draft`
- `complete`
- `needs-update`

## Workflows

Use the Hermess skills as the source of truth:

- `vault-ingest`: process `Clippings/` into `raw/`, `wiki/`, topics, index, and memory.
- `vault-query`: answer from existing wiki knowledge and save retained answers to `outputs/`.
- `vault-lint`: inspect vault quality and update `wiki/VAULT_MEMORY.md`.
