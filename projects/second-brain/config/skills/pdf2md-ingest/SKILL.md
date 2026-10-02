---
name: pdf2md-ingest
description: >
  PDF를 vault 잉게스트 가능한 MD로 변환해 Clippings/에 투입한다. 페이지별 텍스트
  밀도를 측정해 변환 전략(S2 pymupdf4llm / S6 로컬 OCR / S4 Claude 비전 전사)을
  제안하고 사용자 확인 후 실행한다. wiki화는 하지 않는다 — 기존 vault-ingest가
  이어받는다. 커밋 불가 문서(고객사·개인)는 vault 밖 변환 모드로 변환만 수행한다.
  근거: projects/pdf2md-bench/outputs/verdict-report.md
origin: lemoncloud-io/knowledge@11357973:projects/second-brain/config/skills/pdf2md-ingest/SKILL.md
---

# pdf2md-ingest (PDF → Clippings MD)

## 언제 사용하는가

- 사용자가 "이 PDF 잉게스트해줘" / "PDF를 vault에 넣어줘"라고 요청할 때
- PDF 내용을 wiki 지식으로 만들고 싶은데 원본이 md가 아닐 때

이 스킬은 **변환과 Clippings 투입까지만** 담당한다. 개념 추출·wiki 생성·커밋·PR은
하지 않는다 (기존 vault-ingest / vault-ingest-claude 몫).

## 전제 도구 (없으면 안내 후 중단 — 자동 설치 금지)

| 도구 | 확인 | 설치 안내 |
|---|---|---|
| poppler (`pdfinfo`·`pdftotext`·`pdftoppm`) | `command -v pdftoppm` | `brew install poppler` |
| uv (S2 — pymupdf4llm 자동 준비) | `command -v uv` | `brew install uv` |
| Node 18+ (S6) | `node --version` | nvm 등으로 설치 |
| S6 런타임 (1회) | `ls ~/.cache/ppu-paddle-ocr-runtime/node_modules/ppu-paddle-ocr` | 아래 셋업 절 |

**S6 런타임 1회 셋업** (~330MB, vault 밖):

```bash
mkdir -p ~/.cache/ppu-paddle-ocr-runtime && cd ~/.cache/ppu-paddle-ocr-runtime
npm init -y && npm install ppu-paddle-ocr onnxruntime-node
```

**스킬 발견용 설치** (머신별 1회): `$VAULT_DIR/.claude/skills/`에 심링크

```bash
mkdir -p "$VAULT_DIR/.claude/skills"
ln -s "$VAULT_DIR/projects/second-brain/config/skills/pdf2md-ingest" \
      "$VAULT_DIR/.claude/skills/pdf2md-ingest"
```

## 절차

### 0. 게이트 (변환 전 — 하나라도 실패하면 아무것도 쓰지 않고 보고)

1. **커밋 가능성**: 사용자에게 확인 — "이 PDF는 팀 공유 vault에 커밋 가능한 문서인가?"
   고객사·개인 문서면 정식 잉게스트(§3 산출·마무리)는 중단한다. 변환 자체가 필요한
   경우에는 § vault 밖 변환 모드를 제안하고, 사용자가 그 모드를 명시적으로 선택한
   경우에만 진행한다.
2. **VAULT_DIR resolve**: 사용자 명시값 > vault 구조(`VAULT_RULES.md`, `wiki/`, `raw/`,
   `Clippings/`, `templates/`)가 확인된 현재 루트 > 그 외에는 사용자에게 질문.
   `~/knowledge` 조용한 fallback 금지. 절대경로로 resolve.
3. **중복**: `raw/pdf/<원본파일명>.pdf`가 이미 있으면 중단·보고 (raw/는 append-only).

### 1. 밀도 측정 → 전략 제안

```bash
SKILL_DIR="$VAULT_DIR/projects/second-brain/config/skills/pdf2md-ingest"
"$SKILL_DIR/scripts/measure-density.sh" <pdf>
```

출력의 `image-dominant: <n>/<pages>`로 제안을 정한다 (기준: 페이지당 공백 제거
300자 미만 = image-dominant, pdf2md-bench §5.2 실측 기반):

| 밀도 프로파일 | 제안 | 근거 (pdf2md-bench 실측) |
|---|---|---|
| image-dominant 0페이지 | **S2** | 텍스트 문서 T1·T2 만점, 무료·초 단위 |
| image-dominant ≥1페이지 | **S6 기본**, S4 옵션 병기 | 둘 다 QA 15/15. S6=무료·초 단위 / S4=구조·서술 우위, 약 0.045 USD/페이지·수 분 |
| 전 페이지 텍스트 0자 (스캔) | **S6 기본**, S4 옵션 | 텍스트 추출 계열 원리적 불가 |

측정 결과(총 페이지·image-dominant 수)와 제안·예상 비용을 사용자에게 보여주고
**확인받은 뒤** 변환한다. 표지·간지만 image-dominant로 걸린 경우(본문은 전부
텍스트)는 그 사실을 함께 보여주고 S2도 선택지로 남긴다. S5(하이브리드)는 제안하지
않는다 — 텍스트 뼈대의 구조 손상을 상속하는 맹점 (verdict-report §5.3).

### 2. 변환 (산출은 스크래치 디렉토리에 — 완성 전 vault에 쓰지 않는다)

- **S2**: `uv run "$SKILL_DIR/scripts/s2-convert.py" <pdf> <scratch>/converted.md`
  (PEP 723 메타데이터로 uv가 pymupdf4llm을 자동 준비)
- **S6**: 스크립트를 런타임으로 복사 후 실행 (bare import 해석 때문에 필수):

  ```bash
  RUNTIME=~/.cache/ppu-paddle-ocr-runtime
  cp "$SKILL_DIR/scripts/s6-ocr.mjs" "$RUNTIME/"
  node "$RUNTIME/s6-ocr.mjs" <pdf> <scratch>/converted.md          # 한글 문서 (기본)
  node "$RUNTIME/s6-ocr.mjs" <pdf> <scratch>/converted.md --model v6-tiny  # 영문 전용
  ```

- **S4** (클코 자신이 수행): `pdftoppm -png -r 150 <pdf> <scratch>/pages/p`로 렌더 후
  페이지 이미지를 순서대로 Read로 정독하며 전사한다. 규칙:
  - 보이는 것만 충실히 전사 — 추측·보완·요약 금지 (환각 방지)
  - 표는 MD 표로 재구성
  - 다이어그램·그림은 내부 라벨을 모두 옮기고, 화살표·흐름 등 관계를 텍스트로 서술
  - 페이지마다 `<!-- page N -->` 마커
  - 시작 전 예상 비용(약 0.045 USD/페이지)을 사용자에게 고지

### 3. 산출·마무리

1. 원본 보존: `cp <pdf> "$VAULT_DIR/raw/pdf/<원본파일명>.pdf"` (디렉토리 없으면 생성)
2. frontmatter를 붙여 `Clippings/<원본파일명 확장자만 .md>`로 이동:

   ```yaml
   ---
   source_pdf: "raw/pdf/<원본파일명>.pdf"
   source_sha256: "<shasum -a 256 결과>"
   converted_by: S2|S4|S6
   converted_at: "YYYY-MM-DD"
   pages: N
   ---
   ```

   본문 첫 줄은 원제목 H1 (`# <문서 제목>`).
3. 완료 보고: 전략·페이지 수·MD 크기·경로 + "잉게스트는 vault-ingest(-claude)로
   별도 실행" 안내.

### 4. 검증 (완료 선언 전)

- `<!-- page N -->` 마커 수 = 페이지 수 (S6/S4)
- MD 0바이트면 실패 처리. 페이지당 평균 100자 미만이면 경고 + 사용자 확인
  (희소 텍스트 문서일 수 있음)
- frontmatter 필수 키 5종 존재 (`source_pdf`·`source_sha256`·`converted_by`·`converted_at`·`pages`)
- 모든 산출 경로가 `$VAULT_DIR` 아래인지 (vault 밖 변환 모드에서는 반대 — 아래 § 참고)

## vault 밖 변환 모드 (커밋 불가 문서용)

게이트 1(커밋 가능성) 실패 — 고객사·개인 문서 — 인데 변환 산출물 자체는 필요한 경우의
공식 경로. 게이트가 이 모드를 **제안**할 수는 있지만, 진입은 사용자의 명시적 선택으로만
한다 (기본값 아님).

정식 절차와의 차이:

| 단계 | 정식 잉게스트 | vault 밖 변환 모드 |
|---|---|---|
| §0 게이트 2·3 (VAULT_DIR·중복) | 수행 | 중복 검사 생략 (raw/에 아무것도 안 들어가므로) |
| §1 밀도 측정·전략 제안 | 동일 | 동일 |
| §2 변환 | 동일 | 동일 |
| §3 산출·마무리 | raw/pdf/ 보존 + Clippings/ 투입 | **전부 생략** — vault 아래에 아무것도 쓰지 않는다 |
| §4 검증 | 산출 경로가 `$VAULT_DIR` 아래 | 산출 경로가 `$VAULT_DIR` **밖** (스크래치 또는 사용자 지정 경로) |

추가 규칙:

- 산출 MD는 세션 스크래치 디렉토리 또는 사용자가 지정한 vault 밖 경로에만 둔다.
  frontmatter 부착은 선택이며, 붙이더라도 vault 밖 산출물에만 붙인다.
- 산출 MD는 파생 작업(노트 재정리·수치 대조 등)의 **입력**으로만 쓴다. 파생 결과물이
  vault로 들어갈 때는 커밋 전에 개인정보(연락처·이메일·사업자번호·상세 주소) 미유입을
  diff 기준으로 검증한다 (`VAULT_RULES.md` § Core Rules의 개인 데이터 금지 조항).
- 완료 보고에 모드 명칭("vault 밖 변환")과 산출 경로를 명시해, 정식 잉게스트로
  오인되지 않게 한다.
- 실증: 2026-08-20 고객사 컨설팅 계획서 9건 (S2 변환 → 기업 노트 재대조,
  vault 커밋은 파생 노트 수정분만).

## 에러 처리 (fail-closed)

- 도구·런타임 부재 → 위 셋업 명령 안내 후 중단. 자동 설치 금지.
- 변환 실패 → 스크래치만 정리하고 `Clippings/`·`raw/`는 건드리지 않는다.
- 게이트 실패 → 아무것도 쓰지 않고 사유 보고.

## 근거·주의 (요약)

- 전략별 강점: `projects/pdf2md-bench/outputs/verdict-report.md` (S6 §7, 라우팅 §7.4)
- ppu-paddle-ocr 실측 주의점: `wiki/pp-ocrv6.md` § Setup Notes (한글=v5-korean-mobile,
  ArrayBuffer 입력, 모델 캐시 `~/.cache/ppu-paddle-ocr`)
