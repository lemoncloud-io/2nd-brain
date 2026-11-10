#!/usr/bin/env python3
"""Tests for vault_open_questions — the queue derived from wiki `## Open Questions` sections.

Run from the scripts directory:  python3 -m unittest test_vault_open_questions -v
"""
from __future__ import annotations

import contextlib
import io
import json
import pathlib
import subprocess
import tempfile
import unittest

import vault_open_questions as v

NOTE = """---
type: concept
created: "2026-08-01"
---

# Note

## Details

- not a question

## Open Questions

- needs-update: 공식 문서로 확인하지 못했다.
- 이 vault에서 미시험.
  두 번째 줄은 같은 질문이다.
  - 중첩 글머리도 같은 질문이다.
- 채널 기록의 후속 처리 여부 (#team-dev, 2025-01-02)
- 스킬을 플러그인으로 묶을지는 결정된 바 없다.
- 세 층의 경계가 어디인가.

```text
- fenced bullet is not a question
```

## Connections

- not a question either
"""


def write(root, rel, text):
    p = pathlib.Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def run(argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = v.main(argv)
    return code, buf.getvalue()


class ParseTest(unittest.TestCase):
    def test_only_top_level_bullets_of_the_section(self):
        got = v.parse(NOTE)
        self.assertEqual(len(got), 5)
        self.assertIn("두 번째 줄은 같은 질문이다.", got[1][1])
        self.assertIn("중첩 글머리도 같은 질문이다.", got[1][1])
        self.assertNotIn("fenced", " ".join(t for _, t in got))
        self.assertNotIn("not a question", " ".join(t for _, t in got))

    def test_no_section_and_empty_section(self):
        self.assertEqual(v.parse("# T\n\n## Summary\n\n- x\n"), [])
        self.assertEqual(v.parse("# T\n\n## Open Questions\n\n## Connections\n- x\n"), [])

    def test_id_ignores_whitespace_but_not_wording(self):
        self.assertEqual(v.qid("n", "a  b\n c"), v.qid("n", "a b c"))
        self.assertNotEqual(v.qid("n", "a b c"), v.qid("n", "a b d"))
        self.assertTrue(v.qid("note", "x").startswith("note#"))

    def test_kinds(self):
        kinds = [v.kind_of(t) for _, t in v.parse(NOTE)]
        self.assertEqual(kinds, ["A", "B", "D", "C", "E"])


class CommandTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        write(self.root, "wiki/note.md", NOTE)
        write(self.root, "wiki/INDEX.md", "## Open Questions\n\n- index is not scanned\n")
        write(self.root, "wiki/topics/t.md", "## Open Questions\n\n- topics are not scanned\n")

    def tearDown(self):
        self._tmp.cleanup()

    def test_summary_prints_label_count_lines(self):
        code, out = run(["summary", "--root", self.root, "--today", "2026-10-27"])
        self.assertEqual(code, 0)
        lines = dict(l.split(": ") for l in out.strip().splitlines())
        self.assertEqual(lines["열린 질문"], "5")
        self.assertEqual(lines["열린 질문이 있는 노트"], "1")
        self.assertEqual(lines["유형 D 조직 기록"], "1")
        self.assertEqual(lines["stale 후보 (D, 6개월 경과)"], "1")

    def test_stale_respects_the_cut(self):
        _, out = run(["stale", "--root", self.root, "--today", "2025-03-01", "--json"])
        self.assertEqual(json.loads(out), [])
        _, out = run(["stale", "--root", self.root, "--today", "2026-10-27", "--json"])
        self.assertEqual(len(json.loads(out)), 1)

    def test_batch_and_ask_select_by_kind(self):
        _, out = run(["batch", "--root", self.root, "--json"])
        self.assertEqual({i["kind"] for i in json.loads(out)}, {"A", "B"})
        _, out = run(["ask", "--root", self.root, "--json"])
        self.assertEqual([i["kind"] for i in json.loads(out)], ["C"])
        _, out = run(["ask", "--root", self.root])
        self.assertIn("권고 기본값", out)

    def test_diff_requires_every_closed_id_in_the_log(self):
        git = lambda *a: subprocess.run(["git", *a], cwd=self.root, check=True, capture_output=True)
        git("init", "-q")
        git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base")
        closed = v.qid("note", "이 vault에서 미시험. 두 번째 줄은 같은 질문이다. - 중첩 글머리도 같은 질문이다.")
        text = NOTE.replace("- 이 vault에서 미시험.\n  두 번째 줄은 같은 질문이다.\n  - 중첩 글머리도 같은 질문이다.\n", "")
        write(self.root, "wiki/note.md", text)
        write(self.root, "log.md", "nothing here\n")
        code, out = run(["diff", "--root", self.root, "--base", "HEAD", "--log", "log.md"])
        self.assertEqual(code, 1)
        self.assertIn("닫힘 1", out)
        write(self.root, "log.md", f"| `{closed}` | 해소 |\n")
        code, _ = run(["diff", "--root", self.root, "--base", "HEAD", "--log", "log.md"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
