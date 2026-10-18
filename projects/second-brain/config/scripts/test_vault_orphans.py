#!/usr/bin/env python3
"""Tests for vault_orphans — reachability from wiki/INDEX.md and the fix plan.

Run from the scripts directory:

    python3 -m unittest test_vault_orphans -v

Each case builds a tiny vault in a temp dir. The cases pin the decisions the check rests
on: a document is fine only when a chain of links from wiki/INDEX.md reaches it; dependency,
tooling and private trees (node_modules above all) are never scanned; dated records are never
edited; and --apply leaves every planned orphan reachable.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

from vault_orphans import Vault, apply_fixes, extract_targets, required, title_of


def write(root: pathlib.Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        write(self.root, "wiki/INDEX.md", "- [[wiki/a|A]]\n- [Projects](../projects/README.md)\n")
        write(self.root, "wiki/a.md", "# A\n\nSee [[b]].\n")
        write(self.root, "wiki/b.md", "# B\n")
        write(self.root, "wiki/c.md", "# C\n")
        write(self.root, "projects/README.md", "| [p](p/) | active |\n")
        write(self.root, "projects/p/README.md", "# P\n\nThe process is in `docs/process.md`.\n")
        write(self.root, "projects/p/docs/process.md", "# Process\n\nsee [guide](guide.md)\n")
        write(self.root, "projects/p/docs/guide.md", "# Guide\n")
        write(self.root, "projects/p/docs/lonely.md", "---\ntitle: Lonely doc\n---\n# x\n")

    def tearDown(self):
        self._tmp.cleanup()

    def vault(self, skip=()):
        return Vault(str(self.root), skip)

    def orphans(self, skip=()):
        v = self.vault(skip)
        return v.unreachable(v.reachable())


class ReachabilityTest(Base):
    def test_chain_from_index_and_folder_links(self):
        # c is in no chain; process/guide hang off an inline-code mention (not a link); lonely nowhere
        self.assertEqual(self.orphans(), ["projects/p/docs/guide.md", "projects/p/docs/lonely.md",
                                          "projects/p/docs/process.md", "wiki/c.md"])

    def test_config_templates_root_files_and_skip_need_not_be_reachable(self):
        write(self.root, "projects/p/config/skills/s/SKILL.md", "# skill\n")
        write(self.root, "templates/t.md", "# t\n")
        write(self.root, "CLAUDE.md", "# rules\n")
        self.assertFalse(required("projects/p/config/skills/s/SKILL.md"))
        self.assertEqual(self.orphans(skip=("projects/p/docs/",)), ["wiki/c.md"])

    def test_excluded_trees_are_not_scanned(self):
        for rel in ("node_modules/pkg/README.md", "projects/x/config/node_modules/y/README.md",
                    ".claude/worktrees/w/wiki/n.md", "private/n.md", "raw/n.md", "archive/n.md"):
            write(self.root, rel, "[[c]]\n")
        v = self.vault()
        self.assertEqual(len(v.files), 9)
        self.assertIn("wiki/c.md", v.unreachable(v.reachable()))

    def test_node_modules_basename_does_not_hijack_resolution(self):
        # same depth as wiki/c.md and sorts first: only the exclusion keeps [[c]] on the vault note
        write(self.root, "node_modules/c.md", "# not a vault note\n")
        write(self.root, "docs/README.md", "[[c]]\n")
        write(self.root, "wiki/INDEX.md", "- [[wiki/a|A]]\n- [Docs](../docs/README.md)\n")
        self.assertNotIn("wiki/c.md", self.orphans())

    def test_symlinked_directory_is_not_followed(self):
        write(self.root, "outside/ref.md", "[[c]]\n")
        os.symlink(self.root / "outside", self.root / "wiki" / "linked")
        self.assertNotIn("wiki/linked/ref.md", self.vault().files)


class PersonalScopeTest(Base):
    def setUp(self):
        super().setUp()
        write(self.root, "projects/@me/r/README.md", "---\nscope: personal\n---\n# r\n")
        write(self.root, "projects/@me/r/outputs/2026-10-15-plan.md", "# plan\n")

    def test_personal_scope_is_exempt(self):
        self.assertFalse(any(o.startswith("projects/@me/") for o in self.orphans()))
        self.assertEqual(self.vault().personal_dirs, ["projects/@me/r"])

    def test_promoted_document_must_be_reachable(self):
        # promotion moves the material out of the personal folder: the rule applies again
        write(self.root, "areas/ideas/from-r.md", "# idea\n\nsource: [r](../../projects/@me/r/README.md)\n")
        self.assertIn("areas/ideas/from-r.md", self.orphans())


@unittest.skipUnless(shutil.which("git"), "git not installed")
class LocalOnlyTest(Base):
    def setUp(self):
        super().setUp()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        write(self.root, ".gitignore", "projects/@me/\n")
        write(self.root, "projects/@me/README.md", "# local owner index\n[[c]]\n")
        write(self.root, "projects/README.md", "| [p](p/) | active |\n| [me](@me/) | local |\n")

    def test_gitignored_documents_are_neither_checked_nor_followed(self):
        v = self.vault()
        self.assertIn("projects/@me/README.md", v.local_only)
        self.assertNotIn("projects/@me/README.md", v.files)
        # wiki/c.md is linked only from the ignored file, so it stays cut off for teammates
        self.assertIn("wiki/c.md", v.unreachable(v.reachable()))


class PlanApplyTest(Base):
    def test_plan_prefers_mention_then_readme(self):
        fixes, hubs = self.vault().plan()
        via = {f["orphan"]: (f["via"], f["file"]) for f in fixes}
        self.assertEqual(via["projects/p/docs/process.md"], ("mention", "projects/p/README.md"))
        self.assertEqual(via["projects/p/docs/lonely.md"], ("readme", "projects/p/README.md"))
        self.assertNotIn("projects/p/docs/guide.md", via)  # reached through process.md once linked
        self.assertEqual([h["orphan"] for h in hubs], ["wiki/c.md"])  # no README above wiki/c.md

    def test_apply_links_mention_and_builds_document_map(self):
        v = self.vault()
        fixes, _ = v.plan()
        self.assertEqual(apply_fixes(v, fixes), ["projects/p/README.md"])
        text = (self.root / "projects/p/README.md").read_text(encoding="utf-8")
        self.assertIn("[`docs/process.md`](docs/process.md)", text)
        self.assertIn("## Document Map", text)
        self.assertIn("- [Lonely doc](docs/lonely.md)", text)
        self.assertEqual(self.orphans(), ["wiki/c.md"])

    def test_dated_records_are_never_edited(self):
        write(self.root, "outputs/runs/2026-10-15-ingest-x.md", "touched `docs/lonely.md`\n")
        write(self.root, "projects/p/outputs/2026-10-15-report.md", "see `docs/lonely.md`\n")
        write(self.root, "projects/p/README.md", "# P\n\n- [report](outputs/2026-10-15-report.md)\n")
        fixes, _ = self.vault().plan()
        self.assertTrue(fixes)
        self.assertTrue(all("2026-10-15" not in f["file"] for f in fixes))

    def test_clippings_inbox_is_not_required(self):
        write(self.root, "Clippings/pending-clip.md", "# Pending\n\n[[nowhere]]\n")
        self.assertNotIn("Clippings/pending-clip.md", self.orphans())

    def test_rule_files_are_never_edited(self):
        write(self.root, "CLAUDE.md", "Read `docs/lonely.md` first.\n")
        write(self.root, "VAULT_RULES.md", "Contract: `docs/lonely.md`.\n")
        fixes, _ = self.vault().plan()
        self.assertTrue(all(f["file"] not in ("CLAUDE.md", "VAULT_RULES.md") for f in fixes))

    def test_title_skips_frontmatter_comments(self):
        text = "---\ntype: weekly\n# Vault Markdown notes use quoted wikilinks\nweek: 1\n---\n\n# 주간 보고서\n"
        self.assertEqual(title_of(text, "areas/weekly/2026-09-14.md"), "주간 보고서")

    def test_template_slot_in_link_is_not_broken(self):
        write(self.root, "projects/p/final-report/template.md", "sources: [\"[[projects/p/{{company_code}}/README|x]]\"]\n")
        self.assertFalse(any("{{company_code}}" in t for _, _, t in self.vault().broken_links()))

    def test_clipping_links_are_not_broken_links(self):
        write(self.root, "Clippings/clip.md", "---\nauthor: \"[[nobody]]\"\n---\n# Clip\n[[nowhere]]\n")
        self.assertFalse(any(f.startswith("Clippings/") for f, _, _ in self.vault().broken_links()))

    def test_mention_fix_never_targets_frontmatter(self):
        write(self.root, "projects/p/README.md", "---\nnext_action: \"read `docs/lonely.md`\"\n---\n# P\n")
        fixes, _ = self.vault().plan()
        for f in fixes:
            if f["file"] == "projects/p/README.md" and f.get("via") == "mention":
                self.fail("mention fix inside frontmatter: %r" % (f,))

    def test_tooling_is_never_edited(self):
        write(self.root, "projects/p/config/skills/s/SKILL.md", "Read `docs/lonely.md` first.\n")
        write(self.root, "projects/p/README.md", "# P\n\n[skill](config/skills/s/SKILL.md)\n")
        fixes, _ = self.vault().plan()
        self.assertTrue(fixes)
        self.assertTrue(all("/config/" not in f["file"] for f in fixes))

    def test_existing_link_is_not_wrapped_again(self):
        write(self.root, "projects/p/README.md", "# P\n\n[`docs/process.md`](docs/process.md)\n")
        self.assertNotIn("projects/p/docs/process.md", self.orphans())
        fixes, _ = self.vault().plan()
        self.assertNotIn("projects/p/docs/process.md", [f["orphan"] for f in fixes])


class ExtractTest(unittest.TestCase):
    def test_code_is_ignored_and_aliases_stripped(self):
        text = ("[[a|A]] ![[b#Heading]] [[c\\|C]] `[[inline]]`\n"
                "```\n[[fenced]]\n```\n[x](../wiki/d.md#sec) [u](https://e.com/f.md) [p](proj/)\n")
        self.assertEqual(extract_targets(text),
                         [("wiki", "a"), ("wiki", "b"), ("wiki", "c"),
                          ("md", "../wiki/d.md"), ("md", "proj/")])


class BrokenLinksTest(Base):
    def test_resolved_links_are_not_broken(self):
        self.assertEqual(Vault(str(self.root)).broken_links(), set())

    def test_unresolved_wikilink_and_relative_link_are_broken(self):
        write(self.root, "wiki/c.md", "# C\n\n[[nowhere]] and [x](../docs/none.md)\n")
        self.assertEqual(Vault(str(self.root)).broken_links(),
                         {("wiki/c.md", "wiki", "nowhere"), ("wiki/c.md", "md", "../docs/none.md")})

    def test_disk_fallback_placeholders_and_templates(self):
        write(self.root, "raw/clip.md", "raw\n")
        write(self.root, "wiki/c.md", "# C\n\n[[clip]] [r](../raw/clip.md) [[raw/clip]] [[<slug>]] [t](docs/<f>.md)\n")
        write(self.root, "templates/note.md", "[[note-slug]]\n")
        self.assertEqual(Vault(str(self.root)).broken_links(), set())


class RootEscapeTest(unittest.TestCase):
    """A link that leaves the vault root is broken even when a file sits there on disk.

    Mirrors a worktree under .claude/worktrees/: the checkout above it has wiki/x.md, and the
    disk fallback must not see it. Wikilinks resolve from the root, Markdown links from the
    note's folder, so the two links below reach the same outside file. Without the root check
    both links pass here and fail on a clean tree (observed 2026-10-16 on a lint branch).
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        outer = pathlib.Path(self._tmp.name)
        self.root = outer / "vault"
        write(outer, "wiki/x.md", "# outside the vault\n")
        write(self.root, "wiki/INDEX.md", "- [[c]]\n")
        write(self.root, "wiki/b.md", "# B\n")
        write(self.root, "wiki/c.md", "# C\n\n[[../wiki/x]] and [x](../../wiki/x.md)\n")
        write(self.root, "projects/p/README.md", "[inside](../../wiki/b.md) [[wiki/b]] [c](../../wiki/c.md)\n")

    def tearDown(self):
        self._tmp.cleanup()

    def test_links_leaving_the_root_are_broken_even_if_the_file_exists_outside(self):
        # the hole the check closes: both targets really exist one level above the root
        self.assertTrue((self.root / ".." / "wiki" / "x.md").exists())
        broken = Vault(str(self.root)).broken_links()
        self.assertIn(("wiki/c.md", "wiki", "../wiki/x"), broken)
        self.assertIn(("wiki/c.md", "md", "../../wiki/x.md"), broken)

    def test_relative_links_inside_the_root_are_still_fine(self):
        broken = Vault(str(self.root)).broken_links()
        self.assertFalse(any(src == "projects/p/README.md" for src, _, _ in broken), broken)


if __name__ == "__main__":
    unittest.main()
