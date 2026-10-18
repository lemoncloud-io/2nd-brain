---
name: vault-lint
description: >
  사용자의 knowledge vault에 대해 Claude Code 우선, Hermes-native fallback으로
  주기적 lint pass를 실행한다 (모순 탐지, 고아 페이지, 누락 아티클, frontmatter 결함 점검).
  예약 실행 전용 — 사용자가 직접 요청하는 경우는 드물다.
origin: lemoncloud-io/knowledge@4e78a1cb:projects/second-brain/config/skills/vault-lint.md
---

# Vault Lint (Claude-first with Hermes fallback)

이 스킬은 cron/event 자동화에서 Claude Code를 우선 사용해 vault 품질을 점검하고,
Claude Code가 설치되어 있지 않거나 인증되지 않았거나 실패하면 Hermes의 현재 모델로
같은 lint 절차를 수행하도록 만든 fallback 지시서다.

## 언제 사용하는가

- 예약된 주기 실행 시 (권장: 매주 월요일 오전)
- 최근 lint 리포트(`ls outputs/*-vault-lint*.md | tail -1`)가 2주 이상 지났을 때

## 절차

런타임에서는 `~/knowledge`로 조용히 fallback하지 않는다. 사용자가 `VAULT_DIR`를
명시하면 그 값을 우선한다. 명시되지 않았지만 현재 작업 루트가 Obsidian vault 구조
(`VAULT_RULES.md`, `wiki/`, `raw/`, `outputs/`, `templates/`)를 갖고 있으면 현재
작업 루트를 `VAULT_DIR`로 추론한다. 확신할 수 없으면 lint를 실행하기 전에 사용자에게
vault 경로를 확인한다.

## 실행 모드 결정

1. `VAULT_DIR`를 절대경로로 resolve한다.
2. `.locks/vault-lint.lock`으로 동시 실행을 방지한다. 이미 lock이 있으면 실행하지 않고 보고한다.
3. Claude Code 가용성을 확인한다.
   - `command -v claude`가 실패하면 lock을 제거하고 아래 Hermes-native 절차로 fallback한다.
   - `claude --version`이 실패하면 lock을 제거하고 fallback 사유를 보고한 뒤 Hermes-native 절차로 fallback한다.
   - `claude auth status --text`가 실패하면 Claude가 설치되어 있어도 미인증 상태로 보고하고 Hermes-native 절차로 fallback한다.
4. Claude Code가 가능하면 `$ABSOLUTE_VAULT_DIR` 루트에서 아래 Claude lint job spec을 print mode로 실행한다.
5. Claude 실행이 실패하면 자동 재시도를 반복하지 않는다. lock을 제거하고 실패 원인을 보고한 뒤 Hermes-native 절차로 fallback한다.
6. Claude 실행 후에는 결과 파일 존재 여부를 Hermes가 확인하고, 공유 불변식(memory 크기,
   raw·archive append-only, raw 색인 범위, frontmatter 파싱, 레인 흔적 = lint 리포트가 diff에 있음)은
   `python3 projects/second-brain/config/scripts/vault_verify.py --lane lint --base "$(git merge-base HEAD master)"`로 판정한다.
   exit 0이 아니면 성공으로 보고하지 않고 출력된 defect를 그대로 전달한다.
7. lock을 제거하고 실행 경로(Claude 또는 Hermes fallback)를 보고한다.

## Claude lint job spec

```text
You are linting an Obsidian markdown knowledge vault.

ABSOLUTE_VAULT_DIR: <resolved absolute vault path>

Before editing:
- Confirm that the current working directory is ABSOLUTE_VAULT_DIR.
- If the current working directory is not ABSOLUTE_VAULT_DIR, stop and report the mismatch.
- Only read or write files under ABSOLUTE_VAULT_DIR.
- Do not use ~/knowledge unless ABSOLUTE_VAULT_DIR is exactly the resolved ~/knowledge path.

Read first:
- VAULT_RULES.md
- CLAUDE.md, if present
- wiki/VAULT_MEMORY.md
- wiki/INDEX.md
- wiki/TOPIC_MAP.md, if present
- templates/lint-report.md, if present

Task:
- Scan wiki markdown files and topic pages. Scan frontmatter in all other Markdown files except
  `raw/` and `archive/`.
- **"wiki" here always means the vault-root `wiki/` directory**, never a project-local folder
  that happens to be named `wiki/` (e.g. `projects/<name>/wiki/`). Project-local wikis carry their
  own `type`/`status` enums and their own document contract, so lint neither applies the wiki
  enums to them nor resolves their wikilinks as wiki notes — they are covered by the
  frontmatter-only scan like any other project file. (Written down 2026-09-17 when
  a project-local `wiki/` was created and made the bare word ambiguous.)
- Do not read or edit raw/ file contents.
- Check frontmatter, template drift, stub notes, orphan notes, broken wikilinks, escaped-pipe aliases, raw-file wikilinks in sources, duplicate concepts, contradictions, and overcrowded topic pages.
- Orphans: a document is an orphan when no chain of links from `wiki/INDEX.md` reaches it
  (user definition, 2026-10-15; scope includes project-internal documents, not `config/`,
  `templates/`, `scope: personal` projects, or gitignored local-only files — promoted material
  is not exempt). Follow the `vault-reach` skill (`projects/second-brain/config/skills/vault-reach/SKILL.md`):
  run `python3 projects/second-brain/config/scripts/vault_orphans.py`, then `--plan`, then `--apply` on
  the lint branch. Mention fixes link an existing inline-code path; readme fixes add the document to
  the nearest reachable README's `## Document Map`; a `hub` result means a folder hub is cut off from
  INDEX and is fixed by hand (`wiki/INDEX.md` § Vault Hubs). `vault_verify.py` fails on any orphan
  (check 11) and on any broken link the change set adds (check 12) — a link already broken on the
  base is this lane's item instead: `vault_orphans.py --broken` lists them (for example 246 in 86
  documents when the check was introduced, mostly paths into a project wiki tree that never existed); fix with the
  same judgment as any lint finding — the right target, or no link — never by deleting the sentence. The scanner skips `node_modules`, `.git`,
  `.claude` worktrees, `private`, `raw`, `archive` and build directories, and never edits dated records,
  the frozen ingest ledger, the raw index, VAULT_MEMORY, `config/` or `templates/`. Report the
  before/after reachable counts and the fix counts.
- Lane-folder audits: a project that keeps lane folders may ship its own audit script
  (`projects/<name>/config/scripts/<name>_lane_audit.py`, rules in that project's lane README —
  upper/lower membership, parent pointer ↔ table, required files, `next_action` hygiene,
  shared-lib lanes). Run every such script. Fix defects on the lint branch; a
  `track:` or membership decision is the user's and is reported, not guessed. Report the summary line.
- An escaped pipe INSIDE a Markdown table cell is required, not a violation (VAULT_RULES.md
  § Core Rules). Only report escaped aliases in prose.
- Resolve wikilinks in wiki/ only. VAULT_RULES.md, CLAUDE.md, templates/, and
  projects/*/config/skills/ contain syntax EXAMPLES ([[note-slug|Alias]], [[target]], and
  deliberate escaped-pipe counter-examples); do not report those as broken links.
- Check every tracked filename for cross-platform (Windows) compatibility: forbidden
  characters (`< > : " / \ | ? *`), control characters, trailing dots/spaces, reserved
  device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9 — matched case-insensitively), and case-insensitive path
  collisions. Report violations in the lint report — renames in raw/ require user
  approval per docs/raw-layout.md § Append-only; never rename automatically.
- Stub boundary (VAULT_RULES.md § Note Contracts): flag `status: draft` notes whose body is under
  1,200 non-whitespace characters (frontmatter and code blocks excluded), and `status: stub` notes
  above that size whose body does not state a missing-evidence/coverage reason.
- In every frontmatter, require `related` items and vault Markdown note references in `sources`
  to be quoted Obsidian wikilinks. Keep raw paths, URLs, and non-note artifacts in `sources` as strings.
- In project frontmatter, `next_action` holds one action per string — a quoted scalar or a block
  sequence, each item at most 300 bytes with no `;` joining clauses. `vault_verify.py` reports the
  breaches; deciding what counts as one action follows `docs/project-next-action.md`. Keep the
  wording, move the surplus into the body — do not summarise it away.
- In project frontmatter, every `milestones` entry names its checkpoint in at most 300 bytes —
  the name is a label, the evidence goes in the body (`## Milestone Notes`) or in the `outputs/`
  report the label points at. `vault_verify.py` reports the breaches; deciding what stays in the
  label follows `docs/project-milestones.md`. Same rule about the wording: move it, do not
  rewrite it, and drop a clause only after finding it verbatim elsewhere in the note.
- Compact outputs/ by month before regenerating the raw index (VAULT_RULES.md § Monthly
  compaction). Run `python3 projects/second-brain/config/scripts/outputs_compact.py plan`; it lists
  the eligible records — run-logs up to today, and lint reports of closed months except the newest.
  Query answers are never compacted. Then, in order:
  1. Read every eligible record and move the durable knowledge the living vault does not already hold
     — decisions and their reasons, pitfalls, verified facts, judgment rules — into wiki/ (first the
     judgment-rules notes `vault-lint-judgment-rules`, `vault-ingest-judgment-rules`,
     `vault-promotion-judgment-rules`; a project fact goes to that project's README or docs). Link each
     item to the PR that added its record. Check every item against the record text before writing it.
     A user decision already on record wins over a record's suggestion. Counts, file lists and
     anything already codified stay out.
  2. Run `outputs_compact.py write`, then write or refresh `## Answer` in each touched
     `outputs/monthly/YYYY-MM.md`: 3–6 bullets read off its Evidence.
  3. Run `outputs_compact.py apply`. It is the only deletion a lint pass may make. It refuses while an
     Answer is still the placeholder or while `git rm` would fail, and it writes nothing in that case.
  4. Repoint the living documents it lists (wikilinks, current-tense statements) to the monthly
     note. Plain-text mentions inside dated records (reports, run-logs, weekly reports) stay as they are.
  5. Check that `vault_volume.py` prints the same totals before and after, and record the counts in
     the lint report.
  If the pass cannot finish step 1 (turn budget, print mode), run `write` only and report it —
  never `apply` without step 1.
- Regenerate the raw index (docs/raw-index.yml canonical + docs/raw-index.md summary;
  untracked local raw files go to gitignored private/raw-index.yml) by running
  `python3 projects/second-brain/config/scripts/generate_raw_index.py` from the vault root
  (this reads raw/ filenames and frontmatter only — no raw/ content edits). If it surfaces
  orphan raw files, duplicate source URLs, unpaired conversion originals (a preserved
  binary under raw/pdf|hwp|doc that no converted note claims with a source_<lane> key),
  or orphan Slack extracts (a raw/slack/ file whose path no note mentions),
  include them in the lint report. Read docs/raw-index.yml when you need per-file
  provenance; the .md carries counts only.
- The lint lane is the ONLY lane that commits docs/raw-index.yml and docs/raw-index.md
  (docs/raw-layout.md § 색인, 2026-09-29); ingest, promote and every other PR leave them as on
  their base. Regenerate only on a lint branch cut from up-to-date master (fetch, then branch
  from the current master): if HEAD does not contain the current master, do not regenerate —
  report it. When the pass is committed, the two index files go in their own commit, apart
  from the lint report and any fixes.
- Save the report to outputs/YYYY-MM-DD-vault-lint.md using templates/lint-report.md when available.
- Do not stamp wiki/VAULT_MEMORY.md: since 2026-09-03 it holds no `Last Lint Pass:`, `Last Ingest:`,
  `Volume to date` or verification-queue count (they conflicted on every concurrent branch). The
  outputs/ report is the record; vault_verify --lane lint requires it in the diff. Edit memory only to
  fix a contract drift you found, and keep it under 8 KB (`wc -c`).
- Report any Current State / Open Threads entry that has drifted out of contract: a per-run counter line
  re-introduced (`- Last …:`, `- Volume to date:`), restated project status, an Open Threads list over
  5 items, or a closed thread still listed.

Rules:
- Do not edit raw/ or archive/ file contents.
- Do not invent large article bodies during lint.
- Do not run git push, git reset, git clean, rm -rf, or destructive commands. The one deletion
  allowed is `outputs_compact.py apply` after step 1 of the compaction above.

Final response:
Report current working directory, ABSOLUTE_VAULT_DIR, lint report path, critical issues, stub count,
broken link count, and any unresolved issues. Report wiki/VAULT_MEMORY.md only if a contract drift
forced an edit to it (see above) — a lint pass normally leaves it untouched.
```

Claude CLI 예시:

```bash
ABSOLUTE_VAULT_DIR="$(cd "${VAULT_DIR:-$PWD}" && pwd)"
command -v claude >/dev/null 2>&1 || exit 42
claude --version >/dev/null 2>&1 || exit 42
claude auth status --text >/dev/null 2>&1 || exit 42
cd "$ABSOLUTE_VAULT_DIR" && claude -p "<CLAUDE_LINT_JOB_SPEC with ABSOLUTE_VAULT_DIR=$ABSOLUTE_VAULT_DIR>" --permission-mode acceptEdits --allowedTools "Read,Write,Edit,Bash" --max-turns 20 --output-format json
```

## Hermes-native fallback 절차

1. `$VAULT_DIR/wiki/VAULT_MEMORY.md`,
   `$VAULT_DIR/wiki/INDEX.md`, `$VAULT_DIR/wiki/TOPIC_MAP.md`를 읽는다.
2. `$VAULT_DIR/templates/lint-report.md`가 있으면 읽고 lint report 출력 구조로 사용한다.
3. `wiki/`의 markdown 문서를 스캔하고, 그 밖의 Markdown 파일은 frontmatter만 스캔한다.
   `raw/`와 `archive/`는 읽거나 수정하지 않는다.
4. 다음 항목을 점검한다.
   - frontmatter 누락 또는 필수 필드 누락
   - 사용 가능한 템플릿과 크게 어긋나는 wiki/query/lint 문서 구조
   - `status: stub` 문서, 그리고 stub 경계 드리프트(`VAULT_RULES.md` § Note Contracts):
     본문(frontmatter·코드블록 제외, 공백 제외) 1,200자 미만인 `draft`, 그 이상인데
     결손 사유가 본문에 없는 `stub`
   - 고아 문서 — `wiki/INDEX.md`에서 링크를 따라 닿지 않는 문서(2026-10-15 사용자 정의, 프로젝트 내부 문서까지,
     `config/`·`templates/`·`scope: personal` 개인 프로젝트·gitignore된 로컬 전용 파일 제외 — 개인 프로젝트에서
     아이디어·프로젝트·위키로 승격한 문서는 예외가 아니다). `vault-reach` 스킬 절차를 따른다: `vault_orphans.py` → `--plan` → lint
     브랜치에서 `--apply`. `hub`로 나온 것은 폴더 허브가 INDEX에서 끊긴 것이라 손으로 잇는다
     (`wiki/INDEX.md` § Vault Hubs). 스캐너는 `node_modules`·`.claude` 워크트리 등을 건너뛰고, 날짜 기록·동결
     원장·raw 색인·VAULT_MEMORY·`config/`·`templates/`는 고치지 않는다. 전후 도달 수와 수정 건수를 리포트에 남긴다
   - 깨진 wikilink
   - `[[note\|Alias]]`처럼 pipe 문자가 escape된 Obsidian alias.
     단 **마크다운 표 셀 안에서는 escape가 필수**라 위반이 아니다 (`VAULT_RULES.md` § Core Rules) —
     산문에 있는 것만 보고한다
   - `sources`에 raw 파일을 `[[...]]` wikilink로 넣은 경우
   - 모든 frontmatter에서 `related` 항목 또는 `sources`의 vault Markdown 노트 참조가
     quoted wikilink(`"[[target]]"` 또는 `"[[target|Alias]]"`)가 아닌 경우. 단,
     `sources`의 raw 경로·URL·비노트 파일은 문자열로 유지
   - 프로젝트 frontmatter의 `next_action`이 한 문자열에 행위를 둘 이상 담은 경우
     (`vault_verify.py`가 300바이트 초과·`;` 결합을 올린다). 판정과 정비 절차는
     `docs/project-next-action.md` — **문장은 그대로 옮기고** 넘치는 것은 본문으로 내린다
   - 프로젝트 frontmatter의 `milestones` 이름이 라벨이 아니라 기록을 담은 경우
     (`vault_verify.py`가 300바이트 초과를 올린다). 판정과 정비 절차는
     `docs/project-milestones.md` — 근거는 본문 `## Milestone Notes`나 outputs/ 리포트로
     옮기고, 이미 본문에 같은 문장이 있을 때만 지운다
   - 중복 개념
   - 서로 모순되는 설명
   - 10개 이상 문서를 가진 과밀 topic page
   - 크로스 플랫폼(Windows) 비호환 파일명: 금지 문자(`< > : " / \ | ? *`)·제어문자·
     끝 점/공백·예약어(CON, PRN, AUX, NUL, COM1-9, LPT1-9 — 대소문자 무시)·
     대소문자 경로 충돌.
     리포트에만 올린다 — raw/ rename은 사용자 승인 사안 (docs/raw-layout.md § Append-only)
   - 링크 해석은 `wiki/`만 대상으로 한다. `VAULT_RULES.md`·`CLAUDE.md`·`templates/`·
     `projects/*/config/skills/`의 `[[note-slug|Alias]]`·`[[target]]`과 의도된 escaped-pipe
     반례는 문법 예시이므로 깨진 링크로 보고하지 않는다
5. 필요한 경우 빈 stub 문서를 만든다. 단, 추측으로 긴 본문을 작성하지 않는다.
5a. **outputs 월간 압축**(`VAULT_RULES.md` § Monthly compaction, 2026-10-12 사용자 결정 — 정비 때마다
   수행). `python3 projects/second-brain/config/scripts/outputs_compact.py plan`이 대상을 보여 준다.
   대상은 오늘까지의 실행 로그와, 마감된 달의 lint 보고서(가장 최신 1건 제외)다. 질의 답변은 대상이
   아니다. 순서:
   1. **지속 지식은 wiki로.** 대상 기록을 읽는다. 결정과 그 이유, 함정, 검증된 사실, 판정 규칙 중
      살아 있는 볼트에 없는 것을 wiki로 옮긴다. 먼저 `vault-lint/ingest/promotion-judgment-rules`
      노트에 넣고, 특정 프로젝트의 사실은 그 README·docs에 넣는다. 항목마다 그 기록을 들여온 PR을
      링크하고, 원문과 대조한 뒤 쓴다. 이미 내린 사용자 결정이 기록의 제안보다 우선한다. 건수,
      파일 목록, 이미 성문화된 것은 옮기지 않는다. 대상이 많으면 서브에이전트에 나눠 읽힌다(읽기 전용).
   2. `outputs_compact.py write` → 손대는 `outputs/monthly/YYYY-MM.md`의 `## Answer`를 Evidence를
      읽고 3~6줄로 쓴다(이미 있으면 새 항목만큼 다듬는다).
   3. `outputs_compact.py apply` — **정비가 할 수 있는 유일한 삭제다.** Answer가 자리표시자이거나
      `git rm`이 실패할 상황이면 아무것도 쓰지 않고 거부한다.
   4. 출력된 살아 있는 문서의 참조(wikilink, 현재형 서술)를 월별 요약으로 바꾼다. 날짜가 박힌
      기록물(보고서, 실행 로그, 주간 보고) 안의 평문 언급은 그대로 둔다.
   5. `vault_volume.py`의 총계가 압축 전후로 같은지 확인하고, 건수를 lint 리포트에 남긴다.
   1단계를 끝낼 수 없으면(턴 예산, print 모드) `write`만 하고 보고한다. 1단계 없이 `apply`하지 않는다.
6. raw 색인을 재생성한다(`docs/raw-index.yml` 정본 + `docs/raw-index.md` 요약, 미추적 로컬 파일은
   gitignored `private/raw-index.yml`): vault 루트에서
   `python3 projects/second-brain/config/scripts/generate_raw_index.py`
   (raw/ 파일명과 frontmatter만 읽는다 — raw/ 내용 수정 없음). 오펀 raw 파일, source URL 중복,
   짝 없는 변환 원본(`raw/pdf|hwp|doc|xlsx`의 보존 파일 중 어느 변환 노트도 `source_<lane>` 키로
   가리키지 않는 것), slack 레인 오펀(`raw/slack/`의 파일 중 어느 노트도 경로를 언급하지 않는 것)이
   표시되면 lint 리포트에 포함한다. 파일별 출처가 필요하면 `.yml`을 읽는다.
   **색인 두 파일(`docs/raw-index.yml`·`.md`)을 커밋하는 레인은 lint 하나다**(`docs/raw-layout.md`
   § 색인, 2026-09-29) — ingest·promote 등 다른 PR은 base 그대로 둔다. 재생성은 최신 master에서
   딴 lint 브랜치에서만 한다(fetch 후 현재 master에서 분기). HEAD가 현재 master를 포함하지 않으면
   재생성하지 않고 보고한다. 커밋할 때 색인 두 파일은 lint 리포트·수정분과 분리된 별도 커밋 하나로 남긴다.
7. lint 결과를 `outputs/YYYY-MM-DD-vault-lint.md`에 저장한다.
8. `wiki/VAULT_MEMORY.md`에는 실행 카운터를 쓰지 않는다(2026-09-03부터 `Last Lint Pass`·`Volume to date`·
   `Verification queue` 수치 없음 — 리포트가 기록이고, 수치는 `ls outputs/*-vault-lint*.md`·`vault_volume.py`로 유추).
   계약 드리프트를 발견해 고칠 때만 memory를 편집하고 8 KB(`wc -c`)를 지킨다.
   끝나면 `python3 projects/second-brain/config/scripts/vault_verify.py --lane lint --base "$(git merge-base HEAD master)"`가 exit 0인지 확인한다.
9. 결과 요약(신규 stub 수, 분할 후보 topic, 발견된 모순 수)을 사용자에게 보고한다.
   심각한 모순이 발견되면 즉시 보고하고, 사소한 것(빈 stub 등)은 주간 요약에만
   포함한다.

## 금지 사항

- lint 실행 중 `raw/` 파일은 절대 건드리지 않는다 (append-only)
- 근거 없이 본문을 대량 생성하지 않는다
- `git reset`, `git clean`, `rm -rf` 같은 파괴적 명령을 실행하지 않는다. 허용되는 삭제는 5a의
  `outputs_compact.py apply` 하나다(지속 지식을 wiki로 옮긴 뒤에만)
- Claude 미설치/미인증/실패 시 조용히 종료하지 않는다. lock을 제거하고 Hermes-native fallback 여부를 보고한다
