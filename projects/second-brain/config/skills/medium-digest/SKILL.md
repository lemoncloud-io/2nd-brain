---
name: medium-digest
description: >
  Gmail의 Medium Daily Digest에서 아티클 목록을 결정론적으로 추출하고, 로그인된 Chrome
  (claude-in-chrome)으로 본문(member-only 포함)을 수집해 `private/medium/<date>/bodies/`에
  전문으로 캐시한 뒤, 요약은 `sidecars/`에 따로 두고 총합 평가 → 클리핑 후보 추천까지 만든다.
  사용자 승인분만 `Clippings/`로 넘겨 기존 vault-ingest-claude가 이어받는다. 개인 읽기
  파이프라인이라 1~5단계 산출은 vault에 커밋하지 않는다(`private/`는 gitignored).
origin: lemoncloud-io/knowledge@0dd4723:projects/second-brain/config/skills/medium-digest/SKILL.md
---

# medium-digest (Gmail Medium Daily Digest → 요약 → 승인 → Clippings)

## 언제 사용하는가

- 사용자가 "오늘 미디엄 정리해줘" / "메일링 온 아티클 요약해줘"라고 요청할 때
- Medium 아티클을 vault wiki로 넣고 싶은데 원문이 member-only라 Web Clipper·WebFetch로는 본문이
  안 잡힐 때

이 스킬은 **목록 추출 → 본문 수집 → 요약 → 추천 → (승인 후) Clippings 투입**까지 담당한다.
wiki 작성·raw 이동·PR은 하지 않는다 — `vault-ingest-claude`가 이어받는다.

## 전제 (실행 전 확인, 하나라도 없으면 즉시 보고하고 중단 — 자동 설치 금지)

| 도구 | 확인 | 비고 |
|---|---|---|
| workspace-mcp Gmail | `search_gmail_messages`·`get_gmail_message_content` 호출 가능 | 인증된 계정이 digest 수신자여야 한다 |
| claude-in-chrome | `list_connected_browsers`에 `isLocal: true` 브라우저 1개 이상 | Medium에 **로그인된** 사용자 Chrome. 본문의 유일한 경로다 |
| Node 24+ | `node --version` | 스크립트는 erasable TS(`.mts`), 의존성 0, `node <file>.mts`로 실행 |

**차단 실측(재시도 금지)**: WebFetch는 403, 비로그인 인앱 브라우저는 210단어 뒤 페이월. 이 두 경로로
member-only 본문을 얻으려는 시도는 하지 않는다.

## 디렉터리 계약

스크립트는 이 스킬 디렉터리에, 산출은 사용자 개인 공간에 둔다.

```
projects/second-brain/config/skills/medium-digest/
  SKILL.md
  scripts/parse-digest.mts     digest html → digest.json (결정론 파서)
  scripts/embed-images.mts     digest.html 이미지 인라인 임베딩(오프라인 열람판)

private/medium/<YYYY-MM-DD>/   ← gitignored(`private/`). 커밋 대상 아님
  digest.src.html              Gmail full export 원본 — embed 첫 실행 시 자동 보존
  digest.html                  열람판: 원격 이미지 → data URI, 트래킹 픽셀·외부 CSS 제거(≈1.5MB)
  digest.json                  파서 산출 (count, articles[n,title,subtitle,url,slug,author,handle,publication,member_only,read_min,claps,responses])
  bodies/NN-<slug>.md          **원문 전문** 캐시(frontmatter + 노이즈만 제거한 본문). NN = digest.json의 n(2자리)
  sidecars/NN-<slug>.md        **한국어 요약**(요지·핵심 3·관련성). 같은 NN·slug로 bodies와 1:1 짝
  digest.md                    목록 표 + 요약 + 추천 (최종 산출)
  digest.part-<X>.md           병렬 실행 임시 파일 — 병합 후 삭제
```

### `bodies/`와 `sidecars/`를 왜 나누는가 (2026-09-08 확정)

**둘은 수명과 용도가 다르다.**

- `bodies/` = **원문 전문 캐시.** 나중에 클리핑을 승인했을 때 Chrome으로 다시 접속하지 않기 위해
  존재한다. 요약본만 남기면 6단계에서 발췌판을 쓸 근거가 부족해 재수집이 필요해진다 —
  2026-09-08 회차에서 실제로 발생했다(2건 재수집).
- `sidecars/` = **요약.** 4·5단계(요약 표·채점·추천)가 읽는 것이 이쪽이고, 상위 세션이
  전 건을 훑을 때 컨텍스트를 태우지 않게 한다.

**전문 저장이 계약 안인 근거**: `private/`는 `.gitignore` 38행으로 막혀 있고 추적 파일이 0건이다
(2026-09-08 확인). 즉 `bodies/`는 **이 머신에 남는 개인 읽기 캐시이며 팀 repo에도, 어디에도
배포되지 않는다.** 이 볼트는 공개용이 아니라 팀 내부 공유이고, 커밋 경계는 6단계
(`Clippings/` → `raw/`)에 있다. 저작권 판단이 필요한 지점은 그 경계이며 `bodies/`가 아니다.

**이 절을 지우지 말 것.** 근거가 적혀 있지 않아서 2026-09-04·09-07·09-08 세 회차 연속으로
서브에이전트가 전문 저장을 거부하고 압축 노트만 남겼다. 네 번째 반복을 막는 것이 이 절의 목적이다.

## 절차

### 1. 메일 확보
- `search_gmail_messages(query="from:noreply@medium.com newer_than:1d", include_headers=true)`.
  From 이름이 **"Medium Daily Digest"**인 것만 대상(`newsletters@medium.com`·Medium Events 제외).
  0건이면 "오늘 digest 미도착"으로 보고하고 종료(발송은 22:50 UTC, KST 07:50경).
- `get_gmail_message_content(message_id, body_format="html", full=true)` → 응답의 "Saved to:" 파일을
  `<date>/digest.html`로 복사. **text 포맷은 쓰지 않는다** — 아티클 링크가 없다(프로필 링크만, 제목 절단).

### 2. 목록 추출 (결정론 — 모델이 링크를 손으로 옮기지 않는다)
```bash
node projects/second-brain/config/skills/medium-digest/scripts/parse-digest.mts private/medium/<date>/digest.html private/medium/<date>/digest.json
```
- stderr `N articles (member-only K)`. N=0이면 html 구조 변경 → 중단·보고. 통상 N=15, N<10이면
  `full=true` 누락 의심 → 1단계 재확인.
- 링크는 `medium.com/@author/slug-<hexid>?source=…`, 전체 제목은 썸네일 `<img alt>`, member-only는
  `alt="Member-only content"`로 식별한다(파서가 처리).

### 2b. 열람판
```bash
node projects/second-brain/config/skills/medium-digest/scripts/embed-images.mts private/medium/<date>
```
첫 실행이 `digest.html`을 `digest.src.html`로 보존하고 임베딩판을 새로 쓴다. stderr `embedded K/K images` 확인.
사용자에게 보여줄 때는 이 파일을 보낸다(뷰어가 원격 이미지를 막아도 썸네일이 보인다).

### 3. 본문 수집 (Chrome)
- 브라우저가 2개 이상 연결돼 있으면 **`isLocal: true`**를 쓴다(서브에이전트는 사용자에게 묻지 못한다 —
  로컬 우선, 로컬이 둘이면 먼저 나온 것).
- **파트마다 자기 탭을 만든다** — `tabs_create_mcp`로 탭을 하나 열고, 그 `tabId`를 이 파트의 모든
  호출(`navigate`·`computer`·`get_page_text`)에 명시한다. 공용 탭을 쓰면 병렬 파트가 서로의 페이지를
  읽는다 — 2026-09-09 회차(공용 탭)에서 재실행 4건, 파트별 탭으로 바꾼 09-10 회차에서 0건이었다.
- `browser_batch`로 아티클마다 `navigate(url)` → `computer(wait, 4초)` → `get_page_text(tabId)` 3연을 묶어
  실행. **wait 필수** — navigate 직후 곧바로 읽으면 직전 페이지(다른 아티클) 본문이 에러 없이 반환된다.
  2초·3초에서는 재실행이 남았고 4초에서 0건이 됐다(09-08·09-09·09-10 실측, § 변경 이력).
  반환 본문의 첫 제목이 요청 아티클과 일치하는지 반드시 대조한다.
- batch 크기: 3~5건. `read_min ≥ 10`인 글은 2건 이하(3건이면 응답이 60KB를 넘어 파일로 우회된다).
- 리다이렉트는 정상(`pub.towardsai.net`, `medium.com/<pub>/…`, `<handle>.medium.com`, 퍼블리케이션 자체 도메인).
- 페이월 판정: 본문 끝 2,500자에 `create an account` / `read the full story` / `members only`가 있거나
  단어수 < `read_min × 120`이면 불완전 → `status: partial`로 저장하고 보고. 완전 수집분은 `status` 필드를 쓰지 않는다.
- **정제 = 노이즈 제거만. 요약·압축하지 않는다.** `Press enter or click to view image in full size`
  줄·단독 `--` 줄·상단 태그 목록·member-only 배너 제거, 저자 소개·추천 글 꼬리는 `[… 절삭]`으로 절삭,
  코드 블록은 ``` 보존, ASCII 표는 100줄 초과 시 `[표 생략: 한 줄 요약]`. **본문 문장은 그대로 둔다** —
  어조·인칭·문장 순서를 바꾸지 않고(1인칭 → "the author" 의역 금지), 문단을 합치거나 줄이지 않는다.
  `bodies/`는 요약이 아니라 캐시다(§ 디렉터리 계약 참조).
- `bodies/NN-<slug>.md` frontmatter: digest, n, title, author, publication, url, resolved_url, member_only,
  published, read_min, words_measured, collected, cleaning. 빈 값은 명시적 `null`.
  `cleaning`에는 **제거한 노이즈만** 적는다 — 압축·요약했다고 적을 일이 생기면 3단계를 잘못한 것이다.
- 끝나면 자기 탭을 `tabs_close_mcp`로 닫는다. 병렬 파트끼리 같은 Chrome 프로필을 쓰므로
  "not in tab group" 에러는 정상 종료로 간주.

### 3b. 요약 사이드카 (`sidecars/NN-<slug>.md`)

전문을 저장한 뒤 같은 NN·slug로 요약을 따로 쓴다. `bodies/`를 고쳐서 요약으로 만들지 않는다.

frontmatter는 `digest`·`n`·`title`·`body`(짝 `bodies/` 상대경로)·`member_only`·`read_min`·
`words_measured`만 둔다 — 나머지 서지 정보는 `bodies/` 쪽이 정본이다.

본문 구조(한국어):

- `## 요지` 3~5줄 — 저자 주장 그대로, 평가 섞지 않음
- `## 핵심` 3개 — 각 1~2줄, 실행 가능한 사실·수치·명령·파일경로. 재서술 금지
- `## 관련성` — `높음|중간|낮음` + 한 줄(`wiki/INDEX.md` 대조 결과 포함, 없으면 "없음")

### 4. 요약 (`<date>/digest.md`)
frontmatter: `type: medium-digest`, `date`, `digest_message_id`, `articles`(N), `collected`(수집한 n 목록).
1. `## 목록` — 표: n · 제목(링크) · 작성자·퍼블리케이션 · M(member-only) · 분 · 원문(`bodies/`) 링크
2. `## 요약` — 건별 요지·핵심·관련성은 `sidecars/`에 있으므로 여기서는 **한 줄 표**만 둔다:
   n · 관련성 · 한 줄(무엇을 담고 있고 왜 그 관련성인지). 사이드카를 digest.md에 복사하지 않는다
3. `## 운영 메모` — partial·리다이렉트·재실행·소요 등 1~3줄

### 5. 총합 평가·추천 (상위 세션)
전 건 요약이 모이면 상위 세션이 한 번에 읽고 **클리핑 후보 최대 3건**을 고른다.
- 채점은 `sidecars/`만 읽어도 된다 — 전 건 전문을 상위 세션 컨텍스트로 끌어올리지 않는다.
- 채점(각 0~2, 합 6): **유용성** — vault/프로젝트 작업에 바로 쓰이는 사실·절차·수치 · **창의성** — 기존
  wiki에 없는 관점(중복이면 0, `wiki/INDEX.md` 대조) · **근거** — 실측·코드·수치(선언·홍보·클릭베이트 0).
- 제외: 광고·수익 노하우류, 같은 주제 wiki 노트가 이미 `complete`인 것.
- `## 추천` 절: 채점표(전 건, **로컬 본문 링크 열** 포함) · 후보별 사유 · 로컬 원문 링크 + 원본 URL ·
  기대 wiki slug(신규/갱신) · 클리핑 형태(발췌판/전문) · 비추천 요약 1줄.
- **여기서 멈추고 사용자 승인을 요청한다.** 승인 없이 6단계로 넘어가지 않는다.

### 6. 클리핑 (승인된 건만)
- **근거는 `bodies/`의 전문이다.** 사이드카 요약만 보고 클리핑을 쓰지 않는다 — 발췌판이 얇아진다.
  `bodies/`에 전문이 있으면 **Chrome으로 재접속하지 않는다**(3단계를 다시 돌리는 것은 계약 위반).
  전문이 없거나 `status: partial`일 때만 그 건에 한해 재수집한다.
- `bodies/NN-<slug>.md` → `Clippings/<정규화된 제목>.md`. 파일명은 이 시점에 `docs/raw-layout.md`
  § 파일명 정규화를 적용해 짓는다(`:` 등 금지 문자 제거, 공백 접기) — raw 이동 시 rename이 생기지 않는다.
- frontmatter는 **Web Clipper 표준 7키만**(`vault_verify` 계약, 추가 키 금지):
  `title`(원제) · `source`(리다이렉트 전 medium.com URL) · `author: ["[[<author>]]"]` · `published` ·
  `created`(오늘) · `description` · `tags: ["clippings", "medium-digest"]`.
  digest 출처는 본문 첫 인용 블록에 `Medium Daily Digest <date> #<n>` 한 줄로 표기한다.
- **member-only 원문은 발췌판이 기본.** Clippings→raw는 팀 repo에 커밋되므로 전문을 올리지 않고
  구조·주장·근거·사례를 정리한 발췌판(짧은 인용 ≤ 3)으로 만든다. 전문 보존은 사용자가 승인 시 명시할 때만.
  무료 아티클은 전문 가능.
- 여기서 git을 만지지 않는다 — 시작 커밋(`chore: stage N clippings for ingest`)은 ingest 스킬 몫.

### 7. Ingest 인계
- `vault-ingest-claude.md` 절차 그대로(`ingest/<date>-<author-slug>` 브랜치, wiki, run-log, verify, PR).
  머지는 사용자.
- run-log `Details`에 유입 레인이 medium-digest임과 발췌판 여부를 적는다. 완료 후 `digest.md` `## 추천`에
  PR 번호·생성/갱신 노트를 기록한다.

## 실행 모드

- **단일**: 소넷 1기가 1~4단계를 순차 수행. 15건 본문 ≈ 32k 단어(≈45k 토큰 입력), 한 세션에서 가능.
  부분 실행은 `--only 9,13`처럼 n 목록을 받아 해당 건만 3~4단계, `digest.md`가 있으면 `## 요약`에 **추가**.
- **병렬**: 소넷 2기에 n을 반씩 나눠 각자 `digest.part-A.md`/`digest.part-B.md`에 **표 행만** 쓰게 한다
  (`digest.md` 동시 편집 금지). 상위 세션이 n 오름차순으로 병합하고 파트 파일을 지운다. 병합 후 전건
  실측 대조: `bodies/`·`sidecars/` 짝 존재 · 단어수 vs `read_min×120` · 페이월 문구 · 본문 첫 제목 =
  frontmatter 제목.
- **서브에이전트 프롬프트에 § 디렉터리 계약의 근거를 함께 넣는다.** "전문을 저장하라"만 지시하면
  서브에이전트가 저작권을 이유로 거부하거나 압축본으로 바꾼다(3회 실측). `private/`가 gitignored라
  배포되지 않는다는 사실을 프롬프트에 명시할 것.
- Chrome MCP는 디스크에 직접 쓰지 못해 본문이 모델을 거친다(읽기+쓰기 ≈ 2배 토큰). 15건 병렬 실측:
  2기 합계 ≈ 327k 토큰, 12분.

## 하지 말 것

- 1~5단계 산출을 `raw/`·`Clippings/`·`wiki/`·`outputs/`에 쓰거나 git에 올리지 않는다.
- 링크·제목을 메일 text에서 손으로 옮기지 않는다 — 항상 파서 산출을 쓴다.
- 비로그인 경로(WebFetch, 인앱 브라우저)를 재시도하지 않는다.
- 5단계 추천을 승인 없이 6단계로 넘기지 않는다. 클리핑·ingest는 사용자 승인이 게이트.
- Clippings frontmatter에 표준 7키 외 필드를 추가하지 않는다.
- **`bodies/`에 요약·압축본을 쓰지 않는다.** 요약은 `sidecars/`가 받는다 — 두 디렉터리를 섞으면
  6단계에서 재수집이 필요해진다.
- **전문이 `bodies/`에 있는 건을 Chrome으로 다시 열지 않는다.** 재수집은 미수집·partial 건 한정.

## 검증 이력

- 2026-09-03: 15/15 파싱, Chrome 전건 전문 접근(member-only 13, 페이월 0). 소넷 서브에이전트 단일
  (`--only` 2건, 127k tok/6.8분)·병렬(2기, 12건, 327k tok/12분) 자율 완주, 상위 세션 파일 실측 대조 정합.
  발견 → 규칙: 브라우저 2개 시 로컬 우선 · 빈 값 `null` · 핵심 1~2줄 · navigate 후 2초 wait(다른 글 본문
  반환 2건) · 의역 금지(1인칭→3인칭 2건) · 긴 글 batch 2건 이하 · `status`는 partial에만.
- 2026-09-03: 6·7단계 첫 실행 — #9 발췌판 클리핑 → wiki 신규 1/갱신 2, `vault_verify --lane ingest` PASS,
  PR #281 머지. 원 개발은 `private/medium/SKILL.md`(v0.1→0.2)에서 진행 후 이 경로로 승격.
- 2026-09-08: 15/15 수집(member-only 10, 페이월 0), 승인 2건(#4·#10) 클리핑 → wiki 신규 2/갱신 5,
  `vault_verify --lane ingest` PASS, PR #324. **`bodies/` 계약 편차가 3회 연속(09-04·09-07·09-08)
  발생해 이번에 닫았다** — 서브에이전트가 저작권을 이유로 전문 저장을 거부하거나 압축 노트로 대체했고,
  그 결과 6단계에서 승인 2건을 Chrome으로 **재수집**해야 했다(요약 3줄로는 발췌판 근거가 부족).
  결정: `bodies/` = 전문 캐시 / `sidecars/` = 요약으로 분리하고, **근거(`private/` gitignored,
  팀 내부 공유, 커밋 경계는 6단계)를 § 디렉터리 계약에 명시**한다. 지시만 있고 근거가 없으면
  반복 거부된다는 것이 3회의 교훈이다.
- 2026-09-08 부수 관측: stale-tab 재실행 6건(n=3·4·8·9·14) — navigate + **2초** wait 뒤에도 직전
  페이지 본문이 에러 없이 반환됐다. 3~4초로 늘리면 해소됐다. 3단계의 wait 값을 상향할 근거이나
  아직 2초로 두고 "제목 대조 후 재시도"에 의존한다 — 다음 회차에서 3초 고정을 시험할 것.
- 2026-09-10: 15/15 수집(member-only 12, 페이월 0, partial 0), 승인 3건(#11·#15·#6) 클리핑 →
  wiki 신규 2/갱신 6, PR. **stale-tab 대책 확정** — 파트별 전용 탭 + navigate 후 **wait 4초**로
  재실행 0건·교차 오염 0건. 직전 09-09 회차(공용 탭 + 3초)의 재실행 4건과 대비되므로, 원인은
  wait 값만이 아니라 **병렬 파트가 탭을 공유한 것**이었다. → 2026-09-13 3단계 본문에 반영 완료.
  그 전까지는 이 줄이 절차 대신 패치 노릇을 했고, 3단계만 읽은 실행자는 알려진 실패를 재현했다.
- 2026-09-10 부수 관측(중요): **`bodies/` 전문 캐시 미이행이 4회차 연속(09-04·09-07·09-08·09-10)**.
  09-08에 도입한 완화책 — § 디렉터리 계약의 근거(`private/` gitignored·팀 내부 공유·커밋 경계는
  6단계)를 서브에이전트 프롬프트에 명시 — 을 09-10에 그대로 적용했는데도 워커 2기 모두 축자 저장을
  거부했다(A: 메타데이터 스텁, B: 상세 패러프레이즈). **"근거를 주면 저장한다"는 가설은 반증됐다.**
  이 회차는 사용자 승인 아래 대안으로 진행했다 — 15건 사전 캐시를 포기하고 **승인된 3건만 6단계에서
  코디네이터가 직접 수집**. 결과는 문제없었고 토큰도 적게 들었다(사전 캐시 병렬 2기 ≈ 327k 대
  3건 직접 수집). § 디렉터리 계약 개정은 아직 하지 않았다 — 다섯 번째로 같은 지시를 반복하기 전에
  이 관측을 근거로 계약을 뒤집을지 결정할 것.
