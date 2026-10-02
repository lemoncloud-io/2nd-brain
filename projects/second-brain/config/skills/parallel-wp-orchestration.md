---
name: parallel-wp-orchestration
description: >
  여러 repo/모듈에 걸친 개발 작업을 서브 에이전트 병렬 WP(work package)로
  분해·실행·통합할 때 사용한다. 사용자가 "서브 에이전트 적극 활용", "최대한
  병렬로 나눠서", "무중단으로 끝까지" 류 지시를 할 때, 또는 독립적으로 진행
  가능한 작업이 2개 이상일 때 트리거. 단일 repo 단일 작업에는 과하다.
origin: lemoncloud-io/knowledge@11357973:projects/second-brain/config/skills/parallel-wp-orchestration.md
---

# Parallel WP Orchestration (병렬 작업 패키지 운영)

photo-catalog 서버 분리(WP 7개)·색인 동기화(WP 2개×2라운드) 실행에서 검증된
절차를 일반화했다. 단일 repo 안에서는 Repo Coordinator가 계획·통합·git을 전담하고,
서브 에이전트는 구현만 한다. vault에서 외부 GitHub repo로 이어지는 작업은 Vault Coordinator와
repo별 Repo Coordinator를 분리한다.

## 언제 사용하는가

- 작업이 repo·모듈 경계로 독립 분해되고 사용자가 병렬 진행을 지시했을 때
- 같은 계약(on-disk 포맷·HTTP API)을 두 구현이 공유하는 변경일 때 특히 유효

사용하지 않는 경우: 순차 의존이 강한 작업(분해해도 대기만 늘어남), 단일 파일
수준의 소규모 수정.

## 실행 root와 Coordinator 경계

vault 세션이 요청의 진입점이고 제품 코드가 외부 GitHub repo에 속할 때의 경계는 아래 5개
규칙이 정본이다. 그 볼트에 `projects/devops/docs/backend-harness-repository-boundary.md`가
**있으면** 그 문서가 아래를 대체한다 — 조직별 개발 환경 규약이 더 구체적이기 때문이다.
없으면 아래를 그대로 따르고, 없다는 이유로 다른 규약을 추측하지 않는다.

1. **Vault Coordinator**는 project registry를 해석하고 spec·plan·repo 간 contract·dependency Wave를 동결한다.
2. **Repo Coordinator**는 대상 repo를 cwd로 하는 별도 세션에서 WP·worker worktree·harvest·repo gate·local commit을 소유한다.
3. vault 세션에서 제품 구현 subagent를 `isolation: worktree`로 직접 호출하지 않는다. 격리는 호출 세션이 속한
   **볼트 repo**에 생길 수 있다.
4. 여러 repo 작업은 repo마다 별도 Repo Coordinator·branch·base SHA·handoff·result packet을 둔다.
5. 한 worker와 한 WP는 repo 하나만 소유한다. cross-repo contract는 vault가 동결하고 repo 사이 파일 복사로 조율하지 않는다.

이 스킬에서 이하의 “코디네이터”는 별도 표시가 없으면 **현재 대상 repo의 Repo Coordinator**를 뜻한다.

## WP 분해 규칙

1. **소유 경로 기준으로 나눈다** — 원칙적으로 repo 단위. 같은 repo를 둘로
   나눠야 하면 디렉터리가 겹치지 않게 하고, 겹치면 병렬을 포기하거나 격리
   worktree를 쓴다.
2. 모든 WP 프롬프트에 명시: **"소유 경로 밖은 검사만, 수정 금지"** +
   **"git commit/push 금지 — 워킹트리에만 남겨라"**.
3. **공유 계약은 코디네이터가 먼저 동결**해 각 프롬프트에 **같은 사양을 글자
   단위로 복사**해 넣는다 (필드명·타입·스탬프 시점·경계 조건까지). 에이전트 간
   조율은 불가능하므로 계약 판단은 코디네이터로 병목을 의도적으로 만든다 —
   "애매하면 구현 말고 보고" 지시 포함.
4. 프롬프트는 self-contained로: 배경, 설계(판단 여지 없이), 테스트 요구,
   완료 기준, **보고에 포함할 항목**(변경 파일, 수치, 설계 이탈과 근거).
5. **진행 중인 다른 세션/작업 목록을 알려준다** — 모르면 에이전트가 이미
   진행 중인 이슈를 후속 작업으로 중복 등록한다 (실측 사례 있음).
6. repo handoff의 `repo`, `base_sha`, `spec_path`, `spec_digest`, `owned_paths`, `approval`을 모든 WP가
   동일하게 받는다. digest가 다르면 launch하지 않는다.

## 모델 차등 배정

| 작업 성격 | 모델 |
|---|---|
| 문서·분석·정리 (판단 적음) | sonnet |
| 기능 구현·설계 판단 필요 | opus |
| 계획 수립·리뷰·통합·E2E·git | 코디네이터 본인 |

초기 리스크 추정 기반이며 중간 보고에 따라 재조정 가능.

## 통합 절차 (에이전트 보고 수신 후, 순서 고정)

1. **diff를 직접 읽는다** — 보고서만 믿고 완료 선언하지 않는다. 문서 산출물도
   코드와 같은 밀도로 리뷰한다 (에이전트가 남긴 모순·낡은 서술을 코디네이터가
   정정한 실측 사례 있음).
2. **테스트를 직접 재실행하되 repo별로 순차 실행** — 두 repo의 테스트를 병렬로
   돌리면 포트·리소스 충돌로 가짜 실패가 난다 (실측: HTTP 적합성 스위트 충돌).
   빌드 잔재 정리 스크립트(clean)가 있으면 먼저.
3. 같은 계약의 이중 구현이면 **양쪽 직렬화/의미론을 글자 단위로 대조**한다.
4. **실환경 E2E 실측** — 브라우저·실서버·실데이터로 최종 확인하고 증빙(스크린샷,
   응답 JSON)을 남긴다.
5. 그 후에야 커밋 → push → PR. 커밋·브랜치·PR은 전 과정 코디네이터 전담.
6. repo별 commit·gate·finding·divergence를 result packet으로 Vault Coordinator에 반환한다. vault에는 코드를
   복제하지 않고 stable pointer와 지식화할 사실만 남긴다.

## "무중단" 지시의 해석

사용자가 "무중단으로 완결", "커밋/PR까지"를 명시했으면 중간 재승인을 구하지
않고 PR 생성까지 간다. 단: **머지는 항상 사용자**, force-push·main 직접 커밋·
파괴적 액션은 무중단 범위에 포함되지 않는다. 팀 repo는 PR, 개인 repo는
사용자의 기존 선호를 따른다(모르면 PR이 안전한 기본값).

## 금지 사항

- 서브 에이전트에게 git 커밋·push·PR을 시키지 않는다
- 에이전트 보고의 테스트 수치를 재실행 없이 최종 보고에 옮기지 않는다
- 공유 계약 사양을 "각자 알아서 해석"으로 넘기지 않는다
- 병렬성을 위해 같은 파일을 두 WP에 배정하지 않는다
- vault Git root에서 외부 repo 제품 구현 worker를 직접 실행하지 않는다
- 한 worker·worktree·commit에 두 repo의 변경을 섞지 않는다

## 트리거 예시

- "서브 에이전트 적극 활용해서 최대한 병렬로 작업 분리 후 시작해"
- "이번에도 병렬 WP로 진행해"
- "처음부터 끝까지 계획하고 자동 실행/검증하고 PR까지 무중단으로 완결시켜"
