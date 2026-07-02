# Vault Rules

This vault is an AI Second Brain operated through Hermess and Obsidian.

These rules are model-neutral. Use them with GPT, Claude, Codex, or any other LLM that can read and edit this vault.

## Session Start

Before any vault operation, read:

1. `wiki/VAULT_MEMORY.md`
2. `wiki/INDEX.md`
3. The relevant Hermess skill in `projects/second-brain/config/skills/`

If a task is project-specific, also read the matching `projects/<name>/README.md`.

## Obsidian CLI

When Obsidian is running, use `/obsidian-cli` skill commands for vault operations (search, link analysis, frontmatter edits). Prefer `obsidian search:context query="..."` over grep for note content, and `obsidian backlinks file=<name>` to check incoming links. For bulk operations across many files, direct file tools (Read/Edit/Write) remain appropriate.

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

### type values

- `concept` — abstract idea, pattern, or architecture
- `tool` — specific software or CLI tool
- `model` — AI model family or variant
- `framework` — structured methodology or platform
- `pattern` — repeatable workflow or technique
- `protocol` — technical specification
- `topic` — reserved for wiki/topics/ pages only

### status values

- `stub` — under 350 words; needs expansion
- `draft` — substantial content but not fully reviewed
- `complete` — reviewed and comprehensive
- `needs-update` — new source has materially changed the topic

## Topic Pages (wiki/topics/)

Frontmatter:

```yaml
---
type: topic
up: "[[topics/parent-topic]]"   # omit for root topics
---
```

Body: one-line list of related wiki articles with [[wikilinks]].  
10+ linked articles → consider splitting into sub-topics.  
Full topic list → `wiki/TOPIC_MAP.md`.

---

## Workflows

Use the Hermess skills as the source of truth:

- `vault-ingest`: process `Clippings/` into `raw/`, `wiki/`, topics, index, and memory.
- `vault-query`: answer from existing wiki knowledge and save retained answers to `outputs/`.
- `vault-lint`: inspect vault quality and update `wiki/VAULT_MEMORY.md`.
