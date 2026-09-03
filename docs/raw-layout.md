# raw/ 보존소 계약
<!-- origin: lemoncloud-io/knowledge@8480503:docs/raw-layout.md -->

`raw/`의 상세 계약. `VAULT_RULES.md` § Directory Contract의 한 줄("Processed source
originals. Append-only")을 이 문서가 구체화한다. 배경과 실측 근거:
`outputs/2026-08-14-raw-folder-organization.md`.

## 레인

raw/는 유입 경로가 다른 4개 레인을 담는다.

### 1. 웹 클리핑 (루트 `*.md`)

- 유입: Obsidian Web Clipper → `Clippings/` → ingest가 이동
  (`projects/second-brain/config/skills/vault-ingest-claude.md`).
  두 번째 생산자(2026-09-03): `medium-digest` 스킬 — Medium member-only 원문은 **발췌판**으로 투입,
  `tags`에 `medium-digest` 추가(`projects/second-brain/config/skills/medium-digest/SKILL.md` § 6).
- frontmatter: clipper 표준 7키 — `title`, `source`(URL), `author`, `created`,
  `published`, `description`, `tags`.
- 파일명: 이동 시점에 정규화한다 — § 파일명 정규화.

### 2. repo-doc 스냅샷 (루트 `<project>-<doc-slug>-<short-commit>.md`)

- 유입: 팀/개인 repo 문서의 특정 commit 시점 원문 캡처. 주 생산자는 승격 워크플로 —
  `projects/second-brain/config/skills/vault-promote.md` (2026-08-14 명문화).
- 정본이 repo 문서가 아니라 개인 KB 증류 노트면 `source:`에
  `"개인 KB 증류 노트 <slug> (근거: <org/repo>@<commit>)"`으로 적는다
  (레인 README의 `canonical: kb-distilled`와 짝).
- 예외는 하나 — 원문 자체를 복제할 수 없을 때(코드·개인 데이터·라이선스)만 스냅샷 없이 개념을
  올린다. 비공개 저장소는 사유가 아니다(사본이지 링크가 아니다). 조건·검증 대체는
  `vault-promote.md` § 원문 복제 불가 델타.
- capture header 의무 (2026-08-14부터, 기존 파일 소급 없음):

  ```yaml
  ---
  title: "<사람이 읽는 제목>"
  source: "<org/repo> — <repo 내 경로>"
  commit: "<short-hash>"
  branch: "<branch>"
  captured: YYYY-MM-DD
  author: <캡처한 사람>
  note: "<캡처 맥락. 본문 무수정 명시>"
  ---
  ```

- capture header는 캡처 **시점에** 붙이는 메타데이터이고, 본문은 원문 그대로 둔다.
  이미 raw/에 들어간 파일에 header를 소급 추가하는 것은 append-only 위반이다 —
  메타데이터 보충은 색인(`docs/raw-index.yml`)이 맡는다.

### 3. `screenshots/YYYY-MM-DD/`

- 계약 소유:
  `projects/auto-digest-screenshot-via-telegram/config/skills/telegram-screenshot-digest.md`.
- `<slug>-<short-hash>.<ext>` + 짝 `.ocr.md`, append-only.

### 4. 변환 원본 (`pdf/` · `hwp/` · `doc/`)

- 유입: 바이너리 문서를 MD로 변환해 `Clippings/`에 투입하는 변환 스킬이 **원본 파일을
  그대로** 보존하는 곳. 확장자 유지, 파일명 무변경, append-only.
- 계약 소유: `pdf2md-ingest` → `raw/pdf/`, `hwp2md-ingest` → `raw/hwp/`,
  `doc2md-ingest` → `raw/doc/` (+ 임베디드 이미지는 `raw/doc/media/<stem>/`).
  각 스킬은 `projects/second-brain/config/skills/<name>/SKILL.md`.
- 변환된 MD의 frontmatter가 `source_pdf`·`source_hwp`·`source_doc` 키로 여기를
  가리키고 `source_sha256`으로 동일성을 고정한다. 중복 검사는 이 경로의 존재 여부다.
- (2026-08-25 명문화. 세 스킬 계약이 같은 규칙을 각자 적고 있어 레인으로 묶었다 —
  이 시점에 실제 `raw/pdf/`·`raw/hwp/`·`raw/doc/` 디렉터리는 어느 vault에도 아직 없다.
  첫 변환 잉게스트가 만든다.)

## Append-only의 정의

- **내용 수정 금지, rename 금지, 삭제 금지.** 셋 다 append-only 위반이다.
- provenance(`"raw/<file>.md"` 문자열)가 정확한 경로 매칭에 의존하므로, rename은 조용한
  링크 부패를 만든다 (이력상 실제 발생: 2026-07-20 rename 1건, 2026-07-03 삭제 1건 —
  계약 확립 전).
- rename이 불가피하면(예: 개인정보가 노출된 파일명, 크로스 플랫폼 비호환 파일명):
  **사용자 승인** 후, 참조하는 모든 provenance 문자열을 같은 커밋에서 일괄 수정하고,
  사유를 run-log 노트로 남긴다
  (`outputs/runs/`, `kind: maintenance` — `templates/run-log.md`).
- 적용 이력: 2026-08-19 `?` 포함 파일명 2건 rename (Windows 클론/체크아웃 장애 실측,
  사용자 요청) — `outputs/runs/2026-08-19-maintenance-steve-lemon.md`.

## 파일명 정규화 (Clippings → raw 이동 시점)

원제목은 frontmatter `title:`에 남으므로 파일명은 안정성을 우선한다. 이동 시점에
파일명만 바꾼다(내용 무수정):

1. smart punctuation을 ASCII로 치환: `’‘` → `'`, `“”` → `'`, `—`·`–` → `-`, `…` → `...`
   (곧은 큰따옴표 `"`는 Windows 금지 문자라 치환 결과로 만들지 않는다 — 2026-08-19 수정)
2. **크로스 플랫폼 금지 문자 제거** (2026-08-19 추가, Windows 장애 실측 후):
   `< > : " / \ | ? *` 와 제어문자(U+0000–U+001F)를 제거한다. Windows 예약어
   (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`)와 확장자 앞 이름이
   **대소문자 무시**로 일치하면 `-note`를 붙인다.
3. emoji 제거
3-1. 치환·제거(1–3)를 모두 마친 뒤 연속 공백을 하나로 접고, 끝의 `.`·공백을
   제거한다 (2·3단계 어느 쪽이 만든 공백이든 여기서 정리된다 — 2026-08-19 실증에서
   적용 시점 모호로 명확화)
4. `.md` 포함 120바이트 초과 시 단어 경계에서 절단
5. 동명 충돌 시 `-1`, `-2` suffix (기존 규칙, `vault-ingest.md`)
6. 한글 파일명은 NFC로 저장 (현재 전 파일 NFC — 유지)

provenance는 정규화된 이름으로 기록한다. 기존 파일은 소급 rename하지 않는다
(§ Append-only).

## ingest 게이트

`vault-ingest-claude`/`vault-ingest`가 클리핑 처리 시 적용한다.

- **URL 중복 게이트**: 신규 클리핑의 `source:` URL이 기존 raw frontmatter에 이미 있으면
  새 wiki 노트를 만들지 않고 기존 노트를 갱신한다. 원문은 그래도 `-1` suffix로 raw/에
  보존한다 (재클리핑도 이력이다).
- **파일명 정규화 게이트**: § 파일명 정규화를 적용한 이름으로 이동한다.

## 색인

색인은 두 파일 + 개인 파일 하나다 (2026-09-03 재편 — 이전에는 `.md` 하나에 전 항목을 실었다).

- **`docs/raw-index.yml`** — 정본. git이 추적하는 raw 루트 파일별 `file`·`added`(첫 git add 일자)·
  `source`·`refs`(파생 노트 역링크) 항목과 `by_month`·`orphans`·`duplicate_sources` 집계.
  에이전트·스크립트는 파일별 정보가 필요할 때 이 파일을 읽는다.
- **`docs/raw-index.md`** — 사람용 요약만: 생성일·파일 수·월별 유입 수·오펀·source URL 중복.
  파일별 목록은 싣지 않는다(유입이 늘수록 길어져 diff·충돌 비용이 컸다).
- **`private/raw-index.yml`** — 이 머신에서 git이 추적하지 않는 raw 파일(개인/로컬)만.
  `private/`는 gitignored라 공유 색인에 섞이지 않는다. 해당 파일이 없으면 생성기가 지운다.
  (이전 `.md`의 "untracked 유입" 절은 대부분 생성기 결함이었다 — git 기본값 `core.quotepath=true`
  머신에서 비ASCII 파일명이 8진수 이스케이프돼 매칭에 실패. 2026-09-03 수정, 생성기가 `-c core.quotepath=false`로 실행.)
- 재생성: vault 루트에서
  `python3 projects/second-brain/config/scripts/generate_raw_index.py` — 세 파일을 한 번에 쓴다.
- `vault-lint` 패스가 재생성한다. **수동 편집 금지.** master 머지 충돌이 나면 어느 쪽도 택하지 말고 재생성한다.
- 색인이 raw/ 밖에 있는 이유: raw/ 안의 index는 매 ingest마다 편집이 필요해
  append-only와 충돌한다.
- 오펀(참조 0건)·source URL 중복이 발견되면 `.md` 요약과 `.yml` 집계에 표시된다 — lint 리포트로
  올린다.

## 하지 않기로 한 것 (2026-08-14 결정)

- **기존 파일 소급 rename/슬러그화** — 참조 무결 상태에서 실익이 링크 부패 위험보다
  작다.
- **서브폴더 재구조화**(`raw/YYYY-MM/` 등) — flat 구조가 아직 감당된다. **루트 200건
  도달 시** 신규분부터 재검토한다 (파일 수는 `docs/raw-index.md` 상단에 표시).
