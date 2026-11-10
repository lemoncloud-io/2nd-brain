#!/usr/bin/env python3
"""Tests for skill_lint — the SKILL.md checks of docs/agent-skills-registration.md § 7.

Run from the scripts directory:  python3 -m unittest test_skill_lint -v
"""
from __future__ import annotations

import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

import skill_lint

# 통과하는 최소 스킬 본문
GOOD = "---\nname: {name}\ndescription: >\n  무엇을 한다. 언제 쓴다.\n---\n\n# {name}\n\n## 절차\n\n1. 한다.\n"


def write(root: pathlib.Path, rel: str, text: str) -> pathlib.Path:
    """임시 폴더에 파일을 쓴다."""
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def long_body(head: str, total: int) -> str:
    """앞에 head를 두고 total줄이 되도록 채운 본문."""
    lines = head.splitlines()
    return "\n".join(lines + [f"- 줄 {i}" for i in range(total - len(lines))]) + "\n"


class SelfContainedRulesTest(unittest.TestCase):
    """계약 문서가 없는 볼트에서도 스크립트 머리 설명만으로 규칙을 읽을 수 있다."""

    # 규칙 코드 다섯이 모두 머리 설명에 한 줄 이상으로 적혀 있다.
    def test_docstring_names_every_rule(self):
        doc = skill_lint.__doc__ or ""
        for code in ("E1", "E2", "E3", "W1", "W2"):
            self.assertRegex(doc, rf"\n  {code} \S")


class LintSkillTest(unittest.TestCase):
    """lint_skill 한 건 단위 검사."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _lint(self, folder: str, text: str) -> dict:
        """스킬 하나를 쓰고 검사한다."""
        return skill_lint.lint_skill(write(self.root, f"{folder}/SKILL.md", text), self.root)

    # --- E1 frontmatter ---------------------------------------------------

    def test_minimal_skill_passes(self):
        r = self._lint("demo-skill", GOOD.format(name="demo-skill"))
        self.assertEqual((r["errors"], r["warnings"]), ([], []))

    def test_missing_frontmatter_is_an_error(self):
        r = self._lint("demo", "# demo\n")
        self.assertIn("E1 frontmatter", r["errors"][0])

    def test_missing_name_and_description_are_errors(self):
        r = self._lint("demo", "---\nlicense: MIT\n---\n# demo\n")
        joined = " ".join(r["errors"])
        self.assertIn("`name`이 없다", joined)
        self.assertIn("`description`이 없다", joined)

    def test_name_must_match_folder(self):
        r = self._lint("demo", GOOD.format(name="other"))
        self.assertTrue(any("폴더명 `demo`" in e for e in r["errors"]), r["errors"])

    def test_name_format_is_checked(self):
        r = self._lint("Bad--Name", GOOD.format(name="Bad--Name"))
        self.assertTrue(any("형식 위반" in e for e in r["errors"]), r["errors"])

    def test_quoted_name_is_unquoted(self):
        r = self._lint("demo", '---\nname: "demo"\ndescription: "한 줄 설명"\n---\n')
        self.assertEqual(r["errors"], [])

    def test_folded_description_over_limit_is_an_error(self):
        body = "\n".join("  " + "가" * 100 for _ in range(11))
        r = self._lint("demo", f"---\nname: demo\ndescription: >\n{body}\n---\n")
        self.assertTrue(any("`description`이" in e and "1024" in e for e in r["errors"]), r["errors"])

    def test_description_at_limit_passes(self):
        r = self._lint("demo", f"---\nname: demo\ndescription: {'a' * 1024}\n---\n")
        self.assertEqual(r["errors"], [])

    # --- E2 줄 수 ---------------------------------------------------------

    def test_over_500_lines_is_an_error(self):
        text = long_body(GOOD.format(name="demo") + "## 언제 쓰는가\n## 하지 않는 것\n", 501)
        r = self._lint("demo", text)
        self.assertTrue(any(e.startswith("E2") for e in r["errors"]), r["errors"])

    def test_exactly_500_lines_passes(self):
        text = long_body(GOOD.format(name="demo") + "## 언제 쓰는가\n## 하지 않는 것\n", 500)
        r = self._lint("demo", text)
        self.assertEqual(r["errors"], [])

    # --- E3 링크 ----------------------------------------------------------

    def test_broken_relative_link_is_an_error_with_line(self):
        r = self._lint("demo", GOOD.format(name="demo") + "\n[참조](references/missing.md)\n")
        self.assertEqual(len(r["errors"]), 1, r["errors"])
        self.assertIn("SKILL.md:13 링크 `references/missing.md`", r["errors"][0])

    def test_backticked_references_path_is_checked(self):
        r = self._lint("demo", GOOD.format(name="demo") + "\n상세는 `references/gone.md`를 본다.\n")
        self.assertTrue(any("references/gone.md" in e for e in r["errors"]), r["errors"])

    def test_resolving_links_pass(self):
        write(self.root, "demo/references/guide.md", "# guide\n")
        write(self.root, "docs/contract.md", "# contract\n")
        text = GOOD.format(name="demo") + (
            "\n[가이드](references/guide.md#절) · `references/guide.md` · [계약](../docs/contract.md)\n"
            "[외부](https://example.com) · [앵커](#절차) · [메일](mailto:a@b.c)\n")
        self.assertEqual(self._lint("demo", text)["errors"], [])

    def test_placeholders_code_fences_and_inline_code_are_skipped(self):
        text = GOOD.format(name="demo") + (
            "\n`[x](references/<name>.md)` · `references/{slug}.md`\n"
            "```\n[예시](references/nothing.md)\n```\n")
        self.assertEqual(self._lint("demo", text)["errors"], [])

    # --- W1 첫 100줄의 트리거·경계 ------------------------------------------

    def test_short_skill_needs_no_sections(self):
        self.assertEqual(self._lint("demo", long_body(GOOD.format(name="demo"), 100))["warnings"], [])

    def test_long_skill_without_sections_warns_twice(self):
        r = self._lint("demo", long_body(GOOD.format(name="demo"), 150))
        self.assertEqual([w[:2] for w in r["warnings"]], ["W1", "W1"], r["warnings"])
        self.assertEqual(r["errors"], [])

    def test_long_skill_with_korean_sections_passes(self):
        head = GOOD.format(name="demo") + "## 언제 쓰는가\n\n## 하지 않는 것\n"
        self.assertEqual(self._lint("demo", long_body(head, 150))["warnings"], [])

    def test_long_skill_with_english_sections_passes(self):
        head = GOOD.format(name="demo") + "## When to Use\n\n## Boundaries\n"
        self.assertEqual(self._lint("demo", long_body(head, 150))["warnings"], [])

    def test_sections_after_line_100_still_warn(self):
        text = long_body(GOOD.format(name="demo"), 120) + "## 트리거\n## 금지\n"
        self.assertEqual(len(self._lint("demo", text)["warnings"]), 2)

    def test_fenced_heading_does_not_count(self):
        head = GOOD.format(name="demo") + "```\n## 트리거\n## 금지\n```\n"
        self.assertEqual(len(self._lint("demo", long_body(head, 150))["warnings"]), 2)

    # --- W2 참조 md 목차 -----------------------------------------------------

    def test_long_reference_without_toc_warns(self):
        write(self.root, "demo/references/long.md", long_body("# long", 150))
        r = self._lint("demo", GOOD.format(name="demo") + "\n[긴 참조](references/long.md)\n")
        self.assertEqual(len(r["warnings"]), 1, r["warnings"])
        self.assertIn("W2 참조 `references/long.md`", r["warnings"][0])

    def test_long_reference_with_toc_heading_passes(self):
        write(self.root, "demo/references/long.md", long_body("# long\n\n## 목차\n", 150))
        r = self._lint("demo", GOOD.format(name="demo") + "\n`references/long.md`\n")
        self.assertEqual(r["warnings"], [])

    def test_long_reference_with_anchor_list_passes(self):
        write(self.root, "demo/references/long.md", long_body("# long\n\n- [A](#a)\n- [B](#b)\n", 150))
        r = self._lint("demo", GOOD.format(name="demo") + "\n[긴 참조](references/long.md)\n")
        self.assertEqual(r["warnings"], [])

    def test_long_document_outside_the_skill_is_not_a_reference(self):
        write(self.root, "docs/long.md", long_body("# long", 150))
        r = self._lint("demo", GOOD.format(name="demo") + "\n[계약](../docs/long.md)\n")
        self.assertEqual(r["warnings"], [])


class GitModeTest(unittest.TestCase):
    """--changed·--all과 종료 코드 — 임시 git 저장소."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        write(self.root, "projects/a/skills/alpha/SKILL.md", GOOD.format(name="alpha"))
        write(self.root, "projects/a/skills/alpha/references/r.md", "# r\n")
        write(self.root, "projects/b/skills/beta/SKILL.md", GOOD.format(name="wrong"))  # 기존 결함
        write(self.root, "archive/old/SKILL.md", "# 없음\n")
        write(self.root, "docs/note.md", "# note\n")
        self._git("init", "-q")
        self._git("config", "user.email", "t@example.com")
        self._git("config", "user.name", "t")
        self._git("add", "-A")
        self._git("commit", "-qm", "base")
        self.base = self._git("rev-parse", "HEAD").strip()

    def tearDown(self):
        self._tmp.cleanup()

    def _git(self, *args):
        """임시 저장소에서 git을 돌린다."""
        return subprocess.run(["git", "-C", str(self.root), *args],
                              check=True, capture_output=True, text=True, encoding="utf-8").stdout

    def _run(self, *args):
        """main을 돌려 (종료 코드, 출력)을 돌려준다."""
        buf = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(io.StringIO()):
            code = skill_lint.main(["--root", str(self.root), *args])
        return code, buf.getvalue()

    def _names(self, skills):
        """SKILL.md 목록을 스킬 폴더명으로."""
        return [p.parent.name for p in skills]

    def test_no_change_lints_nothing(self):
        self.assertEqual(skill_lint.changed_skills(self.root, self.base), [])
        self.assertEqual(self._run("--changed", "--base", self.base)[0], 0)

    def test_changed_skill_md_is_selected(self):
        write(self.root, "projects/a/skills/alpha/SKILL.md", GOOD.format(name="alpha") + "\n추가\n")
        self.assertEqual(self._names(skill_lint.changed_skills(self.root, self.base)), ["alpha"])

    def test_changed_reference_selects_its_skill(self):
        write(self.root, "projects/a/skills/alpha/references/r.md", "# r\n\n고침\n")
        self.assertEqual(self._names(skill_lint.changed_skills(self.root, self.base)), ["alpha"])

    def test_untracked_new_skill_is_selected(self):
        write(self.root, "projects/c/skills/gamma/SKILL.md", GOOD.format(name="gamma"))
        self.assertEqual(self._names(skill_lint.changed_skills(self.root, self.base)), ["gamma"])

    def test_non_skill_and_archive_changes_are_ignored(self):
        write(self.root, "docs/note.md", "# note\n\n고침\n")
        write(self.root, "archive/old/SKILL.md", "# 고침\n")
        self.assertEqual(skill_lint.changed_skills(self.root, self.base), [])

    def test_changed_broken_skill_exits_1(self):
        write(self.root, "projects/b/skills/beta/SKILL.md", GOOD.format(name="wrong") + "\n고침\n")
        code, out = self._run("--changed", "--base", self.base)
        self.assertEqual(code, 1)
        self.assertIn("폴더명 `beta`", out)

    def test_all_skips_archive_and_reports_existing_defect(self):
        self.assertEqual(self._names(skill_lint.all_skills(self.root)), ["alpha", "beta"])
        code, out = self._run("--all", "--json")
        data = json.loads(out)
        self.assertEqual((code, data["skills"], data["errors"]), (1, 2, 1))
        self.assertTrue(data["files"][0]["path"].endswith("beta/SKILL.md"))

    def test_warning_only_exits_0(self):
        write(self.root, "projects/a/skills/alpha/SKILL.md", long_body(GOOD.format(name="alpha"), 150))
        code, out = self._run(str(self.root / "projects/a/skills/alpha"))
        self.assertEqual(code, 0)
        self.assertIn("WARN  W1", out)

    def test_bad_base_exits_2(self):
        self.assertEqual(self._run("--changed", "--base", "no-such-ref")[0], 2)


if __name__ == "__main__":
    unittest.main()
