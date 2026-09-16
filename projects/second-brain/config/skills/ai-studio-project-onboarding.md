---
name: ai-studio-project-onboarding
description: >
  Google AI Studio(또는 유사 웹 IDE)에서 export한 앱을 로컬 git 정착 → vault 등록 →
  코드 분석 → 로컬 개발 계획까지 온보딩할 때 사용한다. "AI Studio 앱을 로컬 개발로
  온보딩해줘", "수출본을 git/vault에 정착시켜줘" 류 요청, 또는 repo에 metadata.json·
  patch*.cjs·react-example 패키지명 같은 AI Studio 흔적이 보일 때 트리거.
origin: lemoncloud-io/knowledge@42c8dece:projects/second-brain/config/skills/ai-studio-project-onboarding.md
---

# AI Studio Project Onboarding

AI Studio 수출 앱을 로컬 개발 체제로 정착시키는 절차. ai-photo-manager 온보딩
(2026-08-07, 9세션 실행 기록)에서 일반화했다. 규칙 진실원: `VAULT_RULES.md`
§ GitHub-Linked Projects. vault 등록 자체는 `github-project-link` 스킬이 소관이며
이 스킬은 그것을 서브 절차로 호출한다.

## 언제 사용하는가

- 사용자가 AI Studio(웹 IDE) 수출 앱의 로컬 온보딩을 요청할 때
- 수출본 흔적이 있는 신규 폴더/repo를 개발 가능한 상태로 만들 때

사용하지 않는 경우: 이미 온보딩된 프로젝트의 후속 개발(각 프로젝트 README의
next_action을 따른다), 일반 GitHub repo 등록만 필요한 경우(`github-project-link` 단독).

## 전제 조건

- `gh auth status` 인증 완료 — 없으면 중단·보고 (조용한 fallback 금지)
- `GITHUB_DIR`: 환경변수 우선, 미설정 시 `~/Documents`
- graphify 설치 (`graphify --version`; 없으면 `projects/graphify/config/tools/verify_graphify.sh`)
- vault 루트 확인 (`VAULT_RULES.md` 존재; 확신 없으면 사용자에게 확인)

## 사용자 확인 필수 지점 (자동화해도 유지)

1. **push 승인** — 공개 repo면 push = 코드 공개임을 명시하고 승인받는다
2. **goal 문구 확정** — github-project-link 필수 게이트
3. **의존성 제거 결정** — 미사용 dep(특히 `@google/genai`) 제거 여부

## Phase 1 — 코드 정착 (git)

1. **상태 진단** (이 순서로 확인해야 분기점이 드러난다):
   - `gh repo view <owner>/<repo> --json defaultBranchRef,isPrivate` —
     `defaultBranchRef.name`이 **빈 문자열이면 빈 repo** (AI Studio는 repo를 만들되
     push하지 않는 경우가 있다).
   - 로컬 폴더 `$GITHUB_DIR/<owner>/<repo>` — **폴더가 있어도 자체 git repo가 아닐 수
     있다**: `git -C <폴더> remote -v`가 엉뚱한 repo(예: 홈 dotfiles repo)를 가리키면
     미초기화 상태다. `git status`만으로는 이 함정을 못 잡는다.
   - 공개/비공개 확인 — 공개면 사용자 확인 지점 1 발동.
2. **비밀정보 스캔** (push 전 필수):
   - `.env*` 존재·gitignore 커버 확인 (수출본은 보통 `.env*` ignore + `.env.example`만 추적)
   - `grep -rniE "AIza[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}" src/ *.ts` 류 키 패턴 스캔
   - `.env.example`이 placeholder만 담는지 육안 확인. 실키 발견 시 즉시 중단·보고.
3. **git 정착** (승인 후): `git init -b main` → `remote add origin` → commit →
   `push -u origin main`. 빈 원격이면 이 push의 `main`이 기본 브랜치가 된다.
   **원격에 기존 커밋이 있으면** 히스토리 전략(merge/rebase/로컬 우선)을 임의로
   정하지 말고 diff 요약과 함께 사용자에게 확인한다 — force push 금지.

## Phase 2 — vault 등록

`github-project-link` 스킬 그대로: goal 초안 → **사용자 확인(지점 2)** →
`projects/@<owner>/<repo>/README.md` (`templates/project-readme-github.md`, 개인 계정은
`scope: personal`) → org 인덱스 갱신. **개인 owner가 gitignore된 로컬 전용이면 메인
인덱스에 올리지 않고 커밋/PR도 없다.** 프로젝트 노트는 `wiki/INDEX.md` 대상이 아니다.

## Phase 3 — 코드 분석 (graphify + 코드 리딩)

1. `graphify-extract` 스킬: `.graphifyignore` 정비 → `graphify extract . --code-only`
   → `graphify cluster-only .` (GRAPH_REPORT.md 생성). 산출물은 기본 untracked —
   단, **본인 소유 repo에서 추적 여부는 소유자 선택**이다.
2. `graphify-query` 스킬: 진입점 심볼(예: `App`)로 질의 — 허브·커뮤니티 경계 파악.
   그래프만 믿지 말고 원본 파일을 읽어 확정한다.
3. **AI Studio 잔재 체크리스트** (항목별 실측 후 처분 판정):

   | 항목 | 확인 | 처분 |
   | --- | --- | --- |
   | `patch*.cjs` / `patch*.js` | AI Studio 에이전트의 일회성 codemod 잔재 | 삭제 |
   | `README.md` | AI Studio 보일러플레이트 | 전면 재작성 |
   | `index.html` `<title>` | "My Google AI Studio App" 류 기본값 | 교체 |
   | `package.json` `name` | "react-example" 류 기본값 | 교체 |
   | 미사용 의존성 | `metadata.json`이 capability를 선언해도 실제 import가 없을 수 있다 — `grep -rn "genai" src/ server.ts`로 **실측** | 사용자 결정(지점 3) |
   | `.env.example` 미사용 키 | GEMINI_API_KEY 등 | dep 결정에 연동 |
   | `metadata.json` | AI Studio 앱 링크 정보 | **보존** (재수출/연동용) |
   | `vite.config.ts` `DISABLE_HMR` 분기 | AI Studio 전용, 로컬 무해 | 보존 |
   | 포트 하드코딩 | 샌드박스 제약(:3000 등) 주석 확인 | 문서화 |

## Phase 4 — 로컬 개발 계획 수립

superpowers:writing-plans 형식으로 프로젝트 `outputs/`에 저장. 표준 태스크 골격:

1. **기준선 검증** — install / lint / dev 기동 / **브라우저 실렌더** / prod 빌드.
   코드 무변경. 브라우저 게이트는 생략 불가 — Node 테스트 전부 통과 후 브라우저에서만
   드러나는 버그 전례(unbound fetch)가 있다.
2. **잔재 정리** — Phase 3 체크리스트 처분 실행, 회귀 확인 후 커밋.
2-1. **CLAUDE.md 작성** — Phase 3의 graphify 분석을 실측 기반으로 압축한 repo
   가이드: 빌드·테스트 명령(과 그 함정), 아키텍처 개요(모듈 경계·처음 읽을 순서),
   계약 SSOT 포인터, 지켜야 할 제약. 기계 절대경로 금지. 이게 없으면 이후 모든
   Claude 세션이 같은 탐색을 반복한다 (실측: 온보딩 산출물에서 빠져 후행 작업이 된
   전례).
3. **의존성 정리** — 미사용 dep 제거 (사용자 확인 지점 3).
4. **최소 테스트 하네스** — vitest(+supertest) 도입, TDD 진입점 마련.
5. **API 계약 정리** — MVP가 화면+목업 서버 구조라면 본격 개발 전에 반드시.
   프론트가 서버 구현 사정에 끌려가면 서버 교체가 프론트 재작성이 된다.
   산출물 3종 세트: ① `docs/api-spec.md`(엔드포인트·공통 규약·검증 규칙·에러
   카탈로그·현행 quirk 목록) ② DTO 타입 완결(타입 SSOT는 `src/api/dto.ts`)
   ③ 계약 테스트(목업 실행 기반 전 경로 검증). quirk는 고치지 말고 **실측 그대로
   문서화** — 실서버 연동 시 정합 확인 체크리스트가 된다. **계약 버전 숫자는
   api-spec.md 헤더가 유일한 표기처** — README·CLAUDE.md·보조 문서는 버전 숫자
   없이 문서를 가리키기만 한다 (사본은 반드시 낡는다; 실측: 사본 3건이 두 버전
   뒤까지 방치된 전례).
6. **서버리스 목업 클라이언트** — 계약(5) 확정 후. 원칙: fixture·검증 규칙은 서버와
   **공유 모듈**로(복제는 반드시 갈라진다), 실패 표면 동일(같은 에러 타입), 적합성
   스위트 1벌을 실HTTP·목업 두 러너로 실행. 완결 기준은 전환 스위치까지 — 단일 진입
   모듈이 env로 구현을 선택하고, 서버 없는 `dev:mock` 실행에서 **브라우저 API 네트워크
   요청 0건을 실측**으로 확인한다.

앱에 API 표면이 없으면(순수 프론트) 5·6은 스코프 아웃하고 사용자에게 알린다.

## Phase 5 — 기록

- 프로젝트 README: `## Status` 온보딩 결과, `## Sync Notes` graphify 규모, `next_action` 갱신
  (행위 한 건당 한 문자열, 두 건 이상이면 목록 — `docs/project-next-action.md`).
- 실행 로그(세션별 표)는 프로젝트 `outputs/`에 — 편차·교훈이 이 스킬의 개정 입력이 된다.

## 금지 사항

- push·goal·의존성 제거를 사용자 확인 없이 진행하지 않는다
- 실 API 키를 커밋·전송·기록하지 않는다 (발견 즉시 중단·보고)
- quirk를 임의로 "수정"하지 않는다 — 실측 문서화가 먼저다
- 검증 게이트에서 관측된 이상은 **재현 실험으로 원인을 확정한 뒤** 기록한다 —
  그럴듯한 첫 가설이 기록에 남으면 후속 작업이 엉뚱한 곳을 판다
- mock을 실서버보다 관대하게 두지 않는다 — 실서버 필수 규칙은 mock에 모사하고
  계약 문서에 호출 규약으로 명시한다 (관대한 mock은 UI 결함을 숨긴다)

## 트리거 예시

- "AI Studio에서 만든 앱 export했어, 로컬 개발로 온보딩해줘"
- "이 수출본 git이랑 vault에 정착시키고 개발 계획까지 세워줘"
- repo에서 `metadata.json` + `patch*.cjs` + "react-example" 패키지명 발견 시 이 스킬 제안
