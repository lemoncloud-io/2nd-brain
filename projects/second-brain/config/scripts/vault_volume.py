#!/usr/bin/env python3
# origin: lemoncloud-io/knowledge@8480503:projects/second-brain/config/scripts/vault_volume.py
"""Derive the vault volume line (`- Volume to date: …`) from the ledgers.

Since 2026-09-03 wiki/VAULT_MEMORY.md no longer stores this line — every concurrent
ingest branch rewrote it and the merges conflicted. The counters are derived on demand:
run the script with no flags to print the current line. `--check`/`--write` still work
for a vault that keeps the line in memory (they are no-ops when the line is absent).

The volume counters were hand-incremented per run until 2026-08-26 and drifted
twice (Open Thread closed by this script; recommendation ① in
outputs/2026-08-26-second-brain-process-review.md). Current state must be a
deterministic fold of the append-only ledgers, never a maintained number:

  runs / clippings = FROZEN ledger baseline + fold over outputs/runs/*.md
  wiki notes       = live count of wiki/*.md (minus INDEX, VAULT_MEMORY, TOPIC_MAP)
  topics           = live count of wiki/topics/*.md (root = empty `up:`, sub = set)

Baseline extraction rule (docs/vault-ingest-log.md, frozen 2026-08-14, last ingest
entry 2026-08-01 — no overlap with run-logs, which start 2026-08-14): one run per
`^- Last Ingest:` bullet, clippings summed from the first `processed N clipping(s)`
phrase per bullet.

The baseline is read from the vault the script runs in — it is NOT a constant. It was
hardcoded (19 runs / 38 clippings, main's measured values) until 2026-08-28, when a
vault-sync deploy showed why that cannot travel: in a derived vault the constants were
added unconditionally, so @ssocio reported "21 runs / 40 clippings" off two run-logs of
its own, and `--write` would have stamped main's history into a team vault's memory as
fact. Deriving from the local ledger reproduces main's 19 / 38 exactly (its ledger holds
19 bullets summing to 38) and yields 0 / 0 in vaults whose ledger is absent or empty.

Usage:
    python3 vault_volume.py            # print the derived line (the normal use since 2026-09-03)
    python3 vault_volume.py --check    # exit 1 if a stored VAULT_MEMORY line disagrees (absent = ok)
    python3 vault_volume.py --write    # replace a stored line in place (absent = print only)

Exit codes: 0 ok, 1 mismatch (--check), 2 cannot run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
from pathlib import Path

MEMORY_REL = "wiki/VAULT_MEMORY.md"
RUNS_DIR_REL = "outputs/runs"
TOPICS_DIR_REL = "wiki/topics"
LEDGER_REL = "docs/vault-ingest-log.md"
EXPECTED_DIRS = ["wiki", "raw", "Clippings", "templates"]

# Ledger baseline parsing — see module docstring for the extraction rule.
LEDGER_BULLET_RE = re.compile(r"^- Last Ingest:\s*(\d{4}-\d{2}-\d{2})", re.M)
LEDGER_PROCESSED_RE = re.compile(r"processed\s+(\d+)\s+clipping")

# Rendered in place of a date when the vault has no ingest history at all.
NO_DATE = "—"

WIKI_NON_NOTES = {"INDEX.md", "VAULT_MEMORY.md", "TOPIC_MAP.md"}

VOLUME_RE = re.compile(
    r"^- Volume to date: (\d+) ingest runs / (\d+) clippings "
    r"\((\S+) → (\S+)\) → wiki (\d+) notes.*토픽 (\d+) root \+ (\d+) sub"
)


def resolve_vault() -> Path | None:
    candidate = Path(os.environ.get("VAULT_DIR") or os.getcwd()).expanduser().resolve()
    if not (candidate / "VAULT_RULES.md").exists():
        return None
    if not all((candidate / d).is_dir() for d in EXPECTED_DIRS):
        return None
    return candidate


def _frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return ""
    parts = text.split("---", 2)
    return parts[1] if len(parts) >= 3 else ""


def fold_ledger(vault: Path) -> tuple[int, int, str | None, str | None]:
    """(runs, clippings, first date, last date) from this vault's frozen ledger.

    Zeros and None when the ledger is absent or carries no entries — which is the
    normal state of a derived vault, and the reason this is not a constant.
    """
    ledger = vault / LEDGER_REL
    if not ledger.is_file():
        return 0, 0, None, None
    text = ledger.read_text(encoding="utf-8")
    dates: list[str] = []
    clippings = 0
    for match in LEDGER_BULLET_RE.finditer(text):
        dates.append(match.group(1))
        bullet_end = text.find("\n", match.end())
        bullet = text[match.end(): bullet_end if bullet_end != -1 else len(text)]
        processed = LEDGER_PROCESSED_RE.search(bullet)  # first phrase only
        clippings += int(processed.group(1)) if processed else 0
    if not dates:
        return 0, 0, None, None
    return len(dates), clippings, min(dates), max(dates)


def fold_runlogs(vault: Path) -> tuple[int, int, str | None, str | None]:
    """(ingest runs, clippings, first run_date, last run_date) from run-log frontmatter."""
    runs = 0
    clippings = 0
    dates: list[str] = []
    runs_dir = vault / RUNS_DIR_REL
    if not runs_dir.is_dir():
        return runs, clippings, None, None
    for path in sorted(runs_dir.glob("*.md")):
        fm = _frontmatter(path.read_text(encoding="utf-8"))
        kind = re.search(r"^kind:\s*(\S+)", fm, re.M)
        if not kind or kind.group(1) != "ingest":
            continue
        runs += 1
        proc = re.search(r"^processed:\s*(\d+)", fm, re.M)
        clippings += int(proc.group(1)) if proc else 0
        date = re.search(r"^run_date:\s*\"?([0-9-]{10})", fm, re.M)
        if date:
            dates.append(date.group(1))
    if not dates:
        return runs, clippings, None, None
    return runs, clippings, min(dates), max(dates)


def count_wiki_notes(vault: Path) -> int:
    return sum(
        1 for p in (vault / "wiki").glob("*.md") if p.name not in WIKI_NON_NOTES
    )


def count_topics(vault: Path) -> tuple[int, int]:
    root = sub = 0
    topics_dir = vault / TOPICS_DIR_REL
    if not topics_dir.is_dir():
        return root, sub
    for path in sorted(topics_dir.glob("*.md")):
        fm = _frontmatter(path.read_text(encoding="utf-8"))
        up = re.search(r"^up:\s*(.*)$", fm, re.M)
        if up and up.group(1).strip().strip('"'):
            sub += 1
        else:
            root += 1
    return root, sub


def compute(vault: Path) -> dict[str, object]:
    led_runs, led_clippings, led_first, led_last = fold_ledger(vault)
    log_runs, log_clippings, log_first, log_last = fold_runlogs(vault)
    root, sub = count_topics(vault)
    # The ledger is frozen and predates every run-log, so it always holds the earlier
    # bound; run-logs always hold the later one. Either side may be empty.
    first = led_first or log_first or NO_DATE
    last = log_last or led_last or NO_DATE
    return {
        "runs": led_runs + log_runs,
        "clippings": led_clippings + log_clippings,
        "first": first,
        "last": last,
        "notes": count_wiki_notes(vault),
        "root": root,
        "sub": sub,
    }


def format_line(vol: dict[str, object], asof: str) -> str:
    return (
        f"- Volume to date: {vol['runs']} ingest runs / {vol['clippings']} clippings "
        f"({vol['first']} → {vol['last']}) → wiki {vol['notes']} notes(실측 {asof}), "
        f"토픽 {vol['root']} root + {vol['sub']} sub — fold 파생값, 수동 편집 금지 "
        f"(vault_volume.py --write)"
    )


def stored_line(vault: Path) -> tuple[int, str] | None:
    memory = vault / MEMORY_REL
    if not memory.is_file():
        return None
    for lineno, line in enumerate(memory.read_text(encoding="utf-8").splitlines(), 1):
        if line.startswith("- Volume to date:"):
            return lineno, line
    return None


def check(vault: Path) -> list[str]:
    """Return defect strings; empty means the stored line matches the fold."""
    vol = compute(vault)
    found = stored_line(vault)
    if found is None:
        return []  # memory is de-countered (2026-09-03): nothing stored, nothing to drift
    lineno, line = found
    match = VOLUME_RE.match(line)
    if not match:
        return [
            f"{MEMORY_REL}:{lineno} Volume line does not parse; "
            f"expected: {format_line(vol, '<date>')}"
        ]
    got = {
        "runs": int(match.group(1)),
        "clippings": int(match.group(2)),
        "first": match.group(3),
        "last": match.group(4),
        "notes": int(match.group(5)),
        "root": int(match.group(6)),
        "sub": int(match.group(7)),
    }
    diffs = [
        f"{key}={got[key]} (ledger fold: {vol[key]})"
        for key in ("runs", "clippings", "first", "last", "notes", "root", "sub")
        if got[key] != vol[key]
    ]
    if diffs:
        return [
            f"{MEMORY_REL}:{lineno} Volume line drifted from the ledger fold — "
            + ", ".join(diffs)
            + "; run vault_volume.py --write"
        ]
    return []


def write(vault: Path) -> str:
    vol = compute(vault)
    new_line = format_line(vol, dt.date.today().isoformat())
    memory = vault / MEMORY_REL
    lines = memory.read_text(encoding="utf-8").splitlines()
    replaced = False
    for i, line in enumerate(lines):
        if line.startswith("- Volume to date:"):
            lines[i] = new_line
            replaced = True
            break
    if not replaced:
        # De-countered memory (2026-09-03): never insert the line, just report it.
        print(f"vault_volume: {MEMORY_REL} keeps no Volume line; derived value printed, nothing written",
              file=sys.stderr)
        return new_line
    memory.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return new_line


def main() -> int:
    parser = argparse.ArgumentParser(description="Derive the VAULT_MEMORY volume line.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="verify the stored line")
    mode.add_argument("--write", action="store_true", help="rewrite the stored line")
    args = parser.parse_args()

    vault = resolve_vault()
    if vault is None:
        print(
            "vault_volume: cannot resolve the vault root. Set VAULT_DIR or run from a "
            "directory holding VAULT_RULES.md plus " + ", ".join(EXPECTED_DIRS) + "/.",
            file=sys.stderr,
        )
        return 2

    if args.check:
        defects = check(vault)
        if defects:
            print("FAIL (volume):")
            for defect in defects:
                print(f"  - {defect}")
            return 1
        print("PASS (volume): memory line matches the ledger fold")
        return 0

    if args.write:
        print(write(vault))
        return 0

    print(format_line(compute(vault), dt.date.today().isoformat()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
