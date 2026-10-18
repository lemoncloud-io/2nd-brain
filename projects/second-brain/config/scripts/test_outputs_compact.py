#!/usr/bin/env python3
"""Tests for outputs_compact.py — run from the scripts directory:

    python3 -m unittest test_outputs_compact -v

Each test builds a throwaway git vault, so nothing here touches the real one.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE / "outputs_compact.py"
sys.path.insert(0, str(HERE))
from vault_volume import compute  # noqa: E402


def sh(root, *args):
    return subprocess.run(list(args), cwd=root, capture_output=True, text=True)


def runlog(kind, date, summary, pr, processed=0, body=""):
    return (f'---\ntype: run-log\nkind: {kind}\nrun_date: "{date}"\nsummary: "{summary}"\npr: {pr}\n'
            f"processed: {processed}\n---\n\n# r\n\n{body}\n")


def lint(date):
    return f'---\ntype: lint-report\ncreated: "{date}"\nscope: vault\n---\n\n# Vault Lint Report - {date}\n'


def query(date, title):
    return f'---\ntype: query-output\ncreated: "{date}"\nquestion: "q"\nsources: []\n---\n\n# {title}\n'


class Vault:
    def __init__(self, tmp):
        self.root = pathlib.Path(tmp)
        for d in ("wiki/topics", "raw", "Clippings", "templates", "outputs/runs"):
            (self.root / d).mkdir(parents=True, exist_ok=True)
        (self.root / "VAULT_RULES.md").write_text("rules\n")
        sh(self.root, "git", "init", "-q", "-b", "master")
        sh(self.root, "git", "config", "user.email", "t@example.com")
        sh(self.root, "git", "config", "user.name", "t")

    def put(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def commit(self, msg="c"):
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "commit", "-q", "-m", msg)

    def run(self, mode, until):
        return sh(self.root, sys.executable, str(SCRIPT), mode, "--until", until)

    def note(self, month):
        return (self.root / "outputs/monthly" / f"{month}.md").read_text(encoding="utf-8")

    def answer(self, month, text):
        p = self.root / "outputs/monthly" / f"{month}.md"
        p.write_text(p.read_text(encoding="utf-8").replace(
            "- (작성 필요) 아래 Evidence를 읽고 이 달의 흐름을 3~6줄로 쓴다.", text), encoding="utf-8")

    def exists(self, rel):
        return (self.root / rel).exists()


def seed(v):
    v.put("raw/only-in-log.md", "x\n")
    v.put("raw/also-in-wiki.md", "x\n")
    v.put("wiki/a.md", '---\ntype: concept\nsources:\n  - "raw/also-in-wiki.md"\n---\n\n# A\n')
    v.put("outputs/runs/2026-08-14-ingest-a.md",
          runlog("ingest", "2026-08-14", "two clips", 11, 2, "sources raw/only-in-log.md and raw/also-in-wiki.md"))
    v.put("outputs/runs/2026-08-20-promotion-b.md", runlog("promotion", "2026-08-20", "lane", 12))
    v.put("outputs/2026-08-05-vault-lint.md", lint("2026-08-05"))
    v.put("outputs/2026-08-10-some-question.md", query("2026-08-10", "Some Question"))
    v.put("outputs/runs/2026-09-02-ingest-c.md", runlog("ingest", "2026-09-02", "one clip", 13, 1))
    v.put("outputs/2026-09-03-vault-lint.md", lint("2026-09-03"))
    v.commit()


class CompactTest(unittest.TestCase):
    def test_apply_deletes_eligible_and_keeps_volume(self):
        with tempfile.TemporaryDirectory() as tmp:
            v = Vault(tmp)
            seed(v)
            before = compute(v.root)
            self.assertEqual(v.run("write", "2026-09-30").returncode, 0)
            v.answer("2026-08", "- 8월 흐름.")
            v.answer("2026-09", "- 9월 흐름.")
            r = v.run("apply", "2026-09-30")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertFalse(v.exists("outputs/runs/2026-08-14-ingest-a.md"))
            self.assertFalse(v.exists("outputs/runs/2026-09-02-ingest-c.md"))
            self.assertFalse(v.exists("outputs/2026-08-05-vault-lint.md"))      # closed month
            self.assertTrue(v.exists("outputs/2026-09-03-vault-lint.md"))       # current month + newest
            self.assertTrue(v.exists("outputs/2026-08-10-some-question.md"))    # queries never
            after = compute(v.root)
            self.assertEqual((after["runs"], after["clippings"], after["first"], after["last"]),
                             (before["runs"], before["clippings"], before["first"], before["last"]))
            aug = v.note("2026-08")
            self.assertIn("compacted_ingest_runs: 1", aug)
            self.assertIn("`2026-08-14-ingest-a` — two clips", aug)
            self.assertIn("[[outputs/2026-08-10-some-question|Some Question]]", aug)
            self.assertIn('- "raw/only-in-log.md"', aug)          # only a deleted record cited it
            self.assertNotIn('- "raw/also-in-wiki.md"', aug)     # still cited by wiki/a.md
            self.assertIn("- 8월 흐름.", aug)

    def test_write_is_idempotent_and_refresh_appends(self):
        with tempfile.TemporaryDirectory() as tmp:
            v = Vault(tmp)
            seed(v)
            v.run("write", "2026-09-30")
            v.answer("2026-08", "- 8월 흐름.")
            v.answer("2026-09", "- 9월 흐름.")
            v.run("apply", "2026-09-30")
            v.commit()
            first = v.note("2026-09")
            self.assertEqual(v.run("write", "2026-09-30").returncode, 0)
            self.assertEqual(v.note("2026-09"), first)
            v.put("outputs/runs/2026-09-25-ingest-d.md", runlog("ingest", "2026-09-25", "late", 14, 3))
            v.commit()
            v.run("apply", "2026-09-30")
            refreshed = v.note("2026-09")
            self.assertIn("`2026-09-02-ingest-c` — one clip", refreshed)   # earlier deletion kept
            self.assertIn("`2026-09-25-ingest-d` — late", refreshed)
            self.assertIn("compacted_ingest_runs: 2", refreshed)
            self.assertIn("compacted_clippings: 4", refreshed)
            self.assertIn("- 9월 흐름.", refreshed)

    def test_apply_refuses_without_answer(self):
        with tempfile.TemporaryDirectory() as tmp:
            v = Vault(tmp)
            seed(v)
            r = v.run("apply", "2026-09-30")
            self.assertEqual(r.returncode, 3)
            self.assertTrue(v.exists("outputs/runs/2026-08-14-ingest-a.md"))

    def test_plan_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            v = Vault(tmp)
            seed(v)
            r = v.run("plan", "2026-09-30")
            self.assertEqual(r.returncode, 0)
            self.assertIn("2026-08: eligible 3", r.stdout)
            self.assertFalse(v.exists("outputs/monthly"))


if __name__ == "__main__":
    unittest.main()
