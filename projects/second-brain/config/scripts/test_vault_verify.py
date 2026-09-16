#!/usr/bin/env python3
# origin: lemoncloud-io/knowledge@2156ca2a:projects/second-brain/config/scripts/test_vault_verify.py
"""Tests for the frontmatter structural check in vault_verify.

Run from the scripts directory:

    python3 -m unittest test_vault_verify -v

Stdlib only — PyYAML is not installed on every machine that runs the lanes, which is
exactly why `scan_frontmatter` is dependency-free.
"""

from __future__ import annotations

import unittest

from vault_verify import HAVE_YAML, NEXT_ACTION_MAX_BYTES, scan_frontmatter, scan_next_action


class ScanFrontmatterTest(unittest.TestCase):
    def test_scalar_followed_by_indented_sequence_is_a_defect(self):
        """The 2026-08-28 break: a merge left both sides' list tails under a scalar key."""
        text = (
            "---\n"
            "type: project\n"
            "milestones:\n"
            '  - "센트비 주 1회 온라인 컨설팅 4회"\n'
            'next_action: "우성테크원 담당자 회신 대기; 9/11 중간점검 준비"\n'
            '  - "2026-08-28(금) 10시 인터포 정기"\n'
            '  - "금강엔지 1차 실습 완료(08-28)"\n'
            "---\n"
            "\n# Cloud Voucher\n"
        )
        defects = scan_frontmatter(text, "projects/cloud-voucher/README.md")
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
        defects = scan_frontmatter(text, "projects/cloud-voucher/README.md")
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
        text = self._fm('next_action: "제이머티리얼즈 2차(GitHub 연동) 준비 — 09-15(월) 15시"\n')
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
        text = self._fm('next_action: "우성테크원 일정 조정; 센트비 4차 자료 준비"\n')
        defects = scan_next_action(text, "projects/cloud-voucher/README.md")
        self.assertEqual(len(defects), 1, defects)
        self.assertIn("';'", defects[0])

    def test_block_sequence_of_short_items_is_accepted(self):
        text = self._fm(
            "next_action:\n"
            '  - "제이머티리얼즈 2차 준비 — 09-15(월) 15시"\n'
            '  - "엔아이소프트 PoC 검토 — 일정 미정"\n'
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


if __name__ == "__main__":
    unittest.main()
