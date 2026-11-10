#!/usr/bin/env python3
"""Tests for generate_raw_index (raw index schema 2: nodes + edges).

Run from the scripts directory:

    python3 -m unittest test_generate_raw_index -v

The generator is driven end-to-end in a throwaway vault: it reads git and the
working tree, so exercising main() through a subprocess is the only honest way
to cover it. Covered: the snapshot/slack/conversion lanes (docs/raw-layout.md § 레인),
the node key and edge kinds of schema 2, the corpus boundary, and the split
between the shared index and private/raw-index.yml.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent / "generate_raw_index.py"


def make_vault(tmp: str) -> pathlib.Path:
    """Minimal tracked vault: VAULT_RULES.md + raw/, one committed raw note."""
    root = pathlib.Path(tmp)
    (root / "raw").mkdir()
    (root / "VAULT_RULES.md").write_text("# rules\n", encoding="utf-8")
    (root / "wiki").mkdir()
    (root / "docs").mkdir()
    git = ["git", "-C", str(root)]
    subprocess.run(git + ["init", "-q"], check=True)
    subprocess.run(git + ["config", "user.email", "t@example.com"], check=True)
    subprocess.run(git + ["config", "user.name", "t"], check=True)
    return root


def write_settings(root: pathlib.Path, text: str) -> None:
    settings = root / "projects" / "second-brain" / "config"
    settings.mkdir(parents=True, exist_ok=True)
    (settings / "team-settings.yaml").write_text(text, encoding="utf-8")


def commit_all(root: pathlib.Path) -> None:
    git = ["git", "-C", str(root)]
    subprocess.run(git + ["add", "-A"], check=True)
    subprocess.run(git + ["commit", "-qm", "add"], check=True)


def key(path: str) -> str:
    return hashlib.sha1(path.encode("utf-8")).hexdigest()[:12]


def parse_graph(yml: str) -> tuple:
    """(nodes, edges) from a schema-2 index without PyYAML.

    nodes: key → {field: value}; edges: set of (from file, to file, kind).
    Node lines are `  "key": {file: "…", kind: "…"}` with JSON values; edge lines
    are `- [JSON array]` at column 0.
    """
    nodes, raw_edges, section = {}, [], None
    for line in yml.splitlines():
        if section == "edges" and line.startswith("- ["):
            raw_edges.append(json.loads(line[2:]))
            continue
        if not line.startswith(" "):
            section = line.split(":", 1)[0]
            continue
        if section == "nodes":
            k, body = line.strip().split(": ", 1)
            nodes[json.loads(k)] = {f: json.loads(v) for f, v in
                                    re.findall(r'(\w+): ("(?:[^"\\]|\\.)*")', body)}
    edges = {(nodes[f]["file"], nodes[t]["file"], kind) for f, t, kind in raw_edges}
    return nodes, edges


def run(root: pathlib.Path) -> str:
    r = subprocess.run(["python3", str(SCRIPT)], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(f"generator failed: {r.stderr}")
    return r.stdout


def commit_at(root: pathlib.Path, date: str, *args: str) -> None:
    """Stage `args` (a git subcommand, e.g. "mv a b", or nothing for add -A) and commit with author date `date`."""
    git = ["git", "-C", str(root)]
    subprocess.run(git + (list(args) or ["add", "-A"]), check=True)
    env = {**__import__("os").environ, "GIT_AUTHOR_DATE": f"{date}T12:00:00", "GIT_COMMITTER_DATE": f"{date}T12:00:00"}
    subprocess.run(git + ["commit", "-qm", "c"], check=True, env=env)


class AddedDate(unittest.TestCase):
    """`added` is when the source entered raw/. A rename inside raw/ keeps it; a move in from Clippings/ sets it."""

    def test_rename_inside_raw_keeps_first_add_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "A title..md").write_text("---\ntitle: A\n---\nbody\n", encoding="utf-8")
            (root / "Clippings").mkdir()
            (root / "Clippings" / "b.md").write_text("---\ntitle: B\n---\nbody\n", encoding="utf-8")
            commit_at(root, "2026-07-09")
            commit_at(root, "2026-08-01", "mv", "Clippings/b.md", "raw/b.md")
            commit_at(root, "2026-10-25", "mv", "raw/A title..md", "raw/A title.md")
            run(root)
            nodes, _ = parse_graph((root / "docs" / "raw-index.yml").read_text(encoding="utf-8"))
            added = {n["file"]: n.get("added") for n in nodes.values()}
            self.assertEqual(added["raw/A title.md"], "2026-07-09")
            self.assertEqual(added["raw/b.md"], "2026-08-01")


class SnapshotLane(unittest.TestCase):
    """docs/raw-layout.md § 레인 2 — raw/<project>/<doc-slug>-<short-commit>.md
    (team-settings.yaml `raw.snapshot_lanes`에 오른 프로젝트만).

    루트 repo-doc 스냅샷과 같은 노트라 같은 항목 목록에 실린다(유입일·source·역링크·
    오펀·URL 중복). 다른 점은 루트 파일 수에서 빠진다는 것 하나 — 이 레인은 루트가
    재구조화 임계(200)를 넘어서 생겼다(2026-10-01).
    """

    def test_snapshot_lane_is_indexed_but_not_counted_as_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            write_settings(root, 'raw:\n  snapshot_lanes: ["sample-app"]  # lane\n')
            (root / "raw" / "sample-app").mkdir()
            (root / "raw" / "root-note.md").write_text(
                '---\nsource: "https://example.com/a"\n---\n\nbody\n', encoding="utf-8"
            )
            (root / "raw" / "sample-app" / "adr-a-1234567.md").write_text(
                '---\nsource: "example-org/sample-app — docs/adr/a.md"\n---\n\nbody\n',
                encoding="utf-8",
            )
            (root / "raw" / "sample-app" / "adr-b-89abcde.md").write_text(
                '---\nsource: "example-org/sample-app — docs/adr/b.md"\n---\n\nbody\n',
                encoding="utf-8",
            )
            (root / "wiki" / "n.md").write_text(
                '---\nsources:\n  - "raw/root-note.md"\n  - "raw/sample-app/adr-a-1234567.md"\n---\n',
                encoding="utf-8",
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")
            self.assertIn("root_files: 1", yml)
            self.assertIn("snapshot_files:\n  sample-app: 2", yml)
            nodes, edges = parse_graph(yml)
            lane_node = nodes[key("raw/sample-app/adr-a-1234567.md")]
            self.assertEqual(lane_node["kind"], "raw")
            self.assertEqual(lane_node["source"], "example-org/sample-app — docs/adr/a.md")
            self.assertIn(("wiki/n.md", "raw/sample-app/adr-a-1234567.md", "ref"), edges)
            self.assertNotIn("unknown", yml)  # first-add date found for lane files
            orphans = yml.split("orphans:")[1].split("duplicate_sources:")[0]
            self.assertIn("raw/sample-app/adr-b-89abcde.md", orphans)
            self.assertNotIn("adr-a-1234567", orphans)
            self.assertIn("루트 파일 1", md)
            self.assertIn("sample-app 레인 2", md)
            self.assertIn("raw/sample-app/adr-b-89abcde.md", md)

    def test_no_snapshot_directory_emits_no_snapshot_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "root-note.md").write_text("---\n---\n\nbody\n", encoding="utf-8")
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")
            self.assertNotIn("snapshot_files", yml)
            self.assertNotIn("sample-app 레인", md)

    def test_same_key_under_another_parent_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            write_settings(root, 'deploy:\n  snapshot_lanes: ["sample-app"]\nraw:\n  other: 1\n')
            (root / "raw" / "sample-app").mkdir()
            (root / "raw" / "sample-app" / "adr-a-1234567.md").write_text(
                '---\nsource: "example-org/sample-app — docs/adr/a.md"\n---\n\nbody\n',
                encoding="utf-8",
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            self.assertNotIn("snapshot_files", yml)
            self.assertNotIn("sample-app", yml)

    def test_duplicate_setting_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            write_settings(root, 'raw:\n  snapshot_lanes: ["a-app"]\n  snapshot_lanes: ["b-app"]\n')
            r = subprocess.run(["python3", str(SCRIPT)], cwd=root, capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("defined 2 times", r.stderr)

    def test_unreadable_setting_fails_instead_of_dropping_the_lane(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            write_settings(root, "raw:\n  snapshot_lanes:\n    - sample-app\n")
            r = subprocess.run(["python3", str(SCRIPT)], cwd=root, capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("snapshot_lanes", r.stderr)


class SlackLane(unittest.TestCase):
    """docs/raw-layout.md § 레인 5 — raw/slack/<channel>.md.

    루트 파일과 같은 Markdown 보존본이라 참조 0건이면 오펀이다. 색인이 이 레인을
    세지 않으면 raw/ 전체 규모가 과소 보고되고 오펀 탐지에서 통째로 빠진다.
    """

    def test_slack_lane_counted_and_orphan_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "slack").mkdir()
            (root / "raw" / "slack" / "dev.md").write_text(
                '---\nsource: "workspace #dev"\n---\n\nbody\n', encoding="utf-8"
            )
            (root / "raw" / "slack" / "lonely.md").write_text(
                '---\nsource: "workspace #lonely"\n---\n\nbody\n', encoding="utf-8"
            )
            (root / "wiki" / "note.md").write_text(
                '---\nsources:\n  - "raw/slack/dev.md"\n---\n\nbody\n', encoding="utf-8"
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")

            self.assertIn("slack_files: 2", yml)
            self.assertIn('- "raw/slack/lonely.md"', yml)
            self.assertNotIn("raw/slack/dev.md", yml.split("orphan_slack:")[1].split("by_month:")[0])
            self.assertIn("slack 레인 2", md)
            self.assertIn("raw/slack/lonely.md", md)

    def test_no_slack_directory_emits_no_slack_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "note.md").write_text(
                '---\nsource: "https://example.com/a"\n---\n\nbody\n', encoding="utf-8"
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")
            self.assertNotIn("slack_files", yml)
            self.assertNotIn("orphan_slack", yml)
            self.assertNotIn("slack 레인", md)


class ConversionLanes(unittest.TestCase):
    def test_lane_counts_and_unpaired_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "pdf").mkdir()
            (root / "raw" / "pdf" / "paired.pdf").write_bytes(b"%PDF-1.4\n")
            (root / "raw" / "pdf" / "lonely.pdf").write_bytes(b"%PDF-1.4\n")
            (root / "raw" / "paired.md").write_text(
                '---\nsource: "file"\nsource_pdf: "raw/pdf/paired.pdf"\n---\n\nbody\n',
                encoding="utf-8",
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")

            self.assertIn("conversion_originals:", yml)
            self.assertIn("  pdf: 2", yml)
            self.assertIn('- "raw/pdf/lonely.pdf"', yml)
            self.assertNotIn("paired.pdf", yml.split("orphan_originals:")[1].split("by_month:")[0])
            self.assertIn("변환 원본", md)
            self.assertIn("raw/pdf/lonely.pdf", md)

    def test_claim_pending_in_clippings_is_not_reported_orphaned(self):
        """A preserved original tracked ahead of its note is not an orphan.

        A conversion skill writes the converted note to Clippings/ and it stays
        there until ingest moves it to raw/. The claim must count from either
        place, or the pre-ingest window reports a false orphan.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "pdf").mkdir()
            (root / "raw" / "pdf" / "pending.pdf").write_bytes(b"%PDF-1.4\n")
            (root / "Clippings").mkdir()
            (root / "Clippings" / "pending.md").write_text(
                '---\nsource: "file"\nsource_pdf: "raw/pdf/pending.pdf"\n---\n\nbody\n',
                encoding="utf-8",
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")

            self.assertIn("  pdf: 1", yml)
            self.assertIn("orphan_originals: []", yml)

    def test_doc_media_subdir_is_not_counted_as_an_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "doc" / "media" / "sample").mkdir(parents=True)
            (root / "raw" / "doc" / "sample.docx").write_bytes(b"PK\x03\x04")
            (root / "raw" / "doc" / "media" / "sample" / "img1.png").write_bytes(b"\x89PNG")
            (root / "raw" / "sample.md").write_text(
                '---\nsource_doc: "raw/doc/sample.docx"\n---\n\nbody\n', encoding="utf-8"
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            self.assertIn("  doc: 1", yml)
            self.assertIn("orphan_originals: []", yml)

    def test_no_lane_directories_emits_no_lane_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "note.md").write_text(
                '---\nsource: "https://example.com/a"\n---\n\nbody\n', encoding="utf-8"
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")
            self.assertNotIn("conversion_originals", yml)
            self.assertNotIn("orphan_originals", yml)
            self.assertNotIn("변환 원본", md)


class XlsxLane(unittest.TestCase):
    """docs/raw-layout.md § 레인 4 — raw/xlsx/.

    전용 변환 스킬 없이 생긴 레인이라 생성기의 레인 목록에서 빠져 있었다 (2026-09-15).
    레인의 본질은 보존된 바이너리 원본이고 그것을 만든 것이 스킬이든 수동 잉게스트든
    색인 대상이라는 사실은 달라지지 않는다 — 다른 셋과 똑같이 개수·짝 판정·오펀 탐지에
    잡혀야 한다.
    """

    def test_paired_xlsx_original_is_counted_and_not_orphaned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "xlsx").mkdir()
            (root / "raw" / "xlsx" / "paired.xlsx").write_bytes(b"PK\x03\x04")
            (root / "raw" / "paired.md").write_text(
                '---\nsource: "file"\nsource_xlsx: "raw/xlsx/paired.xlsx"\n---\n\nbody\n',
                encoding="utf-8",
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")

            self.assertIn("conversion_originals:", yml)
            self.assertIn("  xlsx: 1", yml)
            self.assertIn("orphan_originals: []", yml)
            self.assertIn("변환 원본", md)
            self.assertIn("xlsx 1", md)

    def test_unpaired_xlsx_original_is_reported(self):
        """짝 판정의 근거는 source_xlsx 키뿐이다.

        자유 서술형 `source:` 문자열이 원본 경로를 그대로 담고 있어도 짝으로 세지
        않는다 — 다른 레인과 같은 규칙이고, 문서 언급을 짝으로 세면 오탐이 난다.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "xlsx").mkdir()
            (root / "raw" / "xlsx" / "lonely.xlsx").write_bytes(b"PK\x03\x04")
            (root / "raw" / "mentions.md").write_text(
                '---\nsource: "raw/xlsx/lonely.xlsx"\n---\n\nbody\n', encoding="utf-8"
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")

            self.assertIn("  xlsx: 1", yml)
            self.assertIn('- "raw/xlsx/lonely.xlsx"', yml)
            self.assertIn("raw/xlsx/lonely.xlsx", md.split("변환 원본 짝 없음")[1])

    def test_no_xlsx_directory_emits_no_lane_section(self):
        """레인 디렉터리가 없는 vault에서는 xlsx도 0으로 채워져 나오지 않는다."""
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "note.md").write_text(
                '---\nsource: "https://example.com/a"\n---\n\nbody\n', encoding="utf-8"
            )
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            md = (root / "docs" / "raw-index.md").read_text(encoding="utf-8")
            self.assertNotIn("conversion_originals", yml)
            self.assertNotIn("xlsx", yml)
            self.assertNotIn("변환 원본", md)
            self.assertNotIn("xlsx", md)


class GraphSchema(unittest.TestCase):
    """계약 docs/raw-layout.md § 색인 — docs/raw-index.yml 스키마 2: 노드 키·엣지 종류·같은 줄 규칙."""

    def test_header_and_node_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "a.md").write_text(
                '---\nsource: "https://example.com/a"\n---\n\nbody\n', encoding="utf-8"
            )
            (root / "wiki" / "x.md").write_text('---\nsources:\n  - "raw/a.md"\n---\n', encoding="utf-8")
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            self.assertIn("\nschema: 2\n", yml)
            # 머리 주석은 배포되는 계약 문서만 가리킨다(설계 문서는 일부 볼트에만 있다).
            self.assertIn("\n# 계약·형식: docs/raw-layout.md § 색인", yml)
            self.assertNotIn("superpowers", yml)
            self.assertNotIn("entries", yml)
            k = hashlib.sha1("raw/a.md".encode("utf-8")).hexdigest()[:12]
            self.assertRegex(
                yml, rf'\n  "{k}": {{file: "raw/a.md", kind: "raw", '
                     r'added: "\d{4}-\d{2}-\d{2}", source: "https://example.com/a"}\n')
            self.assertIn(f'  "{key("wiki/x.md")}": {{file: "wiki/x.md", kind: "doc"}}\n', yml)
            self.assertIn(f'\n- ["{key("wiki/x.md")}","{k}","ref"]\n', yml)

    def test_edge_kinds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            for name in ("a.md", "b.md", "c d.md", "e.md", "f.md"):
                (root / "raw" / name).write_text("---\n---\n\nbody\n", encoding="utf-8")
            (root / "raw" / "pdf").mkdir()
            (root / "raw" / "pdf" / "o.pdf").write_bytes(b"%PDF-1.4\n")
            (root / "wiki" / "x.md").write_text(
                '---\nsources:\n  - "raw/a.md"\nsource_pdf: "raw/pdf/o.pdf"\n---\n\n'
                "B is [[raw/b|bee]] and in a table [[raw/b.md\\|bee]].\n\n"
                "C is [c](../raw/c%20d.md#top).\n\n"
                "E is ![[raw/e.md]] and F is ![f](<../raw/f.md>).\n\n"
                "A bare name [[a]] is not a raw link.\n",
                encoding="utf-8",
            )
            commit_all(root)
            run(root)
            _, edges = parse_graph((root / "docs" / "raw-index.yml").read_text(encoding="utf-8"))
            self.assertEqual(edges, {
                ("wiki/x.md", "raw/a.md", "ref"),
                ("wiki/x.md", "raw/b.md", "wiki"),
                ("wiki/x.md", "raw/c d.md", "md"),
                ("wiki/x.md", "raw/e.md", "embed"),
                ("wiki/x.md", "raw/f.md", "embed"),
                ("wiki/x.md", "raw/pdf/o.pdf", "source"),
            })

    def test_same_line_link_suppresses_ref(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "a.md").write_text("---\n---\n\nbody\n", encoding="utf-8")
            (root / "wiki" / "link-only.md").write_text(
                "See [raw/a.md](../raw/a.md).\n", encoding="utf-8"
            )
            (root / "wiki" / "both.md").write_text(
                "See [it](../raw/a.md).\n\nAlso raw/a.md in prose.\n", encoding="utf-8"
            )
            commit_all(root)
            run(root)
            _, edges = parse_graph((root / "docs" / "raw-index.yml").read_text(encoding="utf-8"))
            self.assertEqual(edges, {
                ("wiki/link-only.md", "raw/a.md", "md"),
                ("wiki/both.md", "raw/a.md", "md"),
                ("wiki/both.md", "raw/a.md", "ref"),
            })

    def test_link_only_reference_is_not_an_orphan(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / "raw" / "linked note.md").write_text("---\n---\n\nbody\n", encoding="utf-8")
            (root / "raw" / "lonely.md").write_text("---\n---\n\nbody\n", encoding="utf-8")
            (root / "wiki" / "x.md").write_text("[n](../raw/linked%20note.md)\n", encoding="utf-8")
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            orphans = yml.split("orphans:")[1].split("duplicate_sources:")[0]
            self.assertIn('"raw/lonely.md"', orphans)
            self.assertNotIn("linked note", orphans)

    def test_ignored_and_excluded_md_are_not_in_the_corpus(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / ".gitignore").write_text("node_modules/\nprojects/app/ignored.md\n", encoding="utf-8")
            (root / "raw" / "a.md").write_text("---\n---\n\nbody\n", encoding="utf-8")
            mention = 'see "raw/a.md"\n'
            pkg = root / "projects" / "app" / "node_modules" / "pkg"
            pkg.mkdir(parents=True)
            (pkg / "README.md").write_text(mention, encoding="utf-8")
            (root / "projects" / "app" / "ignored.md").write_text(mention, encoding="utf-8")
            (root / "projects" / "app" / "dist").mkdir()
            (root / "projects" / "app" / "dist" / "out.md").write_text(mention, encoding="utf-8")
            commit_all(root)
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            nodes, edges = parse_graph(yml)
            self.assertEqual(edges, set())
            self.assertEqual([n["file"] for n in nodes.values()], ["raw/a.md"])
            self.assertIn('"raw/a.md"', yml.split("orphans:")[1].split("duplicate_sources:")[0])

    def test_untracked_raw_goes_to_private_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_vault(tmp)
            (root / ".gitignore").write_text("private/\n", encoding="utf-8")
            (root / "raw" / "pdf").mkdir()
            (root / "raw" / "pdf" / "o.pdf").write_bytes(b"%PDF-1.4\n")
            (root / "raw" / "shared.md").write_text("---\n---\n\nbody\n", encoding="utf-8")
            (root / "wiki" / "x.md").write_text(
                "raw/shared.md and [p](../raw/personal.md)\n", encoding="utf-8"
            )
            commit_all(root)
            (root / "raw" / "personal.md").write_text(
                '---\nsource: "local"\nsource_pdf: "raw/pdf/o.pdf"\n---\n\nbody\n', encoding="utf-8"
            )
            run(root)
            yml = (root / "docs" / "raw-index.yml").read_text(encoding="utf-8")
            private = (root / "private" / "raw-index.yml").read_text(encoding="utf-8")
            self.assertNotIn("personal", yml)
            self.assertNotIn(key("raw/personal.md"), yml)
            self.assertIn("orphan_originals: []", yml)  # 미추적 노트의 짝도 센다
            _, shared_edges = parse_graph(yml)
            self.assertEqual(shared_edges, {("wiki/x.md", "raw/shared.md", "ref")})
            self.assertIn("schema: 2", private)
            self.assertIn("untracked_files: 1", private)
            nodes, edges = parse_graph(private)
            self.assertEqual(nodes[key("raw/personal.md")]["added"], "untracked")
            self.assertEqual(edges, {
                ("wiki/x.md", "raw/personal.md", "md"),
                ("raw/personal.md", "raw/pdf/o.pdf", "source"),
            })

            (root / "raw" / "personal.md").unlink()
            run(root)
            self.assertFalse((root / "private" / "raw-index.yml").exists())

    def test_key_collision_fails(self):
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            import generate_raw_index as g
        finally:
            sys.path.pop(0)
        original = g.node_key
        g.node_key = lambda path: "000000000000"
        try:
            with self.assertRaises(SystemExit) as cm:
                g.emit_graph([("raw/a.md", "raw", []), ("raw/b.md", "raw", [])], set())
            self.assertIn("collision", str(cm.exception.code))
        finally:
            g.node_key = original


if __name__ == "__main__":
    unittest.main()
