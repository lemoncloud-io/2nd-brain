#!/usr/bin/env python3
"""Tests for the public-template origin warning in setup-vault-mac.sh.

Run from the scripts directory:

    python3 -m unittest test_setup_vault_origin_guard -v

The installer warns when a vault's origin still points at the public bootstrap
template, because push and PR would then go to the public repo. The repo was renamed
to lemoncloud-io/doki and GitHub redirects the old URL (LEGACY_TEMPLATE_URL in the
script), so a checkout cloned before the rename must warn too. The test runs the script's own
definitions and warning block (cut out of the file, not copied) in bash.
"""

from __future__ import annotations

import pathlib
import re
import shutil
import subprocess
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent / "setup-vault-mac.sh"


def _legacy_slug() -> str:
    """org/repo of the old template name, read from the script's own constant."""
    text = SCRIPT.read_text(encoding="utf-8")
    m = re.search(r'^LEGACY_TEMPLATE_URL="https://github\.com/([^"]+?)\.git"', text, re.M)
    if m is None:
        raise AssertionError("LEGACY_TEMPLATE_URL not found in setup-vault-mac.sh")
    return m.group(1)


def _guard_snippet() -> str:
    text = SCRIPT.read_text(encoding="utf-8")
    keep = []
    for prefix in ("warn() ", "norm_url() ", "is_template_url() ", "TEMPLATE_URL=", "LEGACY_TEMPLATE_URL="):
        line = next(l for l in text.splitlines() if l.startswith(prefix))
        keep.append(line)
    block = re.search(r"^# 잔여 안전망:.*?^fi$", text, re.S | re.M)
    if block is None:
        raise AssertionError("safety-net block not found in setup-vault-mac.sh")
    body = block.group(0)
    # The origin comes from the test, not from a real checkout.
    body = re.sub(r'^CURRENT_ORIGIN=.*$', 'CURRENT_ORIGIN="$1"', body, flags=re.M)
    return "\n".join(keep + ['TARGET_DIR="/tmp/vault"', body])


@unittest.skipIf(shutil.which("bash") is None, "bash not available")
class OriginGuardTest(unittest.TestCase):
    def warns(self, origin: str) -> bool:
        out = subprocess.run(
            ["bash", "-c", _guard_snippet(), "guard", origin],
            capture_output=True, text=True, check=True,
        ).stdout
        return "공개 부트스트랩 템플릿" in out

    def test_current_template_warns(self) -> None:
        self.assertTrue(self.warns("https://github.com/lemoncloud-io/doki.git"))

    def test_old_name_warns_in_every_url_form(self) -> None:
        slug = _legacy_slug()
        self.assertEqual(slug, "lemoncloud-io/2nd-brain")  # 옛 이름 — 개명 전 clone 의 origin
        for origin in (
            f"https://github.com/{slug}.git",
            f"https://github.com/{slug}",
            f"git@github.com:{slug}.git",
        ):
            with self.subTest(origin=origin):
                self.assertTrue(self.warns(origin))

    def test_team_repo_is_quiet(self) -> None:
        self.assertFalse(self.warns("git@github.com:my-org/my-doki.git"))

    def test_no_origin_is_quiet(self) -> None:
        self.assertFalse(self.warns(""))



@unittest.skipIf(shutil.which("bash") is None, "bash not available")
class NonInteractiveTemplateGuardTest(unittest.TestCase):
    """--non-interactive refuses the public template before any install step.

    Only the guard block is cut out and run — never the whole installer, which would
    install tools and edit shell rc files on this machine if the guard regressed.
    """

    def refuses(self, repo: str) -> bool:
        text = SCRIPT.read_text(encoding="utf-8")
        keep = [next(l for l in text.splitlines() if l.startswith(p))
                for p in ("fail() ", "norm_url() ", "is_template_url() ", "TEMPLATE_URL=", "LEGACY_TEMPLATE_URL=")]
        block = re.search(r"^# 비대화형 입력은 설치를 시작하기 전에 검사한다.*?^fi$", text, re.S | re.M)
        if block is None:
            raise AssertionError("non-interactive guard block not found in setup-vault-mac.sh")
        snippet = "\n".join(keep + ['NON_INTERACTIVE=1', 'TARGET_DIR="/nonexistent/vault"', 'REPO_URL="$1"',
                                     block.group(0), 'echo passed'])
        proc = subprocess.run(["bash", "-c", snippet, "guard", repo], capture_output=True, text=True)
        refused = proc.returncode != 0 and "--non-interactive에는 --repo" in proc.stdout
        self.assertEqual(refused, "passed" not in proc.stdout)
        return refused

    def test_old_name_is_refused_in_every_url_form(self) -> None:
        old = "lemoncloud-io/2nd-brain"  # 옛 이름 — 리다이렉트로 공개 템플릿이 clone 된다
        for repo in (f"https://github.com/{old}.git", f"https://github.com/{old}", f"git@github.com:{old}.git"):
            with self.subTest(repo=repo):
                self.assertTrue(self.refuses(repo))

    def test_current_template_is_refused(self) -> None:
        self.assertTrue(self.refuses("https://github.com/lemoncloud-io/doki.git"))

    def test_team_repo_passes(self) -> None:
        self.assertFalse(self.refuses("git@github.com:my-org/my-doki.git"))

if __name__ == "__main__":
    unittest.main()
