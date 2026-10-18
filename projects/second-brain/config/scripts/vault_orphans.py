#!/usr/bin/env python3
"""Find vault documents that cannot be reached from wiki/INDEX.md, and the link that would fix each.

A document is an orphan when no chain of links leads to it from wiki/INDEX.md, the vault's
top page (user definition, 2026-10-15). Every link counts — wikilinks, embeds, relative
Markdown links, and folder links (`[x](dir/)` opens dir/README.md on GitHub).

Must be reachable: every Markdown document under the vault root except
  - tooling and scaffolding: anything under a `config/` directory inside projects/
    (skills, tool READMEs, fixtures) and templates/
  - root-level entry files (CLAUDE.md, AGENTS.md, README.md, VAULT_RULES.md, …)
  - Clippings/ — the ingest inbox; a clipping becomes a vault document only after ingest
    moves it to raw/ (until then nothing is expected to link it)
  - personal projects: a document whose own folder or an ancestor folder has a README.md with
    `scope: personal` in its frontmatter (docs/github-linked-projects.md). Once personal material
    is promoted into an idea, a goal project or a wiki note, that promoted document is an
    ordinary vault document and must be reachable (user decision 2026-10-15)
  - paths given with --skip
Local-only documents — gitignored, so they never reach teammates (a personal owner folder kept
out of the shared repo, scratch folders) — are not vault documents: they are neither checked
nor followed, since a shared document reachable only through them is cut off for everyone else.
Never scanned: node_modules, .git, .claude (its worktrees are whole vault copies), .obsidian,
private, raw, archive, build outputs. raw/ and archive/ are not read, per the lint contract.
Symlinked directories are not followed.

Fix plan, simulated round by round until nothing changes (each fix can open up more):
  mention  a reachable living document already names the orphan's path in inline code —
           wrap that code span in a link (`docs/a.md` → [`docs/a.md`](docs/a.md))
  readme   the nearest ancestor README.md is reachable — list the orphan under that README's
           `## Document Map` section (created at the end of the README if absent)
  hub      neither applies — a hub page must be linked by hand (reported, never applied)
Never edited by a fix: dated records (outputs/runs/, outputs/monthly/, areas/weekly/, files
named YYYY-MM-DD-*) — a plain mention inside a record stays as written —, frozen or generated
files (the ingest ledger, the raw index summary, VAULT_MEMORY), and tooling
(config/ trees, templates/), whose text agents and scripts read as is.

Broken links (--broken): a link in a scanned document that resolves to no document — not to a
scanned one, not to a file on disk (raw/, archive/ and non-Markdown paths are looked up by
name, never read). Placeholders (`[[<slug>]]`, `docs/<file>.md`) and templates/ are not links.
A path that leaves the vault root (`../` past the top) is broken whatever is on disk there — run
from a worktree, the checkout above it never shows through (Obsidian resolves no relative wikilink).
`vault_verify.py` fails a change set that adds one (check 12, 2026-10-16); the ones already on
the base are a lint item, listed here for the cleanup.

Usage:
  python3 vault_orphans.py [--root DIR] [--skip PREFIX ...] [--plan | --apply | --broken] [--json]
Exit status is 0 whatever is found; --apply prints every file it changed.
"""
import argparse
import collections
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote

ROOT_NOTE = "wiki/INDEX.md"
EXCLUDED_DIRS = {"node_modules", ".git", ".claude", ".obsidian", ".trash", ".locks",
                 "__pycache__", ".venv", "venv", "dist", "build", ".next", ".cache"}
EXCLUDED_TOP = {"private", "raw", "archive"}
MAP_HEADING = "## Document Map"
MAP_INTRO = ("> `vault_orphans.py --apply`가 채운 목록이다 — `wiki/INDEX.md`에서 이 아래 문서로 가는 연결. "
             "손으로 다듬어도 된다.")

FENCE = re.compile(r"^(```|~~~).*?^\1[ \t]*$", re.S | re.M)
INLINE_CODE = re.compile(r"`([^`\n]+)`")
WIKILINK = re.compile(r"!?\[\[([^\]]+?)\]\]")
MDLINK = re.compile(r"\]\((?!https?:|mailto:|#)<?([^)\s>]+?)>?(?:#[^)]*)?\)")
DATED = re.compile(r"(^|/)\d{4}-\d{2}-\d{2}[^/]*\.md$")
PLACEHOLDER = re.compile(r"[<>]|\{\{")  # `[[<slug>]]`, `[x](docs/<file>.md)`, `{{company}}` — an example or a template slot, not a link
RECORD_PREFIXES = ("outputs/runs/", "outputs/monthly/", "areas/weekly/")


def iter_markdown(root):
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        top = rel_dir.split(os.sep)[0] if rel_dir != "." else ""
        if top in EXCLUDED_TOP:
            dirnames[:] = []
            continue
        dirnames[:] = sorted(d for d in dirnames
                             if d not in EXCLUDED_DIRS
                             and not (rel_dir == "." and d in EXCLUDED_TOP)
                             and not os.path.islink(os.path.join(dirpath, d)))
        for name in sorted(filenames):
            if name.endswith(".md"):
                yield os.path.normpath(os.path.join(rel_dir, name)).replace(os.sep, "/")


def required(path, skip=(), personal_dirs=()):
    if "/" not in path or path.startswith(("templates/", "Clippings/")) or path.startswith(tuple(skip)):
        return False
    if any(path.startswith(d + "/") for d in personal_dirs):
        return False
    return not (path.startswith("projects/") and "/config/" in path)


SCOPE_PERSONAL = re.compile(r"^scope:\s*[\"']?personal[\"']?\s*$", re.M)


def frontmatter(text):
    if not text.startswith("---"):
        return ""
    end = text.find("\n---", 3)
    return text[3:end] if end != -1 else ""


def git_ignored(root, paths):
    """Subset of `paths` that git ignores in `root` (empty when root is not a git work tree)."""
    try:
        proc = subprocess.run(["git", "-C", root, "check-ignore", "--stdin", "-z"],
                              input="\0".join(paths).encode("utf-8"), capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return set()
    if proc.returncode not in (0, 1):
        return set()
    return {p for p in proc.stdout.decode("utf-8").split("\0") if p}


def is_record(path):
    return path.startswith(RECORD_PREFIXES) or bool(DATED.search(path))


FROZEN = {"docs/vault-ingest-log.md",  # frozen ledger (2026-08-14)
          "docs/raw-index.md",         # generated by generate_raw_index.py, lint lane only
          "wiki/VAULT_MEMORY.md"}      # loaded every session, 8 KB cap


RULE_FILES = {"CLAUDE.md", "AGENTS.md", "VAULT_RULES.md"}  # the vault's own rules: never rewritten by a fix


def editable(path):
    """Documents a fix may edit: not dated records, frozen/generated files, rule files, tooling or templates."""
    if is_record(path) or path in FROZEN or path in RULE_FILES or path.startswith("templates/"):
        return False
    return not (path.startswith("projects/") and "/config/" in path)


def strip_code(text):
    return INLINE_CODE.sub("", FENCE.sub("", text))


def extract_targets(text):
    """(kind, target) pairs: 'wiki' for wikilinks/embeds, 'md' for relative Markdown links."""
    text = strip_code(text)
    out = []
    for m in WIKILINK.finditer(text):
        target = re.split(r"\\?\||#", m.group(1), maxsplit=1)[0].strip()
        if target:
            out.append(("wiki", target))
    for m in MDLINK.finditer(text):
        href = unquote(m.group(1))
        if href.endswith(".md") or href.endswith("/"):
            out.append(("md", href))
    return out


class Vault:
    def __init__(self, root, skip=()):
        self.root = root
        self.skip = tuple(skip)
        scanned = sorted(iter_markdown(root))
        self.local_only = git_ignored(root, scanned)
        self.files = set(scanned) - self.local_only
        self.text = {}
        for f in self.files:
            try:
                with open(os.path.join(root, f), encoding="utf-8") as fh:
                    self.text[f] = fh.read()
            except (OSError, UnicodeDecodeError):
                self.text[f] = ""
        self.by_base = collections.defaultdict(list)
        self.by_suffix = collections.defaultdict(list)  # lower-cased path suffix at a "/" → files
        self.suffix_count = collections.Counter()
        for f in self.files:
            self.by_base[os.path.basename(f)[:-3].lower()].append(f)
            parts = f.split("/")
            for i in range(len(parts)):
                suffix = "/".join(parts[i:])
                self.suffix_count[suffix] += 1
                self.by_suffix[suffix.lower()].append(f)
        self.edges = {f: self._edges(f) for f in self.files}
        self.personal_dirs = sorted(os.path.dirname(f) for f in self.files
                                    if os.path.basename(f) == "README.md" and "/" in f
                                    and SCOPE_PERSONAL.search(frontmatter(self.text[f])))

    def is_required(self, path):
        return required(path, self.skip, self.personal_dirs)

    def resolve(self, source, kind, target):
        if kind == "md":
            path = os.path.normpath(os.path.join(os.path.dirname(source), target)).replace(os.sep, "/")
            if path == ".." or path.startswith("../"):
                return None  # leaves the vault root: no document, whatever lies there on disk
            if target.endswith("/"):
                path = path + "/README.md"
            return path if path in self.files else None
        t = target[:-3] if target.lower().endswith(".md") else target
        t = t.strip("/")
        if "/" in t:
            hits = self.by_suffix.get(t.lower() + ".md", [])
        else:
            hits = self.by_base.get(t.lower(), [])
        if not hits:
            return None
        same_dir = [h for h in hits if os.path.dirname(h) == os.path.dirname(source)]
        return (same_dir or sorted(hits, key=lambda h: (h.count("/"), h)))[0]

    def _edges(self, f):
        out = set()
        for kind, target in extract_targets(self.text[f]):
            dst = self.resolve(f, kind, target)
            if dst and dst != f:
                out.add(dst)
        return out

    def reachable(self, extra=None):
        extra = extra or {}
        if ROOT_NOTE not in self.files:
            return set()
        seen, queue = {ROOT_NOTE}, [ROOT_NOTE]
        while queue:
            n = queue.pop()
            for d in self.edges.get(n, set()) | extra.get(n, set()):
                if d not in seen:
                    seen.add(d)
                    queue.append(d)
        return seen

    def unreachable(self, seen):
        return sorted(f for f in self.files if f not in seen and self.is_required(f))

    # --- broken links ----------------------------------------------------------------------

    def outside_stems(self):
        """Note stems under raw/ and archive/ — names only, never read; a wikilink may point there."""
        if not hasattr(self, "_outside_stems"):
            stems = set()
            for top in sorted(EXCLUDED_TOP - {"private"}):
                for dirpath, dirnames, filenames in os.walk(os.path.join(self.root, top)):
                    dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
                    stems.update(n[:-3].lower() for n in filenames if n.endswith(".md"))
            self._outside_stems = stems
        return self._outside_stems

    def inside_root(self, path):
        """True when `path` (absolute, normalized here) stays under the vault root.

        The disk fallback below must never look past the root: run from a worktree under
        .claude/worktrees/, a `../` that leaves the root lands in the main checkout and the
        link would pass there but fail on a clean tree.
        """
        root = os.path.abspath(self.root)
        return os.path.commonpath([root, os.path.normpath(path)]) == root

    def is_broken(self, source, kind, target):
        """True when the link resolves to no scanned document and to nothing on disk either.

        A path that leaves the vault root is broken whatever is on disk there.
        """
        if PLACEHOLDER.search(target) or self.resolve(source, kind, target):
            return False
        if kind == "md":
            path = os.path.normpath(os.path.join(os.path.abspath(self.root), os.path.dirname(source), target))
            return not (self.inside_root(path) and os.path.exists(path))
        t = target[:-3] if target.lower().endswith(".md") else target
        t = t.strip("/")
        if "/" in t:
            path = os.path.normpath(os.path.join(os.path.abspath(self.root), t))
            return not (self.inside_root(path) and (os.path.exists(path + ".md") or os.path.isdir(path)))
        return t.lower() not in self.outside_stems()

    def broken_links(self):
        """(source, kind, target) for every broken link outside templates/ and the Clippings/ inbox, as a set."""
        out = set()
        for f in self.files:
            if f.startswith(("templates/", "Clippings/")):  # a clipping's links are the clipper's, fixed at ingest
                continue
            for kind, target in extract_targets(self.text[f]):
                if self.is_broken(f, kind, target):
                    out.add((f, kind, target))
        return out

    # --- fix planning -------------------------------------------------------------------

    def unique_suffixes(self, path):
        parts = path.split("/")
        return [s for s in ("/".join(parts[i:]) for i in range(len(parts) - 1))
                if self.suffix_count[s] == 1]

    def code_index(self):
        """Inline-code spans of living documents, keyed by every path suffix of their text."""
        if hasattr(self, "_code_index"):
            return self._code_index
        index = collections.defaultdict(list)
        for src in sorted(self.files):
            if not editable(src):
                continue
            text = self.text[src]
            body = FENCE.sub(lambda m: " " * len(m.group(0)), text)
            if body.startswith("---\n") and "\n---" in body[4:]:  # frontmatter is data, never a mention site
                fm_end = body.index("\n---", 4) + 4
                body = " " * fm_end + body[fm_end:]
            for m in INLINE_CODE.finditer(body):
                code = m.group(1).strip()
                if code.startswith("./"):
                    code = code[2:]
                if not code.endswith(".md") or " " in code:
                    continue
                before = body[m.start() - 1] if m.start() else ""
                after = body[m.end()] if m.end() < len(body) else ""
                if before == "[" and after == "]":
                    continue
                entry = {"file": src, "line": text.count("\n", 0, m.start()) + 1,
                         "start": m.start(), "end": m.end(), "code": m.group(1)}
                parts = code.split("/")
                for i in range(len(parts)):
                    index["/".join(parts[i:])].append(entry)
        self._code_index = index
        return index

    def find_mention(self, orphan, seen):
        """First inline-code span in a reachable living document that names `orphan`."""
        index = self.code_index()
        for suffix in self.unique_suffixes(orphan):
            for entry in index.get(suffix, ()):
                if entry["file"] in seen and entry["file"] != orphan:
                    return dict(entry)
        return None

    def nearest_readme(self, orphan, seen):
        parts = orphan.split("/")[:-1]
        while parts:
            readme = "/".join(parts) + "/README.md"
            if readme != orphan and readme in seen:
                return readme
            parts.pop()
        return None

    def plan(self):
        extra = collections.defaultdict(set)
        fixes = []

        def open_up(node, seen):
            # a fix makes `node` reachable, and with it everything `node` already links to
            queue = [node]
            seen.add(node)
            while queue:
                n = queue.pop()
                for d in self.edges.get(n, set()) | extra.get(n, set()):
                    if d not in seen:
                        seen.add(d)
                        queue.append(d)

        while True:
            seen = self.reachable(extra)
            progress = False
            orphans = self.unreachable(seen)
            for orphan in orphans:  # pass 1: link existing mentions
                if orphan in seen:  # opened up by an earlier fix in this round
                    continue
                mention = self.find_mention(orphan, seen)
                if mention:
                    fixes.append({"orphan": orphan, "via": "mention", **mention})
                    extra[mention["file"]].add(orphan)
                    open_up(orphan, seen)
                    progress = True
            # pass 2: list in a README, entry points of each unreachable cluster first so the
            # documents they already link to are not listed again
            pending = [o for o in orphans if o not in seen]
            linked_from_pending = {d for o in pending for d in self.edges.get(o, ())}
            for orphan in sorted(pending, key=lambda o: (o in linked_from_pending, o)):
                if orphan in seen:
                    continue
                readme = self.nearest_readme(orphan, seen)
                if readme:
                    fixes.append({"orphan": orphan, "via": "readme", "file": readme})
                    extra[readme].add(orphan)
                    open_up(orphan, seen)
                    progress = True
            if not progress:
                break
        seen = self.reachable(extra)
        hubs = [{"orphan": o, "via": "hub"} for o in self.unreachable(seen)]
        return fixes, hubs


def rel_link(src, dst):
    rel = os.path.relpath(dst, os.path.dirname(src) or ".").replace(os.sep, "/")
    return rel.replace(" ", "%20").replace("(", "%28").replace(")", "%29")


def title_of(text, path):
    m = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", text.split("\n---", 1)[0], re.M) \
        if text.startswith("---") else None
    if m:
        return m.group(1)
    body = text.split("\n---", 1)[1] if text.startswith("---") else text  # a `# comment` in frontmatter is not a heading
    m = re.search(r"^#\s+(.+?)\s*$", FENCE.sub("", body), re.M)
    return m.group(1) if m else os.path.basename(path)[:-3]


def apply_fixes(vault, fixes):
    by_file = collections.defaultdict(list)
    for fx in fixes:
        by_file[fx["file"]].append(fx)
    changed = []
    for path, items in sorted(by_file.items()):
        text = vault.text[path]
        mentions = sorted((f for f in items if f["via"] == "mention"), key=lambda f: -f["start"])
        for fx in mentions:
            span = text[fx["start"]:fx["end"]]
            text = text[:fx["start"]] + f"[{span}]({rel_link(path, fx['orphan'])})" + text[fx["end"]:]
        listed = [f["orphan"] for f in items if f["via"] == "readme"]
        if listed:
            lines = [f"- [{title_of(vault.text[o], o)}]({rel_link(path, o)})" for o in sorted(listed)]
            if MAP_HEADING in text:
                head, tail = text.split(MAP_HEADING, 1)
                nxt = re.search(r"^## ", tail, re.M)
                section, rest = (tail[:nxt.start()], tail[nxt.start():]) if nxt else (tail, "")
                section = section.rstrip("\n") + "\n" + "\n".join(lines) + "\n"
                text = head + MAP_HEADING + section + ("\n" + rest if rest else "")
            else:
                text = text.rstrip("\n") + f"\n\n{MAP_HEADING}\n\n{MAP_INTRO}\n\n" + "\n".join(lines) + "\n"
        with open(os.path.join(vault.root, path), "w", encoding="utf-8") as fh:
            fh.write(text)
        changed.append(path)
    return changed


def group_counts(paths):
    c = collections.Counter()
    for p in paths:
        parts = p.split("/")
        c["/".join(parts[:2]) if parts[0] == "projects" and len(parts) > 2 else parts[0]] += 1
    return c.most_common()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=".")
    ap.add_argument("--skip", action="append", default=[], metavar="PREFIX",
                    help="path prefix that need not be reachable (repeatable)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--plan", action="store_true", help="list the fix for every orphan")
    mode.add_argument("--apply", action="store_true", help="apply mention/readme fixes")
    mode.add_argument("--broken", action="store_true",
                      help="list every link that resolves to no document")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    vault = Vault(os.path.abspath(args.root), args.skip)
    seen = vault.reachable()
    orphans = vault.unreachable(seen)
    needed = sum(vault.is_required(f) for f in vault.files)
    result = {"scanned_files": len(vault.files), "local_only": len(vault.local_only),
              "personal_dirs": len(vault.personal_dirs), "must_reach": needed,
              "reachable": needed - len(orphans), "orphans": orphans}
    if args.plan or args.apply:
        fixes, hubs = vault.plan()
        result.update({"fixes": fixes, "hubs": hubs})
        if args.apply:
            result["changed"] = apply_fixes(vault, fixes)
    if args.broken:
        result["broken"] = [{"file": f, "kind": k, "target": t} for f, k, t in sorted(vault.broken_links())]
    if args.json:
        json.dump(result, sys.stdout, ensure_ascii=False, indent=1)
        print()
        return 0

    print(f"{ROOT_NOTE}에서 도달: {result['reachable']}/{needed} "
          f"(스캔 {result['scanned_files']}개 · 로컬 전용 제외 {result['local_only']}개 · "
          f"개인 범위 프로젝트 {result['personal_dirs']}곳 예외) · 고아 {len(orphans)}")
    for group, n in group_counts(orphans):
        print(f"  {n:4d}  {group}")
    if args.plan or args.apply:
        kinds = collections.Counter(f["via"] for f in result["fixes"])
        print(f"수정 계획: mention {kinds['mention']} · readme {kinds['readme']} · hub(수동) {len(result['hubs'])}")
        if args.plan:
            for fx in result["fixes"]:
                where = f"{fx['file']}:{fx['line']}" if fx["via"] == "mention" else fx["file"]
                print(f"  [{fx['via']}] {fx['orphan']}  ← {where}")
        for h in result["hubs"]:
            print(f"  [hub] {h['orphan']}")
        if args.apply:
            print(f"수정한 파일 {len(result['changed'])}개:")
            for p in result["changed"]:
                print(f"  {p}")
    elif orphans:
        print("  (--plan으로 문서별 연결 위치를 본다)")
    if args.broken:
        print(f"깨진 링크 {len(result['broken'])} (문서 {len({b['file'] for b in result['broken']})}개)")
        for b in result["broken"]:
            shown = f"[[{b['target']}]]" if b["kind"] == "wiki" else f"({b['target']})"
            print(f"  {b['file']}: {shown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
