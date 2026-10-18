# 프로젝트 `review` 계약 — 검토 관문
<!-- origin: lemoncloud-io/knowledge@4e78a1cb:docs/project-review.md -->

`projects/<name>/README.md` frontmatter의 `review` · `review_since` · `review_gate` · `review_ref` 네 필드가
가질 수 있는 모양과, 그 상태에 들어가고 나오는 절차. 진입점 요약은 `VAULT_RULES.md` § Note Contracts
**Projects**, 필드 목록 자체는 `templates/project-readme.md`가 정본이다. `milestones`·`next_action` 계약과
같은 원칙을 따른다 — frontmatter는 **라벨과 상태**만, 근거는 본문과 `outputs/`로.

2026-10-15 제정. 계기는 한 프로젝트(codex-cmux-claude)의 준비물 PR(knowledge#685)이 사용자 검토가 끝나기 전에
`검토중` 라벨을 단 채 머지된 것이다. "검토용 준비물이지 확정 운영 규칙이 아니다"라는 표시는 `## Status`의 인용
블록 한 단락뿐이었다 — 사람은 읽지만 lint·base·스킬은 읽지 못하고, 검토 대기 프로젝트를 한 화면에 모을 수도
없었다. 라벨은 머지 뒤 볼트에 흔적이 남지 않는다.

## 두 축 — 생애주기와 검토 관문

| 축 | 필드 | 값 | 묻는 것 |
| --- | --- | --- | --- |
| 생애주기 | `status` | `active` · `paused` · `done` | 이 목표를 향해 일하고 있는가 |
| 검토 관문 | `review` | `pending` · `confirmed` (없으면 `confirmed`) | 이 문서들이 사용자 검토를 통과했는가 |

둘은 독립이다. `active`인 프로젝트가 `pending`일 수 있고(이번 사례), `paused`이면서 `confirmed`일 수 있다.
`status`에 값을 더하지 않는 이유 — 생애주기와 섞이면 `done → archive/` 같은 생애주기 규칙이 꼬이고, 기존
프로젝트 전부의 의미가 흔들린다. 레인 문서의 `status: draft | confirmed | executed`가 같은 뜻의 `confirmed`를
이미 쓰므로 어휘를 맞췄다. 레인에서 `spec_frozen` 날짜가 검토 통과 표시이듯, 프로젝트에서는 `review`가 그 역할이다.

## 필드

평면 필드 넷이다. 중첩 블록(`review: {state: …}`)이 아닌 이유 — Obsidian 속성 패널과 Bases가 중첩 맵을 읽지
못해 "검토 대기" 뷰가 성립하지 않고, 의존성 없는 lint 줄 스캐너가 복잡해진다.

| 필드 | 필수 | 값 |
| --- | --- | --- |
| `review` | 관문 상태를 표시할 때 | `pending` — 검토 통과 전에 머지됨 · `confirmed` — 통과함. **키가 없으면 `confirmed`로 본다** (기존 프로젝트 전부 영향 없음) |
| `review_since` | `pending`이면 필수 | 검토 미완인 채 머지된 날, `"YYYY-MM-DD"` |
| `review_gate` | `pending`이면 필수 | **무엇이 되면 `confirmed`로 바꾸는가.** 한 줄, 300바이트 이하(UTF-8, 한글 약 100자). 관문 하나 — 둘 이상이면 본문으로 |
| `review_ref` | 선택 | 관문의 기준 문서, 프로젝트 기준 상대경로 (`docs/…`, `outputs/…`) |

```yaml
status: active
review: pending
review_since: "2026-10-15"
review_gate: "실볼트 V0~V9 1회 통과와 구성원별 R&R 확정"
review_ref: "docs/ccc-minimal-verification.md"
```

## 규칙

1. **들어가는 조건.** PR에 `검토중` 라벨이 붙은 채 머지되면, 그 PR이 바꾼 프로젝트 README에 `review: pending`을
   쓴다. 원칙은 머지 전에 그 PR 안에서 넣는 것이고, 이미 머지됐으면 후속 PR 하나로 넣는다. 라벨은 PR의 사실,
   `review`는 볼트의 사실이다 — 둘 다 있어야 한다.
2. **`pending`이면 `review_since`·`review_gate` 필수**, 그리고 `next_action` 첫 항목은 그 관문을 통과하는 행위다.
   관문이 곧 다음 할 일이고, 둘의 문구는 같은 행위를 가리킨다.
3. **나가는 조건.** `confirmed`로 바꾸는 PR은 증거를 가리킨다 — PR 본문과 `## Status`에 통과 근거(`outputs/`
   파일이나 PR 번호). 키를 지우지 않고 값만 바꿔 "한때 pending이었다"가 남게 한다. `review_since`·`review_gate`는
   그대로 둔다 — 무엇을 언제부터 기다렸는지의 기록이다.
4. **`status: done`은 `review: confirmed`일 때만.** 검토가 끝나지 않은 프로젝트는 닫지 못한다.
5. **가시성.** `projects/README.md` 인덱스의 상태 열을 `active · 검토중`으로 적고, `projects.base`의
   **검토 대기** 뷰(`review == "pending"`)에서 한 화면으로 본다. `confirmed`로 바꾸면 인덱스 표기도 되돌린다.
6. **`## Status` 인용 블록은 사람용 표시**로 유지하되 정본은 frontmatter다. 첫머리를 고정한다:
   `> **검토중 · 운영 사용 전 (YYYY-MM-DD):** …` 그리고 끝에 `관문(review_gate): … — 통과하면 review: confirmed`.

## 절차

**들어갈 때** — 머지 전이 원칙, 머지 뒤면 후속 PR.

1. 네 필드를 쓴다. `review_gate`는 `wc -c`로 300 이하를 확인한다.
2. `next_action` 맨 앞에 관문 통과 행위를 넣는다(`docs/project-next-action.md` 형식, 300바이트).
3. `## Status` 인용 블록 첫머리와 끝 문장을 § 규칙 6 형식으로.
4. `projects/README.md` 상태 열을 `active · 검토중`으로.
5. `python3 projects/second-brain/config/scripts/vault_verify.py --base origin/master`가 `review` defect 0.

**나갈 때** — 관문 통과를 확인한 PR에서.

1. `review: confirmed`. 나머지 세 필드는 그대로.
2. `## Status` 인용 블록을 걷고, 통과 근거 한 줄을 남긴다("2026-MM-DD 관문 통과 — outputs/… · knowledge#NNN").
3. `next_action`에서 관문 항목을 빼고, `projects/README.md` 상태 열을 `active`로.
4. 관문 통과가 마일스톤이면 해당 `milestones` 항목을 `done: true`로 — 관문 문구와 마일스톤 이름이 같을 필요는 없다.

## lint

`vault_verify.py`의 frontmatter 패스가 `review`를 따로 본다(`scan_review`). 모든 레인에서 돌고, PyYAML 없이도
판정한다. 올리는 defect는 아래다.

- `review is '<값>' — pending or confirmed only` — 두 값 밖
- `review is empty` — 값 없음(중첩 블록으로 쓴 경우도 여기 걸린다)
- `review must be a bare value` — 플로우 맵·블록 스칼라
- `review: pending needs review_since` / `needs review_gate` — 필수 필드 누락
- `review_since is '<값>' — a YYYY-MM-DD date` — 날짜 형식
- `review_gate is N bytes (max 300)` · `review_gate is a block scalar` — 관문 한 줄 위반
- `status: done while review: pending` — 검토 전 종료
- `<필드> without review` — `review` 없이 `review_since`·`review_gate`·`review_ref`만 있음

## 버린 대안

- **GitHub 라벨만** — 머지 뒤 볼트에 흔적이 없고, 프로젝트가 아니라 PR에 붙는다.
- **`milestones`의 관문 항목만** — 다른 미완 마일스톤과 구분되지 않고, 프로젝트를 가로질러 모을 수 없다.
- **`## Status` 인용 블록만**(2026-10-15 #685 직후의 모양) — 사람만 읽는다. 이 계약은 그 블록을 없애지 않고
  정본을 frontmatter로 옮긴 것이다.
- **`status`에 값 추가** — 생애주기와 섞인다(§ 두 축).

## 첫 적용

2026-10-15 `projects/codex-cmux-claude/README.md` — knowledge#685가 `검토중` 라벨로 머지된 뒤 후속 PR로 들어갔다.
관문은 "실볼트 V0~V9 1회 통과와 구성원별 R&R 확정", 기준 문서는 그 프로젝트의 `docs/ccc-minimal-verification.md`.
