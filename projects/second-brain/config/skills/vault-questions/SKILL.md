---
name: vault-questions
description: >
  위키 노트의 `## Open Questions` 글머리를 큐로 모아 보고, 에이전트가 닫을 수 있는 것을 한 회차로 정리하고,
  소유자만 답할 수 있는 것을 묶어 묻는다. 사용자가 "열린 질문 보여줘", "미해결 질문 정리해줘",
  "Open Questions 정리 회차", "소유자 질문 묶음 만들어줘", "stale 후보 보여줘", "/vault-questions"라고 할 때,
  그리고 vault-lint의 열린 질문 점검 단계에서 사용한다. 노트 절이 정본이고 큐는 파생이라 큐를 커밋하지 않는다.
origin: lemoncloud-io/knowledge@f68f1d38:projects/second-brain/config/skills/vault-questions/SKILL.md
---

# vault-questions (열린 질문 큐 — 보기 · 정리 회차 · 소유자 묻기)

위키 노트마다 `## Open Questions`가 있다. ingest 때 생기고 거의 닫히지 않는다(2026-10-27 실측: 864개, 노트를
만들 때의 문장 90%가 그대로). 이 스킬은 Vault Cockpit 패턴(모델이 쓰고 사람이 정한다)을 이 볼트의 PR 경계 위에
얹은 것이다. 근거와 설계: `projects/second-brain/outputs/2026-10-27-vault-cockpit-adoption-plan.md`,
`wiki/vault-cockpit.md`(둘 다 해당 문서가 있는 볼트에서만).

도구는 `projects/second-brain/config/scripts/vault_open_questions.py` 하나다(의존성 없음, Python 3). 볼트 루트에서
실행한다. 명령과 유형(A~E)의 뜻은 스크립트 첫머리 docstring이 정본이다.

## 원칙

- **노트 절이 정본이다.** 큐 파일·목록 페이지를 만들지 않는다. 필요할 때 명령으로 뽑는다(허브에 살아 있는
  집계 금지, `VAULT_RULES.md` § Live tallies).
- **에이전트는 제안하고 소유자가 닫는다.** 쓰기 단위는 PR 하나다. 브랜치 + `vault_verify` + 소유자 리뷰가
  Vault Cockpit의 트랜잭션·일괄 판정 자리를 맡는다. master에 직접 쓰지 않는다.
- **유형은 문구 규칙이다.** 2026-10-27 표본 40건에서 사람 분류와 29건(72.5%) 일치했다. 값 판단(C)을 덜 잡고
  열린 연구(E)로 많이 보낸다. 그래서 `ask`와 `batch` 결과는 사람이 읽고 고른 뒤에 쓴다.

## 1. 보기

```bash
python3 projects/second-brain/config/scripts/vault_open_questions.py summary
python3 projects/second-brain/config/scripts/vault_open_questions.py list --kind C,E --limit 30
```

`summary`는 `라벨: N` 줄로 낸다. vault-lint 보고서의 `## Open Questions` 절에 그대로 옮긴다.

## 2. 정리 회차 (에이전트 — 유형 A·B)

1. master에서 브랜치 `maintenance/<YYYY-MM-DD>-open-questions-<작업자>`를 만든다.
2. `batch --kind A,B --limit 50`으로 작업 목록을 뽑는다. 노트 생성일이 오래된 것부터 나온다.
3. 질문마다 1차 출처를 직접 읽거나 실측한다. 판정은 셋 중 하나다.
   - **해소** — 답을 노트 본문(Details 등 맞는 절)에 출처와 함께 넣고 `## Open Questions`에서 그 글머리를 지운다.
     출처는 `sources`에 더한다(raw 경로 문자열·URL). 답이 질문과 다르면(질문의 전제가 틀렸으면) 그렇게 적는다.
   - **stale 제안** — 글머리는 두고 run-log 표에 이유를 적는다. 닫기는 소유자가 PR 리뷰에서 정한다.
   - **유지** — 손대지 않는다. 확인한 것이 있으면 run-log에만 적는다.
   한 글머리를 고쳐 쓰는 것은 "닫힘 1 + 새로 1"이 된다. 부분 해소는 해소된 부분을 본문으로 옮기고 남은 질문만
   새 글머리로 쓴다.
4. run-log `outputs/runs/<YYYY-MM-DD>-maintenance-open-questions-<작업자>.md`(`templates/run-log.md`,
   `kind: maintenance`)에 표를 쓴다. 열: id · 노트 · 판정 · 근거. **지운 글머리의 id가 모두 있어야 한다.**
5. 검사:
   ```bash
   python3 projects/second-brain/config/scripts/vault_open_questions.py diff --base master \
     --log outputs/runs/<run-log 파일>
   python3 projects/second-brain/config/scripts/vault_verify.py --base "$(git merge-base HEAD master)"
   ```
   `diff`는 run-log에 없는 닫힘이 있으면 exit 1이다. `vault_verify`에는 maintenance 레인이 없어 레인 없이
   돌린다 — 이 회차의 기록 검사는 `diff --log`가 맡는다.
6. PR 본문에 `diff` 첫 줄(닫힘 · 새로 생김 · 순변화)과 stale 제안 목록을 넣는다. 소유자가 stale 제안을
   승인하면 같은 PR에서 그 글머리를 지우고 run-log 판정을 "stale — 소유자 승인"으로 바꾼다.

서브 에이전트에 나눠 맡길 때: 조사·초안만 맡긴다. git·gh와 노트 편집 반영은 코디네이터가 한다. 서브 에이전트의
"해소" 판정은 코디네이터가 근거 URL·파일을 직접 열어 확인한 뒤에만 반영한다.

## 3. 소유자 묻기 (유형 C, E 중 값 판단)

1. `ask --kind C,E --limit 40`에서 소유자만 답할 수 있는 질문 10개를 고른다(E에 값 판단이 섞여 있다).
2. 질문마다 근거와 **권고 기본값**을 붙여 한 메시지로 묻는다. 설계 안에서 답이 나오는 질문은 묻지 않고 직접 정한다.
3. 답을 받으면 정리 회차와 같은 PR 경계로 반영한다. PR 본문 `## 소유자 답(원문)` 절에 답을 그대로 옮기고,
   노트 `sources`에 그 PR URL을 넣는다. 답한 질문의 글머리는 지우고 run-log 표에 "해소 — 소유자 답"으로 적는다.

## 4. stale 후보 (유형 D)

```bash
python3 projects/second-brain/config/scripts/vault_open_questions.py stale --months 6
```

기록 날짜가 6개월 넘은 조직 기록 질문이다(2026-10-27 계획안의 권고 기본값, 소유자가 바꿀 수 있다). 정리 회차 PR에 "stale 제안"으로 싣는다.
닫기는 소유자 판정이다.

## 하지 않는 것

- 큐·목록 페이지를 커밋하지 않는다.
- 소유자 판정 없이 stale·값 판단 질문을 지우지 않는다.
- `raw/`·`archive/`를 고치지 않는다. 소유자 답 원문을 `raw/`에 두지 않는다(계약 밖 — PR 본문에 둔다).
- 근거 없이 "해소"로 판정하지 않는다. 출처를 열지 않은 서브 에이전트 보고만으로 지우지 않는다.
