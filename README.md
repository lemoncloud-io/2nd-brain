# 2nd-brain

**한국어** · [English](README.en.md)

Hermes와 Claude Code로 운영하는 Obsidian 기반 AI Second Brain vault.

원문 소스를 인제스트 파이프라인으로 구조화된 wiki 문서로 컴파일하고, 그 wiki를 근거로 질문에 인용 답변을 생성한다. 규칙은 모델 중립적이며, 권위 있는 계약은 [`VAULT_RULES.md`](VAULT_RULES.md)를 따른다.

## 구조

```text
Clippings/        ← inbox: 새로 수집된 소스 (처리 대기)
raw/              ← 처리된 원문 (append-only)
wiki/             ← 개념 문서, 한 개념당 한 파일
wiki/topics/      ← 토픽 인덱스 페이지 (주제 클러스터)
outputs/          ← 질의 응답, 분석 리포트, 린트 결과
projects/<name>/  ← 프로젝트별 실행 맥락과 산출물
areas/            ← 지속 영역: daily/ 노트와 ideas/ 노트
templates/        ← Obsidian + LLM 출력 템플릿 (공유 계약)
archive/          ← 완료 프로젝트와 폐기 자료 (append-only)
docs/             ← 설치 가이드 등 시스템 문서
```

> `raw/`와 `archive/`는 append-only다. `wiki/VAULT_MEMORY.md`와 `wiki/INDEX.md`는 모든 vault 작업 시작 시 로드된다.

## 필수 도구

| 도구 | 필수 | 용도 |
| --- | --- | --- |
| Git | 필수 | clone·branch·commit·push |
| Obsidian | 필수 | 마크다운 vault 편집, Web Clipper·플러그인 |
| Claude CLI (`claude`) | 선택 | 인제스트·린트를 Claude Code에 위임 (없으면 Hermes 폴백) |
| GitHub CLI (`gh`) | 선택 | 터미널에서 PR 생성·GitHub 프로젝트 연결 (웹으로 대체 가능) |

버전 확인:

```bash
git --version        # 필수
claude --version     # 선택
gh --version         # 선택
```

## 설치 및 시작

1. **저장소 clone 후 `VAULT_DIR` 설정** — 아래 저장소·경로는 예시다. clone 후 origin을 본인/팀 git으로 바꿔 사용하고, 절대경로 대신 `$VAULT_DIR`·`~` 상대경로를 쓴다.

   ```bash
   git clone https://github.com/lemoncloud-io/2nd-brain.git ~/knowledge
   export VAULT_DIR="$HOME/knowledge"
   cd "$VAULT_DIR"
   ```

2. **Obsidian에서 clone한 폴더를 vault로 열기** — `Open folder as vault`로 `~/knowledge` 선택. `VAULT_RULES.md`, `wiki/`, `templates/`가 보이면 정상.

3. **(선택) Claude CLI 설치** — 인제스트/린트를 Claude Code에 위임하려면 `claude`가 설치·인증되어 있어야 한다. 없으면 Hermes 네이티브 워크플로우로 폴백된다.

> Obsidian Web Clipper 설정, 플러그인, PR 흐름, 문제 해결 등 **자세한 설치·이용 가이드는 [`docs/knowledge-wiki-setup-guide.md`](docs/knowledge-wiki-setup-guide.md)를 참조**한다.

## Vault 루트

저장소 루트를 `VAULT_DIR`로 취급하는 것은 기대 구조(`VAULT_RULES.md`, `wiki/`, `raw/`, `Clippings/`, `outputs/`, `templates/`)가 모두 존재할 때만이다. 사용자가 `VAULT_DIR`를 지정하면 그것을 쓴다. `~/knowledge`로 조용히 폴백하지 않는다 — 이는 설치 예시 경로일 뿐이다.

## 워크플로우

인제스트는 클리핑마다가 아니라 하루 1회 배치로 실행된다. `Clippings/`에 마크다운을 넣고 실행한다.

```text
지침을 읽고, 클리핑 처리해줘
```

인제스트와 린트는 `claude` CLI가 설치·인증돼 있으면 Claude Code를 우선 사용한다. Claude Code가 없거나 차단·미인증 상태면 조용히 실패하지 않고 이유를 보고한 뒤 Hermes 네이티브 폴백을 실행한다. 파이프라인은 파일을 `raw/`로 옮기고, 개념을 추출하고, frontmatter·위키링크·토픽 인덱스와 함께 `wiki/` 문서를 생성·갱신한다.

### 처음 실행 시 예상 결과

`Clippings/`에 소스 하나(예: 멀티 에이전트 설정 글)를 넣고 실행하면 에이전트가 다음을 수행한다.

- `ingest/<YYYY-MM-DD>-<작업자-slug>` 브랜치를 `master`에서 생성 (같은 날 재실행 시 `-2`, `-3` 접미사)
- 처리한 클리핑을 내용 변경 없이 `Clippings/` → `raw/`로 이동 (append-only)
- `templates/`를 적용해 `wiki/` 개념 문서 생성 (예: `multi-agent-orchestration`, `hermes-agent`), 필요 시 `wiki/topics/`에 새 토픽 추가 (예: `ai-agents`)
- `wiki/INDEX.md`, `wiki/TOPIC_MAP.md`, `wiki/VAULT_MEMORY.md` 갱신
- 결과를 커밋·push하고 `master` 대상 PR을 자동으로 오픈 (기본 리뷰어 `steve-lemon`)

PR 오픈까지는 확인 없이 진행되지만, PR **merge는 사용자의 명시적 승인**이 있어야 한다. 새로 만들어진 문서는 대개 `stub` 상태이며, 시간 민감하거나 근거가 부족한 주장은 `needs-update`로 표기된다. 실행이 끝나면 처리한 클리핑, 생성·갱신 문서, 남은 이슈, PR 링크가 요약 보고된다.

Claude Code에 강제로 위임하려면:

```text
Claude에 위임해서 클리핑 처리해줘
```

## 질의

무엇이든 물어보면 에이전트가 `wiki/INDEX.md`를 읽어 관련 문서를 찾고, 인용된 답변을 `outputs/`에 저장한다.

## 프로젝트

- [second-brain](projects/second-brain/) — `active` · 이 vault의 구조·워크플로우 지속 개선 (3-루프 가동)

프로젝트 상태·마감·다음 행동의 진실원은 각 프로젝트 README의 frontmatter다. 자세한 내용은 [projects/README.md](projects/README.md) 참조.

## 스킬

각 워크플로우의 진실원은 Hermes 스킬이다.

| 스킬 | 역할 |
| --- | --- |
| `vault-ingest-claude` | 우선 인제스트 경로 (Claude Code) |
| `vault-ingest` | Hermes 네이티브 인제스트 폴백 |
| `vault-query` | wiki 기반 응답, 보존 답변을 `outputs/`에 저장 |
| `vault-lint` | Claude 우선 린트 + Hermes 네이티브 폴백 |
