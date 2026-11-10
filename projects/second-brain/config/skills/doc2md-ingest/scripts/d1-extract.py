#!/usr/bin/env python3
# /// script
# dependencies = []
# ///
"""D1/D2: Word 문서(.docx/.doc) -> MD 추출 랩퍼 (doc2md-ingest).

usage: uv run d1-extract.py <file.docx|file.doc> <out.md> [--media-dir=DIR]
(외부 Python 의존이 없다 — pandoc과 플랫폼 사전변환 도구를 subprocess로 쓴다.
 python3로 직접 실행해도 동일하다.)

경로:
  D1  .docx -> pandoc                                   (구조 보존. 기본 경로)
  D2a .doc  -> LibreOffice(soffice) -> docx -> pandoc   (구조 보존. 전 플랫폼)
  D2c .doc  -> Word COM(PowerShell) -> docx -> pandoc   (구조 보존. Windows + Word 설치 시)
  D2b .doc  -> macOS textutil -> html -> pandoc         (내장. 헤딩·목록·표헤더·이미지 손실)

.doc 우선순위: D2a → D2c(Windows) / D2b(macOS) → 실패. Windows는 textutil이 없고,
macOS는 Word COM이 없다. Linux는 D2a뿐이다.

--media-dir=DIR 를 주면 임베디드 이미지를 DIR/media/ 아래에 추출하고, MD 안의 참조는
상대경로 `media/<file>` 로 다시 쓴다 (절대경로가 MD에 남으면 실패 처리).

stdout 마지막 줄에 판정용 통계를 출력한다:
  stats chars=<공백·태그 제외 문자수> tables=<표 수> images=<이미지 수> headings=<헤딩 수> path=<D1|D2a|D2b|D2c> title=<문서제목|->
D2b 경로에서는 stderr 에 구조·이미지 손실 경고를 함께 낸다.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"
IS_MACOS = sys.platform == "darwin"

# gfm-raw_html: 폭·높이 속성을 단 이미지가 raw <img> 로 떨어지는 것과, textutil html의
# <span class="Apple-tab-span"> 잔재가 본문에 섞이는 것을 한 번에 막는다 (2026-08-25 실측).
PANDOC_ARGS = ["-t", "gfm-raw_html", "-s", "--wrap=none"]
MEDIA_SUBDIR = "media"  # pandoc --extract-media=DIR 는 DIR/media/ 를 만든다


def need(tool: str) -> str:
    found = shutil.which(tool)
    if not found:
        sys.exit(f"required tool not found: {tool}")
    return found


TIMEOUT_SEC = 300  # Word COM 모달·LibreOffice 첫 실행 프롬프트에서 무기한 정지 방지
SUBPROCESS_IO = dict(capture_output=True, text=True, encoding="utf-8", errors="replace")


def run(cmd: list[str], *, fatal: bool = True) -> bool:
    """명령 실행. fatal=True면 실패 시 종료, False면 stderr 경고 후 False 반환."""
    try:
        proc = subprocess.run(cmd, timeout=TIMEOUT_SEC, **SUBPROCESS_IO)
    except subprocess.TimeoutExpired:
        msg = f"command timed out after {TIMEOUT_SEC}s: {' '.join(cmd[:2])}"
        if fatal:
            sys.exit(msg)
        print(f"warning: {msg}", file=sys.stderr)
        return False
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        msg = f"command failed: {' '.join(cmd[:2])} — {detail[0] if detail else 'no output'}"
        if fatal:
            sys.exit(msg)
        print(f"warning: {msg}", file=sys.stderr)
        return False
    return True


def pandoc_to_md(src: Path, fmt: str, out: Path, media_dir: Path | None) -> None:
    cmd = [need("pandoc"), "-f", fmt, *PANDOC_ARGS]
    if media_dir is not None:
        cmd.append(f"--extract-media={media_dir}")
    cmd += [str(src), "-o", str(out)]
    run(cmd)


def find_soffice() -> str | None:
    """PATH → Windows 표준 설치 경로 → macOS 앱 번들 순으로 LibreOffice를 찾는다.
    Windows 설치기는 PATH를 안 건드리므로 PATH만 보면 항상 못 찾는다."""
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    candidates: list[Path] = []
    if IS_WINDOWS:
        for env in ("ProgramFiles", "ProgramFiles(x86)"):
            base = os.environ.get(env)
            if base:
                candidates.append(Path(base) / "LibreOffice" / "program" / "soffice.exe")
    elif IS_MACOS:
        candidates.append(Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"))
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def doc_via_soffice(src: Path, work: Path) -> Path | None:
    """D2a: .doc -> .docx (LibreOffice headless). 없거나 실패하면 None (다음 폴백으로).
    -env:UserInstallation 으로 실행별 프로필을 준다 — GUI LibreOffice가 떠 있으면
    headless --convert-to 가 rc 0으로 아무것도 안 만드는 알려진 동작을 피한다."""
    soffice = find_soffice()
    if not soffice:
        return None
    profile = (work / "lo-profile").as_uri()
    ok = run(
        [soffice, f"-env:UserInstallation={profile}", "--headless",
         "--convert-to", "docx", "--outdir", str(work), str(src)],
        fatal=False,
    )
    produced = work / (src.stem + ".docx")
    if ok and produced.exists():
        return produced
    print("warning: D2a(LibreOffice) 변환이 산출물을 내지 않았다 — 다음 폴백으로", file=sys.stderr)
    return None


def doc_via_word_com(src: Path, work: Path) -> Path | None:
    """D2c: .doc -> .docx (Word COM 자동화, PowerShell). Windows + Word 설치 시에만.
    ReadOnly로 열어 SaveAs2(16 = wdFormatDocumentDefault → .docx)로 사본을 저장한다 — 원본 무수정."""
    if not IS_WINDOWS:
        return None
    powershell = shutil.which("powershell") or shutil.which("pwsh")
    if not powershell:
        return None
    produced = work / (src.stem + ".docx")

    def ps_quote(p: Path) -> str:
        return "'" + str(p.resolve()).replace("'", "''") + "'"

    script = work / "word2docx.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        # Write-Error 는 EAP=Stop 아래서 종료 예외라 exit 2 에 못 미친다 — Console 직접 출력
        "try { $word = New-Object -ComObject Word.Application } "
        "catch { [Console]::Error.WriteLine('Word COM unavailable (Word not installed?)'); exit 2 }\n"
        "$word.Visible = $false\n"
        "$word.DisplayAlerts = 0\n"
        "try {\n"
        f"  $doc = $word.Documents.Open({ps_quote(src)}, $false, $true)\n"
        f"  $doc.SaveAs2({ps_quote(produced)}, 16)\n"
        "  $doc.Close($false)\n"
        "} finally { $word.Quit() }\n",
        encoding="utf-8-sig",
    )
    try:
        proc = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
            timeout=TIMEOUT_SEC, **SUBPROCESS_IO,
        )
    except subprocess.TimeoutExpired:
        sys.exit(f"command timed out after {TIMEOUT_SEC}s: Word COM (대화상자가 떠 있는지 확인)")
    if proc.returncode == 2:
        return None  # Word 없음 — 다음 폴백으로
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        sys.exit(f"command failed: Word COM — {detail[0] if detail else 'no output'}")
    return produced if produced.exists() else None


def doc_via_textutil(src: Path, work: Path) -> Path | None:
    """.doc -> .html (macOS textutil). 없으면 None. 이미지는 이 단계에서 이미 유실된다."""
    textutil = shutil.which("textutil")
    if not textutil:
        return None
    produced = work / (src.stem + ".html")
    run([textutil, "-convert", "html", str(src), "-output", str(produced)])
    return produced if produced.exists() else None


def media_prefixes(media_dir: Path) -> list[str]:
    """pandoc이 MD에 박는 경로 접두 후보 — 구분자 변형을 문자열로 직접 만든다.
    Path.as_posix()는 PosixPath에서 백슬래시를 안 바꾸므로 플랫폼에 기대지 않는다."""
    s = str(media_dir)
    forms = {s, s.replace("\\", "/"), s.replace("/", "\\")}
    out: list[str] = []
    for f in forms:
        for sep in ("/", "\\"):
            out.append(f"{f}{sep}{MEDIA_SUBDIR}{sep}")
    return out


def relativize_media(md: str, media_dir: Path) -> str:
    """pandoc이 박은 `<media_dir>/media/...` 를 상대경로 `media/...` 로 바꾼다."""
    for prefix in media_prefixes(media_dir):
        md = md.replace(prefix, f"{MEDIA_SUBDIR}/")
    return md


ABS_TARGET = re.compile(r"!\[[^\]]*\]\(\s*<?([^)\s>]+)")
ABS_PATH = re.compile(r"^(?:[A-Za-z]:[\\/]|/|file:)")


def leaked_absolute(md: str, media_dir: Path | None) -> bool:
    """이미지 링크 대상이 절대경로면 True. media_dir 문자열 일치에 기대지 않는다 —
    치환과 검출이 같은 형태만 보면 형태가 어긋날 때 둘 다 조용히 실패한다."""
    if media_dir is not None and any(f in md for f in (str(media_dir), media_dir.as_posix())):
        return True
    return any(ABS_PATH.match(m.group(1)) for m in ABS_TARGET.finditer(md))


def extract_title(md: str) -> str:
    m = re.match(r"^---\n(.*?)\n---\n", md, re.S)
    if m:
        t = re.search(r"^title:\s*(.+)$", m.group(1), re.M)
        if t:
            return t.group(1).strip().strip("'\"") or "-"
    h = re.search(r"^#\s+(.+)$", md, re.M)
    return h.group(1).strip() if h else "-"


def count_tables(md: str) -> int:
    """GFM 표 구분선(|---|) 개수 = 표 개수."""
    return len(re.findall(r"^\|[\s:|-]+\|\s*$", md, re.M))


def count_images(md: str) -> int:
    """마크다운 이미지 + (방어적으로) raw <img> 둘 다 센다."""
    return len(re.findall(r"!\[[^\]]*\]\(", md)) + len(re.findall(r"<img\b", md))


def visible_chars(md: str) -> int:
    """공백과 HTML 태그를 뺀 문자수 — 경로 간 비교 가능한 값."""
    stripped = re.sub(r"<[^>]+>", "", md)
    return len("".join(stripped.split()))


def parse_args(argv: list[str]) -> tuple[Path, Path, Path | None]:
    positional: list[str] = []
    media_dir: Path | None = None
    for a in argv:
        if a.startswith("--"):
            if "=" not in a:
                sys.exit(f"flag needs a value: {a} (use --media-dir=DIR)")
            key, val = a.split("=", 1)
            if key != "--media-dir":
                sys.exit(f"unknown flag: {key}")
            media_dir = Path(val).expanduser().resolve()
        else:
            positional.append(a)
    if len(positional) != 2:
        sys.exit(__doc__)
    return Path(positional[0]).expanduser(), Path(positional[1]).expanduser(), media_dir


def main() -> None:
    src, out, media_dir = parse_args(sys.argv[1:])
    if not src.is_file():
        sys.exit(f"not a file: {src}")

    suffix = src.suffix.lower()
    warnings: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        if suffix == ".docx":
            path_used = "D1"
            pandoc_to_md(src, "docx", out, media_dir)
        elif suffix == ".doc":
            converted = doc_via_soffice(src, work)
            if converted is not None:
                path_used = "D2a"
                pandoc_to_md(converted, "docx", out, media_dir)
            elif (converted := doc_via_word_com(src, work)) is not None:
                path_used = "D2c"
                pandoc_to_md(converted, "docx", out, media_dir)
            else:
                html = doc_via_textutil(src, work)
                if html is None:
                    hint = (
                        "Windows: Word 설치(D2c) 또는 LibreOffice 설치(D2a)."
                        if IS_WINDOWS else
                        "LibreOffice(soffice) 설치 후 재시도."
                    )
                    sys.exit(f".doc는 pandoc이 직접 못 읽는다. {hint}")
                path_used = "D2b"
                pandoc_to_md(html, "html", out, media_dir)
                warnings.append(
                    "D2b: textutil 경로는 헤딩·목록·표 헤더 행과 임베디드 이미지를 잃는다. "
                    "구조나 이미지가 중요하면 LibreOffice 설치 후 D2a로 재변환할 것."
                )
        else:
            sys.exit(f"unsupported extension: {suffix} (.docx/.doc만 지원)")

    md = out.read_text(encoding="utf-8")
    if not md.strip():
        sys.exit("empty conversion result")

    if media_dir is not None:
        md = relativize_media(md, media_dir)
    if leaked_absolute(md, media_dir):
        out.unlink(missing_ok=True)  # 유출된 산출물을 남기지 않는다
        sys.exit("absolute path leaked into MD image links — 산출물 삭제됨")
    out.write_text(md, encoding="utf-8")

    chars = visible_chars(md)
    tables = count_tables(md)
    headings = len(re.findall(r"^#{1,6}\s+\S", md, re.M))
    images = count_images(md)
    title = extract_title(md)

    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    print(f"wrote {len(md)} chars -> {out}")
    print(
        f"stats chars={chars} tables={tables} images={images} "
        f"headings={headings} path={path_used} title={title}"
    )


if __name__ == "__main__":
    main()
