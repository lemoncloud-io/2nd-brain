---
name: vault-weekly-report
description: >
  vault의 지난 1주일 변경 이력을 git 전수 통계로 집계해 주간 보고서를 작성한다.
  사용자가 트리거 문구(team-settings.yaml의 trigger_phrase, 현재 "주간 보고"),
  "주간 보고서", "지난 주 업데이트 정리", "weekly report"를 요청할 때 사용한다.
  결과는 areas/weekly/YYYY-MM-DD.md (templates/weekly-report.md 계약)와 같은 이름의
  .html 뷰(templates/weekly-report.html 계약)를 함께 저장하고, 트리거 문구 명령은
  팀 메일 **초안 생성**까지 포함한다 — 발송 버튼은 항상 사용자가 Gmail에서 직접 누른다.
origin: lemoncloud-io/knowledge@c872ab87:projects/second-brain/config/skills/vault-weekly-report.md
---

# Vault Weekly Report

vault 리포지토리의 지난 1주일 활동을 집계해 `areas/weekly/`에 주간 보고서를
남기는 절차서다. 수치는 항상 **git 전수 통계**로 산출하고 집계 기준을 보고서에
명기한다 — 큐레이션 수치(예시로 고른 항목)와 전수 통계를 섞거나 혼동시키지 않는다.

## 설정 (배포 값)

이 스킬은 범용 절차서다. 수신자·조직 이름 같은 배포 값은 본문에 두지 않고
**`projects/second-brain/config/team-settings.yaml`**에서 읽는다 (이 스킬이 쓰는
키: `vault.name`, `mail.weekly_report.*`). 값 변경 — 특히 발송 대상 — 은 사용자
승인 사항이며, 다른 조직/vault로 이식할 때는 설정 파일만 바꾼다.

## 트리거 명령 (생성 + 팀 메일 초안)

사용자가 `mail.weekly_report.trigger_phrase`(현재 `주간 보고`)를 입력하면 아래를
한 번에 수행한다:

1. 오늘 날짜의 `areas/weekly/YYYY-MM-DD.{md,html}`가 이미 있으면 **생성을 생략**하고
   기존 파일을 쓴다. 없으면 아래 집계·작성·HTML 절차로 새로 만든다 (커밋·PR 포함).
2. HTML 전문으로 **`mail.weekly_report.to`(팀 메일) 앞 초안을 만든다**
   (§ 이메일 초안 절차). `cc_requester: true`면 **요청자 본인을 `cc`에 넣는다** —
   팀 메일이 Google Groups면 작성자 본인에게 재배달되지 않아, cc 사본이 없으면 본인
   받은편지함에는 나타나지 않는다 (2026-08-12 실측). 초안 생성은 PR 머지를 기다리지
   않는다 — 브랜치 생성본 기준으로 만든다.
3. 초안 ID와 수신자를 사용자에게 보고하고, **Gmail에서 직접 발송하라고 안내한다.**

트리거 명령 없이 스킬이 발동된 경우(보고서만 요청)에는 초안도 만들지 않으며,
설정된 팀 메일 외 다른 수신자 추가는 언제나 별도 사용자 승인이 필요하다.

## 기간 정의

- **기본: 직전 보고서 이후 전부.** 경계 커밋(BASE)은 `areas/weekly/`의 직전 보고서를
  만든 커밋이고, 집계 구간은 `$BASE..master`다. 두 보고서가 정확히 맞물려 누락도
  중복도 생기지 않는다.
- frontmatter: `period-start` = **직전 보고서의 날짜**, `period-end` = 이번 보고일,
  `sources` = `"git log <BASE 단축해시>..master (직전 보고서 커밋 이후 master 전수 통계)"`.
- 직전 보고서가 없을 때(첫 보고서)만 7일 공식으로 대체한다 —
  `BASE=$(git rev-list -1 --before="<보고일-7일> 00:00" master)`,
  `period-start` = `<보고일-7일>`.
- 사용자가 기간을 지정하면 그 기간을 쓰고, `period-start`/`period-end`에 그대로 기록한다.

**왜 날짜가 아니라 커밋인가** — 보고서가 항상 정확히 7일 간격으로 써지지는 않는다.
`--since="<보고일-7일> 00:00"`을 고정으로 쓰면 간격이 6일일 때 하루가 두 번 집계되고
8일일 때 하루가 통째로 빠진다. 실제로 2026-08-12 보고서는 `2026-08-05 00:00` 이후를
그날 14:54에 집계했고 다음 보고서는 08-18에 써졌으므로, 날짜 공식이었다면 08-11 전체와
08-12 대부분이 다시 집계됐을 것이다. 커밋 경계에서는 이 문제가 구조적으로 생기지 않는다.
(2026-08-18 보고서에서 처음 적용, 같은 날 기본값으로 확정.)

## 집계 절차 (전수 통계)

경계 커밋을 먼저 잡는다 — 직전 보고서를 만든 커밋이다:

```bash
PREV=$(ls areas/weekly/*.md | sed 's#.*/##; s#\.md$##' | grep -v '^<보고일>$' | sort | tail -1)
BASE=$(git log -1 --diff-filter=A --pretty=%H -- "areas/weekly/$PREV.md")
```

`--diff-filter=A`는 그 파일을 **생성한** 커밋을 고른다 — 직전 보고서가 나중에 수정됐어도
경계가 뒤로 밀려 그 사이 커밋이 통째로 누락되는 일이 없다. 직전 보고서가 없으면(첫 보고서)
`BASE=$(git rev-list -1 --before="<보고일-7일> 00:00" master)`로 대체한다.

커밋 경계에서는 **중복 집계가 구조적으로 불가능하다** — 두 구간이
`ancestors(이번 보고서 커밋) \ ancestors(직전 보고서 커밋)`과
`ancestors(master) \ ancestors(이번 보고서 커밋)`이라 집합 정의상 서로소다. 대신 조심할 것은
**이월**이다: 보고서 브랜치를 stale한 master에서 따면 그 사이 머지된 PR이 이번 보고서에서 빠져
다음 보고서로 밀린다. 누락되지는 않지만 주차 귀속이 어긋나므로, 보고서 브랜치는 `git fetch` 후
최신 master에서 딴다. (실제로 2026-08-18 보고서가 stale base에서 만들어져 08-14에 머지된
PR #126이 다음 주로 이월됐다.)

| 항목 | 명령 |
| --- | --- |
| 커밋 수 (전체 / 실작업) | `git log --oneline $BASE..master \| wc -l` / `--no-merges` 동일 |
| 머지된 PR 수 | `git log --merges --pretty="%s" $BASE..master \| grep -c "Merge pull request"` |
| 기여자별 커밋 | `git log --no-merges --pretty="%an" $BASE..master \| sort \| uniq -c \| sort -rn` |
| diffstat | `git diff --shortstat $BASE..master` |
| 영역별 변경 | `git diff --name-only $BASE..master \| cut -d/ -f1 \| sort \| uniq -c` |
| 신규 wiki 문서 | `git diff --diff-filter=A --name-only $BASE..master -- wiki/ \| grep -v topics` |
| 신규 팀 스킬 | 동일 명령, 경로 `projects/second-brain/config/skills/` |
| 신규 프로젝트 레인 | 동일 명령, 경로 `'projects/*/README.md'` (glob은 따옴표) |
| 일별 커밋 | `git log --pretty="%ad" --date=format:"%m-%d" $BASE..master \| sort \| uniq -c` |

`$BASE..master` 구간에는 **직전 보고서 자신의 PR이 머지로 잡힌다** — 보고서 커밋은 브랜치에서
만들어지고 그 머지는 경계 이후에 일어나기 때문이다. 정상이며, 오히려 두 구간 사이에 빈틈이
없다는 증거다. Notes에 그렇게 적는다.

커밋 메시지·머지 브랜치명으로 워크스트림을 묶고, 세부 맥락이 필요하면 해당
`projects/<name>/README.md`의 Log와 `wiki/VAULT_MEMORY.md` Current State를 참조한다.

## 작성 절차

1. `templates/weekly-report.md`를 읽고 frontmatter·섹션 계약을 그대로 따른다.
2. `areas/weekly/YYYY-MM-DD.md`로 저장한다 — 파일명은 **보고일**, 주 1개.
3. 섹션 채우기:
   - `Summary`: 주간을 관통하는 축 2~3개를 한 문단으로.
   - `Metrics`: 집계표 + 일별 커밋. 수치는 위 명령 산출값만 사용.
   - `Workstreams`: PR 번호·날짜·기여자를 명기한 주제별 소절.
   - `New Assets`: 신규 wiki / 스킬 / 프로젝트 레인 목록.
   - `Notes`: **집계 기준 명령과 비교 경계를 반드시 명기** (전수 통계임을 밝힌다).
     경계 커밋 해시와 그것이 직전 보고서(날짜)를 만든 커밋이라는 사실, 그래서 두 보고서
     사이에 누락도 중복도 없다는 점, 직전 보고서 자신의 PR이 이 구간의 머지로 잡힌다는
     점을 함께 적는다.
   - `Follow-ups`: VAULT_MEMORY Open Threads와 이번 주에 열린 미결 항목.
4. 본문 wikilink는 vault 노트에만 쓴다 (`[[wiki/...|Alias]]`). PR은 번호 텍스트로.

## HTML 뷰 (md와 함께 저장, 이메일 임베딩 호환)

- md 확정 후 `templates/weekly-report.html` 계약대로 `areas/weekly/YYYY-MM-DD.html`을
  생성해 **md와 나란히 커밋한다**. 진실원은 md다 — md를 수정하면 HTML을 재생성해
  둘을 일치시키고, 수치·문구를 HTML에만 넣지 않는다.
- HTML은 **이메일 본문 임베딩 호환**이 계약이다 (브라우저 열람은 자동으로 충족):
  - 모든 스타일은 요소 인라인(`style=""`). `<style>` 블록·CSS 변수·media query·
    `:hover`·flex/grid 금지 — 이메일 클라이언트가 head를 제거해도 본문이 유지되게.
  - 레이아웃은 `role="presentation"` 테이블. 본문 폭 680px. `bgcolor` 속성과
    `background-color` 스타일 병기.
  - 차트는 가로 막대만: `td width="N%"` + bgcolor 기법. 세로 막대·외부 라이브러리 금지.
  - 라이트 팔레트 고정 (토큰 값은 템플릿 주석에 명기).

## 이메일 초안 (Gmail, 2026-08-12 실측 검증)

전제: workspace-mcp가 gmail 도구 포함으로 등록되어 있어야 한다
(`--tools drive sheets slides gmail`) 그리고 GCP 프로젝트에 **Gmail API가 활성화**
되어 있어야 한다. 둘 중 하나라도 없으면 재등록·scope 재동의를 사용자와 함께
진행한다 — `docs/google-workspace-mcp-setup.md` § 인증·재인증 (HTTP 부트스트랩).

- **초안까지만 자동화한다** (`mail.weekly_report.delivery: draft_only`, 2026-08-31
  사용자 결정). `draft_gmail_message`로 초안을 만들고, 사용자가 Gmail에서 렌더를
  확인한 뒤 **직접 발송 버튼을 누른다.** 인자: `body_format: "html"`, `body`는
  `areas/weekly/YYYY-MM-DD.html` 전문, `include_signature: false`.
- 제목 규칙: `<subject_prefix> <vault.name> 주간 보고서 — YYYY-MM-DD`
  (값은 team-settings.yaml).
- **`send_gmail_message`는 이 스킬에서 쓰지 않는다.** 외부로 나가는 발신에 사람의
  손을 한 번 거치게 두는 것이 이 결정의 목적이므로, 초안 경로가 막혔다고 직접 발송으로
  대체하지 않는다 — 막히면 사용자에게 보고한다. (계기: 2026-08-31 `send_gmail_message`가
  권한 분류기에 차단돼 초안 경로로 완주했고, 그 편이 낫다고 판단해 규칙으로 굳혔다.)
- 실측 기준 (2026-08-12, 첫 보고서 25 KB): Gmail 웹 라이트/다크·모바일 앱 렌더
  통과. Gmail 클리핑 한도는 약 102 KB — 본문이 커지면 발송 전 `wc -c`로 확인한다.
- **본문은 파일 경로가 아니라 인라인으로 넘어간다 — 그리고 되읽어 대조할 수 없다**
  (2026-09-14 실측). `draft_gmail_message`에 파일 인자가 없어 HTML 전문을 그대로
  입력해야 하고, workspace-mcp에는 `drafts.get`/`drafts.list`가 없어 만든 초안을
  다시 읽을 경로가 없다 (`draft_gmail_message`가 돌려주는 draft ID는 message ID가
  아니라 `get_gmail_message_content`에 넣으면 `Invalid id value` 400이 난다;
  `in:drafts`·`is:draft` 검색도 빈 결과다). 따라서 **md·HTML → 초안 사이의 전사
  충실도를 기계로 보증할 수 없다.**

  그래서 § 트리거 명령 3번의 "Gmail에서 직접 발송하라"는 안내는 편의가 아니라
  **이 파이프라인의 유일한 검증 지점이다.** 사용자에게 초안 ID만 알리지 말고
  *발송 전에 렌더를 눈으로 확인할 것*을 함께 알린다. 본문이 커밋본과 다를 수
  있다는 사실을 숨기지 않는다.

## 커밋·PR

- 브랜치 `report/<YYYY-MM-DD>-weekly`로 커밋하고 PR을 올린다. 머지는 사용자
  승인이 필요하다 (vault 표준 워크플로).
- 이 스킬은 `wiki/`·`VAULT_MEMORY.md`를 수정하지 않는다 — 보고서는 areas 레인의
  기록물이며, 지식 승격이 필요한 내용은 별도 ingest/승격 워크플로를 따른다.

## 안전 규칙

- 개인 실험 데이터·개인 미디어 서술을 보고서에 넣지 않는다 (집계 수치만).
- 머신 절대경로를 남기지 않는다 (`$VAULT_DIR` 또는 상대경로).
- 수치를 재인용할 때 산출 명령이 달라졌으면 수치를 다시 계산한다 — 이전 보고서
  값을 복사하지 않는다.
