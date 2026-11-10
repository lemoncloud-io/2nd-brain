#!/usr/bin/env python3
"""Tests for raw_source_gate — the ingest URL gate over raw/ and open PRs.

Run from the scripts directory:  python3 -m unittest test_raw_source_gate -v
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import pathlib
import tempfile
import unittest

import raw_source_gate as g


def write(root, rel, text):
    p = pathlib.Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def clip(url):
    return f'---\ntitle: "t"\nsource: "{url}"\n---\n\nbody source: "not this"\n'


class GateTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        write(self.root, "raw/a.md", clip("https://x.test/a"))
        write(self.root, "raw/slack/b.md", clip("https://x.test/b"))
        write(self.root, "raw/no-front.md", "source: https://x.test/c\n")
        write(self.root, "Clippings/new.md", clip("https://x.test/new"))
        write(self.root, "Clippings/dup.md", clip("https://x.test/a"))
        write(self.root, "Clippings/arch.md", clip("https://news.test/archive/12#3"))

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = g.main(argv)
        return code, buf.getvalue()

    def test_source_is_read_from_frontmatter_only(self):
        self.assertEqual(g.source_of(clip("u")), "u")
        self.assertEqual(g.source_of("source: u\n"), "")

    def test_local_raw_hit_and_miss(self):
        code, out = self.run_main(["--root", self.root, "--no-prs", "Clippings/new.md"])
        self.assertEqual(code, 0)
        self.assertIn("신규", out)
        code, out = self.run_main(["--root", self.root, "--no-prs", "Clippings/dup.md"])
        self.assertEqual(code, 1)
        self.assertIn("raw/a.md", out)

    def test_open_pr_hit(self):
        def fake(args, root):
            if args[:2] == ["pr", "list"]:
                return json.dumps([{"number": 7, "headRefName": "ingest/x",
                                    "files": [{"path": "raw/p.md"}, {"path": "wiki/w.md"}]}])
            self.assertIn("ref=ingest%2Fx", args[1])
            return base64.b64encode(clip("https://x.test/new").encode()).decode()
        self.assertEqual(g.open_pr_sources(self.root, run=fake), {"https://x.test/new": ["#7 raw/p.md"]})

    def test_archive_fragment_keeps_sections_apart(self):
        write(self.root, "raw/n1.md", clip("https://news.test/archive/12#1"))
        code, _ = self.run_main(["--root", self.root, "--no-prs", "Clippings/arch.md"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
