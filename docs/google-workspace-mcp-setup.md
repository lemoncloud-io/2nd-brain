# Google Workspace MCP Setup
<!-- origin: lemoncloud-io/knowledge@f68f1d38:docs/google-workspace-mcp-setup.md -->

Claude Code에서 Google Drive / Sheets / Slides 문서를 읽고 편집하기 위한 연결 준비 문서.

## 접근 방식 결정

| 후보 | 범위 | 판정 |
| --- | --- | --- |
| claude.ai 네이티브 Google Drive 커넥터 | Drive 검색·읽기 전용. Sheets/Slides 편집 불가 | 보류 |
| Merge/Composio 등 관리형 MCP | 외부 SaaS에 OAuth 토큰 위탁 | 제외 — 팀 vault 데이터를 제3자 경유시키지 않음 |
| **`google_workspace_mcp` (self-hosted)** | Drive·Docs·Sheets·Slides 포함 12개 서비스, 읽기+쓰기 | **채택 권고** — 활발히 유지보수됨(3k+ stars), `uvx`로 즉시 실행, OAuth 자격증명이 로컬에만 저장됨 |

- 저장소: <https://github.com/taylorwilsdon/google_workspace_mcp>
- 실행 요건: `uvx` — 로컬에 `uv`가 설치돼 있어야 한다 (macOS는 Homebrew `brew install uv`)

## 사전 준비 체크리스트

### 1. 사용자가 직접 해야 하는 것 (Google Cloud Console)

에이전트는 계정 인증·자격증명 입력을 대행하지 않는다. 아래는 사용자 작업:

1. <https://console.cloud.google.com> 에서 프로젝트 선택 또는 생성
2. API 활성화: **Google Drive API**, **Google Sheets API**, **Google Slides API**,
   **Gmail API** (Docs도 쓸 예정이면 **Google Docs API** 추가).
   주의: OAuth scope 동의와 API 활성화는 별개다 — scope 동의가 통과해도 해당
   API가 꺼져 있으면 도구 호출이 `API is not enabled` 오류를 낸다 (실측;
   활성화 후 반영까지 1–2분).
3. OAuth 동의 화면 구성 (조직 Workspace를 쓴다면 사용자 유형 Internal)
4. 사용자 인증 정보 → **OAuth 클라이언트 ID** 생성 (앱 유형: 데스크톱 앱)
5. 발급된 `Client ID` / `Client Secret`을 로컬 환경변수로 보관:

   ```bash
   export GOOGLE_OAUTH_CLIENT_ID="<client-id>"
   export GOOGLE_OAUTH_CLIENT_SECRET="<client-secret>"
   ```

**자격증명은 절대 vault에 커밋하지 않는다.** 셸 환경 또는 `~/.claude.json`(MCP env)에만 둔다.

### 2. 자격증명 준비 후 실행할 등록 명령

최종 등록 명령 (user 스코프 stdio):

```bash
claude mcp add -s user workspace-mcp \
  --env GOOGLE_OAUTH_CLIENT_ID="$GOOGLE_OAUTH_CLIENT_ID" \
  --env GOOGLE_OAUTH_CLIENT_SECRET="$GOOGLE_OAUTH_CLIENT_SECRET" \
  -- uvx workspace-mcp --tools drive sheets slides gmail
```

이미 등록된 상태에서 `--tools`를 바꾸려면 `claude mcp remove -s user workspace-mcp`
후 재등록한다 (add는 기존 항목을 덮어쓰지 않고 `already exists` 오류를 냄 — 실측).
scope가 늘어나면 재동의가 필요하다 (§ 인증·재인증).

단계적 도입 시 `--read-only`를 붙이면 OAuth scope 자체가 `*.readonly`로
제한된다(실측 확인). 읽기 검증 후 플래그를 빼고 재등록하면 쓰기 scope
재동의가 요구된다.

### 인증·재인증 (localhost:8000 콜백 함정)

OAuth 콜백 주소가 `http://localhost:8000/oauth2callback`인데, stdio 인스턴스는
Claude 세션이 끝나면 콜백 리스너도 함께 죽는다. **세션이 반환한 인증 URL을
나중에 열면 콜백이 실패한다.** 인증이 필요할 때는:

1. 서버를 HTTP 모드로 임시 기동 (인스턴스와 인증 상태가 세션 밖에서 유지됨):

   ```bash
   uvx workspace-mcp --tools drive sheets slides gmail --transport streamable-http
   ```

2. 도구를 한 번 호출해 인증 URL을 받고, **같은 머신의 브라우저**에서 승인한다.
3. 토큰이 로컬 credentials 디렉터리에 저장되면 HTTP 인스턴스를 종료한다.
   토큰은 transport와 무관하게 공유되므로 stdio 등록이 그대로 재사용한다(실측 확인).

### 3. 연결 후 검증

1. `claude mcp list` 에서 `workspace-mcp - ✔ Connected` 확인
2. Drive 검색 → 시트 셀 읽기 → 슬라이드 목차 읽기 순으로 읽기 경로 검증
3. 쓰기 검증은 테스트용 신규 문서에서만 수행 (기존 팀 문서로 첫 쓰기 테스트 금지)

## 관련 절차

운용 절차서: `projects/second-brain/config/skills/google-workspace.md` (승격된 팀 스킬)
주간 보고서 발송 절차: `projects/second-brain/config/skills/vault-weekly-report.md` § 이메일 발송
