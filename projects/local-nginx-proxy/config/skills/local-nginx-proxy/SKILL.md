---
name: local-nginx-proxy
description: >
  "로컬 이름 셋업"·"이름으로 접속하게 해줘"·"3d.local 처럼"·"<이름>.local 추가해줘"·"로컬 nginx 이름"·
  "로컬 이름 점검"·"nginx 프록시"·"local-nginx-proxy"·"옛 local-name-proxy 옮기기" 같은 요청에 이 기기의 로컬 서비스를 `http://<이름>.local`로 열리게 한다.
  nginx 전용 인스턴스(루트 LaunchDaemon, 127.0.0.1·::1 의 80)가 `127.0.0.1:<포트>`로 넘기고, `/etc/hosts` 관리 블록이
  이름을 루프백에 묶는다. 설정 파일은 생성기(projects/local-nginx-proxy/config/local-nginx-proxy/render.mjs)가 만들고,
  sudo 가 필요한 적용(apply.sh)은 오너가 읽고 직접 돌린다. 다른 기기에서 여는 이름(테일넷)은 이 스킬 밖이다.
origin: lemoncloud-io/knowledge@121d6640:projects/local-nginx-proxy/config/skills/local-nginx-proxy/SKILL.md
---

# local-nginx-proxy — 로컬 서비스를 이름으로

`http://<이름>.<접미사>`(기본 `local`) → nginx(루프백 80) → `127.0.0.1:<포트>`. 이 기기 안에서만 열린다.

## 언제 쓰나

- 로컬 서비스를 포트 없이 `http://<이름>.local`로 열고 싶을 때(처음 셋업 · 이름 추가 · 점검).
- 옛 이름(`local-name-proxy`)으로 설치한 기기를 새 이름으로 옮길 때 — § 옛 이름에서 옮기기.
- 다른 스킬이 화면 주소를 그 사람의 이름으로 찾을 때 — § 화면 붙이기.

| 무엇 | 어디 | Git |
| --- | --- | --- |
| 이름 → 포트 목록 | `~/.config/local-nginx-proxy/services.json` | 밖(기기 전용) |
| 생성물(nginx.conf · hosts 블록 · LaunchDaemon plist · apply.sh) | `~/.local/state/local-nginx-proxy/` | 밖 |
| 생성기 · 시험 · 예시 | `projects/local-nginx-proxy/config/local-nginx-proxy/` | 안 |

## 경계 — 하지 않는 것

생성기는 파일만 만든다. 서비스 설치·`/etc/hosts` 수정·재시작은 `apply.sh`가 한다. `apply.sh`는 sudo 로만 돌고 오너가 돌린다.
에이전트는 sudo 를 돌리지 않는다. 비밀번호를 받지 않는다. 기기 이름·계정·절대 경로를 볼트 문서·PR·커밋에 적지 않는다.

## 처음 셋업

1. **확인.** `command -v nginx`가 없으면 `brew install nginx`를 오너 승인 뒤 돌린다. brew 서비스(`brew services start nginx`)는 켜지 않는다. 이 스킬의 데몬만 쓴다.
   `lsof -nP -iTCP:80 -sTCP:LISTEN`으로 80 을 쓰는 다른 프로세스가 없는지 본다. 있으면 멈추고 오너에게 묻는다.
2. **목록.** `~/.config/local-nginx-proxy/services.json`이 없으면 `services.example.json`을 복사해 고친다.
   이름은 소문자 DNS 라벨 하나(`3d`, `docs`)다. 포트는 1024~65535 의 루프백 서비스다. 이름은 각자 고른다.
   선택 칸: `app`(그 화면을 여는 스킬의 `viewer.id` — 에이전트 작업 뷰어 `agent-task-viewer`, 볼트 뷰어 `knowledge-viewer`),
   `title`(안내 페이지에 보일 이름), `open`(안내 페이지 링크의 경로, 기본 `/`), `health`(2xx 면 "응답함"으로 보는 경로, 기본 `/`).
3. **생성.** `node projects/local-nginx-proxy/config/local-nginx-proxy/render.mjs`.
   결과의 `nginx_test`가 `syntax ok · port 80 needs root …`면 정상이다(오너 권한으로는 80 을 못 묶는다). 다른 오류면 멈춘다.
4. **앱 쪽 허용.** Host·Origin 을 검사하는 앱은 새 이름을 알아야 한다.
   - 에이전트 작업 뷰어(serve.mjs, 그 앱이 있는 볼트에서만): LaunchAgent 환경 `CLAUDE_DASHBOARD_PUBLIC_ORIGINS=http://<이름>.local`(쉼표로 여럿).
     plist 사전 키는 `plutil -replace EnvironmentVariables.<키> -string <값>`으로 쓴다. 그 뒤 `launchctl bootout` + `bootstrap`.
   - 볼트 뷰어(knowledge-viewer): 실행 환경 `KNOWLEDGE_VIEWER_PUBLIC_HOSTS=<이름>.local`. 그 앱의 `projects/knowledge-viewer/config/README.md` § 이름으로 열기가
     정본이다(그 설정을 아는 판부터. 모르는 판은 그 이름을 127.0.0.1 로 넘겨 버린다 — `health` 가 2xx 가 아니라 "응답 없음"으로 보인다).
   - Vite 앱은 `server.allowedHosts`에 이름을 넣는다(`*.localhost`와 달리 `.local`은 기본 허용이 아니다).
   - 확인: `curl -s -o /dev/null -w '%{http_code}' -H 'Host: <이름>.local' http://127.0.0.1:<포트>/` 가 200, 다른 이름은 403/거부.
5. **적용(오너).** `~/.local/state/local-nginx-proxy/apply.sh`를 보여 주고 오너에게 돌려 달라고 한다:
   `sudo sh ~/.local/state/local-nginx-proxy/apply.sh`. 하는 일: `nginx -t`(루트) → 옛 이름 데몬이 있으면 내림 → LaunchDaemon `local.nginx-proxy.nginx` 설치 →
   `/etc/hosts` 관리 블록 교체(옆에 백업) → DNS 캐시 비움 → nginx (재)기동.
6. **점검.** `node …/render.mjs check` — 데몬 상태, hosts 블록, 이름마다 해석·HTTP 코드·걸린 시간.
   이어서 브라우저 패널로 `http://<이름>.local/`을 연다. 에이전트 작업 뷰어면(그 앱이 있는 볼트에서만) `/viewer`·`/dashboard`·`/__monitor/events`(스트림)도 본다.

## 옛 이름에서 옮기기

이 도구의 옛 이름은 `local-name-proxy`다. 옛 이름으로 설치한 기기는 한 번 옮긴다. 옛 설치가 없는 기기는 이 절을 건너뛴다.

1. **목록 파일.** 오너 권한으로 옮긴다. 새 목록이 없고 옛 목록만 있으면 생성기가 멈추고 이 명령을 한 줄로 알린다.
   `mkdir -p ~/.config/local-nginx-proxy && cp ~/.config/local-name-proxy/services.json ~/.config/local-nginx-proxy/services.json`
2. **생성.** `node …/render.mjs`. 새 상태 폴더 `~/.local/state/local-nginx-proxy/`에 생성물이 생긴다.
3. **적용(오너).** `sudo sh ~/.local/state/local-nginx-proxy/apply.sh`. 옛 데몬(`local.name-proxy.nginx`)을 내리고 그 plist 를 지운다.
   `/etc/hosts`의 옛 표시 블록을 지우고 새 블록을 넣는다(백업은 옆에). 그 뒤 새 데몬을 올린다. 옛 데몬을 먼저 내리므로 80 이 겹치지 않는다.
4. **점검.** `node …/render.mjs check`. `daemon: running`이어야 한다. `legacy` 줄이 무엇이 남았는지 알린다.
   데몬·plist·hosts 블록이 남았다고 하면 3번을 다시 돌린다. "지워도 된다"만 말하면 적용은 끝났다.
5. **정리.** 옛 상태 폴더 `~/.local/state/local-name-proxy/`와 옛 목록 폴더 `~/.config/local-name-proxy/`는 스크립트가 지우지 않는다.
   새 데몬이 뜬 뒤 지운다. 그 뒤 `check`에 `legacy` 줄이 없다.

## 이름 추가 · 빼기

`services.json`을 고친다 → 생성 → 앱 쪽 허용 → 오너가 `sudo sh …/apply.sh` → 점검. 바뀐 것이 없으면 생성이 `nothing changed`를 낸다.

## 화면 붙이기 — 각자 설정을 따른다

화면을 여는 스킬은 이름을 직접 적지 않는다. 그 사람의 `services.json`에서 찾는다. 셋업이 없는 사람에게는 지금까지처럼 연다.

```sh
node projects/local-nginx-proxy/config/local-nginx-proxy/render.mjs url --app <viewer.id> --path '<경로?질의#앵커>' --fallback <스킬의 기본 주소>
# → {"url":"…","via":"name"|"fallback","reason":"…"} — 그 앱의 이름이 여럿이면 "candidates":["…"] 가 더 붙는다
```

- `via: name` — 그 사람의 이름이 `health` 에서 2xx 로 답했다. `url`을 브라우저 패널에서 `navigate` 한다. 서버를 따로 띄우지 않는다.
  같은 `app`의 이름이 여럿이면 `candidates`가 응답한 이름의 주소를 목록 순서로 준다(`url`은 그 첫째). 어느 것을 열지는 그 화면의 스킬이 정한다.
- `via: fallback` — 셋업이 없거나, 그 앱의 이름이 없거나, 이름이 답하지 않는다. `url`은 기본 주소다. 스킬의 원래 절차(launch.json · `preview_start`)를 따른다.
- 생성기 파일이 볼트에 없으면 이 단계를 건너뛴다.

| 화면 | `--app` | `--path` 예 | `--fallback` | 더 볼 것 |
| --- | --- | --- | --- | --- |
| 에이전트 작업 뷰어(그 앱이 있는 볼트에서만) | `agent-task-viewer` | `/viewer#mode=sessions` · `/dashboard` · `/debug` | `http://127.0.0.1:4318` | 상시 서버는 하나다. 세션마다 다른 데이터가 아니다 |
| 볼트 뷰어 | `knowledge-viewer` | `/v/wiki/INDEX.md?agent=claude&src=local` | `http://127.0.0.1:<그 볼트의 포트>`(기본 8778) | 상시 서버는 볼트마다 하나이고 볼트 루트 하나(그 볼트의 주 체크아웃)를 낸다. 스킬은 `candidates`를 차례로 견줘 세션의 볼트 루트를 내는 이름만 쓴다. 없으면(워크트리 등) 이름을 쓰지 않는다 — knowledge-viewer-open 스킬 |

## 상시 서비스 — 이름이 답하려면

이름은 서비스가 늘 떠 있을 때만 쓸모 있다. 상시 실행은 각 앱의 몫이다. 규칙:

- 서비스는 이 볼트의 **주 체크아웃**에서 띄운다. 따로 서빙 폴더를 만들지 않는다. 올리기 전에 주 체크아웃을 기본 브랜치의 최신으로 맞춘다.
- 에이전트 작업 뷰어: `projects/agent-task-monitor/README.md` § 상시 실행(LaunchAgent, 4318) — 해당 문서가 있는 볼트에서만.
- 볼트 뷰어: 볼트마다 LaunchAgent 하나(그 볼트의 포트, 기본 8778). 볼트가 여럿이면 포트·이름·라벨·로그가 볼트마다 다르다.
  설치 → plist → 이름 → 점검 → 갱신 → AI 키 → 문제 해결의 처음부터 끝까지는 [references/vault-viewer.md](references/vault-viewer.md)가 정본이다.
- 상시 서버가 포트를 잡고 있으면 세션 워크트리의 개발 서버는 다른 포트로 띄운다.

## 안내 페이지

`http://localhost/` — 이름마다 링크(`open`)와 응답 여부(`/_up/<이름>` → `health`, 15초마다)를 보인다. 목록은 `services.json`에서 생성된다(포트는 싣지 않는다).
다른 Host 는 여전히 404 다.

## 재부팅 뒤 확인

- nginx 데몬은 부팅 때 뜬다(LaunchDaemon). 화면 서버들은 로그인 때 뜬다(LaunchAgent). 로그인 전에는 이름이 502 를 낸다.
- 로그인 뒤 `node …/render.mjs check` — `daemon: running`, `landing: 200`, 이름마다 `http`. 안내 페이지에서 모두 "응답함"인지 본다.

## 되돌리기

오너가 돌린다:

```sh
sudo launchctl bootout system/local.nginx-proxy.nginx
sudo rm /Library/LaunchDaemons/local.nginx-proxy.nginx.plist
# /etc/hosts 에서 '# >>> local-nginx-proxy >>>' ~ '# <<< local-nginx-proxy <<<' 블록을 지운다(백업: /etc/hosts.bak-local-nginx-proxy-*)
```

## 알아 둘 것

- **왜 루트 데몬인가.** macOS 에서 루트가 아닌 프로세스는 80 을 모든 주소(`0.0.0.0`)에만 묶을 수 있다. 그러면 같은 망에 열린다.
  데몬은 루트로 `127.0.0.1:80`·`[::1]:80`만 묶고, 작업자 프로세스는 오너 계정으로 돈다.
- **왜 /etc/hosts 인가.** `.local`은 mDNS 접미사라 OS 가 `*.localhost`처럼 루프백으로 풀지 않는다. 관리 블록은 `127.0.0.1`과 `::1`을 함께 적는다.
  `::1`이 없으면 IPv6 조회가 시간 초과를 기다릴 수 있다.
- **같은 이름의 기기.** 같은 망에 `<이름>.local`을 광고하는 기기가 있어도 이 기기에서는 hosts 블록이 먼저다.
- **설정 바꿈은 sudo 가 든다.** nginx 주 프로세스가 루트라 다시 읽기(`kickstart`)도 루트다. 그래서 이름을 바꿀 때마다 `apply.sh`를 다시 돌린다.
- **스트림.** 사이트마다 `proxy_buffering off`, `proxy_read_timeout 1h`, `Host` 그대로. SSE·긴 응답이 끊기지 않는다.
- **느린 스트림은 앱 쪽인지 먼저 본다.** 프록시 뒤 스트림이 안 열리면 같은 요청을 `127.0.0.1:<포트>`로 직접 보내 첫 바이트 시간을 잰다(`curl -N -w %{time_starttransfer}`). 앱에 따라 직접 연결에서도 첫 바이트가 수 초 걸린다(예: 에이전트 작업 뷰어 대시보드의 이벤트 스트림). nginx 로그 `499`는 클라이언트가 먼저 끊었다는 뜻이다.
- 로그: `~/.local/state/local-nginx-proxy/nginx/logs/`(`error.log` · `access.log` · `launchd.log`).
