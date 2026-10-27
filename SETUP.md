# SETUP.md — 에이전트가 따라 하는 2nd-brain 설치 런북

이 문서는 **사람이 아니라 에이전트(Claude)가 읽고 실행하는 절차서**다. 사용자는 Claude 데스크톱 앱의
**Code 탭(로컬 세션)** 에서 아래 한 줄만 입력한다.

```text
github.com/lemoncloud-io/2nd-brain 의 SETUP.md 대로 설정해줘
```

끝나면 사용자 컴퓨터에 사용자 본인의 비공개 위키 repo(`~/knowledge`)가 생기고, 그 폴더로 연 새 세션에서
"클리핑 처리해줘"·"볼트 뷰어 열어줘" 같은 말로 위키를 쓴다. Obsidian은 필요 없다.

사람이 터미널에서 직접 설치하려면 이 문서 대신 [`README.md`](README.md) § 빠른 시작의 설치 스크립트를 쓴다.

## 에이전트가 지킬 것

- **셸이 있는 로컬 세션에서만 진행한다.** 0단계 확인이 실패하면(일반 채팅·Cowork처럼 셸이 없거나 샌드박스인 환경)
  설치를 시도하지 말고 "Claude 데스크톱 앱 → Code 탭 → 로컬 세션에서 같은 문장을 다시 입력해 주세요"라고 안내하고 멈춘다.
- 사용자는 개발자가 아니라고 가정한다. 명령어 출력을 그대로 보여주지 말고 지금 무엇을 하는지 한 줄로 알린다.
  사용자가 손으로 할 일은 이 문서가 그렇게 적은 단계(Homebrew 설치·GitHub 승인·Windows 개발자 모드)뿐이다.
- 각 단계는 **실행 → 확인 → 실패 시** 순서다. 확인이 통과해야 다음 단계로 간다. 실패하면 그 단계의 "실패 시"를 따르고,
  거기에 없는 실패는 에러 문구 한 줄을 사용자에게 보여주고 멈춘다.
- 기존 폴더·파일을 지우거나 덮어쓰지 않는다. `~/knowledge`가 이미 있으면 7단계 설치 스크립트가 판단한다.
- 설치 스크립트는 재실행해도 안전하다. 중간에 멈췄으면 고친 뒤 같은 명령을 다시 실행한다.
- 오래 걸리는 명령(설치 스크립트, `npm ci`)은 타임아웃을 10분으로 잡거나 백그라운드로 돌린다.

## 0단계 — 환경 확인

- **실행**: `uname -s` (Windows PowerShell 도구라면 `$PSVersionTable.OS`)
- **확인**: 결과가 나오면 셸이 있다. `Darwin` = macOS, `MINGW*`·`MSYS*` 또는 Windows 문자열 = Windows.
  이후 단계의 macOS·Windows 갈래를 여기서 정한다.
- **실패 시**: 명령을 실행할 수 없으면 위 "에이전트가 지킬 것" 첫 항목대로 Code 탭 안내 후 멈춘다.

## 1단계 — 사용자에게 한 번만 묻기

설치를 시작하기 전에 아래 하나만 묻는다(나머지 값은 GitHub 계정에서 가져온다).

- **이미 쓰는 팀 위키 repo가 있나요?** 팀 관리자에게 주소를 받았다면 그 주소(`https://github.com/<org>/<repo>`).
  없으면 새로 만든다 — 기본 이름 `my-2nd-brain`(사용자가 다른 이름을 원하면 그 이름).

설치 위치는 `~/knowledge`(Windows `$HOME\knowledge`)로 고정한다. 사용자가 다른 위치를 명시했을 때만 바꾸고,
7단계에 `--target`(Windows `-TargetDir`)으로 넘긴다.

## 2단계 — 도구 확인

- **실행**: macOS `for t in brew git gh python3 node pandoc uv; do printf '%s ' "$t"; command -v "$t" >/dev/null && echo ok || echo missing; done`
  — `brew`가 missing이어도 `/opt/homebrew/bin/brew`·`/usr/local/bin/brew`가 있으면 설치된 것이다.
  그때는 이후 모든 명령 앞에 `eval "$(/opt/homebrew/bin/brew shellenv)"`(Intel Mac은 `/usr/local/bin/brew`)를 붙인다.
  Windows는 `winget`·`git`·`gh`를 `Get-Command`로 확인한다.
- **확인**: macOS는 `brew`, Windows는 `winget`이 있어야 3단계로 간다. 나머지 도구는 3단계(`gh`)와 7단계(나머지)가 설치한다.
- **실패 시**:
  - **macOS에 Homebrew가 없음** — 설치기가 관리자 비밀번호를 터미널에서 묻기 때문에 에이전트가 대신 실행할 수 없다.
    사용자에게 이렇게 안내하고 끝났다고 답할 때까지 기다린다:
    > Mac의 **터미널** 앱을 열고(`Cmd+Space` → "터미널") 아래 한 줄을 붙여넣은 뒤 Enter를 눌러 주세요.
    > Mac 로그인 비밀번호를 물으면 입력하세요(입력해도 화면에 안 보이는 게 정상입니다). 끝나면 "끝났어"라고 알려 주세요.
    > ```bash
    > /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    > ```

    답을 받으면 2단계를 다시 실행한다. `git`도 이 설치가 함께 깐다(Xcode Command Line Tools).
  - **Windows에 winget이 없음** — Microsoft Store에서 "앱 설치 관리자(App Installer)"를 설치해 달라고 안내하고 기다린다.

## 3단계 — GitHub CLI 설치

- **실행**: `gh`가 missing일 때만. macOS `brew install gh` · Windows `winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements`
- **확인**: `gh --version`이 버전을 출력한다. Windows는 새로 깐 명령이 현재 셸 PATH에 없을 수 있다 —
  `C:\Program Files\GitHub CLI\gh.exe`를 전체 경로로 쓴다.
- **실패 시**: 에러 한 줄을 보여주고 멈춘다.

## 4단계 — GitHub 로그인

로그인은 브라우저에서 사용자가 승인해야 끝난다. 에이전트는 일회용 코드를 받아 사용자에게 전달하고 기다린다.

- **실행**: 먼저 `gh auth status`. 이미 로그인돼 있으면 이 단계를 건너뛴다. 아니면 **백그라운드로**(Claude Code: Bash 도구
  `run_in_background: true`) 실행하고 출력은 파일로 받는다:
  ```bash
  gh auth login --hostname github.com --git-protocol https --web > "${TMPDIR:-/tmp}/gh-login.log" 2>&1
  ```
  몇 초 뒤 로그 파일에서 `one-time code`가 있는 줄의 `XXXX-XXXX` 코드를 읽어 사용자에게 이렇게 보여준다:
  > 브라우저에서 <https://github.com/login/device> 를 열고 코드 **XXXX-XXXX** 를 입력한 뒤 **Authorize**를 눌러 주세요.
  > GitHub 계정이 없으면 같은 화면에서 가입부터 하면 됩니다(무료).
- **확인**: 백그라운드 명령이 끝난 뒤 `gh auth status`가 `Logged in to github.com`을 출력한다. 그 다음 `gh auth setup-git`.
- **실패 시**:
  - 로그에 15초가 지나도 코드가 없거나 명령이 바로 에러로 끝나면, 사용자에게 터미널(Windows는 PowerShell) 앱에서
    `gh auth login --web --git-protocol https`를 직접 실행하고 화면 안내를 따라 달라고 한 뒤 "확인"부터 다시 한다.
  - 승인 시간이 지나 만료되면 실행부터 다시 한다(코드는 매번 새로 나온다).

## 5단계 — 사용자 정보 가져오기

- **실행**: `gh api user --jq '.login, .id, (.name // "")'`
- **확인**: 세 줄을 얻는다. 아래 값을 정하고 사용자에게 한 줄로 알린다(바꾸고 싶다고 하면 그 값을 쓴다).
  - `LOGIN` = 첫 줄
  - `NAME` = 셋째 줄, 비었으면 `LOGIN` — 위키 변경 기록에 남는 이름
  - `EMAIL` = `<id>+<login>@users.noreply.github.com` — 실제 메일 주소를 공개 기록에 남기지 않는 GitHub 공식 주소
- **실패 시**: 4단계 "확인"으로 돌아간다(로그인이 풀린 것).

## 6단계 — 내 위키 repo 준비

### 새로 만드는 경우

- **실행**:
  1. `gh repo view "$LOGIN/<이름>" --json name` — 성공하면 같은 이름이 이미 있다. 사용자에게 다른 이름을 묻는다
     (그 repo가 예전에 만든 2nd-brain 위키라면 "팀 위키가 있는 경우"로 간다).
  2. `gh repo create "<이름>" --template lemoncloud-io/2nd-brain --private`
  3. 템플릿 복사는 몇 초 늦게 끝난다. `gh api "repos/$LOGIN/<이름>/contents/VAULT_RULES.md" --jq .name`이 성공할 때까지
     2초 간격으로 최대 30번 다시 확인한다.
- **확인**: 3이 `VAULT_RULES.md`를 출력한다. `REPO_URL=https://github.com/$LOGIN/<이름>.git`
- **실패 시**: 2가 권한 에러면 4단계 로그인을 다시 한다. 3이 끝내 실패하면 GitHub 웹에서 repo가 비어 있는지 알려 달라고 하고 멈춘다.

### 팀 위키가 있는 경우

- **실행**: `gh repo view <받은 주소> --json nameWithOwner,viewerPermission`
- **확인**: `viewerPermission`이 `WRITE`·`MAINTAIN`·`ADMIN` 중 하나다. `REPO_URL`은 반환된 `nameWithOwner`로 만든 `https://github.com/<nameWithOwner>.git`이다.
- **실패 시**: 찾을 수 없거나 `READ`면 팀 관리자의 초대를 수락하지 않은 것이다 — GitHub 알림 메일의 초대를 수락해 달라고 하고
  수락했다고 하면 다시 확인한다.

## 7단계 — 설치 스크립트 실행 (비대화형)

스크립트가 문서 변환 도구(pandoc·uv)와 지식 뷰어용 Node.js 24+를 설치하고, git 이름·이메일을 설정하고, repo를 clone하고,
`VAULT_DIR` 환경변수를 등록한다. 비대화형 모드는 Claude Code를 설치하지 않고 Obsidian도 깔지 않는다.

- **실행** (macOS):
  ```bash
  curl -fsSL https://raw.githubusercontent.com/lemoncloud-io/2nd-brain/master/projects/second-brain/config/scripts/setup-vault-mac.sh -o "${TMPDIR:-/tmp}/setup-vault-mac.sh"
  bash "${TMPDIR:-/tmp}/setup-vault-mac.sh" --non-interactive --repo "$REPO_URL" --name "$NAME" --email "$EMAIL"
  ```
- **실행** (Windows PowerShell):
  ```powershell
  irm https://raw.githubusercontent.com/lemoncloud-io/2nd-brain/master/projects/second-brain/config/scripts/setup-vault-windows.ps1 -OutFile "$env:TEMP\setup-vault-windows.ps1"
  powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\setup-vault-windows.ps1" -NonInteractive -RepoUrl $REPO_URL -Name $NAME -Email $EMAIL
  ```
  Windows에서는 설치가 끝난 뒤 8~10단계 명령을 실행할 PowerShell 세션에서 PATH를 다시 읽는다:
  `$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";" + $env:Path`
  도구 호출마다 새 셸이 생기면 이후 각 호출의 명령 앞에서도 이 갱신을 실행한다.
- **확인**: 마지막 줄이 `SETUP_OK vault=<설치 경로>`다. 이 경로를 `VAULT`로 기억한다.
- **실패 시**: 스크립트의 `[실패]` 문구가 원인과 할 일을 적는다. 그대로 따르고 같은 명령을 다시 실행한다.
  - `Homebrew가 없습니다` → 2단계 "실패 시".
  - `GitHub 로그인이 필요합니다` → 4단계.
  - `폴더가 이미 있고 비어있지 않은데 git repo가 아닙니다` → 사용자에게 그 폴더를 어떻게 할지 묻는다. 지우지 말고,
    다른 위치를 원하면 `--target`(Windows `-TargetDir`)으로 다시 실행한다.
  - (Windows) `심링크 … 텍스트 파일로 체크아웃됐습니다` 경고 → 사용자에게 **설정 → 시스템 → 개발자용 → 개발자 모드 켜기**를
    부탁한 뒤 `git -C "$VAULT" checkout -- .`을 실행한다.

## 8단계 — 새로 만든 repo의 설정 값 바꾸기

새로 만든 repo만 한다(팀 위키는 관리자가 이미 해 두었으므로 건너뛴다). 템플릿의 `team-settings.yaml`은 공개 템플릿을
가리키므로 그대로 두면 위키 변경 제안(PR)이 사용자 repo가 아닌 곳을 향한다.

- **실행**: `$VAULT/projects/second-brain/config/team-settings.yaml`에서 세 값만 바꾼다. 다른 줄과 주석은 그대로 둔다.
  - `vault.name` → `"<NAME>의 2nd-brain"`
  - `github.vault_repo` → `"<LOGIN>/<이름>"`
  - `github.default_reviewer` → `"<LOGIN>"`

  그 다음 커밋해 올린다:
  ```bash
  git -C "$VAULT" add projects/second-brain/config/team-settings.yaml
  git -C "$VAULT" commit -m "chore(setup): point team-settings at this vault"
  git -C "$VAULT" push
  ```
- **확인**: `git -C "$VAULT" status --short`가 빈 출력이고 `git -C "$VAULT" log origin/HEAD -1 --format=%s`가 위 커밋 제목이다.
- **실패 시**: push가 거부되면 4단계 "확인"의 `gh auth setup-git`을 다시 실행하고 push한다.

## 9단계 — 지식 뷰어 준비 (실패해도 계속)

"볼트 뷰어 열어줘"·"연결 그래프 보여줘"가 쓰는 로컬 뷰어를 미리 빌드해 둔다.

- **실행**: `cd "$VAULT/projects/knowledge-viewer/config/app" && npm ci && npm run build`
- **확인**: 두 명령이 0으로 끝난다.
- **실패 시**: `node`가 없거나 24 미만이면 macOS `brew install node` · Windows `winget install --id OpenJS.NodeJS.LTS -e` 후
  다시 실행한다. 그래도 실패하면 건너뛰고 10단계 안내에 "지식 뷰어는 아직 준비되지 않았다"를 한 줄 덧붙인다.

## 10단계 — 구조 검증

- **실행**: `cd "$VAULT" && uv run --no-project projects/second-brain/config/scripts/vault_verify.py`
  (`uv`가 없으면 `python3`, Windows는 `python`으로 같은 파일을 실행한다)
- **확인**: 첫 줄이 `PASS`로 시작하고 종료 코드가 0이다.
- **실패 시**: `FAIL` 줄을 사용자에게 그대로 보여주고 멈춘다 — 막 만든 repo에서 실패하면 템플릿 결함이므로
  <https://github.com/lemoncloud-io/2nd-brain/issues>에 그 줄을 올려 달라고 안내한다.

## 11단계 — 마무리 안내

이 세션은 위키 폴더 밖에서 열렸으므로 위키 규칙과 스킬(`CLAUDE.md`·`.claude/skills`)이 아직 로드되지 않았다.
사용자에게 아래 내용을 그대로 안내하고 끝낸다(`<…>`는 실제 값으로 바꾼다).

> 설정이 끝났습니다. 내 위키: <https://github.com/<LOGIN>/<이름>> (비공개) · 내 컴퓨터: `<VAULT>`
>
> 이제 위키 폴더에서 새로 시작해야 합니다.
> 1. Claude 앱 **Code 탭**에서 새 세션을 엽니다.
> 2. 폴더 선택에서 홈 폴더의 **`knowledge`** 를 고릅니다.
> 3. 그 세션에서 이렇게 말해 보세요.
>    - "클리핑 처리해줘" — `Clippings/` 폴더에 넣어 둔 글을 위키 문서로 정리
>    - "○○에 대해 위키에서 찾아줘" — 위키를 근거로 답변
>    - "볼트 뷰어 열어줘" · "연결 그래프 보여줘" — 위키를 화면과 그래프로 보기
