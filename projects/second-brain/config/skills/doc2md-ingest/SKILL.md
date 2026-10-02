---
name: doc2md-ingest
description: >
  Word 문서(.docx/.doc)를 vault 잉게스트 가능한 MD로 변환해 Clippings/에 투입한다.
  기본 전략은 D1(.docx → pandoc 직행 — 표·헤딩·목록 보존)이고, 레거시 .doc은 사전
  변환이 필요해 D2a(LibreOffice headless → docx → pandoc, 구조 보존)를 우선하고,
  Windows는 D2c(Word COM → docx → pandoc, 추가 설치 없음 — **Windows 실기기 미검증**,
  § Windows 검증 체크리스트), macOS는 D2b(textutil → html → pandoc, 내장이지만
  구조·이미지 손실)로 폴백한다. 텍스트가
  희소한 이미지 위주 문서는 D3(페이지 렌더 → Claude 비전 전사)로 간다. wiki화는
  하지 않는다 — 기존 vault-ingest가 이어받는다. 커밋 불가 문서(고객사·개인)는 vault
  밖 변환 모드로 변환만 수행한다. 근거: 2026-08-25 로컬 스모크 실측 (§ 근거·주의).
origin: lemoncloud-io/knowledge@11357973:projects/second-brain/config/skills/doc2md-ingest/SKILL.md
---

# doc2md-ingest (Word DOC/DOCX → Clippings MD)

## 언제 사용하는가

- 사용자가 "이 워드 파일 잉게스트해줘" / "docx를 vault에 넣어줘"라고 요청할 때
- `.docx`(OOXML) 또는 `.doc`(Word 97-2003 바이너리) 내용을 wiki 지식으로 만들고 싶을 때

이 스킬은 **변환과 Clippings 투입까지만** 담당한다. 개념 추출·wiki 생성·커밋·PR은
하지 않는다 (기존 vault-ingest / vault-ingest-claude 몫).

포맷별 담당 스킬:

| 포맷 | 스킬 |
| --- | --- |
| `.docx` · `.doc` | **이 스킬** |
| `.hwp` · `.hwpx` | `hwp2md-ingest` |
| `.pdf` | `pdf2md-ingest` |
| `.xlsx` · `.xlsm` | `xlsx2md-ingest` |

"docx를 pdf로 출력해서 pdf2md로 넣는" 우회를 하지 않는다 — 그 경로는 헤딩·표 구조를
버리고 레이아웃만 남긴다. 이 스킬이 존재하는 이유다.

## 전제 도구 (없으면 안내 후 중단 — 자동 설치 금지)

| 도구 | 확인 | 용도 | macOS | Windows |
| --- | --- | --- | --- | --- |
| pandoc | `pandoc --version` | D1·D2 공통 변환기 | `brew install pandoc` | `winget install JohnMacFarlane.Pandoc` |
| uv | `uv --version` | 스크립트 실행 (외부 Python 의존 없음) | `brew install uv` | `winget install astral-sh.uv` |
| Word | — | **D2c — Windows `.doc` 기본 경로** (추가 설치 없음) | 미사용 | 이미 설치된 것을 COM으로 호출 |
| LibreOffice | `soffice` 탐색 | D2a — `.doc` 전 플랫폼 경로 | `brew install --cask libreoffice` | `winget install TheDocumentFoundation.LibreOffice` |
| textutil | macOS 내장 | D2b — macOS `.doc` 폴백 (구조 손실) | 기본 제공 | 없음 |

`.docx`만 다룬다면 pandoc + uv로 충분하다. pandoc은 `.doc`을 직접 읽지 못한다(실측:
`Pandoc can convert from DOCX, but not from DOC.`) — 사전 변환이 필수다.

**플랫폼별 `.doc` 경로**

| 플랫폼 | 순서 | 비고 |
| --- | --- | --- |
| Windows | D2a(LibreOffice 있으면) → **D2c(Word COM)** → 실패 | 업체 PC에는 Word가 있으므로 사실상 D2c. 추가 설치 0 |
| macOS | D2a → D2b(textutil) → 실패 | D2b는 구조 손실 — `.doc`이 많으면 LibreOffice |
| Linux | D2a → 실패 | LibreOffice 필수 |

스크립트는 LibreOffice를 PATH 다음에 표준 설치 경로(`%ProgramFiles%\LibreOffice\program`,
`/Applications/LibreOffice.app`)에서도 찾는다 — Windows 설치기는 PATH를 안 건드린다.

> 비개발자 셋업 스크립트(`setup-vault-mac.sh`·`setup-vault-windows.ps1`)가 pandoc·uv를
> 설치한다 (2026-08-25부터, `-SkipConverters`/`SKIP_CONVERTERS=1`로 생략 가능).
> 스크립트를 안 거친 PC만 위 명령으로 수동 설치한다.

**스킬 발견용 설치** (머신별 1회): `$VAULT_DIR/.claude/skills/`에 심링크

```bash
mkdir -p "$VAULT_DIR/.claude/skills"
ln -s ../../projects/second-brain/config/skills/doc2md-ingest \
      "$VAULT_DIR/.claude/skills/doc2md-ingest"
```

상대 심링크여야 한다 — 절대경로 심링크는 기계 종속이라 커밋할 수 없다
(`docs/agent-skills-registration.md` — 해당 문서가 있는 볼트에서만).

## 절차

### 0. 게이트 (변환 전 — 하나라도 실패하면 아무것도 쓰지 않고 보고)

1. **커밋 가능성**: 사용자에게 확인 — "이 문서는 팀 공유 vault에 커밋 가능한가?"
   고객사·개인 문서면 정식 잉게스트(§3 산출·마무리)는 중단한다. 변환 자체가 필요한
   경우에는 § vault 밖 변환 모드를 제안하고, 사용자가 그 모드를 명시적으로 선택한
   경우에만 진행한다.
2. **VAULT_DIR resolve**: 사용자 명시값 > vault 구조(`VAULT_RULES.md`, `wiki/`, `raw/`,
   `Clippings/`, `templates/`)가 확인된 현재 루트 > 그 외에는 사용자에게 질문.
   `~/knowledge` 조용한 fallback 금지. 절대경로로 resolve.
3. **중복**: `raw/doc/<원본파일명>`이 이미 있으면 중단·보고 (raw/는 append-only).

### 1. D1/D2 추출 → 2단 판정 → 전략 확정

추출은 저비용·무해(읽기 전용)이므로 먼저 실행해서 그 통계로 전략을 판정한다:

```bash
SKILL_DIR="$VAULT_DIR/projects/second-brain/config/skills/doc2md-ingest"
uv run "$SKILL_DIR/scripts/d1-extract.py" <file.docx|file.doc> <scratch>/converted.md \
    --media-dir=<scratch>
```

스크립트가 확장자와 플랫폼을 보고 경로를 스스로 고른다 — `.docx`는 D1, `.doc`은
LibreOffice가 있으면 D2a, 없으면 Windows는 D2c(Word COM), macOS는 D2b. 이미지는 `<scratch>/media/`에 추출되고 MD 안의 참조는
상대경로 `media/<file>`로 다시 쓰인다 (절대경로가 남으면 스크립트가 실패한다).
stdout 마지막 줄:

```
stats chars=<n> tables=<n> images=<n> headings=<n> path=<D1|D2a|D2b> title=<제목>
```

`chars`는 공백과 HTML 태그를 뺀 값이라 경로 간 비교 가능하다. D2b이면 stderr에
손실 경고가 같이 나온다.

판정은 **두 축을 따로** 본다 — 경로 품질(구조가 살았는가)과 밀도(텍스트가 있는가).
한 표에 섞으면 행이 겹치거나 비는 조합이 생긴다.

**1단 — 경로 품질**

| `path` | 판정 |
| --- | --- |
| `D1` · `D2a` · `D2c` | 구조 보존 경로. 2단으로 간다 |
| `D2b` | **구조·이미지 손실 경고**를 사용자에게 보인다(아래 목록). LibreOffice 설치 후 D2a 재변환을 제안하고, 사용자가 D2b 산출을 그대로 쓰기로 하면 2단으로 간다 |

**2단 — 밀도** (1단을 통과한 산출에 대해)

| `chars` | `images` | 판정 | 근거 |
| --- | --- | --- | --- |
| ≥ 300 | 무관 | **채택** — 산출 그대로 사용 | 표·헤딩·목록·단위 기호까지 보존 (2026-08-25 실측) |
| < 300 | ≥ 1 | **D3 제안** — 이미지 위주 문서, 텍스트 산출은 폐기 | 텍스트 추출 계열 원리적 불가. 비용 고지 후 사용자 확인 |
| < 300 | 0 | 산출을 보여주고 **사용자 판단** | 짧은 서식·공문이 정상일 수 있음 |

스크립트가 `command failed`로 중단되면 손상·암호 문서 가능성 — 원인 보고 후 중단,
자동 재시도 금지.

> `chars` 300 기준은 `hwp2md-ingest`에서 차용한 초기값이다. 짧은 서식 문서는 정상
> 변환인데도 300 미만이 나온다(실측 사례: 표 1개짜리 절차서가 chars=290). 숫자만
> 보고 폐기하지 말고 산출을 함께 확인한다. (needs-update — 실사용 축적 후 조정)
>
> D2b는 `images`가 **항상 0**이다 — textutil이 `.doc`에서 이미지를 뽑지 않는다. 그래서
> D2b 산출에 2단 "이미지 위주" 행은 적용되지 않는다. 원본에 이미지가 중요하면 D2a로.

판정 결과(문자수·표·헤딩·이미지 수·사용 경로)와 확정 전략을 사용자에게 보여주고
**확인받은 뒤** 다음 단계로 간다.

#### D2b의 알려진 손실 (실측)

macOS textutil 경로는 내용은 살리지만 구조를 잃는다. 1단에서 다음을 명시한다:

- **헤딩 소실** — `# 1. 점검 주기`가 평문 `1\. 점검 주기`로 떨어진다 (`headings=0`)
- **목록 평문화** — 불릿이 `• 항목` 텍스트 문단이 된다
- **표 헤더 어긋남** — 빈 헤더 행이 생기고 원래 헤더가 첫 데이터 행으로 밀린다.
  잉게스트 전에 표 첫 행을 눈으로 확인한다
- **임베디드 이미지 전량 유실** — textutil html 변환 단계에서 사라진다. 복구 불가

내용 자체(한글, 표 셀 값, 단위 기호 `℃`·`±`, 설비코드 등)는 보존된다. textutil이
남기는 `<span class="Apple-tab-span">` 잔재는 pandoc `gfm-raw_html` 출력으로
제거되므로 MD에 들어오지 않는다.

### 2. 폴백 변환 (D3 — 클코 자신이 수행, 산출은 스크래치에)

텍스트가 희소한 이미지 위주 문서는 페이지를 이미지로 렌더해 전사한다. 규칙은
`pdf2md-ingest` S4 · `hwp2md-ingest` H3와 동일하다:

1. LibreOffice로 PDF 변환 → `pdf2md-ingest`의 렌더·전사 경로로 넘긴다
   (`soffice --headless --convert-to pdf`). 별도 렌더러를 새로 만들지 않는다.
2. 전사 규칙:
   - 보이는 것만 충실히 전사 — 추측·보완·요약 금지 (환각 방지)
   - 표는 MD 표로 재구성
   - 다이어그램·그림은 내부 라벨을 모두 옮기고, 화살표·흐름 등 관계를 텍스트로 서술
   - 페이지마다 `<!-- page N -->` 마커
3. 시작 전 예상 비용(약 0.045 USD/페이지)을 사용자에게 고지

### 3. 산출·마무리

1. 원본 보존: `cp <file> "$VAULT_DIR/raw/doc/<원본파일명>"` (디렉토리 없으면 생성.
   확장자 `.doc`/`.docx` 그대로 유지)
2. frontmatter를 붙여 `Clippings/<원본파일명 확장자만 .md>`로 이동:

   ```yaml
   ---
   source_doc: "raw/doc/<원본파일명>"
   source_sha256: "<shasum -a 256 결과>"
   converted_by: D1|D2a|D2b|D3
   converted_at: "YYYY-MM-DD"
   tables: N
   images: N
   ---
   ```

   본문 첫 줄은 원제목 H1 (`# <문서 제목>`). 스크립트가 뽑은 `title=`을 쓰되,
   pandoc `-s`가 만든 YAML 블록이 본문에 남아 있으면 제거하고 H1으로 바꾼다 —
   frontmatter가 두 개가 되면 안 된다.
3. 임베디드 이미지가 있으면 `<scratch>/media/`의 파일을
   `raw/doc/media/<원본파일명 stem>/`로 옮기고, MD 안의 `media/<file>` 참조를
   `raw/doc/media/<stem>/<file>`로 고친다 (vault 상대경로).
4. 완료 보고: 전략·문자수·표/헤딩/이미지 수·MD 크기·경로 + "잉게스트는
   vault-ingest(-claude)로 별도 실행" 안내.

### 4. 검증 (완료 선언 전)

- MD 0바이트면 실패 처리
- frontmatter 필수 키 6종 존재
  (`source_doc`·`source_sha256`·`converted_by`·`converted_at`·`tables`·`images`)
- **frontmatter 블록이 정확히 1개** (pandoc `-s` 잔재로 2개가 되기 쉽다)
- **MD 본문에 절대경로 없음** — `grep -nE '(/Users/|/home/|[A-Z]:\\)' <md>`가 0건.
  스크립트가 `--media-dir` 절대경로 유출은 막지만, 수동 편집 뒤에는 다시 확인한다
- `converted_by: D2b`이면 표 첫 행 어긋남을 확인했다는 사실을 보고에 명시
- D3 산출은 `<!-- page N -->` 마커 수 = 렌더된 페이지 수
- 모든 산출 경로가 `$VAULT_DIR` 아래인지 (vault 밖 변환 모드에서는 반대 — 아래 § 참고)

## vault 밖 변환 모드 (커밋 불가 문서용)

게이트 1(커밋 가능성) 실패 — 고객사·개인 문서 — 인데 변환 산출물 자체는 필요한 경우의
공식 경로. 게이트가 이 모드를 **제안**할 수는 있지만, 진입은 사용자의 명시적 선택으로만
한다 (기본값 아님). 규칙은 `pdf2md-ingest`·`hwp2md-ingest`와 동일하다:

- §0 게이트 3(중복 검사) 생략, §1·§2 동일 수행, §3은 **전부 생략** — vault 아래에
  아무것도 쓰지 않는다. §4 검증은 산출 경로가 `$VAULT_DIR` **밖**인지로 뒤집힌다.
- 산출 MD는 파생 작업의 입력으로만 쓰고, 파생 결과물이 vault로 들어갈 때는 커밋 전에
  개인정보(연락처·이메일·사업자번호·상세 주소) 미유입을 diff 기준으로 검증한다.
- 완료 보고에 모드 명칭("vault 밖 변환")과 산출 경로를 명시한다.

## 에러 처리 (fail-closed)

- 도구 부재 → 위 설치 안내 후 중단. 자동 설치 금지.
- `.doc`인데 어느 사전 변환 경로도 없음 → 중단. Windows는 "Word 또는 LibreOffice",
  macOS·Linux는 "LibreOffice" 설치 안내.
- D2a에서 LibreOffice가 실패하거나 산출물을 안 내면 → stderr 경고 후 다음 폴백으로
  간다(D2c/D2b). 실행별 프로필(`-env:UserInstallation`)을 주므로 GUI LibreOffice가
  떠 있어도 무산되지 않는다.
- D2c에서 Word COM이 뜨지 않음(exit 2) → 조용히 다음 폴백으로 간다. Word가 설치돼
  있는데도 실패하면 대개 원격 세션·서비스 계정 등 **대화형 데스크톱이 아닌 환경**이다 —
  COM 자동화는 로그인된 데스크톱 세션이 필요하다.
- `.doc`인데 원본에 이미지가 핵심이고 soffice가 없음 → D2b로 강행하지 않는다.
  LibreOffice 설치 또는 "Word로 열어 docx 저장" 중 하나를 사용자에게 선택시킨다.
- 변환 실패(손상·암호) → 원인을 보고하고 중단. `Clippings/`·`raw/`는 건드리지 않는다.
- 게이트 실패 → 아무것도 쓰지 않고 사유 보고.

## 근거·주의 (요약)

- **2026-08-25 로컬 스모크 (맥, Word 없이)**: 한글 본문 + 4열 표(단위 `℃`·`±`·`bar`,
  설비코드) + 헤딩 3 + 불릿 3 + 임베디드 이미지 1을 담은 docx로 두 경로를 실측.
  - **D1** (`pandoc -f docx -t gfm-raw_html -s --wrap=none`): 표·헤딩·목록·이미지·단위
    기호·고유명사 전량 보존. `stats tables=1 headings=3 images=1 path=D1`.
    문서 제목은 pandoc이 메타데이터로 보내므로 `-s`가 필수이고 YAML 블록으로 나온다
    (§3-2에서 H1으로 옮긴다).
  - **D2b** (`textutil -convert html` → `pandoc -f html`): 내용·표 셀 값·단위는 보존,
    **헤딩 0 / 목록 평문화 / 표 헤더 행 어긋남 / 이미지 0**. `headings=0`이 구조
    손실의 기계적 신호다.
  - **D2a** (LibreOffice headless → docx → D1)는 이 머신에 LibreOffice가 없어
    **미검증**이다. 구조 보존은 D1과 같아야 한다는 것이 설계 근거이며, 첫 실사용 시
    검증하고 이 절을 갱신한다 (needs-update).
- **Windows 전체 미검증** (needs-update, **M1 전 실기기 검증 필수**): 개발 머신이
  macOS라 D2c(Word COM)·LibreOffice 경로 탐색·경로 구분자 처리·회귀 테스트 전부
  Windows에서 한 번도 안 돌았다. 검증 항목은 § Windows 검증 체크리스트.
- **`gfm-raw_html`을 쓰는 이유** (2026-08-25 리뷰에서 발견): 기본 `gfm`은 폭·높이
  속성이 달린 이미지를 raw `<img …>`로 내보내 마크다운 이미지 정규식에 안 잡히고
  (`images=0`으로 오판), textutil html의 `<span class="Apple-tab-span">` 잔재가
  본문과 `chars`에 섞였다(같은 문서가 D1 81자 vs D2b 350자). raw HTML을 끄면 이미지는
  `![alt](path)`로, span은 내용만 남는다.
- **pandoc은 `.doc`을 직접 읽지 못한다** (실측 에러 메시지: `Unknown input format doc /
  Pandoc can convert from DOCX, but not from DOC.`). 사전 변환이 선택이 아니라 필수다.
- **pandoc `--extract-media=DIR`는 `DIR/media/`를 한 겹 더 만들고, MD에는 명령줄에 준
  경로 문자열을 그대로 박는다.** 절대경로를 주면 MD에 절대경로가 남으므로 스크립트가
  상대경로로 다시 쓰고, 남아 있으면 실패 처리한다.
- **회귀 테스트**: `scripts/test-d1-extract.py` — 픽스처를 pandoc으로 즉석 생성(외부
  파일 없음), D1 계수·제목·media 상대경로·절대경로 미유출·플래그 파싱·D2b 손실 신호를
  검사한다. `uv run scripts/test-d1-extract.py`. D2b 케이스는 textutil이 있는 macOS에서만.
- `chars` 300 기준은 `hwp2md-ingest`에서 차용했고, 그쪽도 `pdf2md-ingest`의 페이지당
  300자 기준을 문서 단위로 옮긴 초기값이다 (needs-update).
- 표 개수는 GFM 구분선(`|---|`) 정규식으로 센다. 표 안에 표가 없다는 전제이며,
  중첩 표 문서에서는 과소 계수될 수 있다. **병합 셀 표**는 `gfm-raw_html`에서 파이프
  표로 안 떨어지고 평문화될 수 있어 `tables=0` 오판 가능 — 미검증 (needs-update).
- 모든 외부 명령에 300초 timeout — Word COM 모달·LibreOffice 첫 실행 프롬프트에서
  무기한 정지하지 않는다. 비개발자가 쓰는 도구라 멈추면 원인을 못 찾는다.

## Windows 검증 체크리스트 (첫 Windows 실사용 시 — 결과를 § 근거에 기록)

업체 환경이 대부분 Windows다. 아래를 실기기에서 돌리고 통과 여부를 § 근거·주의에 날짜와
함께 적는다. 하나라도 실패하면 스킬 description의 Windows 문구를 내린다.

- [ ] `winget install JohnMacFarlane.Pandoc` · `winget install astral-sh.uv` 후 새 터미널에서
      `pandoc --version` · `uv --version`
- [ ] `uv run scripts\test-d1-extract.py` — D1 항목 전부 통과 (D2 항목은 textutil이 없어
      skip이 정상)
- [ ] Word로 만든 실제 `.docx` 1건: `stats` 계수가 눈으로 센 값과 일치, 이미지가
      `media\` 아래로 나오고 MD 참조가 `media/<file>` 상대경로
- [ ] Word로 만든 실제 `.doc` 1건 (LibreOffice 없이): `path=D2c`, headings·tables 보존,
      원본 `.doc` 수정 시각 불변
- [ ] 같은 `.doc`을 LibreOffice 설치 후: `path=D2a`, D2c와 계수 동일
- [ ] 한글 파일명·공백 포함 경로(`C:\Users\홍길동\문서\점검 절차.docx`)에서 D1 성공
- [ ] MD 본문에 `C:\` 절대경로 없음 (`§4 검증` 명령)
