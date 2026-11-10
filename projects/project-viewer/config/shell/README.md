# project-viewer 셸
<!-- origin: lemoncloud-io/knowledge@f68f1d38:projects/project-viewer/config/shell/README.md -->

`viewer.yml` 하나로 읽기 전용 리뷰 뷰어(단일 HTML)를 빌드하는 공용 셸이다. 프로젝트는
React 코드를 쓰지 않는다. 설계 배경은 `../../docs/design.md`, 필드 정의는
`../../docs/schema.md`.

## 구조

| 디렉터리 | 책임 |
| --- | --- |
| `model/` | `viewer.yml`·`status.yml` 파싱, 스키마 검증, 근거 참조 해소, 상태 규칙, 원문 충실도 검사(`fidelity.ts`). React·Vite 없이 도는 순수 함수와 `check` |
| `loader/` | 볼트 루트 탐색, 원본을 빌드 때 읽어 가상 모듈(`virtual:viewer-bundle`)로 주입, 빌드 스탬프 생성 |
| `src/reader/` | md 렌더, 내비게이터, 목차, 링크 해석 |
| `src/blocks/` | 블록 8종 렌더와 근거 패널 |
| `src/app/` | 해시 라우터, 상단 메뉴, 검색, 하단 스탬프, 테마, 해설 글의 참조 토큰 → 링크·미리보기(`refs.ts`·`inline.tsx`) |
| `src/styles/` | CSS(토큰·기본·레이아웃·리더·블록) |
| `tests/` | `node --test` 케이스(`model/` `loader/` `ui/` `fixtures/`) |
| `cli.ts` | `check`·`build`·`dev` 명령 진입점 |
| `src/embed/`·`loader/embed-*.ts`·`loader/scope-css.ts` | 볼트 뷰어 통합 보기의 주입 지점(§ 볼트 뷰어 통합 보기). 단독 빌드는 부르지 않는다 |

## 명령

볼트 루트에서 실행한다. `<프로젝트 디렉터리>`는 `projects/<name>` 형태다.

```
node projects/project-viewer/config/shell/cli.ts check <프로젝트 디렉터리>   # viewer.yml 검사. 오류가 있으면 종료 코드 1
node projects/project-viewer/config/shell/cli.ts check <프로젝트 디렉터리> --fidelity   # 위 검사 + 원문 충실도 검사(선택 모드)
node projects/project-viewer/config/shell/cli.ts build <프로젝트 디렉터리>   # check 통과 뒤 단일 HTML 빌드
node projects/project-viewer/config/shell/cli.ts dev   <프로젝트 디렉터리>   # 개발 서버
```

환경 변수 `VIEWER_REPOS_DIR`이 있으면 그 아래 `<org>/<name>/`에서 저장소 코드 원본을 읽어
검증한다. 없으면 오류가 아니라 `W_CODE_UNVERIFIED` 경고로 집계한다.

`--fidelity`는 해설 문자열이 원본 문장에서만 왔는지 문장 단위로 검사한다(정규화·판정 규칙,
한계는 `../../docs/schema.md` § 충실도 검사 (선택 모드)가 정본). 플래그가 없으면 출력과 종료
코드는 지금과 바이트 단위로 같다.

## 테스트

이 디렉터리(`config/shell/`)에서:

```
npm ci             # 최초 1회
npm test           # node --test "tests/**/*.test.ts"
npm run typecheck  # tsc --noEmit
```

## 자기완결 의존성 원칙

셸은 다른 볼트로 복제될 수 있는 배포 후보다. 빌드·테스트에 필요한 모듈은 전부 이
`package.json`에 선언하고, 볼트 루트의 공용 모듈에 기대지 않는다. `zod`는 3 계열을 쓴다.
선언만 하고 쓰지 않는 의존성은 두지 않는다.

## 볼트 뷰어 통합 보기

볼트 뷰어(`projects/knowledge-viewer`)는 `viewer.yml` 을 열면 이 셸의 화면 컴포넌트를 iframe·빌드 산출물 없이 자기 화면 안에 그린다.
화면 코드(`App`·`blocks/`·`reader/`)는 복사하지 않고 그대로 import 한다 — 새 블록은 통합 보기에도 따라온다.
바깥과 닿는 자리만 바꿔 끼운다. 단독 빌드(`cli build`·`vite.config.ts`·`src/main.tsx`)는 아래 파일을 부르지 않으므로
산출물이 바뀌지 않는다(스탬프의 시각·커밋·dirty 를 뺀 sha256 대조).

| 파일 | 하는 일 |
| --- | --- |
| `src/embed/ProjectViewer.tsx` | 바깥 앱이 그리는 컴포넌트 `ProjectViewer({ bundle, host })`. 루트는 `<div class="pv-root pv-embed" data-theme>` |
| `src/embed/host.ts` | 주입 지점 `EmbedHost`: `readHash`·`writeHash`·`subscribe`(라우트), `docHref`·`openDoc`(원본 문서), `theme`(밝기). 루트 요소는 컴포넌트가 잰다 |
| `src/embed/bundle.ts`·`router.ts`·`useRoute.ts`·`theme.ts`·`mermaid.ts` | 원래 모듈(`virtual:viewer-bundle`·`app/router.ts`·`app/useRoute.ts`·`app/theme.ts`·`mermaid`)과 같은 이름을 내보내는 어댑터. 원본 문서 하나를 가리키는 `#/docs/<id>` 주소만 바깥 문서 주소가 되고, 스크롤은 창 대신 루트를 품은 스크롤 칸, 밝기는 바깥 앱 것, mermaid 는 늘 `strict` 로 그리고 설정을 되돌린다 |
| `loader/embed-redirects.ts` | 바꿔 끼우기 표(셸 화면 코드의 import 만, 어댑터 자신은 제외). 표의 원래 모듈이 값을 더하면 어댑터도 따라야 한다 — `tests/loader/embed.test.ts` 가 막는다 |
| `loader/embed-plugin.ts` | 바깥 앱 Vite 플러그인 `projectViewerEmbed({ hostCss })`: 바꿔 끼우기, 셸 라이브러리를 바깥 앱 한 벌로(`resolve.dedupe`), 셸 CSS 는 `.pv-root` 아래로(`scope-css.ts` `scopeCss`), 고른 바깥 CSS 는 `:not(.pv-root *)` 로(`excludeCss`). 런타임 import 는 node 내장뿐이다 |
| `loader/collect.ts` | `viewerText`·`readFile` 를 주면 디스크·볼트 루트 탐색 없이 묶는다(볼트 뷰어가 소스 리더 — local·git — 를 넘긴다). 없으면 지금처럼 디스크다 |

기본값은 지금 동작 그대로다(해시 라우트·`<html data-theme>`·창 스크롤·`#/docs/…` 셸 리더). 한 화면에 셸 하나만 그린다는 전제다 —
화면 코드가 데이터를 모듈 최상위에서 한 번 받기 때문이다(`src/bundle.ts`).

## 새 블록을 추가하는 절차

블록 어휘는 닫힌 집합이다(현재 8종: `graph` `tree` `sequence` `stages` `items` `table`
`mermaid` `prose`). 같은 필요가 두 프로젝트에서 나올 때만 늘린다. 한 프로젝트에만 필요한
내용은 블록을 늘리지 말고 원본 md로 돌려보낸다.

1. **types** — `model/types.ts`에 필드를 추가한다(공유 계약의 정본).
2. **schema** — `model/schema.ts`의 zod 스키마에 반영한다. 모르는 키는 여전히 오류여야
   한다.
3. **check** — `model/check.ts`에 필요한 검사 규칙(근거 필수, id 유일성 등)을 추가한다.
4. **블록 컴포넌트** — `src/blocks/`에 렌더러를 추가하고 `BlockView.tsx`에 연결한다.
5. **테스트** — `tests/model/`·`tests/ui/`에 실패 케이스 중심으로 테스트를 먼저 쓴다.
6. **스키마 문서** — `../../docs/schema.md`에 필드 표를 갱신한다.
