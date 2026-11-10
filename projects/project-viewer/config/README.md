# 리뷰 뷰어 셸 — 코어 유닛
<!-- origin: lemoncloud-io/knowledge@121d6640:projects/project-viewer/config/README.md -->

프로젝트마다 `viewer.yml` 하나로 읽기 전용 리뷰 뷰어(단일 HTML)를 만드는 공용 셸과 그 스킬이다.
이 폴더(`config/`)는 볼트마다 같은 코드다. 볼트마다 다른 것은 각 프로젝트의 `viewer.yml` 과 그 근거 문서다.

- 셸: `shell/` — 파싱·검사(`model/`), 원본 묶기·빌드(`loader/`), 화면(`src/`), 시험(`tests/`). 구조와 명령의 정본은 [셸 README](shell/README.md).
- 스킬: [project-viewer-build](skills/project-viewer-build/SKILL.md)(작성·검사·빌드) · [project-viewer-open](skills/project-viewer-open/SKILL.md)(띄워서 보기).
- 이 폴더에 `viewer.yml` 이 있으면 그것은 이 프로젝트 자신의 뷰어 정의다. 공통 코드가 아니고, 근거 문서가 있는 볼트에서만 검사가 통과한다.

## 실행과 시험

| 용도 | 명령 | 비고 |
| --- | --- | --- |
| 검사 | `node projects/project-viewer/config/shell/cli.ts check projects/<name>` | 볼트 루트에서. 오류가 있으면 종료 코드 1 |
| 충실도 검사 | `… check projects/<name> --fidelity` | 해설 문장이 원본에 있는지 함께 본다 |
| 빌드 | `node projects/project-viewer/config/shell/cli.ts build projects/<name>` | 검사 통과 뒤 `projects/<name>/outputs/viewer/index.html` |
| 개발 | `node projects/project-viewer/config/shell/cli.ts dev projects/<name>` | 개발 서버 |
| 설치 | `npm ci` | `shell/` 에서 최초 1회 |
| 시험 | `npm test` | `shell/` 에서. `node --test "tests/**/*.test.ts"` |
| 타입 | `npm run typecheck` | `shell/` 에서 |

## 확장 지점

코어를 고치지 않고 붙일 수 있는 것은 아래가 전부다.

### 1. 프로젝트별 `viewer.yml`

- 자리는 `projects/<name>/config/viewer.yml` 하나다. CLI 는 `<프로젝트 디렉터리>/config/viewer.yml` 만 읽는다(`shell/cli.ts`). 프로젝트당 뷰어는 하나다.
- 최상위 키: `schema_version`(1) · `meta`(`title`·`kind: project|explainer`·`audience`·`summary`) · `sources` · `statuses` · `glossary` · `pages`.
- `sources[]`: `id`·`path`(볼트 상대)·`title`·`group`·`role: primary|reference|ledger`·`kind: doc|code|data`, 코드 원본이면 `repo: <org>/<name>`·`commit`·`url_base`.
- `pages[]`: `id`·`title`·`layout: stack|tabs`·`blocks`.
- 모든 객체는 모르는 키를 오류로 낸다. 필드 정의의 정본은 `shell/model/schema.ts`(zod)와 `shell/model/types.ts` 다.
- 상태는 `viewer.yml` 에 쓰지 않는다. `role: ledger` 원본(`status.yml`, 뷰어당 0개 또는 1개)에서만 읽는다.

### 2. 블록

블록 어휘는 닫힌 집합이다: `graph` `tree` `sequence` `stages` `items` `table` `mermaid` `prose`.
한 프로젝트에만 필요한 내용은 블록을 늘리지 말고 원본 md 로 돌려보낸다. 블록을 늘리는 것은 셸 코어 변경이다 —
절차는 [셸 README § 새 블록을 추가하는 절차](shell/README.md#새-블록을-추가하는-절차).

### 3. 환경 변수

- `VIEWER_REPOS_DIR` — 있으면 그 아래 `<org>/<name>/` 에서 `kind: code` 원본을 읽어 검증한다.

### 없을 때의 동작

- 프로젝트에 `config/viewer.yml` 이 없으면 `check`·`build`·`dev` 가 사유 한 줄과 종료 코드 2 로 멈춘다.
- `primary`·`ledger` 원본이 없으면 오류(`E_SOURCE_MISSING`), `reference` 원본이 없으면 경고(`W_REFERENCE_MISSING`)다.
- `VIEWER_REPOS_DIR` 가 없으면 코드 원본은 오류가 아니라 경고(`W_CODE_UNVERIFIED`)로 집계한다.

### 볼트별로 달라도 되는 것

- 어느 프로젝트가 `viewer.yml` 을 갖는지와 그 내용, 근거 문서, 빌드 산출물(`outputs/viewer/`).
- `VIEWER_REPOS_DIR` 의 값.

### 볼트 뷰어 통합 보기

볼트 읽기 뷰어는 이 셸의 화면 컴포넌트를 자기 화면 안에 그린다(셸 README § 볼트 뷰어 통합 보기).
그쪽 확장 지점은 `projects/knowledge-viewer/config/README.md` § 확장 지점(해당 문서가 있는 볼트에서만).
