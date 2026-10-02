#!/usr/bin/env python3
# origin: lemoncloud-io/knowledge@11357973:projects/second-brain/config/scripts/test_vault_verify.py
"""Tests for vault_verify: the frontmatter structural check and its next_action /
milestones shape checks, and the raw index scope check (docs/raw-layout.md § 색인).

Run from the scripts directory:

    python3 -m unittest test_vault_verify -v

Stdlib only — PyYAML is not installed on every machine that runs the lanes, which is
exactly why `scan_frontmatter` is dependency-free.
"""

from __future__ import annotations

import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

import vault_verify
from vault_verify import (
    HAVE_YAML,
    MILESTONE_MAX_BYTES,
    NEXT_ACTION_MAX_BYTES,
    scan_frontmatter,
    scan_milestones,
    scan_next_action,
)


class ScanFrontmatterTest(unittest.TestCase):
    def test_scalar_followed_by_indented_sequence_is_a_defect(self):
        """The 2026-08-28 break: a merge left both sides' list tails under a scalar key."""
        text = (
            "---\n"
            "type: project\n"
            "milestones:\n"
            '  - "A사 주 1회 온라인 컨설팅 4회"\n'
            'next_action: "B사 담당자 회신 대기; 9/11 중간점검 준비"\n'
            '  - "2026-08-28(금) 10시 C사 정기"\n'
            '  - "D사 1차 실습 완료(08-28)"\n'
            "---\n"
            "\n# Sample Project\n"
        )
        defects = scan_frontmatter(text, "projects/p/README.md")
        self.assertTrue(defects, "expected a defect for a sequence indented under a scalar")
        self.assertIn("next_action", " ".join(defects))

    def test_duplicate_top_level_key_is_a_defect(self):
        text = (
            "---\n"
            "type: project\n"
            'next_action: "first"\n'
            'next_action: "second"\n'
            "---\n"
        )
        defects = scan_frontmatter(text, "a.md")
        self.assertTrue(defects)
        self.assertIn("duplicate", " ".join(defects).lower())

    def test_unterminated_frontmatter_is_a_defect(self):
        text = "---\ntype: project\nstatus: active\n\n# Heading with no closing fence\n"
        defects = scan_frontmatter(text, "b.md")
        self.assertTrue(defects)
        self.assertIn("unterminated", " ".join(defects).lower())

    def test_tab_indentation_is_a_defect(self):
        text = "---\ntopics:\n\t- ai-agents\n---\n"
        defects = scan_frontmatter(text, "c.md")
        self.assertTrue(defects)
        self.assertIn("tab", " ".join(defects).lower())

    # --- must NOT fire ----------------------------------------------------

    def test_block_scalar_body_is_accepted(self):
        """`description: >` followed by indented prose is how every skill file opens."""
        text = (
            "---\n"
            "name: vault-lint\n"
            "description: >\n"
            "  사용자의 knowledge vault에 대해 Claude Code 우선으로 lint pass를 실행한다\n"
            "  (모순 탐지, 고아 페이지, frontmatter 결함 점검).\n"
            "---\n"
        )
        self.assertEqual(scan_frontmatter(text, "vault-lint.md"), [])

    def test_literal_block_scalar_is_accepted(self):
        text = "---\nnotes: |\n  line one\n  line two\n---\n"
        self.assertEqual(scan_frontmatter(text, "d.md"), [])

    def test_nested_mapping_and_sequences_are_accepted(self):
        text = (
            "---\n"
            "type: project\n"
            "status: active\n"
            "milestones:\n"
            "  - name: \"Initialize control files\"\n"
            "    due: 2026-07-08\n"
            "    done: true\n"
            "  - name: \"Clarify workflows\"\n"
            "    due: 2026-07-08\n"
            "    done: true\n"
            "sources:\n"
            '  - "raw/some-source.md"\n'
            '  - "https://example.com/a"\n'
            "due:\n"
            "---\n"
        )
        self.assertEqual(scan_frontmatter(text, "e.md"), [])

    def test_same_key_at_different_depths_is_accepted(self):
        """`name:` inside two milestone entries is not a duplicate — different parents."""
        text = (
            "---\n"
            "milestones:\n"
            '  - name: "one"\n'
            '  - name: "two"\n'
            "---\n"
        )
        self.assertEqual(scan_frontmatter(text, "f.md"), [])

    def test_comment_lines_are_accepted(self):
        text = "---\n# a comment\ntype: concept\n---\n"
        self.assertEqual(scan_frontmatter(text, "g.md"), [])

    def test_file_without_frontmatter_is_accepted(self):
        self.assertEqual(scan_frontmatter("# Just a heading\n\nBody.\n", "h.md"), [])

    def test_empty_frontmatter_is_accepted(self):
        self.assertEqual(scan_frontmatter("---\n---\n\n# Body\n", "i.md"), [])

    def test_defect_message_names_the_file_and_line(self):
        text = "---\ntype: project\n" + 'next_action: "x"\n  - "y"\n' + "---\n"
        defects = scan_frontmatter(text, "projects/x/README.md")
        self.assertTrue(defects)
        self.assertIn("projects/x/README.md", defects[0])
        self.assertIn(":4", defects[0])


class PyYamlLayerTest(unittest.TestCase):
    """The full parse that runs on top when PyYAML is importable.

    The structural check is deliberately conservative, so it lets some unparseable
    documents through. Where PyYAML exists, catch those too.
    """

    def setUp(self):
        if not HAVE_YAML:
            self.skipTest("PyYAML not importable by this interpreter")

    def test_catches_a_break_the_structural_check_lets_through(self):
        """An unclosed flow sequence is valid line-shape but invalid YAML."""
        text = "---\ntype: concept\ntopics: [ai-agents, knowledge\nstatus: draft\n---\n"
        self.assertEqual(
            scan_frontmatter(text, "z.md", use_parser=False), [],
            "precondition: the structural check does not catch this",
        )
        defects = scan_frontmatter(text, "z.md")
        self.assertTrue(defects, "expected the parser layer to catch it")
        self.assertIn("z.md", defects[0])

    def test_valid_document_stays_clean(self):
        text = (
            "---\n"
            "type: concept\n"
            "topics:\n"
            "  - ai-agents\n"
            "status: draft\n"
            'created: "2026-08-28"\n'
            "---\n"
        )
        self.assertEqual(scan_frontmatter(text, "y.md"), [])

    def test_structural_defects_are_not_duplicated_by_the_parser(self):
        """The historical break reports its two precise defects, not a parser dump too."""
        text = (
            "---\n"
            "type: project\n"
            'next_action: "first"\n'
            '  - "orphaned item"\n'
            'next_action: "second"\n'
            "---\n"
        )
        defects = scan_frontmatter(text, "projects/p/README.md")
        self.assertEqual(len(defects), 2, defects)

    def test_template_placeholders_parse(self):
        """templates/ files carry {{date}} placeholders and must stay clean."""
        text = '---\ntype: concept\ntopics: []\nstatus: draft\ncreated: "{{date}}"\n---\n'
        self.assertEqual(scan_frontmatter(text, "templates/wiki-concept.md"), [])


class ScanNextActionTest(unittest.TestCase):
    """The `next_action` shape contract — docs/project-next-action.md."""

    def _fm(self, body: str) -> str:
        return "---\ntype: project\nstatus: active\n" + body + "---\n\n# P\n"

    def test_short_scalar_is_accepted(self):
        text = self._fm('next_action: "A사 2차(GitHub 연동) 준비 — 09-15(월) 15시"\n')
        self.assertEqual(scan_next_action(text, "projects/p/README.md"), [])

    def test_empty_values_are_accepted(self):
        for body in ('next_action: ""\n', "next_action: []\n", "next_action:\n"):
            self.assertEqual(scan_next_action(self._fm(body), "templates/project-readme.md"), [])

    def test_missing_key_is_accepted(self):
        self.assertEqual(scan_next_action(self._fm("goal: \"x\"\n"), "wiki/a.md"), [])

    def test_oversize_scalar_is_a_defect_naming_the_line_and_size(self):
        value = "가" * 120  # 360 bytes in UTF-8
        text = self._fm(f'next_action: "{value}"\n')
        defects = scan_next_action(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("projects/p/README.md:4", defects[0])
        self.assertIn("360 bytes", defects[0])
        self.assertIn(str(NEXT_ACTION_MAX_BYTES), defects[0])

    def test_cap_measures_bytes_not_characters(self):
        """101 Korean characters are over the cap; 101 ASCII characters are not."""
        self.assertTrue(scan_next_action(self._fm('next_action: "' + "가" * 101 + '"\n'), "p.md"))
        self.assertEqual(scan_next_action(self._fm('next_action: "' + "a" * 101 + '"\n'), "p.md"), [])

    def test_semicolon_joined_scalar_is_a_defect(self):
        """The 2026-09-15 case: one company per clause, ten clauses, one string."""
        text = self._fm('next_action: "B사 일정 조정; A사 4차 자료 준비"\n')
        defects = scan_next_action(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("';'", defects[0])

    def test_block_sequence_of_short_items_is_accepted(self):
        text = self._fm(
            "next_action:\n"
            '  - "A사 2차 준비 — 09-15(월) 15시"\n'
            '  - "C사 PoC 검토 — 일정 미정"\n'
        )
        self.assertEqual(scan_next_action(text, "projects/p/README.md"), [])

    def test_oversize_item_names_its_own_line_and_index(self):
        text = self._fm("next_action:\n" '  - "ok"\n' f'  - "{"가" * 120}"\n')
        defects = scan_next_action(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("item 2", defects[0])
        self.assertIn("projects/p/README.md:6", defects[0])

    def test_sequence_stops_at_the_next_key(self):
        """A later key's own list is not counted as next_action items."""
        text = self._fm(
            "next_action:\n" '  - "ok"\n' "milestones:\n" f'  - "{"가" * 120}"\n'
        )
        self.assertEqual(scan_next_action(text, "projects/p/README.md"), [])

    def test_inline_flow_sequence_is_a_defect(self):
        text = self._fm('next_action: ["a", "b"]\n')
        defects = scan_next_action(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("flow sequence", defects[0])

    def test_block_scalar_is_a_defect(self):
        text = self._fm("next_action: >\n  두 줄로\n  접힌 값\n")
        defects = scan_next_action(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("block scalar", defects[0])

    def test_indented_next_action_is_not_read(self):
        """Only the top-level project key is judged."""
        text = self._fm("nested:\n" '  next_action: "' + "가" * 120 + '"\n')
        self.assertEqual(scan_next_action(text, "projects/p/README.md"), [])

    def test_file_without_frontmatter_is_accepted(self):
        text = "# Plan\n\n```yaml\nnext_action: \"" + "가" * 120 + "\"\n```\n"
        self.assertEqual(scan_next_action(text, "docs/superpowers/plans/x.md"), [])

    def test_unterminated_frontmatter_is_left_to_scan_frontmatter(self):
        text = "---\ntype: project\nnext_action: \"" + "가" * 120 + '"\n'
        self.assertEqual(scan_next_action(text, "projects/p/README.md"), [])
        self.assertTrue(scan_frontmatter(text, "projects/p/README.md"))


class ScanMilestonesTest(unittest.TestCase):
    """The `milestones` name contract — docs/project-milestones.md."""

    def _fm(self, body: str) -> str:
        return "---\ntype: project\nstatus: active\n" + body + "---\n\n# P\n"

    def test_short_string_entries_are_accepted(self):
        text = self._fm(
            "milestones:\n"
            '  - "A사 온라인 컨설팅 4회 종료 — 09-17 커리큘럼 4차로 마감"\n'
            '  - "2026-10 첫째 주 기업별 중간 점검 보고서 9부 제출"\n'
        )
        self.assertEqual(scan_milestones(text, "projects/p/README.md"), [])

    def test_short_mapping_entries_are_accepted(self):
        text = self._fm(
            "milestones:\n"
            '  - name: "증분 boundary v3 + 백엔드 tool 3종 (2026-09-07)"\n'
            "    due:\n"
            "    done: true\n"
            '  - name: "describe 완전성 (2026-09-09)"\n'
            "    due: 2026-09-09\n"
            "    done: true\n"
        )
        self.assertEqual(scan_milestones(text, "projects/p/README.md"), [])

    def test_empty_and_missing_are_accepted(self):
        for body in ("milestones: []\n", "milestones:\n"):
            self.assertEqual(scan_milestones(self._fm(body), "templates/project-readme.md"), [])
        self.assertEqual(scan_milestones(self._fm('goal: "x"\n'), "wiki/a.md"), [])

    def test_oversize_string_entry_names_the_line_and_size(self):
        text = self._fm("milestones:\n" + '  - "' + "가" * 120 + '"\n')
        defects = scan_milestones(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("projects/p/README.md:5", defects[0])
        self.assertIn("entry 1", defects[0])
        self.assertIn("360 bytes", defects[0])
        self.assertIn(str(MILESTONE_MAX_BYTES), defects[0])

    def test_oversize_mapping_name_names_its_own_line(self):
        """The 2026-09-21 case: the verdict record lived in the name, 4,889 bytes of it."""
        text = self._fm(
            "milestones:\n"
            '  - name: "짧은 라벨"\n'
            "    done: true\n"
            '  - name: "' + "나" * 150 + '"\n'
            "    done: true\n"
        )
        defects = scan_milestones(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("entry 2", defects[0])
        self.assertIn(":7 ", defects[0])

    def test_cap_measures_bytes_not_characters(self):
        self.assertTrue(scan_milestones(self._fm("milestones:\n  - \"" + "가" * 101 + "\"\n"), "p.md"))
        self.assertEqual(
            scan_milestones(self._fm("milestones:\n  - \"" + "a" * 101 + "\"\n"), "p.md"), []
        )

    def test_name_on_a_later_line_of_the_mapping_is_still_read(self):
        """`- due:` first, `name:` below it — the entry is one item, not two."""
        text = self._fm(
            "milestones:\n"
            "  - due: 2026-09-09\n"
            '    name: "' + "다" * 150 + '"\n'
            "    done: false\n"
        )
        defects = scan_milestones(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("entry 1", defects[0])

    def test_sequence_stops_at_the_next_key(self):
        """An oversize next_action below the block is not counted as a milestone."""
        text = self._fm(
            "milestones:\n"
            '  - "짧은 라벨"\n'
            'next_action: "' + "가" * 120 + '"\n'
        )
        self.assertEqual(scan_milestones(text, "projects/p/README.md"), [])

    def test_inline_flow_sequence_is_a_defect(self):
        text = self._fm('milestones: ["a", "b"]\n')
        defects = scan_milestones(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("flow sequence", defects[0])

    def test_bare_scalar_value_is_a_defect(self):
        text = self._fm('milestones: "설계 확정과 배포와 검증"\n')
        defects = scan_milestones(text, "projects/p/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("block sequence", defects[0])

    def test_indented_milestones_key_is_not_read(self):
        text = self._fm("nested:\n  milestones:\n    - \"" + "가" * 120 + '"\n')
        self.assertEqual(scan_milestones(text, "projects/p/README.md"), [])

    def test_unterminated_frontmatter_is_left_to_scan_frontmatter(self):
        text = "---\nmilestones:\n  - \"" + "가" * 120 + '"\n'
        self.assertEqual(scan_milestones(text, "projects/p/README.md"), [])


INDEX_FILES = ("docs/raw-index.yml", "docs/raw-index.md")


class RawIndexScopeTest(unittest.TestCase):
    """docs/raw-layout.md § 색인 — only the lint lane commits docs/raw-index.*.

    A lint-lane change set is defined by shape, not branch name: it touches no path under
    raw/ or Clippings/. An ingest or promote change set always adds raw files, so an index
    change riding along with one is the 2026-09-29 collision source (date + counts at the
    top of both files conflict between any two raw-touching PRs).
    """

    BASE = "abc1234"

    def _run(self, paths):
        defects: list[str] = []
        with mock.patch.object(vault_verify, "_changed_paths", lambda *a, **k: paths):
            vault_verify.check_raw_index_scope(pathlib.Path("."), self.BASE, defects)
        return defects

    def test_index_with_raw_file_is_a_defect(self):
        defects = self._run([*INDEX_FILES, "raw/new-clip.md", "wiki/x.md", "outputs/runs/r.md"])
        self.assertEqual(len(defects), 1, defects)
        msg = defects[0]
        for rel in INDEX_FILES:
            self.assertIn(rel, msg)
        self.assertIn("lint lane", msg)
        self.assertIn(f"git checkout {self.BASE} -- docs/raw-index.yml docs/raw-index.md", msg)

    def test_index_with_clippings_path_is_a_defect_naming_only_the_changed_file(self):
        defects = self._run(["docs/raw-index.md", "Clippings/pending.md"])
        self.assertEqual(len(defects), 1, defects)
        head = defects[0].split(" — ")[0]
        self.assertIn("docs/raw-index.md", head)
        self.assertNotIn("docs/raw-index.yml", head)

    def test_quoted_non_ascii_raw_path_still_counts(self):
        """git quotes non-ASCII names by default (core.quotepath=true)."""
        defects = self._run(["docs/raw-index.yml", '"raw/\\355\\225\\234.md"'])
        self.assertEqual(len(defects), 1, defects)

    def test_index_only_is_accepted(self):
        self.assertEqual(self._run(list(INDEX_FILES)), [])

    def test_index_with_wiki_outputs_and_runs_is_accepted(self):
        paths = [*INDEX_FILES, "wiki/a.md", "outputs/2026-09-29-vault-lint.md",
                 "outputs/runs/2026-09-29-maintenance-x.md", "docs/raw-layout.md"]
        self.assertEqual(self._run(paths), [])

    def test_raw_without_index_is_accepted(self):
        self.assertEqual(self._run(["raw/new-clip.md", "Clippings/other.md", "wiki/a.md"]), [])

    def test_lookalike_paths_are_not_raw_or_index(self):
        paths = ["docs/raw-index.yml.bak", "raw-notes/a.md", "private/raw-index.yml",
                 "projects/x/raw/a.md"]
        self.assertEqual(self._run(paths), [])

    def test_git_failure_is_reported_like_sibling_checks(self):
        """_changed_paths → None: same as check_lane_trace, a "could not run" defect."""
        defects = self._run(None)
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("could not run", defects[0])
        self.assertIn(self.BASE, defects[0])


class RawIndexScopeGitTest(unittest.TestCase):
    """End to end against a throwaway repo — covers what the stub cannot: pathspecs,
    untracked files, renames, and that the default `_changed_paths` is unchanged."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        for d in ("raw", "Clippings", "docs", "wiki", "outputs/runs"):
            (self.root / d).mkdir(parents=True)
        self._write("raw/old.md", "old\n")
        self._write("Clippings/tracked-clip.md", "clip\n")
        for rel in INDEX_FILES:
            self._write(rel, "generated: 2026-09-01\n")
        self._git("init", "-q")
        self._git("config", "user.email", "t@example.com")
        self._git("config", "user.name", "t")
        self._git("add", "-A")
        self._git("commit", "-qm", "base")
        self.base = self._git("rev-parse", "HEAD").strip()

    def tearDown(self):
        self._tmp.cleanup()

    def _git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args],
                              check=True, capture_output=True, text=True).stdout

    def _write(self, rel, text):
        (self.root / rel).write_text(text, encoding="utf-8")

    def _check(self):
        defects: list[str] = []
        vault_verify.check_raw_index_scope(self.root, self.base, defects)
        return defects

    def test_committed_ingest_with_index_is_a_defect(self):
        self._write("raw/한글-클립.md", "new\n")
        self._write("docs/raw-index.yml", "generated: 2026-09-29\n")
        self._git("add", "-A")
        self._git("commit", "-qm", "feat: ingest")
        defects = self._check()
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("docs/raw-index.yml", defects[0])

    def test_clipping_moved_to_raw_with_index_is_a_defect(self):
        self._git("mv", "Clippings/tracked-clip.md", "raw/tracked-clip.md")
        self._write("docs/raw-index.md", "generated: 2026-09-29\n")
        self.assertEqual(len(self._check()), 1)

    def test_lint_regen_with_untracked_local_files_is_accepted(self):
        """A lint pass on a machine with pending clippings and local-only raw files."""
        self._write("Clippings/pending ’clip’.md", "pending\n")
        self._write("raw/local-only.md", "local\n")
        for rel in INDEX_FILES:
            self._write(rel, "generated: 2026-09-29\n")
        self._write("outputs/2026-09-29-vault-lint.md", "report\n")
        self.assertEqual(self._check(), [])

    def test_ingest_leaving_index_alone_is_accepted(self):
        self._write("raw/new.md", "new\n")
        self._git("add", "-A")
        self._git("commit", "-qm", "feat: ingest")
        self.assertEqual(self._check(), [])

    def test_default_changed_paths_still_covers_outputs_only(self):
        """The lane-trace helper keeps its old scope: outputs/, tracked diff + untracked."""
        self._write("raw/new.md", "new\n")
        self._write("docs/raw-index.yml", "generated: 2026-09-29\n")
        self._write("outputs/runs/r.md", "run\n")
        self.assertEqual(vault_verify._changed_paths(self.root, self.base), ["outputs/runs/r.md"])


if __name__ == "__main__":
    unittest.main()
