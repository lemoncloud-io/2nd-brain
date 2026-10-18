---
name: vault-reach
description: >
  볼트 문서가 최상단 `wiki/INDEX.md`에서 링크를 따라 찾아갈 수 있는지 점검하고(고아 문서 찾기),
  문서마다 어디를 고치면 연결되는지 계획을 내고, 승인되면 그 연결을 적용한다. 사용자가 "고아 문서 찾아줘",
  "고아 노트 점검", "INDEX에서 못 찾아가는 문서", "도달성 점검", "/vault-reach"라고 할 때, 그리고
  vault-lint의 고아 점검 단계에서 사용한다. node_modules·.claude 워크트리 등은 스캔하지 않는다.
origin: lemoncloud-io/knowledge@4e78a1cb:projects/second-brain/config/skills/vault-reach/SKILL.md
---

# vault-reach (INDEX 도달성 점검 — 고아 문서)

**정의(2026-10-15 사용자 결정):** 고아 문서란 `wiki/INDEX.md`에서 링크를 따라가도 닿지 않는 문서다.
최상단에서 찾아갈 수 없으면 문제로 보고, 끊긴 연결 지점을 찾아 고친다. 범위는 프로젝트 내부 문서까지다.

도구는 `projects/second-brain/config/scripts/vault_orphans.py` 하나다(의존성 없음, Python 3). 볼트 루트에서
실행한다.

## 범위

- **도달해야 하는 문서:** 볼트의 모든 Markdown. 단 아래는 도달하지 않아도 된다.
  - 도구·뼈대: `projects/**/config/**`(스킬·도구 README·픽스처), `templates/`
  - 루트 진입 파일: `CLAUDE.md`, `AGENTS.md`, `README.md`, `VAULT_RULES.md` 등
  - **개인 저장소는 예외다**(2026-10-15 사용자 결정). 자기 폴더나 상위 폴더의 `README.md` frontmatter가
    `scope: personal`인 문서(`docs/github-linked-projects.md` § Access and Visibility). 단 그 내용을
    **아이디어·프로젝트·위키로 승격하면** 승격된 문서는 일반 문서라 INDEX에서 도달해야 한다 — 연결은 이때 필요하다.
  - `--skip <경로 접두사>`로 뺀 것(임시 예외). 경로를 커밋 문서나 PR 본문에 적지 않는다.
- **로컬 전용 문서는 볼트 문서가 아니다:** gitignore된 파일(공유 저장소에 올리지 않는 개인 소유자 폴더,
  작업용 임시 폴더 등)은 팀원에게 존재하지 않으므로 판정하지도, 경로로 쓰지도 않는다. 그런 문서를 거쳐야만
  닿는 공유 문서는 팀원 입장에서 끊긴 것이라 고아로 나온다.
- **스캔하지 않는 것:** `node_modules`(볼트 안에만 md 2천여 개), `.git`, `.claude`(워크트리가 볼트 사본이다),
  `.obsidian`, `private`, `raw`, `archive`, 빌드 디렉터리. 심볼릭 링크 디렉터리는 따라가지 않는다.
  손으로 grep할 때도 같은 제외를 쓴다 — 빼지 않으면 `README.md` 같은 흔한 이름이 엉켜 판정이 틀어진다.
- **링크로 세는 것:** `[[wikilink]]`·`![[embed]]`(frontmatter 포함), 상대 Markdown 링크, 폴더 링크
  (`[x](dir/)` → `dir/README.md`). 코드 블록·인라인 코드 안의 경로는 링크가 아니다.

## 절차

1. **점검.** `python3 projects/second-brain/config/scripts/vault_orphans.py` — 도달 수/대상 수와 고아를 묶음별로
   보여 준다. 고아가 0이면 끝.
   - `--broken`은 어디로도 이어지지 않는 링크(위키링크·상대 링크)를 전부 나열한다. `vault_verify.py`
     검사 12는 변경분이 **새로** 만든 깨진 링크만 결함으로 올리고, base에 이미 있던 것은 이 목록으로
     lint 레인이 정리한다.
2. **계획.** `--plan`(필요하면 `--skip`)으로 고아마다 연결 방법을 본다. 수정 하나가 다른 문서까지 열어 주므로
   계획은 라운드를 돌며 최소로 잡힌다.
   - `mention` — 이미 도달 가능한 살아 있는 문서가 그 경로를 인라인 코드로 언급한다 → 그 코드를 링크로 감싼다
     (`` `docs/a.md` `` → ``[`docs/a.md`](docs/a.md)``).
   - `readme` — 가장 가까운 상위 `README.md`가 도달 가능하다 → 그 README의 `## Document Map` 절에 한 줄
     (`- [제목](경로)`)을 더한다. 절이 없으면 끝에 만든다.
   - `hub` — 둘 다 없다 → 허브 연결이 끊긴 것이다. 손으로 고친다: 그 폴더의 README(없으면 짧은 허브 README)를
     만들고 `wiki/INDEX.md` § Vault Hubs나 상위 README에서 링크한다. 그다음 다시 `--plan`.
   계획을 사용자에게 요약해 보인다(종류별 건수, 수정될 파일 수, hub 목록).
3. **적용(요청받았거나 lint 레인일 때).** master에서 딴 작업 브랜치에서 `--apply`. 도구는 다음을 고치지 않는다.
   - 날짜 기록: `outputs/runs/`, `outputs/monthly/`, `areas/weekly/`, `YYYY-MM-DD-*` 파일
   - 동결·생성 파일: `docs/vault-ingest-log.md`, `docs/raw-index.md`, `wiki/VAULT_MEMORY.md`
   - 도구·템플릿: `config/`, `templates/`
4. **검증.** 다시 실행해 고아 0을 확인한다. 이어서 다음을 확인한다.
   - `git diff --name-only`에 위 고치지 않는 파일과 `raw/`·`archive/`가 없는가
   - `vault_verify.py --lane <레인>`이 PASS인가
   - diff 표본을 직접 읽어 본다: 링크 경로가 맞는가, 문서 목록 제목이 링크 문법을 깨지 않는가
5. **기록.** 커밋 → PR. 본문에 다음을 적는다.
   - 전후 도달 수, `mention`·`readme`·`hub` 건수
   - 손으로 고친 허브
   - 빼고 남긴 것(이유만, 경로는 적지 않음)

## 하지 않는 것

- 링크를 지어내 건수를 맞추지 않는다. `readme` 목록은 위치만 잇는 것이고, 관계 설명이 필요하면 사람이 다듬는다.
- `raw/`·`archive/`를 읽거나 고치지 않는다. 위키 노트를 병합·삭제하지 않는다.
- 날짜 기록 안의 평문 경로를 링크로 바꾸지 않는다(기록은 쓴 그대로 둔다).

## 테스트

`cd projects/second-brain/config/scripts && python3 -m unittest test_vault_orphans -v` — 도달 판정, 제외 트리
(돌연변이 검사: `node_modules` 제외를 빼면 두 테스트가 실패해야 한다), 계획 순서, 적용 결과, 기록·도구 미수정을
고정한다.
