#!/usr/bin/env python3
"""Tests for vault_tally — on-demand counts and the live-tally detector.

Run from the scripts directory:  python3 -m unittest test_vault_tally -v
"""
from __future__ import annotations

import pathlib
import tempfile
import unittest

from vault_tally import count_docs, count_folders, count_rows, live_tallies


def write(root, rel, text):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


class CountTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        write(self.root, "f/README.md", "# index\n")
        write(self.root, "f/a/README.md", "# a\n")
        write(self.root, "f/a/feature-definition.md", "# fd\n")
        write(self.root, "f/b/README.md", "# b\n")
        write(self.root, "f/b/feature-definition.md", "# fd\n")
        write(self.root, "f/c-no-readme/note.md", "# n\n")
        write(self.root, "f/2026-10-01-report.md", "# r\n")
        write(self.root, "f/node_modules/x.md", "# not a doc\n")
        write(self.root, "t.md", "# T\n\n## 정의\n\n| a | b |\n| --- | --- |\n| 1 | x |\n| 2 | y |\n\n"
                                 "## 시나리오·세부 내용\n\n### 화면 1\n\n| a | b |\n| --- | --- |\n| 3 | z |\n\n"
                                 "### 화면 2\n\n| a | b |\n| --- | --- |\n| 4 | w |\n| 5 | v |\n\n"
                                 "## 엣지케이스·고려사항\n\n```\n| --- |\n| fenced | row |\n```\n| 6 | u |\n")

    def tearDown(self):
        self._tmp.cleanup()

    def test_docs_skips_own_readme_and_node_modules(self):
        self.assertEqual(count_docs(str(self.root), "f"), 6)
        self.assertEqual(count_docs(str(self.root), "f", recursive=False), 1)
        self.assertEqual(count_docs(str(self.root), "f", name="feature-definition.md"), 2)

    def test_folders_counts_subfolders_with_a_readme(self):
        self.assertEqual(count_folders(str(self.root), "f"), 2)

    def test_rows_counts_table_bodies_only(self):
        self.assertEqual(count_rows(str(self.root), "t.md"), 5)  # fenced rows and the bare `| 6 |` line do not count

    def test_rows_in_a_section_cover_its_subheadings_and_stop_at_a_sibling(self):
        self.assertEqual(count_rows(str(self.root), "t.md", section="시나리오"), 3)
        self.assertEqual(count_rows(str(self.root), "t.md", section="화면 2"), 2)
        self.assertEqual(count_rows(str(self.root), "t.md", section="정의"), 2)


class LiveTallyTest(unittest.TestCase):
    def test_bare_counts_are_found_dated_and_coded_ones_are_not(self):
        text = ("기능 42건의 색인\n"
                "화면별 폴더 35\n"            # a bare number is not a count
                "2026-10-15 실측 67개\n"      # dated: a record
                "`vault_tally.py docs` → 12건이 아니라 명령\n"  # count outside code still counts
                "holds 35 folders\n"
                "no `42건` here\n"
                "상한 100명 · 1.2개 · v2 파일\n")
        self.assertEqual(live_tallies(text), [(1, "42건"), (4, "12건"), (5, "35 folders")])


if __name__ == "__main__":
    unittest.main()
