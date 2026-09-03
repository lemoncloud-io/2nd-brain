#!/usr/bin/env python3
# origin: lemoncloud-io/knowledge@8480503:projects/second-brain/config/scripts/test_vault_volume.py
"""Tests for the ledger baseline fold in vault_volume.

Run from the scripts directory:

    python3 -m unittest test_vault_volume -v

The point of these tests is portability: the baseline must come from the vault the
script is run in, so a derived vault reports its own history rather than main's.
"""

from __future__ import annotations

import pathlib
import tempfile
import unittest

from vault_volume import check, compute, fold_ledger, write

MAIN = pathlib.Path(__file__).resolve().parents[4]

# The two "main" regression guards below assert main's frozen ledger numbers
# (19 runs / 38 clippings). MAIN resolves to whatever vault this file is deployed
# in, so in a derived vault (vault-sync copy) the guards would compare that
# vault's own ledger against main's constants and fail structurally. Run them
# only when the local ledger is main's frozen ledger, identified by its final
# frozen entry. (Found 2026-08-29 when the first vault-sync deploy of this file
# failed both guards in all three derived vaults.)
_LEDGER = MAIN / "docs" / "vault-ingest-log.md"
IS_MAIN_LEDGER = _LEDGER.exists() and "- Last Ingest: 2026-08-01" in _LEDGER.read_text(
    encoding="utf-8"
)

LEDGER_HEAD = "# Vault Ingest Log\n\nAppend-only. 기존 항목을 편집하지 않는다.\n\n"


def make_vault(tmp: str, ledger: str | None = None, runlogs: list[str] | None = None):
    """Minimal vault tree holding only what compute() reads."""
    root = pathlib.Path(tmp)
    (root / "wiki" / "topics").mkdir(parents=True)
    (root / "outputs" / "runs").mkdir(parents=True)
    if ledger is not None:
        (root / "docs").mkdir()
        (root / "docs" / "vault-ingest-log.md").write_text(ledger, encoding="utf-8")
    for i, body in enumerate(runlogs or []):
        (root / "outputs" / "runs" / f"log-{i}.md").write_text(body, encoding="utf-8")
    return root


def runlog(run_date: str, processed: int, kind: str = "ingest") -> str:
    return f'---\nkind: {kind}\nrun_date: "{run_date}"\nprocessed: {processed}\n---\n\nbody\n'


class LedgerFoldTest(unittest.TestCase):
    @unittest.skipUnless(IS_MAIN_LEDGER, "main-vault regression guard; not main's ledger")
    def test_main_ledger_reproduces_the_previously_frozen_constants(self):
        """Regression guard: main's own numbers must not move with this change."""
        runs, clippings, first, last = fold_ledger(MAIN)
        self.assertEqual(runs, 19)
        self.assertEqual(clippings, 38)
        self.assertEqual(first, "2026-07-08")
        self.assertEqual(last, "2026-08-01")

    def test_absent_ledger_yields_a_zero_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp, ledger=None)
            self.assertEqual(fold_ledger(root), (0, 0, None, None))

    def test_ledger_with_no_entries_yields_a_zero_baseline(self):
        """The derived vaults carry the ledger file with a header and no bullets."""
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp, ledger=LEDGER_HEAD)
            self.assertEqual(fold_ledger(root), (0, 0, None, None))

    def test_bullet_without_a_processed_phrase_counts_as_a_run_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = LEDGER_HEAD + "- Last Ingest: 2026-07-08 — reorganised raw/, no clippings.\n"
            root = make_vault(tmp, ledger=ledger)
            self.assertEqual(fold_ledger(root), (1, 0, "2026-07-08", "2026-07-08"))

    def test_singular_and_plural_clipping_are_both_counted(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = LEDGER_HEAD + (
                "- Last Ingest: 2026-07-08 — processed 1 clipping into 4 wiki articles.\n"
                "- Last Ingest: 2026-07-10 — processed 3 clippings into 5 articles.\n"
            )
            self.assertEqual(fold_ledger(make_vault(tmp, ledger=ledger)),
                             (2, 4, "2026-07-08", "2026-07-10"))

    def test_only_the_first_processed_phrase_per_bullet_counts(self):
        """A bullet may mention later counts in prose; the rule takes the first."""
        with tempfile.TemporaryDirectory() as tmp:
            ledger = LEDGER_HEAD + (
                "- Last Ingest: 2026-07-08 — processed 2 clippings; earlier we processed 9 clippings.\n"
            )
            runs, clippings, _, _ = fold_ledger(make_vault(tmp, ledger=ledger))
            self.assertEqual((runs, clippings), (1, 2))


class ComputePortabilityTest(unittest.TestCase):
    def test_derived_vault_reports_its_own_history_not_mains(self):
        """The bug this change fixes: main's 19/38 leaking into every derived vault."""
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp, ledger=LEDGER_HEAD,
                              runlogs=[runlog("2026-08-20", 1), runlog("2026-08-22", 2)])
            vol = compute(root)
            self.assertEqual(vol["runs"], 2)
            self.assertEqual(vol["clippings"], 3)

    def test_dates_fall_back_to_runlogs_when_the_ledger_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp, ledger=LEDGER_HEAD,
                              runlogs=[runlog("2026-08-22", 2), runlog("2026-08-20", 1)])
            vol = compute(root)
            self.assertEqual(vol["first"], "2026-08-20")
            self.assertEqual(vol["last"], "2026-08-22")

    def test_ledger_and_runlogs_add_up_with_the_ledger_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = LEDGER_HEAD + "- Last Ingest: 2026-07-08 — processed 5 clippings.\n"
            root = make_vault(tmp, ledger=ledger, runlogs=[runlog("2026-08-20", 1)])
            vol = compute(root)
            self.assertEqual((vol["runs"], vol["clippings"]), (2, 6))
            self.assertEqual(vol["first"], "2026-07-08")
            self.assertEqual(vol["last"], "2026-08-20")

    def test_promotion_runlogs_are_not_counted_as_ingest_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp, ledger=None,
                              runlogs=[runlog("2026-08-20", 1), runlog("2026-08-21", 4, kind="promotion")])
            vol = compute(root)
            self.assertEqual((vol["runs"], vol["clippings"]), (1, 1))

    def test_empty_vault_renders_without_dates(self):
        with tempfile.TemporaryDirectory() as tmp:
            vol = compute(make_vault(tmp, ledger=None))
            self.assertEqual((vol["runs"], vol["clippings"]), (0, 0))
            self.assertTrue(str(vol["first"]).strip())
            self.assertTrue(str(vol["last"]).strip())

    @unittest.skipUnless(IS_MAIN_LEDGER, "main-vault regression guard; not main's ledger")
    def test_main_compute_still_starts_from_19_38(self):
        vol = compute(MAIN)
        self.assertGreaterEqual(vol["runs"], 19)
        self.assertGreaterEqual(vol["clippings"], 38)
        self.assertEqual(vol["first"], "2026-07-08")



class DecounteredMemoryTest(unittest.TestCase):
    """2026-09-03: VAULT_MEMORY no longer stores the Volume line (it conflicted on every
    concurrent ingest). check()/write() must treat an absent line as "nothing to keep in
    sync", not as a defect — the line is derived on demand by running the script."""

    def test_check_passes_when_memory_has_no_volume_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp, ledger=None, runlogs=[runlog("2026-08-20", 1)])
            (root / "wiki" / "VAULT_MEMORY.md").write_text("# Vault Memory\n\n- Created: x\n", encoding="utf-8")
            self.assertEqual(check(root), [])

    def test_write_without_a_stored_line_returns_the_line_and_leaves_memory_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp, ledger=None, runlogs=[runlog("2026-08-20", 1)])
            mem = root / "wiki" / "VAULT_MEMORY.md"
            before = "# Vault Memory\n\n- Created: x\n"
            mem.write_text(before, encoding="utf-8")
            line = write(root)
            self.assertTrue(line.startswith("- Volume to date: 1 ingest runs / 1 clippings"))
            self.assertEqual(mem.read_text(encoding="utf-8"), before)

    def test_check_still_flags_a_stale_stored_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp, ledger=None, runlogs=[runlog("2026-08-20", 1)])
            (root / "wiki" / "VAULT_MEMORY.md").write_text(
                "- Volume to date: 9 ingest runs / 9 clippings (2026-08-20 → 2026-08-20) → wiki 0 notes(실측 x), "
                "토픽 0 root + 0 sub — fold 파생값, 수동 편집 금지 (vault_volume.py --write)\n", encoding="utf-8")
            self.assertTrue(check(root))


if __name__ == "__main__":
    unittest.main()
