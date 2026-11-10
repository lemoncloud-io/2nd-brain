---
name: project-viewer-build
description: >
  프로젝트의 설계·진행을 사람이 리뷰할 읽기 전용 뷰어가 필요할 때 project-viewer 셸로
  viewer.yml을 작성·검사·빌드한다. 사용자가 "이 프로젝트 뷰어 만들어줘", "리뷰용 화면
  빌드해줘", "뷰어에 페이지 추가해줘"라고 할 때 사용한다. 화면에서 입력을 받는 도구,
  시뮬레이션, 일회성 보고서에는 쓰지 않는다.
origin: lemoncloud-io/knowledge@121d6640:projects/project-viewer/config/skills/project-viewer-build/SKILL.md
---

# project-viewer-build (뷰어 만들기)

`projects/project-viewer/config/shell/`의 공용 셸로 프로젝트별 `viewer.yml` 하나를 검사·
빌드해 단일 HTML 리뷰 뷰어를 만드는 절차다. 셸 자체는 고치지 않는다 — 프로젝트 고유 내용은
전부 `viewer.yml`에 담고, 셸에 없는 블록이 필요하면 셸 쪽에 추가를 요청한다. 설계 배경은
`projects/project-viewer/docs/design.md`, 필드 정의는 `projects/project-viewer/docs/schema.md`.

## 언제 사용하는가

프로젝트의 설계·진행을 사람이 리뷰할 뷰어가 필요할 때(아키텍처 한 장 그림, 용어 정리,
원본 문서 리더, 단계·상태 화면).

쓰지 않는 경우: 화면에서 판정·입력을 받아 저장하는 도구, 파라미터를 움직이는 시뮬레이션
화면, 일회성 보고서. 입력을 받거나 실행을 시키는 도구 화면은 React + Vite 로 짓고 볼트 뷰어의
앱 플러그인으로 등록한다 — `knowledge-viewer-app-build`(2026-11-05 기본값). 뷰어는 원본이 바뀌면 다시 빌드해 항상 최신을 반영하는 것이 전제다.

## 금지 사항

- `viewer.yml`에 상태 값을 쓰지 않는다(스키마가 거부한다 — 상태는 원본에서만 읽는다).
- 원본에 없는 해설을 지어내지 않는다.
- 페이지·블록 단위 근거를 항목마다 복제해 정밀도를 부풀리지 않는다(물려받게 둔다).
- 근거를 원본에 없는 외부 주소로 추측해 만들지 않는다.
- 셸 코드(`config/shell/`)를 프로젝트마다 복사해 고치지 않는다 — 필요한 블록은 셸에
  추가를 요청한다.

## 전제 조건

- Node 24 이상.
- `projects/project-viewer/config/shell/`에서 `npm ci`를 한 번 실행해 둔다(`node_modules/`
  존재로 확인. 이미 돼 있으면 건너뛴다).
- 볼트 루트에 `VAULT_RULES.md`가 있다(셸이 이 파일을 기준으로 볼트 루트를 찾는다).

## 절차

모든 명령은 볼트 루트에서 실행한다. `<name>`은 `projects/<name>/`의 프로젝트 디렉터리
이름이다.

### 1. 원본 선정

무엇이 이 뷰어의 진실원인지 정한다. `viewer.yml`의 `sources`에 없는 파일은 뷰어가 읽지
않는다.

- `role: primary` — 없으면 뷰어가 성립하지 않는 원본(누락되면 빌드가 실패한다).
- `role: reference` — 있으면 좋은 원본(누락은 경고로만 집계한다).
- `role: ledger` — 상태 원장, 뷰어당 0개 또는 1개.

뷰어에 넣고 싶은데 원본에 없는 내용은 뷰어에 새로 쓰지 않는다 — **원본 문서에 먼저 쓴다.**
`viewer.yml`은 파생물이고 진실원이 될 수 없다.

### 2. 상태 원장

프로젝트에 단계가 있으면 `projects/<name>/docs/status.yml`을 상태 원장으로 둔다(형식은
`docs/schema.md` § status.yml). `done: true` 상태의 단계·항목에는 증거가 있어야 한다.
원장은 뷰어가 쓰는 게 아니라 프로젝트가 소유하는 문서이고, 다른 프로젝트 문서와 같이
PR로 리뷰한다.

### 3. `viewer.yml` 작성

`projects/<name>/config/viewer.yml`을 스키마(`docs/schema.md`)에 맞춰 쓴다.

블록은 모양으로 고른다:

| 담을 것 | 블록 |
| --- | --- |
| 관계(누가 무엇과 연결되나) | `graph` |
| 포함(무엇이 무엇 안에 있나) | `tree` |
| 순서(무엇 다음에 무엇) | `sequence` |
| 단계(진행 로드맵) | `stages` |
| 목록(id 붙은 항목, 검색·상호참조) | `items` |
| 비교(열·행) | `table` |

여덟 종(위 여섯 + `mermaid` + `prose`) 중 어디에도 안 맞으면 억지로 담지 않고 원본 md로
돌려보낸다 — 리더가 스타일에 맞게 보여 준다.

- 해설(`easy` `tech` `why` `body` `criteria` `text` `intro` `fields[].text`, 표 셀)은
  **원본 문장에서만** 가져온다. 새로 지어내지 않는다.
- 근거는 `{source, at: "헤딩 문구"}`를 우선한다(권장 형태). `lines`는 코드에만, `find`는
  원문 조각을 정확히 가리킬 때만 쓴다.
- 페이지·블록 단위로만 근거가 있고 항목별 근거가 없으면, 항목마다 억지로 복제하지 말고
  블록의 `evidence`를 물려받게 둔다(화면에 "블록 근거"로 드러나고 스탬프에 집계된다 —
  정밀도를 부풀리지 않기 위해서다).

### 4. `check`

```
node projects/project-viewer/config/shell/cli.ts check projects/<name>
```

오류가 있으면 오류 코드를 찍고 종료 코드 1로 끝난다. 코드별 뜻은
`projects/project-viewer/docs/schema.md` § 오류 코드가 정본이다. 자주 나오는 5개:

| 코드 | 자주 나오는 상황 | 고치는 법 |
| --- | --- | --- |
| `E_SCHEMA` | 모르는 키를 썼다, 필수 필드 누락, `schema_version` 없음 | 스키마 문서의 필드 표와 오탈자를 대조한다 |
| `E_NO_EVIDENCE` | 해설 필드는 있는데 근거가 없다 | 항목에 `evidence`를 달거나 블록 `evidence`를 채운다 |
| `E_REF_UNRESOLVED` | `at`의 헤딩 문구가 원본과 다르다, `find`가 0곳·여러 곳에서 걸린다 | 원본을 열어 헤딩·문구를 그대로 복사한다. `at`은 헤딩의 **평문**(백틱·굵게·링크 같은 인라인 표기를 뗀 문구)과 비교한다 — 표기를 그대로 넣지 않는다. 못 찾으면 메시지가 표기를 뗀 후보나 가까운 헤딩을 알려 준다 |
| `E_SOURCE_MISSING` | `primary`·`ledger` 원본 파일이 그 경로에 없다 | `sources[].path`가 볼트 루트 기준 상대경로인지 확인한다 |
| `E_LEDGER` | 원장 규칙 위반(완료에 증거 없음, 기본값이 완료, 필수 항목 미완인데 단계 완료, id 불일치) | `status.yml`과 `viewer.yml`의 단계·항목 id를 맞추고 증거를 채운다 |

해설이 원본 문장에서만 왔는지는 `check`에 `--fidelity`를 붙이면 추가로 본다:

```
node projects/project-viewer/config/shell/cli.ts check projects/<name> --fidelity
```

자주 걸리는 실패 양상 3가지:

- 원본 표의 칸을 문장으로 재조합했다 — 표는 `table` 블록으로 열·셀 그대로 옮긴다.
- 원문에 없는 마침표·접속어를 새로 지어 넣었다.
- 여러 불릿을 한 문장으로 이어 붙였다.

`W_FIDELITY_TRIMMED` 경고는 통과가 아니라 **확인 요청**이다 — 다듬음으로 판정한 문장마다
하나씩 나오고, 그 문장을 원문과 눈으로 대조한다(메시지의 `다른 곳` 조각이 어긋난 자리다).
숫자가 원본과 다르면 다듬음이 아니라 `E_FIDELITY`로 막힌다.

판정 규칙(완전 일치·다듬음·다른 원본·미일치)과 한계는
`projects/project-viewer/docs/schema.md` § 충실도 검사 (선택 모드)가 정본이다.

### 5. `build`

```
node projects/project-viewer/config/shell/cli.ts build projects/<name>
```

산출물은 `projects/<name>/outputs/viewer/index.html` 단일 파일이다. `check`를 먼저
통과해야 빌드가 진행된다. 이 파일은 커밋 대상이다 — 빌드 없이 `file://`로 바로 열려야
하기 때문이다.

### 6. 브라우저 실측

"빌드가 됐다"는 "완성됐다"가 아니다. 실제로 열어서 확인한다.

- 페이지의 모든 내부 링크와 근거 버튼을 전수 이동시켜 목적지가 실제로 있는지 본다.
- `file://`로 직접 열어도 동작하는지 확인한다(해시 라우팅이라 서버 없이도 열려야 한다).
- 콘솔 오류 0건.
- 좁은 화면(모바일 폭)과 다크 테마에서도 레이아웃이 깨지지 않는지 본다.

### 7. 원장 갱신

검증이 통과한 뒤에만 `status.yml`의 상태를 바꾼다. 증거는 실제로 확인한 기록(검증 로그,
빌드 산출물)을 가리켜야 한다. 완료를 먼저 선언하고 증거를 나중에 채우지 않는다.

## 서브에이전트에 맡길 때(감독 축약판)

`viewer.yml` 작성은 경량 모델로 충분하다. 코디네이터는 `check`·`check --fidelity`·`build`·
브라우저 실측을 **직접 재실행**한다 — 에이전트의 완료 보고를 재실행 없이 그대로 옮기지
않는다. git·gh는 코디네이터만 실행한다. 상세 절차는 `projects/project-viewer/docs/supervision.md`.

## 트리거 예시

- "<프로젝트> 뷰어 만들어줘."
- "이 프로젝트 진행 상황을 리뷰할 화면 빌드해줘."
- "<프로젝트> 아키텍처 뷰어에 페이지 추가해줘."
- "뷰어 check 돌려서 오류 고쳐줘."
