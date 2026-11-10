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

import contextlib
import io
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

import vault_orphans
from vault_orphans import Vault, apply_fixes, extract_targets, main, required, title_of


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

    def test_frozen_files_are_never_edited(self):
        # a frontmatter `frozen:` file fails vault_verify check 14 if a fix touches it
        write(self.root, "projects/p/sync-log.md", "---\nfrozen: 2026-10-29\n---\n# Log\n\nsee `docs/process.md`\n")
        write(self.root, "projects/p/README.md", "# P\n\n- [log](sync-log.md)\n")
        fixes, _ = self.vault().plan()
        self.assertTrue(fixes)
        self.assertTrue(all(f["file"] != "projects/p/sync-log.md" for f in fixes))

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


class FolderIndexTest(Base):
    """A README whose `## Document Map` carries `<!-- docmap: folder -->` reaches every Markdown
    document in its folder tree, stopping at a subfolder that has its own README (listed as one
    entry; its documents are that README's job). The list is regenerated by --apply, so a PR adding
    an output no longer edits a shared list by hand (parallel PRs conflicted on such a line, 2026-10-21).
    """

    MAP = ("# Outputs\n\n## Document Map\n\n<!-- docmap: folder -->\n> 이 폴더의 문서 전부.\n\n"
           "- [Old](2026-10-01-old.md) — kept by hand\n"
           "- [Gone](2026-09-01-gone.md)\n")

    def setUp(self):
        super().setUp()
        write(self.root, "projects/p/README.md", "# P\n\n- [outputs](outputs/README.md)\n")
        write(self.root, "projects/p/outputs/README.md", self.MAP)
        write(self.root, "projects/p/outputs/2026-10-01-old.md", "# Old report\n")
        write(self.root, "projects/p/outputs/2026-10-20-new.md", "---\ntitle: New report\n---\n# x\n")
        write(self.root, "projects/p/outputs/bare/leaf.md", "# Leaf\n")
        write(self.root, "projects/p/outputs/sub/README.md", "# Sub\n\n[deep](deep.md)\n")
        write(self.root, "projects/p/outputs/sub/deep.md", "# Deep\n")
        write(self.root, "projects/p/outputs/sub/stray.md", "# Stray\n")

    def test_folder_index_covers_its_tree_but_stops_at_a_subfolder_readme(self):
        orphans = self.orphans()
        for rel in ("README.md", "2026-10-01-old.md", "2026-10-20-new.md", "bare/leaf.md",
                    "sub/README.md", "sub/deep.md"):
            self.assertNotIn("projects/p/outputs/" + rel, orphans)
        self.assertIn("projects/p/outputs/sub/stray.md", orphans)  # sub/README.md does not link it

    def test_folder_index_counts_only_when_the_readme_itself_is_reachable(self):
        write(self.root, "projects/p/README.md", "# P\n")
        self.assertIn("projects/p/outputs/2026-10-20-new.md", self.orphans())

    def test_marker_outside_document_map_is_ignored(self):
        write(self.root, "projects/p/outputs/README.md", "# Outputs\n\n<!-- docmap: folder -->\n")
        self.assertIn("projects/p/outputs/2026-10-20-new.md", self.orphans())

    def test_folder_index_diff_lists_unlisted_and_gone_entries(self):
        v = self.vault()
        self.assertEqual(sorted(v.folder_indexes()), ["projects/p/outputs/README.md"])
        missing, gone = v.folder_index_diff("projects/p/outputs/README.md")
        self.assertEqual(missing, ["projects/p/outputs/2026-10-20-new.md", "projects/p/outputs/bare/leaf.md",
                                   "projects/p/outputs/sub/README.md"])
        self.assertEqual(gone, ["projects/p/outputs/2026-09-01-gone.md"])

    def test_apply_regenerates_the_list_in_path_order_keeping_hand_written_lines(self):
        v = self.vault()
        fixes, _ = v.plan()
        changed = apply_fixes(v, fixes)
        self.assertIn("projects/p/outputs/README.md", changed)
        text = (self.root / "projects/p/outputs/README.md").read_text(encoding="utf-8")
        self.assertEqual(text, "# Outputs\n\n## Document Map\n\n<!-- docmap: folder -->\n> 이 폴더의 문서 전부.\n\n"
                               "- [Old](2026-10-01-old.md) — kept by hand\n"
                               "- [New report](2026-10-20-new.md)\n"
                               "- [Leaf](bare/leaf.md)\n"
                               "- [Sub](sub/README.md)\n")
        v2 = self.vault()
        self.assertNotIn("projects/p/outputs/README.md", apply_fixes(v2, v2.plan()[0]))  # idempotent

    def test_text_after_the_list_and_the_next_section_survive(self):
        write(self.root, "projects/p/outputs/README.md",
              self.MAP + "\n후기 한 줄.\n\n## Next\n\n- keep me\n")
        v = self.vault()
        apply_fixes(v, v.plan()[0])
        text = (self.root / "projects/p/outputs/README.md").read_text(encoding="utf-8")
        self.assertIn("- [Sub](sub/README.md)\n\n후기 한 줄.\n\n## Next\n\n- keep me\n", text)
        self.assertNotIn("Gone", text)


STAMP = "example-org/example-vault@abc1234:docs/x.md"  # synthetic stamp value
STAMP_FORMS = {  # the three stamp forms, each put in front of a body
    "frontmatter": lambda body: f"---\norigin: {STAMP}\n---\n{body}",
    "hash comment": lambda body: f"# origin: {STAMP}\n{body}",
    "html comment": lambda body: f"<!-- origin: {STAMP} -->\n{body}",
}
P_README = "# P\n\nThe process is in `docs/process.md`.\n"


class ManagedCopyTest(Base):
    """A file carrying an origin stamp is a copy managed elsewhere: --apply never edits it,
    and the orphan it would have fixed is reached another way when one exists."""

    def run_main(self, *args):
        # main()'s stdout for this fixture vault
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            main(["--root", str(self.root), *args])
        return buf.getvalue()

    def test_stamp_forms_are_detected_only_at_the_top(self):
        for name, form in STAMP_FORMS.items():
            with self.subTest(form=name):
                self.assertTrue(vault_orphans.is_managed_copy(form("# Doc\n")))
        self.assertFalse(vault_orphans.is_managed_copy("# Doc\n"))
        self.assertFalse(vault_orphans.is_managed_copy("---\ntitle: x\n---\n# origin: " + STAMP + "\n"))  # body after frontmatter
        self.assertFalse(vault_orphans.is_managed_copy("# Doc\n" + "line\n" * 10 + "# origin: " + STAMP + "\n"))  # past line 10
        self.assertFalse(vault_orphans.is_managed_copy("# Doc\n```yaml\n# origin: " + STAMP + "\n```\n"))  # inside a code example
        self.assertFalse(vault_orphans.is_managed_copy("---\norigin: web clip\n---\n# Doc\n"))  # not a stamp value

    def test_mention_in_a_stamped_copy_is_never_linked(self):
        for name, form in STAMP_FORMS.items():
            with self.subTest(form=name):
                original = form(P_README)
                write(self.root, "projects/p/README.md", original)
                v = self.vault()
                fixes, _ = v.plan()
                self.assertTrue(all(f["file"] != "projects/p/README.md" for f in fixes))
                apply_fixes(v, fixes)
                self.assertEqual((self.root / "projects/p/README.md").read_text(encoding="utf-8"), original)
                self.assertNotIn("projects/p/docs/process.md", self.orphans())  # reached another way

    def test_next_unstamped_mention_is_used(self):
        write(self.root, "projects/p/README.md", STAMP_FORMS["frontmatter"](P_README + "\n[notes](notes.md)\n"))
        write(self.root, "projects/p/notes.md", "# Notes\n\nSee `docs/process.md`.\n")
        v = self.vault()
        fixes, _ = v.plan()
        via = {f["orphan"]: (f["via"], f["file"]) for f in fixes}
        self.assertEqual(via["projects/p/docs/process.md"], ("mention", "projects/p/notes.md"))
        self.assertIn({"orphan": "projects/p/docs/process.md", "via": "mention", "file": "projects/p/README.md"},
                      v.skipped_managed)

    def test_readme_fix_when_only_a_stamped_copy_mentions_the_orphan(self):
        write(self.root, "projects/p/README.md", P_README + "\n[ref](ref.md)\n")
        write(self.root, "projects/p/ref.md", STAMP_FORMS["hash comment"]("# Ref\n\nRead `docs/lonely.md`.\n"))
        v = self.vault()
        fixes, _ = v.plan()
        via = {f["orphan"]: (f["via"], f["file"]) for f in fixes}
        self.assertEqual(via["projects/p/docs/lonely.md"], ("readme", "projects/p/README.md"))
        apply_fixes(v, fixes)
        self.assertNotIn("](", (self.root / "projects/p/ref.md").read_text(encoding="utf-8"))

    def test_stamped_nearest_readme_falls_back_to_the_readme_above(self):
        original = STAMP_FORMS["html comment"](P_README)
        write(self.root, "projects/p/README.md", original)
        v = self.vault()
        fixes, _ = v.plan()
        changed = apply_fixes(v, fixes)
        self.assertEqual(changed, ["projects/README.md"])
        self.assertEqual((self.root / "projects/p/README.md").read_text(encoding="utf-8"), original)
        text = (self.root / "projects/README.md").read_text(encoding="utf-8")
        self.assertIn("- [Lonely doc](p/docs/lonely.md)", text)
        self.assertEqual(self.orphans(), ["wiki/c.md"])

    def test_skips_show_in_plan_apply_and_json(self):
        write(self.root, "projects/p/README.md", STAMP_FORMS["frontmatter"](P_README))
        plan_out = self.run_main("--plan")
        self.assertIn("출처 스탬프 사본 건너뜀", plan_out)
        self.assertIn("projects/p/docs/process.md", plan_out.split("출처 스탬프 사본 건너뜀", 1)[1])
        data = json.loads(self.run_main("--plan", "--json"))
        skipped = {(s["orphan"], s["via"], s["file"], s["resolved"]) for s in data["skipped_managed"]}
        self.assertIn(("projects/p/docs/process.md", "mention", "projects/p/README.md", True), skipped)
        self.assertIn(("projects/p/docs/lonely.md", "readme", "projects/p/README.md", True), skipped)
        self.assertIn("출처 스탬프 사본 건너뜀", self.run_main("--apply"))

    def test_orphan_left_when_every_way_is_a_stamped_copy(self):
        write(self.root, "projects/p/README.md", STAMP_FORMS["frontmatter"](P_README))
        write(self.root, "projects/README.md", STAMP_FORMS["frontmatter"]("| [p](p/) | active |\n"))
        data = json.loads(self.run_main("--plan", "--json"))
        hubs = {h["orphan"]: h for h in data["hubs"]}
        self.assertEqual(hubs["projects/p/docs/lonely.md"]["skipped_managed"],
                         ["projects/README.md", "projects/p/README.md"])
        self.assertTrue(any(s["orphan"] == "projects/p/docs/lonely.md" and not s["resolved"]
                            for s in data["skipped_managed"]))
        self.assertNotIn("skipped_managed", hubs["wiki/c.md"])  # no stamped copy was in its way

    def test_origin_example_in_the_body_is_not_a_stamp(self):
        write(self.root, "projects/p/README.md",
              P_README + "\n" + "text\n" * 10 + "```yaml\norigin: " + STAMP + "\n```\n")
        fixes, _ = self.vault().plan()
        via = {f["orphan"]: (f["via"], f["file"]) for f in fixes}
        self.assertEqual(via["projects/p/docs/process.md"], ("mention", "projects/p/README.md"))

    def test_stamped_orphan_is_still_made_reachable(self):
        write(self.root, "projects/p/docs/lonely.md", STAMP_FORMS["frontmatter"]("# Lonely\n"))
        fixes, _ = self.vault().plan()
        via = {f["orphan"]: (f["via"], f["file"]) for f in fixes}
        self.assertEqual(via["projects/p/docs/lonely.md"], ("readme", "projects/p/README.md"))

    def test_stamped_folder_index_is_not_regenerated(self):
        write(self.root, "projects/p/README.md", "# P\n\n- [outputs](outputs/README.md)\n")
        original = STAMP_FORMS["frontmatter"]("# Outputs\n\n## Document Map\n\n<!-- docmap: folder -->\n\n- [Gone](gone.md)\n")
        write(self.root, "projects/p/outputs/README.md", original)
        write(self.root, "projects/p/outputs/new.md", "# New\n")
        v = self.vault()
        self.assertNotIn("projects/p/outputs/new.md", v.unreachable(v.reachable()))  # still counts for reach
        self.assertNotIn("projects/p/outputs/README.md", apply_fixes(v, v.plan()[0]))
        self.assertEqual((self.root / "projects/p/outputs/README.md").read_text(encoding="utf-8"), original)
        self.assertIn({"orphan": None, "via": "folder", "file": "projects/p/outputs/README.md"}, v.skipped_managed)

    def test_broken_links_count_stamped_copies(self):
        write(self.root, "wiki/c.md", STAMP_FORMS["frontmatter"]("# C\n\n[[nowhere]]\n"))
        self.assertEqual(self.vault().broken_links(), {("wiki/c.md", "wiki", "nowhere")})


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

    def test_attachment_embeds_resolve_by_name_or_path(self):
        # Obsidian resolves `![[x.png]]` by file name anywhere in the vault, and a path form from the root
        write(self.root, "projects/p/outputs/assets/shot.png", "png")
        write(self.root, "wiki/c.md", "# C\n\n![[shot.png|560]] ![[projects/p/outputs/assets/shot.png]]\n")
        self.assertEqual(Vault(str(self.root)).broken_links(), set())

    def test_missing_attachment_is_broken(self):
        write(self.root, "wiki/c.md", "# C\n\n![[gone.png]] ![[projects/p/gone.png]]\n")
        self.assertEqual(Vault(str(self.root)).broken_links(),
                         {("wiki/c.md", "wiki", "gone.png"), ("wiki/c.md", "wiki", "projects/p/gone.png")})


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
