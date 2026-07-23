---
type: project
status: active
goal: "Prepare and operate this sandbox as the initial environment for a future real knowledge vault."
due:
milestones:
  - name: "Initialize required vault control files"
    due: 2026-07-08
    done: true
  - name: "Clarify Hermes/Claude automation workflows"
    due: 2026-07-08
    done: true
next_action: "Run the first clipping ingest and verify raw/wiki/index/memory updates."
---

# second-brain

## Status

Active. This project maintains the vault structure, operating rules, and automation workflows.

## Purpose

Use the resolved `$VAULT_DIR` (the cloned vault root) as the setup and testing environment for a future production knowledge folder.

## Current Context

- The vault root is valid when it contains `VAULT_RULES.md`, `wiki/`, `raw/`, `Clippings/`, `outputs/`, and `templates/`.
- Ingest and lint should prefer Claude Code when available, with Hermes-native fallback when Claude is unavailable.
- The first pending ingest source is currently in `Clippings/`.

## Related Wiki

- [[wiki/INDEX|Wiki Index]]
- [[wiki/topics/knowledge-management|Knowledge Management]]

## Log

- 2026-07-08: Initialized required control files and clarified Claude-first automation policy.

## Outputs

Project-specific outputs should be saved in `projects/second-brain/outputs/` when needed.
