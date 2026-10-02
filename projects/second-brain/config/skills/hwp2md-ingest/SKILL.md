---
name: hwp2md-ingest
description: >
  HWP/HWPX(한글 문서)를 vault 잉게스트 가능한 MD로 변환해 Clippings/에 투입한다.
  기본 전략은 H1(hwp-hwpx-parser 순수 Python 직행 — 한컴오피스 불필요)이고, 텍스트
  희소 문서는 H3(페이지 렌더 → Claude 비전 전사)로 폴백한다. wiki화는 하지 않는다 —
  기존 vault-ingest가 이어받는다. 커밋 불가 문서(고객사·개인)는 vault 밖 변환 모드로
  변환만 수행한다. 근거: 2026-08-21 로컬 스모크 실측 (§ 근거·주의).
origin: lemoncloud-io/knowledge@11357973:projects/second-brain/config/skills/hwp2md-ingest/SKILL.md
---

# hwp2md-ingest (HWP/HWPX → Clippings MD)

## 언제 사용하는가

- 사용자가 "이 hwp 잉게스트해줘" / "한글 문서를 vault에 넣어줘"라고 요청할 때
- .hwp(HWP 5.0 바이너리) 또는 .hwpx(OWPML) 내용을 wiki 지식으로 만들고 싶을 때

이 스킬은 **변환과 Clippings 투입까지만** 담당한다. 개념 추출·wiki 생성·커밋·PR은
하지 않는다 (기존 vault-ingest / vault-ingest-claude 몫). PDF는 이 스킬이 아니라
`pdf2md-ingest`를 쓴다 — "hwp를 pdf로 출력해서" 우회할 필요가 없다는 것이 이 스킬의
존재 이유다.

## 전제 도구 (없으면 안내 후 중단 — 자동 설치 금지)

| 도구 | 확인 | 설치 안내 |
|---|---|---|
| uv (H1 — hwp-hwpx-parser 자동 준비) | `command -v uv` | `brew install uv` |
| Node 18+ (H3 렌더·H2 옵션) | `node --version` | nvm 등으로 설치 |

한컴오피스·JVM은 필요 없다. H3/H2가 쓰는 `hwp-mcp`는 `npx -y hwp-mcp`로 실행 시점에
준비된다 (전역 설치 불필요).

**스킬 발견용 설치** (머신별 1회): `$VAULT_DIR/.claude/skills/`에 심링크

```bash
mkdir -p "$VAULT_DIR/.claude/skills"
ln -s "$VAULT_DIR/projects/second-brain/config/skills/hwp2md-ingest" \
      "$VAULT_DIR/.claude/skills/hwp2md-ingest"
```

## 절차

### 0. 게이트 (변환 전 — 하나라도 실패하면 아무것도 쓰지 않고 보고)

1. **커밋 가능성**: 사용자에게 확인 — "이 문서는 팀 공유 vault에 커밋 가능한가?"
   고객사·개인 문서면 정식 잉게스트(§3 산출·마무리)는 중단한다. 변환 자체가 필요한
   경우에는 § vault 밖 변환 모드를 제안하고, 사용자가 그 모드를 명시적으로 선택한
   경우에만 진행한다. (고객사 hwp 서식·계획서가 전형적 해당 사례.)
2. **VAULT_DIR resolve**: 사용자 명시값 > vault 구조(`VAULT_RULES.md`, `wiki/`, `raw/`,
   `Clippings/`, `templates/`)가 확인된 현재 루트 > 그 외에는 사용자에게 질문.
   `~/knowledge` 조용한 fallback 금지. 절대경로로 resolve.
3. **중복**: `raw/hwp/<원본파일명>`이 이미 있으면 중단·보고 (raw/는 append-only).

### 1. H1 추출 → 밀도 판정 → 전략 확정

H1은 저비용·무해(읽기 전용)이므로 먼저 실행해서 그 통계로 전략을 판정한다:

```bash
SKILL_DIR="$VAULT_DIR/projects/second-brain/config/skills/hwp2md-ingest"
uv run "$SKILL_DIR/scripts/h1-extract.py" <file.hwp|hwpx> <scratch>/converted.md
```

stdout 마지막 줄 `stats chars=<n> tables=<n> images=<n> encrypted=<bool>`로 판정한다:

| 프로파일 | 판정 | 근거 |
|---|---|---|
| chars ≥ 300 | **H1 채택** — 산출 그대로 사용 | 텍스트·표(md 표 재구성)·머리말/꼬리말·`{{field}}`까지 추출됨 (2026-08-21 실측) |
| chars < 300 그리고 images ≥ 1 | **H3 제안** (이미지 위주 문서 — H1 산출은 폐기) | 텍스트 추출 계열 원리적 불가. 비용 고지 후 사용자 확인 |
| chars < 300, images = 0 | 희소 텍스트 문서 가능성 — H1 산출을 보여주고 사용자 판단 | 짧은 서식·공문이 정상일 수 있음 |
| encrypted | 중단 — 암호 해제 후 재시도 안내 | H1·H3 모두 불가 |

판정 결과(문자수·표·이미지 수)와 확정 전략을 사용자에게 보여주고 **확인받은 뒤**
다음 단계로 간다. `[IMAGE]` 마커가 있으면 그 사실을 함께 보고한다 (이미지 내용은
H1이 못 읽는다 — 이미지 속 정보가 중요하면 chars가 충분해도 H3 병행을 제안).

### 2. 폴백 변환 (H3 — 클코 자신이 수행, 산출은 스크래치에)

`npx -y hwp-mcp`를 MCP stdio로 붙여 `render_hwp_all_pages`로 페이지 PNG를 렌더한 뒤,
이미지를 순서대로 Read로 정독하며 전사한다. 규칙은 pdf2md-ingest S4와 동일:

- 보이는 것만 충실히 전사 — 추측·보완·요약 금지 (환각 방지)
- 표는 MD 표로 재구성
- 다이어그램·그림은 내부 라벨을 모두 옮기고, 화살표·흐름 등 관계를 텍스트로 서술
- 페이지마다 `<!-- page N -->` 마커
- 시작 전 예상 비용(약 0.045 USD/페이지)을 사용자에게 고지

(H2 — `hwp-mcp`의 `convert_hwp_markdown` 직접 호출 — 는 H1과 같은 계열 결과를 내므로
기본 경로에서는 제안하지 않는다. hwp-mcp가 이미 연결된 세션에서 단건 변환할 때의
동등 대안으로만 쓴다.)

### 3. 산출·마무리

1. 원본 보존: `cp <file> "$VAULT_DIR/raw/hwp/<원본파일명>"` (디렉토리 없으면 생성.
   확장자 .hwp/.hwpx 그대로 유지)
2. frontmatter를 붙여 `Clippings/<원본파일명 확장자만 .md>`로 이동:

   ```yaml
   ---
   source_hwp: "raw/hwp/<원본파일명>"
   source_sha256: "<shasum -a 256 결과>"
   converted_by: H1|H3
   converted_at: "YYYY-MM-DD"
   tables: N
   images: N
   ---
   ```

   본문 첫 줄은 원제목 H1 (`# <문서 제목>`).
3. 완료 보고: 전략·문자수·표/이미지 수·MD 크기·경로 + "잉게스트는
   vault-ingest(-claude)로 별도 실행" 안내.

### 4. 검증 (완료 선언 전)

- MD 0바이트면 실패 처리. `stats chars` < 300인데 H1 산출을 채택했다면 사용자 확인을
  거쳤는지 재확인
- H3 산출은 `<!-- page N -->` 마커 수 = 렌더된 페이지 수
- frontmatter 필수 키 6종 존재 (`source_hwp`·`source_sha256`·`converted_by`·`converted_at`·`tables`·`images`)
- 모든 산출 경로가 `$VAULT_DIR` 아래인지 (vault 밖 변환 모드에서는 반대 — 아래 § 참고)

## vault 밖 변환 모드 (커밋 불가 문서용)

게이트 1(커밋 가능성) 실패 — 고객사·개인 문서 — 인데 변환 산출물 자체는 필요한 경우의
공식 경로. 게이트가 이 모드를 **제안**할 수는 있지만, 진입은 사용자의 명시적 선택으로만
한다 (기본값 아님). 규칙은 `pdf2md-ingest` § vault 밖 변환 모드와 동일하다:

- §0 게이트 3(중복 검사) 생략, §1·§2 동일 수행, §3은 **전부 생략** — vault 아래에
  아무것도 쓰지 않는다. §4 검증은 산출 경로가 `$VAULT_DIR` **밖**인지로 뒤집힌다.
- 산출 MD는 파생 작업의 입력으로만 쓰고, 파생 결과물이 vault로 들어갈 때는 커밋 전에
  개인정보(연락처·이메일·사업자번호·상세 주소) 미유입을 diff 기준으로 검증한다.
- 완료 보고에 모드 명칭("vault 밖 변환")과 산출 경로를 명시한다.

## 에러 처리 (fail-closed)

- 도구 부재 → 위 설치 안내 후 중단. 자동 설치 금지.
- H1 실패(파싱 불가·깨진 파일) → H3을 제안하되, 원인(암호화·비표준 포맷)을 함께 보고.
- 변환 실패 → 스크래치만 정리하고 `Clippings/`·`raw/`는 건드리지 않는다.
- 게이트 실패 → 아무것도 쓰지 않고 사유 보고.

## 근거·주의 (요약)

- 2026-08-21 로컬 스모크 (맥, 한컴 없이): hwp-hwpx-parser 1.0.0이 .hwp 바이너리
  3종(표·머리말/꼬리말·`{{field}}` 템플릿)과 .hwpx를 모두 추출 — 표는 md 표로 재구성됨.
- 2026-08-21 실문서 검증 (고객사 계획서 1건 149KB·표 12개, vault 밖 변환 모드 —
  같은 문서의 hwp vs pdf 병렬본 교차): H1 산출이 pdf(S2) 산출과 정규화 유사도 94.7%,
  수치 지문 hwp 측 전량 일치(pdf 측 유일 불일치 1건은 pdf 추출의 셀 분할 아티팩트 —
  hwp가 온전), 원본 PDF 1페이지 시각 대조 핵심 사실 16/16 일치. 병합 셀 표도 md 표로 유지.
  treesoop/hwp-mcp v0.2.0(`npx -y hwp-mcp`, MIT)은 도구 35종 노출, .hwp→md 변환·표
  추출 성공, python-hwpx로 생성한 .hwpx도 읽음 (구현 간 상호운용 확인).
- chars 300 기준은 pdf2md-ingest의 페이지당 300자(image-dominant) 기준을 문서 단위로
  차용한 초기값 — 실사용 축적 후 조정 대상 (needs-update).
- hwp-hwpx-parser는 이미지 **내용**을 읽지 못한다 (`[IMAGE]` 마커만). 이미지 속
  텍스트·도표가 핵심인 문서는 H3.
- 관련: 대화형으로 hwp를 계속 다루는 세션이라면 스킬 대신
  `claude mcp add hwp-mcp -- npx -y hwp-mcp` 직접 연결이 낫다 (편집·렌더 도구 포함).
