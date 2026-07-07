# sandbox

Sandbox for testing **Knowledge Ops** Setup by Steve.

Personal knowledge base built with Claude Code — raw sources compiled into structured wiki articles via an automated Reader → Writer pipeline.

## Structure

```text
Clippings/        ← inbox: newly scraped sources (pending processing)
raw/              ← processed source documents (append-only)
wiki/             ← LLM-authored articles (one .md per concept)
wiki/topics/      ← topic index pages (subject clusters)
outputs/          ← general query responses and synthesized reports
projects/<name>/  ← project-specific execution docs and outputs
docs/             ← harness config, system specs, agent scaffolding
```

## Projects

| Project | 목적 |
|---------|------|
| [second-brain](projects/second-brain/) | 이 vault의 구조·워크플로우 지속 개선 |

## Usage

This sandbox is the initial environment for a future production knowledge folder. Treat the repository root as `VAULT_DIR` only when the expected vault structure is present (`VAULT_RULES.md`, `wiki/`, `raw/`, `Clippings/`, `outputs/`, and `templates/`). Do not silently fall back to `~/knowledge`.

Drop markdown files into `Clippings/` and run the ingest pipeline:

```text
클리핑 처리해줘
```

Automation should prefer Claude Code for ingest when the `claude` CLI is installed and authenticated. If Claude Code is unavailable, the agent falls back to the Hermes-native `vault-ingest` workflow. The pipeline moves files to `raw/`, extracts concepts, and creates or updates `wiki/` articles with frontmatter, wikilinks, and topic index entries.

For explicit delegation, ask:

```text
Claude에 위임해서 클리핑 처리해줘
```

Lint follows the same policy: prefer Claude Code for scheduled/delegated lint, then fall back to Hermes-native lint if Claude is unavailable.

## Query

Ask any question — the agent reads `wiki/INDEX.md`, identifies relevant articles, and writes a cited answer to `outputs/`.
