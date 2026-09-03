# Vault Rules

This vault is an AI Second Brain operated through Hermes and Obsidian.

These rules are model-neutral. Use them with GPT, Claude, Codex, or any other LLM that can
read and edit this vault. Session read order and vault-root resolution are in `CLAUDE.md`;
this file is the contract layer.

## Directory Contract

| Directory | Role |
| --- | --- |
| `Clippings/` | New source inbox |
| `raw/` | Processed source originals — web clippings, repo-doc snapshots. Append-only. Contract: `docs/raw-layout.md` |
| `wiki/` | Concept articles, one concept per file |
| `wiki/topics/` | Topic index pages |
| `outputs/` | Query answers, analysis reports, lint results, per-run logs (`runs/`) |
| `templates/` | Obsidian and LLM output templates |
| `projects/` | Project execution context and project-scoped outputs |
| `projects/<name>/config/` | Project-local skills, prompts, scripts, and tool configuration source files |
| `areas/` | Ongoing responsibility areas: `daily/` notes, `weekly/` reports, and `ideas/` notes |
| `archive/` | Completed projects, superseded config, expired material. Append-only |
| `docs/` | System specs, setup notes, and configuration docs |

## Core Rules

- `raw/` and `archive/` are append-only: no content edits, no renames, no deletions. An
  unavoidable `raw/` rename is a user-approval matter and must update every referencing
  provenance string in the same commit. Lane, filename-normalization, and index contract:
  `docs/raw-layout.md`.
- Preserve source provenance. See § Note Contracts.
- Prefer updating existing wiki notes over creating duplicate notes.
- Use matching files in `templates/` before inventing a new note or output structure.
- Use English kebab-case filenames for wiki notes.
- Write new wiki article body prose in Korean. See § Language Convention.
- Use `[[wikilinks]]` for related wiki concepts. Do not use wikilinks for raw source files
  unless a corresponding wiki source note exists.
- Use Obsidian aliases as `[[note-slug|Alias]]`; do not escape the pipe character.
- Save durable answers under `outputs/` or `projects/<name>/outputs/`; create `outputs/` if
  it does not exist. Query-style answers that should be retained must not finish as
  chat-only output.
- Keep project execution context in `projects/`; move reusable concepts to `wiki/`.
- Project-specific skills, prompts, scripts, generated tools, cron wrapper prompts, and
  automation config belong under `projects/<name>/config/`; treat those files as the source
  of truth and update runtime settings from them, not the other way around.
- Team skills are generic procedures. Org- or person-specific deployment values (mail
  recipients, default reviewer, vault display name, trigger phrases) live in
  `projects/second-brain/config/team-settings.yaml` and are referenced from skills by key —
  never hardcoded in skill bodies. Changing a value there (especially mail recipients) is a
  user-approval matter. (Established 2026-08-12.)
- Execution-generated runtime state, caches, manifests, ledgers, and lock files are not
  source-of-truth artifacts. Keep them untracked and add project-specific ignore rules when
  they must live under `projects/<name>/outputs/`.
- Mark unsupported claims as inference or `needs-update`.
- Personal experiment data stays local-only; this is a shared team vault. Never commit
  per-item ground-truth labels over personal media, descriptions of personal photo/file
  contents, or local sample folder names/paths — in retained documents keep aggregate
  metrics only (counts, rates, distributions) and refer to data locations as
  `$SAMPLE_DIR`-style env names or `<sample-dir>` placeholders. Gitignore such data
  files with project-specific rules (keep a synthetic `*.example.*` as the tracked format
  reference), and keep commit messages free of personal-content descriptions.
  (Established 2026-07-24 after a label-file cleanup required a history rewrite.)
- `wiki/VAULT_MEMORY.md` is capped at 8 KB (`wc -c`); it is loaded every session, so the
  budget is bytes, not lines. A line count is not a load budget — one 3 KB bullet passes
  "200 lines" and still costs a full load. Verify with
  `python3 projects/second-brain/config/scripts/vault_verify.py` before committing — it is the
  single checker for this cap, for raw/archive append-only, for the frontmatter of every
  tracked Markdown file outside raw/ and archive/ staying parseable, and for the lane trace
  (a run-log or lint report must be in the diff against `--base`); every write lane calls it
  with `--lane ingest|lint|promote` (aligned 2026-09-03 with the main vault contract).
  The memory file holds durable policy plus static state and pointers — never an execution
  log and, since 2026-09-03, **no per-run counters**: the `Last Ingest/Lint Pass/Promotion`
  and `Volume to date` lines were replaced on every run and conflicted on every concurrent
  ingest branch. Lanes do not write to memory at all. The same facts are derived on demand:
  - latest runs → `ls outputs/runs/ | tail` (run-log filename + frontmatter `kind`/`pr`/`processed`)
  - latest lint → `ls outputs/*-vault-lint*.md | tail -1`
  - volume → `python3 projects/second-brain/config/scripts/vault_volume.py` (this vault's ledger,
    if present, + `outputs/runs/` fold, printed, never stored)
  - `## Current State` keeps only static facts (created, last sync) and these derivation pointers.
  - Per-run narrative lives in a per-run log note at
    `outputs/runs/YYYY-MM-DD-<kind>-<author-slug>.md` (template `templates/run-log.md`;
    browse/filter via `runs.base`; frontmatter `summary` ≤ 200 bytes, detail in the body).
    `docs/vault-ingest-log.md` is the pre-run-log ledger, frozen — append nothing there.
    Full detail also stays in the commit and PR body.
  - Project status/goal/next_action is never restated there; `projects/<name>/README.md`
    frontmatter is the source of truth (index: `projects/README.md`).
  - `## Open Threads`: max 5 live vault-level actions, deleted when closed.
- One daily note per day at `areas/daily/YYYY-MM-DD.md`; ideas that recur get promoted to
  `areas/ideas/<slug>.md`. Weekly reports go to `areas/weekly/YYYY-MM-DD.md` (filename is the
  report date, one per week) plus a same-name `.html` view, via the `vault-weekly-report`
  skill; the `.md` is the source of truth and the `.html` is regenerated from it.
- Project truth lives in `projects/<name>/README.md` frontmatter (`status`, `goal`, `due`,
  `milestones`, `next_action`).

## Automation Priority

Ingest and lint automation should prefer Claude Code when the `claude` CLI is installed and
authenticated. This is the preferred path for future cron/event-based operation.

If Claude Code is unavailable, blocked, or unauthenticated, do not fail silently. Report the
reason and run the Hermes-native fallback: ingest → `vault-ingest`, lint → `vault-lint`.

Before delegating to Claude Code, resolve `VAULT_DIR` to an absolute path and pass it
explicitly in both the working directory and the delegated prompt. Delegated agents must only
read or write below the resolved vault root.

## Obsidian CLI

When an Obsidian CLI is available and Obsidian is running, prefer it for search, link
analysis, and frontmatter edits; otherwise use the Hermes `obsidian` skill's filesystem-first
workflow with concrete absolute paths. For bulk operations across many files, direct file
tools (Read/Edit/Write) remain appropriate.

## Note Contracts

`templates/` holds the frontmatter and section contract for every note type — read the
matching template rather than a copy of it here. If a template exists, preserve its
frontmatter fields and section headings unless the user explicitly asks for a different
structure. The rules below are the parts templates cannot carry.

This section replaces the former § Wiki Frontmatter, § Work Layer Frontmatter, § Topic Pages,
§ Templates, and § status values (merged 2026-08-07). § Session Start and § Vault Root
Resolution moved to `CLAUDE.md`; the GitHub contract moved to `docs/github-linked-projects.md`.
Documents dated before 2026-08-07 may still point at the old section names.

**Enums**

- wiki `type`: `concept` (abstract idea, pattern, or architecture) · `tool` (specific
  software or CLI tool) · `model` (AI model family or variant) · `framework` (structured
  methodology or platform) · `pattern` (repeatable workflow or technique) · `protocol`
  (technical specification) · `topic` (reserved for `wiki/topics/` pages only)
- wiki `status`: `stub` (under 350 words; needs expansion) · `draft` (substantial content but
  not fully reviewed) · `complete` (reviewed and comprehensive) · `needs-update` (a new
  source has materially changed the topic)
- idea `status`: `seed` · `growing` · `ready` · `adopted` · `dropped`
- project `status`: `active` · `paused` · `done`

**Frontmatter links** — in any `related` or `sources`, vault Markdown notes use quoted
wikilinks (`"[[path|Alias]]"`). `sources` keeps raw paths, URLs, and non-note artifacts as strings.

**Daily notes** — `projects-touched` entries are formatted `"[[projects/<name>/README|<name>]]"`.

**Projects** — `status: done` moves the project folder to `archive/projects/`; update
`projects/README.md`.

**Topic pages** — body is a one-line list of related wiki articles with `[[wikilinks]]`. Set
`up: "[[topics/parent-topic]]"` except on root topics. 10+ linked articles → consider
splitting into sub-topics. Full topic list → `wiki/TOPIC_MAP.md`.

## Language Convention

Wiki article body prose is written in Korean. Keep in English inside the body: section
headings (part of the shared template contract), frontmatter keys and values, proper nouns
and product/tool/model names, and inline code, commands, file paths, and CLI flags.

Effective 2026-07-09, for newly created wiki articles. Existing English-body articles are not
bulk-rewritten; convert them the next time they are substantively updated, not proactively.

## GitHub-Linked Projects

External GitHub repos are tracked as lightweight status/goal notes at
`projects/@<owner>/<folder>/README.md` (identity is `org/repo`, carried in `repo`
frontmatter; local clones at `$GITHUB_DIR/<org>/<folder>`, default `~/Documents`). Team orgs
and personal accounts share the structure; personal is marked `scope: personal`. Agents
propose sync changes and the user approves final `status`/`goal`/`next_action`. Never write
to external repos remotely.

Full contract: `docs/github-linked-projects.md`.
Skills: `github-project-link` (clone + register), `github-project-sync` (detect + propose).

## Workflows

Ingest runs as one daily batch, not per-clipping. Daily brief/close are Hermes-native; only
knowledge compilation is delegated to Claude.

The skills in `projects/second-brain/config/skills/` are the source of truth for each
workflow's steps: `vault-ingest-claude` (preferred ingest, incl. the `ingest/<date>-<author-slug>`
branch and auto-PR workflow), `vault-ingest` (Hermes-native fallback), `vault-query`,
`vault-lint`, `vault-weekly-report`, `private-note`. Merging an ingest PR always requires
explicit user approval.

Planned: `vault-daily-brief`, `vault-daily-close`, `vault-project-review`, and `vault-retro`
must be written before those workflows are relied on in automation.
