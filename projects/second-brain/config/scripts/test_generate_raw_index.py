#!/usr/bin/env python3
# origin: lemoncloud-io/knowledge@2156ca2a:projects/second-brain/config/scripts/test_generate_raw_index.py
"""Tests for the conversion-original lanes in generate_raw_index.

Run from the scripts directory:

    python3 -m unittest test_generate_raw_index -v

The generator is driven end-to-end in a throwaway vault: it reads git and the
working tree, so exercising main() through a subprocess is the only honest way
to cover it. The lanes under test are raw/pdf|hwp|doc|xlsx (docs/raw-layout.md § 레인 4),
whose originals are paired to their converted MD by a source_<ext> frontmatter key.
"""

from __future__ import annotations

import pathlib
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


def commit_all(root: pathlib.Path) -> None:
    git = ["git", "-C", str(root)]
    subprocess.run(git + ["add", "-A"], check=True)
    subprocess.run(git + ["commit", "-qm", "add"], check=True)


def run(root: pathlib.Path) -> str:
    r = subprocess.run(["python3", str(SCRIPT)], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(f"generator failed: {r.stderr}")
    return r.stdout


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
            self.assertNotIn("raw/slack/dev.md", yml.split("orphan_slack:")[1])
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
            self.assertNotIn("paired.pdf", yml.split("orphan_originals:")[1])
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


if __name__ == "__main__":
    unittest.main()
