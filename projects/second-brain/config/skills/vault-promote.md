---
name: vault-promote
description: >
  팀/개인 repo 문서(또는 개인 KB 증류 노트)를 vault로 승격한다 — 재사용 개념을
  wiki로 추출하고 원문 스냅샷을 raw/에 표준 capture header로 보존한다.
  clipping ingest와 레인이 다른 별도 워크플로. 트리거: "/promote", "승격해줘".
origin: lemoncloud-io/knowledge@8480503:projects/second-brain/config/skills/vault-promote.md
---

# Vault Promote (repo 문서 → vault 승격)

`docs/vault-ingest-log.md` § Promotions에 기록되어 온 실행 관행(2026-07-29 첫 승격 이후)을
2026-08-14에 스킬로 명문화한 것이다. 스냅샷 헤더는 `docs/raw-layout.md` § repo-doc 스냅샷
표준을 따른다 — 그 이전 실행이 쓰던 자유 형식 헤더(`정본:`/`snapshot_at:` 평문)는 이
스킬로 대체된다(기존 스냅샷은 append-only라 그대로 둔다).

## 왜 승격하는가

승격의 산출물은 문서 사본이 아니라 **팀이 나중에도 읽을 수 있는 시점 고정본**이다.
2026-07-29 첫 실행 이후 § Promotions 원장에 쌓인 실행들이 보여준 효과는 네 가지다.

- **정본이 흔들려도 읽을 수 있다.** 근거 commit이 미머지 브랜치에 있는 경우가 반복됐고
  (eureka-flow PR #130, dou-app PR #418·#422), 머지 방식에 따라 그 sha는 남지 않는다.
  스냅샷 + 캐비앳 + 머지 후 확인 절차가 이 구멍을 닫는다 — 2026-08-12·2026-08-14 두 건이
  실제로 머지 후 sha 유지를 확인하고 캐비앳을 걷었다.
- **승격 심사가 repo 문서의 게이트가 된다.** 2026-08-12 eureka-flow 승격은 레인의 정본이
  될 repo 문서가 아예 없다는 것을 드러내 ADR을 먼저 쓰게 만들었다. 2026-08-14 dou-app
  승격은 올리기 전에 계약과 코드를 대조하다 코드가 문서보다 앞선 지점을 찾아냈다.
- **repo 경계를 넘는 대조가 가능해진다.** dou-app 레인의 구현 대조표가 chatic-socials-api
  스펙 R7의 `lastChat` 미구현을 드러냈다. 각 repo 안에만 있었으면 만나지 않는 두 문서다.
- **탈락 판정이 축적된다.** 실행 저널(PLAN 류), `.gitignore`된 작성자 로컬 문서, 내용이
  같은 다른 판 — 같은 사유가 반복 적용되면서 다음 승격의 판단 비용이 내려갔다. 그래서
  탈락도 사유와 함께 기록한다.

효과가 없는 승격도 있다. 재사용 개념을 억지로 뽑으면 오히려 손해다 — § 절차 4단계 참고.

## 언제 사용하는가

- repo의 설계/스펙/가이드 문서가 재사용 가능한 개념을 담게 되었을 때
- 개인 KB에서 증류한 노트를 팀 vault로 올릴 때 (레인 README `canonical: kb-distilled`)
- clipping(URL 원문)이 아니라 repo 좌표를 가진 원문을 provenance로 보존해야 할 때

clipping 처리는 `vault-ingest-claude`/`vault-ingest`가 담당한다 — 섞지 않는다.

## 절차

1. **읽기**: `VAULT_RULES.md`, `docs/raw-layout.md`, `docs/github-linked-projects.md`
   § Lanes, `wiki/INDEX.md`. 대상 repo가 `projects/@<org>/<folder>/`에 등록되어 있는지
   확인한다 (없으면 `github-project-link` 먼저).
2. **대상 선정**: 승격은 문서 단위로 판단한다.
   - 대상: 재사용 개념을 담은 설계/스펙/가이드/ADR. 정본 commit(sha)을 특정할 수 있어야 한다.
   - 탈락: 실행 저널(PLAN 류 — 프로젝트 로컬), `.gitignore`된 작성자 로컬 문서, 내용이 같은
     다른 판(스냅샷 1부면 provenance 성립). 탈락도 log에 사유와 함께 기록한다.
   - **대상을 자동으로 고르지 않는다.** 올릴 문서가 지정되지 않았으면 후보를 나열하고
     사용자 선택을 기다린다 — 나열까지가 자동의 상한이다. 승격은 팀 전체가 읽는 층에
     쓰는 행위라 무엇을 올릴지는 사람이 정한다.
3. **스냅샷 보존**: `raw/<project>-<doc-slug>-<short-commit>.md`. 본문은 원문 그대로,
   맨 위에 capture header(YAML frontmatter)만 붙인다 (`docs/raw-layout.md` § repo-doc 스냅샷):

   ```yaml
   ---
   title: "<사람이 읽는 제목>"
   source: "<org/repo> — <repo 내 경로>"
   commit: "<short-hash>"
   branch: "<branch>"
   captured: YYYY-MM-DD
   author: <캡처한 사람>
   note: "<캡처 맥락. 본문 무수정 명시. 미머지 브랜치면 그 사실>"
   ---
   ```

   - 정본이 repo 문서가 아니라 개인 KB 증류 노트면: `source:`에
     `"개인 KB 증류 노트 <slug> (근거: <org/repo>@<commit>)"` 형식으로 적고, `commit:`에는
     근거 commit을, `branch:`에는 그 근거 repo의 **기본 브랜치**를 둔다 (증류 노트 자체는
     어떤 브랜치에도 도달하지 않으므로 근거 커밋 쪽 좌표를 쓴다 — 6단계 레인의
     `source_branch:`와 같은 값).
   - 같은 문서의 갱신판은 기존 스냅샷을 **대체하지 않고 새 파일로 추가**한다
     (append-only — 예: `…-4029414.md` 옆에 `…-1e12b7e.md`).
4. **배치 판정 — 무엇을 만들지 먼저 정한다.** 정본은 `VAULT_RULES.md` § Core Rules:
   *"Keep project execution context in `projects/`; move reusable concepts to `wiki/`."*

   | 이 내용은 | 어디로 |
   |---|---|
   | 원문 | `raw/` — 항상 (3단계). 예외: § 원문 복제 불가 델타 |
   | 계약·규칙·구현별 준수 상태·repo 파일 경로·후속 목록 | 프로젝트 레인 (6단계) |
   | repo 이름을 지워도 다른 팀이 읽을 수 있는 개념·함정 | `wiki/` (5단계) |

   **기본값은 레인이다.** 승격 대상이 repo 문서인 이상 대개 그 repo의 실행 컨텍스트이고,
   **wiki 0건이 정상 결과다** — 억지 추출 금지. 그리고 **한 내용을 wiki와 레인으로
   쪼개지 않는다**: 계약의 절반이 wiki에 절반이 레인에 있으면 읽는 사람이 한쪽만 본다.
   애매하면 레인 하나로 둔다. (2026-08-10 dou-app 실측 — wiki부터 쓴 배치를 두 번 되돌렸고,
   개념 층에만 있던 서술은 레인 README의 `### 왜 이 모양인가`로 접어 유실 없이 끝났다.)

   배치 판정과 그 근거는 7단계 run-log에 남긴다.
5. **개념 추출** (배치 판정이 `wiki/`를 지목했을 때만): 문서당 재사용 개념 **0~2건** 원칙.
   제품/실행 특정 내용은 wiki로 올리지 않는다. 기존 wiki 노트가 이미 다루면 새 노트 대신
   그 노트를 갱신하고, 신규 노트는 기존 노트와 상호 링크한다. 미검증/시효성 주장은
   `needs-update`로 표시한다. wiki `sources`는 `"raw/<snapshot-file>.md"` 문자열로 기록한다
   (원문 복제 불가 시 § 원문 복제 불가 델타의 자유 서술 문자열).
   - **색인 갱신**: wiki 노트를 만들었으면 `wiki/INDEX.md`와 해당 `wiki/topics/`를 같은
     커밋에서 갱신한다.
   - **철회 시 전량 롤백**: 뽑았던 wiki 노트를 도로 접기로 했으면 위 두 색인과 프로젝트
     노트의 `## Related Wiki` 행을 **전부** 되돌린다. 확인은
     `grep -rn "<slug>" . --include="*.md"`의 잔여를 읽고 판정한다 — run-log의 철회 기록,
     이번 실행 raw 스냅샷, 유지한 레인 본문의 개념어는 정상이고, `wiki/INDEX.md`·
     `wiki/topics/`·`## Related Wiki`에 남은 링크는 실패다.
6. **레인 기록**: 승격 실행 상태·정본 관계는 `projects/@<org>/<repo>/<lane>/README.md`에
   둔다 (`docs/github-linked-projects.md` § Lanes — 정본이 repo면 `canonical: repo`,
   KB 증류면 `canonical: kb-distilled`).
7. **log/memory**: 이번 실행을 `outputs/runs/YYYY-MM-DD-promotion-<author-slug>.md`에
   run-log 노트로 작성한다(`templates/run-log.md`, `kind: promotion`, frontmatter `summary`
   ≤ 200 bytes — 처리 대상, 배치 판정과 근거, 탈락과 사유는 본문에). 동결된
   `docs/vault-ingest-log.md`에는 append하지 않는다. `wiki/VAULT_MEMORY.md`는 건드리지 않는다
   (2026-09-03부터 `Last Promotion`·`Volume to date` 줄 없음 — run-log와 `vault_volume.py`로 유추). 끝나면
   `python3 projects/second-brain/config/scripts/vault_verify.py --lane promote --base "$(git merge-base HEAD master)"`가 exit 0인지 확인한다.
8. **PR**: `master` 기준 `ingest/<YYYY-MM-DD>-<author-slug>-promote` 브랜치(같은 날 2회째부터
   `-2` suffix). author-slug 결정과 커밋/push/PR 오픈 절차, 금지 사항은
   `vault-ingest-claude.md` § GitHub PR 워크플로우를 그대로 따른다 (리뷰어:
   `team-settings.yaml`의 `github.default_reviewer`). PR merge는 사용자 승인 없이 하지 않는다.

## KB 증류 노트 델타

정본이 repo 문서가 아니라 개인 KB의 증류 노트일 때만 위 절차에 추가로 적용한다.
스냅샷 `source:` 표기는 3단계에 있다.

- **자격**: 노트 상태가 `adopted`인 것만 올린다. 증류 노트는 어떤 repo 브랜치에도 도달하지
  않으므로 "기본 브랜치 도달" 판정은 문서가 아니라 **본문이 인용한 증거 커밋**으로 한다.
  팀이 근거를 검증할 수 있어야 하므로 org repo에서 나온 노트만 대상이다.
- **스냅샷 1행 예외** — 원문 무수정 원칙에서 이것 하나만 예외이고, 이 이상 넓히지 않는다.
  증류 노트의 `## Provenance`에는 팀이 열 수 없는 개인층 경로가 들어 있다. 그 행을 지우고
  출처를 `- repo: <org>/<repo>@<sha>` **1행으로** 남긴다. 노트 형식이 둘이라 처리가 갈리지만
  결과는 어느 쪽이든 `- repo:` 행 1개다.
  - sha 없는 `- repo:` 행이 이미 있으면 그 행에 `@<sha>`를 붙이고 경로 행만 지운다.
    행을 새로 추가하면 같은 뜻의 행이 둘 남는다.
  - `- repo:` 행이 없으면 경로 행 자체를 `- repo: <org>/<repo>@<sha>`로 교체한다.

  **그 외 본문은 무수정** — 윤문·재구성 금지. sha는 본문이 인용한 증거 커밋 중 해결 또는
  배포 커밋 하나다. 이 정제는 승격하는 노트 1건에만 적용하고, 다른 노트를 소급해 일괄
  정제하지 않는다.
- **레인 frontmatter**: `canonical: kb-distilled`, `source_path:` 생략(repo에 대응 문서가
  없다), `source_commit:` = 위 증거 커밋, `source_branch:` = 그 repo의 기본 브랜치.

## 원문 복제 불가 델타 (개념만 승격)

**비공개는 면제 사유가 아니다.** raw 스냅샷은 링크가 아니라 사본이라 저장소가 비공개여도 뜰 수
있고, 공개 전환도 답이 아니다 — 정본이 움직이면 링크는 끊기고 스냅샷만 남는다(2026-08-18 PR #137,
비공개 개인 repo의 산문 문서 5건을 표준 header로 스냅샷). 이 델타는 **원문 자체를 vault에
복제할 수 없을 때만** 적용한다: 원 구현이 코드·스크립트라 산문 원문이 없거나(2026-08-15
`session-outcome-distillation`·`knowledge-consumption-gate` — 두 노트의 `sources` 사유는 2026-08-18에
이 조항에 맞게 정정, run-log는 도입 전이라 없음), 개인 데이터·라이선스가 복제를 막을 때.

- **raw 스냅샷 면제**: 3단계 스냅샷을 만들지 않는 대신 wiki `sources`에 자유 서술 문자열
  1행 이상 — 출처 종류·기준일·"raw 스냅샷 없이 개념만 옮긴다"와 **복제 불가 사유**를 명기한다
  (VAULT_RULES § Note Contracts가 non-note artifact를 문자열로 허용). 공개 원 출처가 있으면
  URL을 별도 행으로 추가한다.
- **배치는 wiki만**: 레인에 올릴 계약·준수 상태가 없으므로 레인 0이 정상. 개념이 wiki 요건
  ("다른 팀이 읽을 수 있는가")을 통과하지 못하면 승격하지 않는다.
- **본문에 저장소 내부 식별자를 남기지 않는다** (스킬명·파일 경로·내부 도구명). raw가 없으니
  실측 수치는 `needs-update`로 표시한다.
- **검증 예외**: 아래 § 검증의 스냅샷 2항목과 `sources` 형식 항목은 "복제 불가 사유가 run-log
  Details에 적혔는가"로 대체한다.

## 검증 (완료 보고 전)

- 스냅샷 파일이 capture header 표준을 따르는지 (YAML frontmatter + 7키)
- 본문이 정본과 동일한지 (헤더 제외 diff 없음 — KB 증류 노트는 § KB 증류 노트 델타의
  `- repo:` 1행만 예외)
- wiki `sources`가 `"raw/<file>.md"` 문자열인지 (원문 복제 불가 델타 적용 시 면제 — 사유가 run-log에 있는지)
- wiki 노트를 만들었으면 `wiki/INDEX.md`·`wiki/topics/`가 같이 갱신됐는지, 철회했으면
  두 색인과 `## Related Wiki`에 잔여 링크가 없는지
- run-log 노트 생성(`kind: promotion`, `summary` ≤ 200 bytes)
- 공유 불변식(memory 크기, 기존 raw/·archive/ 수정·rename·삭제 없음, frontmatter 파싱, 레인 흔적 = `kind: promotion` run-log가 diff에 있음)은
  `python3 projects/second-brain/config/scripts/vault_verify.py --lane promote --base "$(git merge-base HEAD master)"`가 exit 0인지로 판정한다

## 금지 사항

- 기존 raw/ 스냅샷의 수정·rename·삭제 (append-only — `docs/raw-layout.md`)
- 정본이 repo인 문서를 vault 사본에서 fork시키는 편집 (drift는 재승격으로 해소)
- 외부 repo에 원격 쓰기 (`docs/github-linked-projects.md` § Write Boundaries)
- 개인 실험 데이터·로컬 절대경로 커밋 (`VAULT_RULES.md` § Core Rules)
- 승격 대상 자동 선택 — 후보 나열까지가 자동의 상한이다 (2단계)
- master 직접 push, PR 자동 merge
