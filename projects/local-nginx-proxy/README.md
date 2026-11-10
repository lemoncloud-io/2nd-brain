---
type: project
status: active
goal: "이 기기의 로컬 서비스를 포트 없이 http://<이름>.local 로 여는 nginx 역프록시 생성기와 그 스킬"
due:
milestones: []
next_action: ""
managed: vault-sync
origin: lemoncloud-io/knowledge@121d6640:projects/local-nginx-proxy/
---

# local-nginx-proxy

## Purpose

로컬 서비스(예: 볼트 뷰어)를 `http://<이름>.local` 로 연다. 이 기기 안에서만 열린다.
nginx 전용 인스턴스가 루프백 80 에서 받아 `127.0.0.1:<포트>` 로 넘기고, `/etc/hosts` 관리 블록이 이름을 루프백에 묶는다.
생성기는 파일만 만든다. sudo 가 드는 적용(`apply.sh`)은 사람이 읽고 직접 돌린다.

## 구성

- `config/local-nginx-proxy/` — 생성기 `render.mjs`(설정 생성 · `check` 점검 · `url` 이름 찾기), 시험 `tests/`, 목록 예시 `services.example.json`.
- `config/skills/local-nginx-proxy/` — 셋업·이름 추가·점검·되돌리기 스킬. 본문 [SKILL.md](config/skills/local-nginx-proxy/SKILL.md). 등록 레이어 `.claude/skills/local-nginx-proxy` 상대 심링크.
- `config/skills/local-nginx-proxy/references/vault-viewer.md` — 볼트 뷰어를 상시 서비스로 올리고 이름으로 여는 처음부터 끝까지의 절차.
- 확장 지점은 없다. 기기마다 다른 값은 Git 밖 목록 파일(`~/.config/local-nginx-proxy/services.json`) 하나다. 생성물은 `~/.local/state/local-nginx-proxy/` 에 생긴다(역시 Git 밖).

## 쓰는 법

- 이 볼트의 뷰어를 이름으로 열려면 [knowledge-viewer](../knowledge-viewer/README.md) § 직접 구성하기부터 읽는다. 그 절에 이 볼트의 값(포트·예시 이름·라벨·로그)과 읽는 순서가 있다.
- 다른 로컬 서비스의 이름 추가·빼기·점검·되돌리기는 스킬 본문을 따른다. 에이전트에게 "로컬 이름 셋업", "<이름>.local 추가해줘"라고 하면 이 스킬이 맡는다.
- 시험: `node --test tests/*.test.mjs`(`config/local-nginx-proxy/` 에서).

## Sync Notes

- `config/` 아래 파일은 출처 스탬프(`origin:`)가 있는 사본이다. 손으로 고치지 않는다. 바꿀 것이 있으면 볼트 운영자에게 요청한다.
- 코드·json 파일에는 스탬프가 없다. 이 README 의 `origin` 이 그 파일들의 기준 커밋이다.
