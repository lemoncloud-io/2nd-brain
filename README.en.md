# 2nd-brain

[한국어](README.md) · **English**

AI Second Brain vault operated through Hermes and Claude Code over an Obsidian folder.

Raw sources are compiled into structured wiki articles by an ingest pipeline, and questions are answered from that wiki with cited outputs. Rules are model-neutral — see [`VAULT_RULES.md`](VAULT_RULES.md) for the authoritative contract.

## Structure

```text
Clippings/        ← inbox: newly scraped sources (pending processing)
raw/              ← processed source originals (append-only)
wiki/             ← concept articles, one concept per file
wiki/topics/      ← topic index pages (subject clusters)
outputs/          ← query answers, analysis reports, lint results
projects/<name>/  ← per-project execution context and outputs
areas/            ← ongoing areas: daily/ notes and ideas/ notes
templates/        ← Obsidian + LLM output templates (shared contracts)
archive/          ← completed projects and superseded material (append-only)
docs/             ← system docs such as the setup guide
```

> `raw/` and `archive/` are append-only. `wiki/VAULT_MEMORY.md` and `wiki/INDEX.md` load at the start of every vault operation.

## Requirements

| Tool | Required | Purpose |
| --- | --- | --- |
| Git | Required | clone, branch, commit, push |
| Obsidian | Required | edit the markdown vault, Web Clipper & plugins |
| Claude CLI (`claude`) | Optional | delegate ingest/lint to Claude Code (falls back to Hermes without it) |
| GitHub CLI (`gh`) | Optional | create PRs / link GitHub projects from the terminal (web works too) |

Version check:

```bash
git --version        # required
claude --version     # optional
gh --version         # optional
```

## Getting Started

1. **Clone the repo and set `VAULT_DIR`** — the repo and path below are examples. After cloning, repoint `origin` to your own/team git, and use `$VAULT_DIR`/`~` relative paths instead of absolute machine paths.

   ```bash
   git clone https://github.com/lemoncloud-io/2nd-brain.git ~/knowledge
   export VAULT_DIR="$HOME/knowledge"
   cd "$VAULT_DIR"
   ```

2. **Open the cloned folder as an Obsidian vault** — use `Open folder as vault` and pick `~/knowledge`. You should see `VAULT_RULES.md`, `wiki/`, and `templates/`.

3. **(Optional) Install the Claude CLI** — to delegate ingest/lint to Claude Code, `claude` must be installed and authenticated. Without it, the agent falls back to the Hermes-native workflow.

> For the **full setup and usage guide** — Obsidian Web Clipper, plugins, the PR workflow, and troubleshooting — see [`docs/knowledge-wiki-setup-guide.md`](docs/knowledge-wiki-setup-guide.md).

## Vault Root

Treat the repository root as `VAULT_DIR` only when the expected structure is present (`VAULT_RULES.md`, `wiki/`, `raw/`, `Clippings/`, `outputs/`, and `templates/`). Use a user-provided `VAULT_DIR` when set. Never silently fall back to `~/knowledge` — that is only an example setup path.

## Workflows

Ingest runs as one daily batch, not per-clipping. Drop markdown into `Clippings/` and run:

```text
클리핑 처리해줘   (process clippings)
```

Ingest and lint prefer Claude Code when the `claude` CLI is installed and authenticated. If Claude Code is unavailable, blocked, or unauthenticated, the agent reports why and runs the Hermes-native fallback instead of failing silently. The pipeline moves files to `raw/`, extracts concepts, and creates or updates `wiki/` articles with frontmatter, wikilinks, and topic index entries.

To force delegation to Claude Code:

```text
Claude에 위임해서 클리핑 처리해줘   (delegate to Claude Code)
```

## Query

Ask any question — the agent reads `wiki/INDEX.md`, identifies relevant articles, and writes a cited answer to `outputs/`.

## Projects

- [second-brain](projects/second-brain/) — `active` · continuously improving this vault's structure and workflow (3-loop operation)

The source of truth for a project's status, due date, and next action is the frontmatter of its own README. See [projects/README.md](projects/README.md) for details.

## Skills

Hermes skills are the source of truth for each workflow:

| Skill | Role |
| --- | --- |
| `vault-ingest-claude` | Preferred ingest path (Claude Code) |
| `vault-ingest` | Hermes-native ingest fallback |
| `vault-query` | Answer from wiki, save retained answers to `outputs/` |
| `vault-lint` | Claude-first lint with Hermes-native fallback |
