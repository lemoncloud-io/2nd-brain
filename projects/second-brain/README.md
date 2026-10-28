---
type: project
status: active
goal: "Prepare and operate this sandbox as the initial environment for a future real knowledge vault."
due:
milestones:
  - name: "Initialize required vault control files"
    due: 2026-07-08
    done: true
  - name: "Clarify Hermes/Claude automation workflows"
    due: 2026-07-08
    done: true
  - name: "Establish the operating rule layer"
    due: 2026-08-14
    done: true
next_action: "Run the first clipping ingest and verify raw/wiki/index/memory/ingest-log updates."
---

# second-brain

## Status

Active. This project maintains the vault structure, operating rules, and automation workflows.

## Purpose

Use the resolved `$VAULT_DIR` (the cloned vault root) as the setup and testing environment for a future production knowledge folder.

## Current Context

- The vault root is resolved by `CLAUDE.md` § Vault Root; `VAULT_RULES.md` is the contract layer.
- Ingest and lint should prefer Claude Code when available, with Hermes-native fallback when Claude is unavailable.
- Deployment values (mail recipients, default reviewer, vault display name, trigger phrase) live in
  `config/team-settings.yaml`; skills reference them by key. Replace them after cloning.
- The first pending ingest source is currently in `Clippings/`.

## Related Wiki

- [[wiki/INDEX|Wiki Index]]
- [[wiki/topics/knowledge-management|Knowledge Management]]

## Log

- 2026-07-08: Initialized required control files and clarified Claude-first automation policy.
- 2026-07-29: 실행 이력을 [`wiki/VAULT_MEMORY.md`](../../wiki/VAULT_MEMORY.md)에서 [`docs/vault-ingest-log.md`](../../docs/vault-ingest-log.md)로 분리 —
  memory는 8 KB 예산의 상태·포인터 문서로 고정하고, `Last Ingest:` 한 줄만 교체한다.
- 2026-08-07: attention-budget 재배치 — `VAULT_RULES.md`의 § Wiki Frontmatter·§ Work Layer
  Frontmatter·§ Topic Pages·§ Templates를 § Note Contracts로 통합, § Session Start·
  § Vault Root Resolution은 `CLAUDE.md`로 이관, GitHub 계약은 [`docs/github-linked-projects.md`](../../docs/github-linked-projects.md)로
  분리. `AGENTS.md`는 `CLAUDE.md` 포인터로 축소해 규칙 3중 복제를 제거.
- 2026-08-11: `private/` 개인 스크래치 공간 도입 — `.gitignore`에 `private/` 추가(git
  비추적), `templates/private-note.md` 신설, `config/skills/private-note.md` 스킬 추가
  (`private/YYYY-MM-DD.md` 생성·이어쓰기). `areas/daily/`(팀 공유)와 별개이며 내용을
  팀 공유 경로로 승격하려면 사용자 명시 확인이 필요.
- 2026-08-12: `areas/weekly/` 주간 보고서 레인 신설 — `templates/weekly-report.{md,html}`
  템플릿, `config/skills/vault-weekly-report.md` 스킬(git 전수 통계 집계 절차) 추가.
  md가 진실원, 같은 이름 `.html` 뷰를 나란히 저장.
- 2026-08-12: `config/team-settings.yaml` 신설 — 팀 스킬은 범용 절차, 조직·개인 배포
  값(수신자·리뷰어·vault 표시명·트리거 문구)은 이 파일에서 키로 참조 (VAULT_RULES
  Core Rules 등록). ingest·github-project 스킬의 리뷰어 하드코딩도 `github.default_reviewer`
  참조로 전환.
- 2026-08-14: `raw/` 계약 정밀화 — [`docs/raw-layout.md`](../../docs/raw-layout.md) 신설(레인 구분, append-only 정의,
  파일명 정규화, ingest 게이트), `config/scripts/generate_raw_index.py`로 [`docs/raw-index.md`](../../docs/raw-index.md)를
  생성하고 `vault-lint`가 재생성·검사하도록 편입.
- 2026-08-14: 지침 계층 정비. 조직 고유 값은 `config/team-settings.yaml`의
  플레이스홀더로 중립화했으므로 clone 후 교체가 필요하다.
- 2026-09-04: 볼트 루트 devops baseline 도입 — `package.json`(Node 24+ `engines` + 공용
  툴체인 7종: typescript·@types/node·tsx·vitest·zod·@modelcontextprotocol/sdk·jsdom)과
  `.nvmrc`(24)를 볼트 루트에 둔다. 도구를 만들 때의 공통 환경이며 조직 고유 규약은 담지
  않는다 — 공개 표준과 공개 npm 패키지만 쓴다. `npm install` 산출물은 커밋 대상이 아니라
  `.gitignore`에 `/node_modules/`를 함께 추가했다. 이 시점에는 lockfile을 두지 않았다(caret 범위).
- 2026-09-04: 볼트 루트 `package-lock.json` 추가 — `package.json`의 caret 범위만으로는
  설치 시점의 최신 patch/minor가 깔려 공통 환경이 이름만 공통이 된다. lockfile을
  같이 두면 같은 트리가 깔리고 `npm ci`로 재현 설치가 된다. **루트에서는 `npm ci`를 쓴다** —
  `npm install`은 lockfile을 그 자리에서 재작성한다.
- 2026-10-18: `config/` 갱신(16파일) — 고아 점검 도구(`scripts/vault_orphans.py` + `vault-reach` 스킬, `.claude/skills/vault-reach` 등재)와 outputs 월간 압축(`scripts/outputs_compact.py`) 추가, `vault_verify.py` 검사 8a(검토 관문)·9(raw 색인 범위)·10(스냅샷 레인)·11(도달성)·12(깨진 링크) 추가, vault-lint § 고아·§ 5a 월간 압축, `vault_volume.py`·`generate_raw_index.py` 갱신. 계약 문서 [`docs/project-review.md`](../../docs/project-review.md) 추가, `docs/raw-layout.md`·[`docs/project-next-action.md`](../../docs/project-next-action.md) 갱신. `team-settings.yaml` 은 이 볼트 값 유지. 검증: scripts unittest 154 OK(skip 6). 검사 11 은 `wiki/INDEX.md` 에서 닿지 않는 문서가 있으면 FAIL — `vault-reach` 스킬로 잇는다.
  origin: lemoncloud-io/knowledge@4e78a1cb:projects/second-brain/config/
- 2026-10-19: `config/` 갱신(6파일) — 고아 스캐너 보정(`{{…}}` 템플릿 슬롯은 링크가 아님, `--broken` 은 `Clippings/` 제외, mention 수정은 frontmatter 를 건드리지 않음), 스킬·계약 문서의 참조 표기 정리. 검증: scripts unittest 157 OK(skip 6).
  origin: lemoncloud-io/knowledge@6f4088ca:projects/second-brain/config/
- 2026-10-27: `scripts/setup-vault-mac.sh`·`setup-vault-windows.ps1`에 비대화형 모드(`--non-interactive`·`-NonInteractive`) 추가 — 루트 [`SETUP.md`](../../SETUP.md) 에이전트 런북이 Claude 데스크톱 Code 탭에서 실행한다. 이름·이메일·repo를 인자로 받고, sudo·로그인이 필요한 단계는 기다리지 않고 이유를 출력하며 실패, Claude Code 설치 생략, Obsidian은 옵션. 두 스크립트 모두 Node.js 24+(지식 뷰어용)를 설치한다. 이 vault에서 직접 고친 것이라 `lemoncloud-io/knowledge` 원본에 옮기기 전까지 다음 `config/` 동기화가 덮어쓴다.
- 2026-10-28: `scripts/`의 git·gh 호출(`subprocess.run(text=True)`)에 `encoding="utf-8"` 지정 — `vault_verify.py`·`generate_raw_index.py`·`outputs_compact.py`·`vault_ingest_once.py` 13곳. 지정하지 않으면 Windows가 로캘 코드페이지(cp1252·cp949)로 디코드해 한글 경로에서 `UnicodeDecodeError`로 죽는다(Windows PowerShell 5.1 러너에서 SETUP 10단계 재현). 검증: scripts unittest 157 OK(skip 6). 위 항목과 같이 원본에 옮기기 전까지 다음 동기화가 덮어쓴다.

## Outputs

Project-specific outputs should be saved in `projects/second-brain/outputs/` when needed.
