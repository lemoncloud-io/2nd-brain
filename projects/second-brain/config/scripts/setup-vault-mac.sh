#!/usr/bin/env bash
# origin: lemoncloud-io/knowledge@e5a3687:projects/second-brain/config/scripts/setup-vault-mac.sh
# setup-vault-mac.sh — 비개발자용 vault 온보딩 스크립트 (macOS)
#
# 하는 일:
#   1. Homebrew·Git·Obsidian·Claude Code CLI·GitHub CLI·문서 변환 도구(pandoc·uv)가
#      없으면 설치. 변환 도구는 SKIP_CONVERTERS=1 로 건너뛸 수 있다
#   2. GitHub 브라우저 로그인(gh auth login) + git 사용자 정보(이름·이메일) 설정
#   3. 팀 vault repo URL을 물어 clone (기본 경로: ~/knowledge)
#   4. VAULT_DIR 환경변수를 셸 설정에 등록
#   5. 구조 검증 후 다음 단계 안내
#
# 사용법 — git이 없어도 됨. 터미널에 아래 한 줄만 붙여넣으면 끝:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/lemoncloud-io/2nd-brain/master/projects/second-brain/config/scripts/setup-vault-mac.sh)"
#
# repo/경로를 미리 지정하려면 환경변수로:
#   REPO_URL=https://github.com/<org>/<repo>.git TARGET_DIR=~/my-vault bash -c "$(curl -fsSL ...)"
#   변환 도구 생략: SKIP_CONVERTERS=1 bash -c "$(curl -fsSL ...)"
# 파일로 받아 실행할 때는 인자로도 가능:
#   bash setup-vault-mac.sh [repo-url] [설치경로]
#
# 비대화형 모드 — 사람이 아니라 에이전트(Claude Code의 Bash 도구 등)가 실행할 때. SETUP.md가 쓴다:
#   bash setup-vault-mac.sh --non-interactive --repo <url> --name <이름> --email <이메일> \
#     [--target <설치경로>] [--with-obsidian]
#   묻는 단계를 전부 인자로 받고, 입력·sudo가 필요한 단계는 기다리지 않고 이유를 출력하며 실패한다:
#   Homebrew가 없으면 설치하지 않고 중단(sudo 필요), gh 미로그인이면 중단(gh auth login --web 선행),
#   --repo가 없거나 공개 템플릿이면 중단. Claude Code 설치는 건너뛰고(이미 실행 중),
#   Obsidian은 --with-obsidian일 때만 설치한다.
#
# 필요 선행 조건: 없음 (curl·bash는 macOS 기본 내장, Homebrew·Git은 스크립트가 설치)
# 재실행해도 안전하다(이미 설치/클론/설정된 항목은 건너뜀).
set -euo pipefail

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[주의]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[실패]\033[0m %s\n' "$*"; exit 1; }

# 기본값은 공개 부트스트랩 템플릿이다. 실제 clone 대상은 6번 단계에서 팀 repo URL을
# 물어 결정한다 — 조직 값의 단일 출처는 projects/second-brain/config/team-settings.yaml.
TEMPLATE_URL="https://github.com/lemoncloud-io/2nd-brain.git"
NON_INTERACTIVE=0
WITH_OBSIDIAN=0
GIT_NAME_ARG=""
GIT_EMAIL_ARG=""
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=1 ;;
    --with-obsidian)   WITH_OBSIDIAN=1 ;;
    --repo)   [ $# -ge 2 ] || fail "$1 뒤에 값이 필요합니다."; REPO_URL="$2"; shift ;;
    --name)   [ $# -ge 2 ] || fail "$1 뒤에 값이 필요합니다."; GIT_NAME_ARG="$2"; shift ;;
    --email)  [ $# -ge 2 ] || fail "$1 뒤에 값이 필요합니다."; GIT_EMAIL_ARG="$2"; shift ;;
    --target) [ $# -ge 2 ] || fail "$1 뒤에 값이 필요합니다."; TARGET_DIR="$2"; shift ;;
    --*) fail "알 수 없는 옵션: $1" ;;
    *) POSITIONAL+=("$1") ;;
  esac
  shift
done
REPO_URL="${POSITIONAL[0]:-${REPO_URL:-$TEMPLATE_URL}}"
TARGET_DIR="${POSITIONAL[1]:-${TARGET_DIR:-$HOME/knowledge}}"
# 사람이 터미널에서 실행했을 때만 묻는다. 비대화형 모드는 TTY가 있어도 묻지 않는다.
if [ "$NON_INTERACTIVE" = "0" ] && [ -t 0 ]; then CAN_PROMPT=1; else CAN_PROMPT=0; fi
# URL 비교용 정규화: 프로토콜·ssh 접두·.git 접미를 벗겨 host/org/repo만 남긴다
norm_url() { printf '%s' "$1" | sed -E 's#^https?://##; s#^git@##; s#:#/#; s#\.git$##; s#/$##'; }

# 비대화형 입력은 설치를 시작하기 전에 검사한다 — 도구를 다 깐 뒤 clone 단계에서 멈추지 않게.
if [ "$NON_INTERACTIVE" = "1" ] && [ ! -d "$TARGET_DIR/.git" ] \
   && [ "$(norm_url "$REPO_URL")" = "$(norm_url "$TEMPLATE_URL")" ]; then
  fail "--non-interactive에는 --repo <내 위키 repo URL>이 필요합니다 (공개 템플릿은 clone하지 않습니다).
  새 repo는 먼저 만드세요: gh repo create <이름> --template lemoncloud-io/2nd-brain --private"
fi

SHELL_NAME="${SHELL##*/}"
case "$SHELL_NAME" in
  zsh)  SHELL_RC="$HOME/.zshrc" ;;
  bash) SHELL_RC="$HOME/.bash_profile" ;;  # macOS Terminal의 bash는 로그인 셸 — .bashrc는 안 읽는다
  *)    SHELL_RC="" ;;
esac

# 셸 설정 파일에 줄 하나를 멱등하게 추가한다. 설치기들이 PATH를 이 프로세스에만 반영하고
# 영구 등록은 사용자에게 맡기기 때문에 필요하다 — 등록하지 않으면 새 터미널에서
# brew·gh·pandoc·uv·claude가 전부 사라진다.
ensure_rc_line() {
  rc_line="$1"; rc_note="$2"
  if [ -z "$SHELL_RC" ]; then
    warn "자동 등록을 지원하지 않는 셸($SHELL_NAME)입니다. 셸 설정에 직접 추가하세요:
  $rc_line"
    return 0
  fi
  if grep -qsF -- "$rc_line" "$SHELL_RC"; then return 0; fi
  printf '\n%s\n' "$rc_line" >> "$SHELL_RC"
  say "$rc_note ($SHELL_RC)"
}

# ── 1. Homebrew ───────────────────────────────────────────────
# Homebrew 설치기는 PATH 등록을 사용자에게 맡기고 안내문만 출력한다. 등록하지 않으면
# 이 프로세스에서만 brew가 잡히고, 이후 brew로 깐 git·gh·pandoc·uv도 새 터미널에서 사라진다.
# 설치는 됐는데 PATH에 없는 경우(다른 터미널에서 방금 설치, 에이전트 셸)도 여기서 잡는다.
register_brew() {
  for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$brew_bin" ]; then
      eval "$("$brew_bin" shellenv)"
      ensure_rc_line "eval \"\$($brew_bin shellenv)\"" "Homebrew PATH 등록됨"
      return 0
    fi
  done
  return 1
}
if register_brew || command -v brew >/dev/null 2>&1; then
  say "Homebrew 확인됨"
elif [ "$NON_INTERACTIVE" = "1" ]; then
  # 설치기가 sudo 비밀번호를 TTY로 묻는다 — 에이전트 셸에서는 멈추거나 실패한다.
  fail "Homebrew가 없습니다. 설치는 관리자 비밀번호가 필요해 사용자가 터미널 앱에서 직접 실행해야 합니다:
  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"
  설치가 끝나면 이 스크립트를 다시 실행하세요."
else
  say "Homebrew 설치 중 (관리자 비밀번호를 물을 수 있습니다)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  register_brew || fail "Homebrew 설치 실패 — https://brew.sh 에서 수동 설치 후 재실행하세요."
fi

# ── 2. Git ────────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  say "Git 설치 중..."
  brew install git
else
  say "Git 확인됨: $(git --version)"
fi

# ── 3. Obsidian (비대화형 모드는 --with-obsidian일 때만) ─────
if [ -d "/Applications/Obsidian.app" ]; then
  say "Obsidian 확인됨"
elif [ "$NON_INTERACTIVE" = "1" ] && [ "$WITH_OBSIDIAN" = "0" ]; then
  say "Obsidian 설치 건너뜀 (필요하면 --with-obsidian)"
else
  say "Obsidian 설치 중..."
  brew install --cask obsidian
fi

# ── 4. Claude Code CLI (공식 native 설치 — 자동 업데이트됨) ──
# 비대화형 모드는 Claude 안에서 돌므로 설치하지 않는다(PATH 등록만 아래에서 보장).
if [ "$NON_INTERACTIVE" = "1" ]; then
  say "Claude Code 설치 건너뜀 (비대화형 모드)"
elif command -v claude >/dev/null 2>&1; then
  say "Claude Code 확인됨: $(claude --version 2>/dev/null || echo installed)"
else
  say "Claude Code 설치 중..."
  curl -fsSL https://claude.ai/install.sh | bash
fi
# 공식 설치기는 ~/.local/bin 에 넣고 PATH 영구 등록은 사용자에게 맡긴다. 등록하지 않으면
# 안내문의 "새 터미널에서 claude"가 동작하지 않는다. 설치 여부와 무관하게 매 실행 보장한다.
if [ -d "$HOME/.local/bin" ]; then
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac
  ensure_rc_line 'export PATH="$HOME/.local/bin:$PATH"' "claude PATH 등록됨"
fi
command -v claude >/dev/null 2>&1 || warn "claude 명령을 아직 찾지 못했습니다 — 설치는 됐을 수 있으니 새 터미널에서 'claude --version'으로 확인하세요."

# ── 4b. 문서 변환 도구 (pandoc · uv) ─────────────────────────
# hwp·doc·pdf를 위키에 넣는 변환 스킬(hwp2md·doc2md·pdf2md-ingest)의 공통 전제.
# 웹 클리핑만 쓰는 구성원은 SKIP_CONVERTERS=1 로 건너뛴다. 실패해도 온보딩은 계속된다.
if [ "${SKIP_CONVERTERS:-}" = "1" ]; then
  say "문서 변환 도구 설치 건너뜀 (SKIP_CONVERTERS=1)"
else
  for tool in pandoc uv; do
    if command -v "$tool" >/dev/null 2>&1; then
      say "$tool 확인됨"
    else
      say "$tool 설치 중 (hwp·doc·pdf 변환용)..."
      brew install "$tool" || warn "$tool 설치 실패 — hwp·doc·pdf 변환에만 필요합니다. 나중에 'brew install $tool'로 설치하세요."
    fi
  done
fi

# ── 4c. 지식 뷰어 런타임 (Node.js 24+) ───────────────────────
# "볼트 뷰어 열어줘"·"연결 그래프 보여줘"(projects/knowledge-viewer)의 전제 — 루트 package.json engines.
# 실패해도 온보딩은 계속된다.
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 24 ]; then
  say "Node.js 확인됨: $(node --version)"
else
  say "Node.js 설치 중 (지식 뷰어용)..."
  brew install node || warn "Node.js 설치 실패 — 지식 뷰어에만 필요합니다. 나중에 'brew install node'로 설치하세요."
fi

# ── 5. GitHub 로그인 + git 사용자 정보 ───────────────────────
# 프라이빗 팀 repo clone과 이후 커밋·PR(Claude 위임 포함)에 필요하다.
if ! command -v gh >/dev/null 2>&1; then
  say "GitHub CLI 설치 중..."
  brew install gh
fi
if gh auth status >/dev/null 2>&1; then
  say "GitHub 로그인 확인됨"
elif [ "$NON_INTERACTIVE" = "1" ]; then
  # 로그인은 일회용 코드를 사용자가 브라우저에 입력해야 한다 — 호출자(SETUP.md)가 먼저 끝낸다.
  fail "GitHub 로그인이 필요합니다. 먼저 'gh auth login --web --git-protocol https'로 로그인한 뒤 재실행하세요."
elif [ "$CAN_PROMPT" = "1" ]; then
  say "GitHub 로그인 — 브라우저가 열리면 안내를 따르세요"
  gh auth login --web --git-protocol https || fail "GitHub 로그인 실패 — 재실행하세요."
else
  warn "비대화형 실행이라 GitHub 로그인을 건너뜁니다 — 프라이빗 repo clone이 실패할 수 있습니다."
fi
gh auth setup-git 2>/dev/null || true  # HTTPS clone/push에 gh 자격증명 사용

[ -n "$GIT_NAME_ARG" ] && git config --global user.name "$GIT_NAME_ARG"
[ -n "$GIT_EMAIL_ARG" ] && git config --global user.email "$GIT_EMAIL_ARG"
if [ -z "$(git config --global user.name 2>/dev/null || true)" ] && [ "$CAN_PROMPT" = "1" ]; then
  printf 'git 커밋에 기록할 이름 (예: 홍길동): '
  read -r GIT_NAME || GIT_NAME=""
  [ -n "$GIT_NAME" ] && git config --global user.name "$GIT_NAME"
fi
if [ -z "$(git config --global user.email 2>/dev/null || true)" ] && [ "$CAN_PROMPT" = "1" ]; then
  printf 'git 커밋에 기록할 이메일 (회사 이메일): '
  read -r GIT_EMAIL || GIT_EMAIL=""
  [ -n "$GIT_EMAIL" ] && git config --global user.email "$GIT_EMAIL"
fi
if [ -z "$(git config --global user.name 2>/dev/null || true)" ] || [ -z "$(git config --global user.email 2>/dev/null || true)" ]; then
  warn "git 사용자 정보 미설정 — 커밋 시 필요합니다:
  git config --global user.name \"이름\" && git config --global user.email \"이메일\""
fi

# ── 6. 팀 repo 지정 + vault clone ────────────────────────────
if [ ! -d "$TARGET_DIR/.git" ] && [ "$(norm_url "$REPO_URL")" = "$(norm_url "$TEMPLATE_URL")" ] && [ "$CAN_PROMPT" = "1" ]; then
  printf '팀 vault repo URL을 입력하세요 (예: https://github.com/<org>/<repo>.git — 엔터 = 공개 템플릿으로 시작): '
  read -r INPUT_URL || INPUT_URL=""
  [ -n "$INPUT_URL" ] && REPO_URL="$INPUT_URL"
fi
if [ ! -d "$TARGET_DIR/.git" ] && [ "$(norm_url "$REPO_URL")" = "$(norm_url "$TEMPLATE_URL")" ]; then
  warn "공개 템플릿($TEMPLATE_URL)을 clone합니다 — 팀 위키가 아닙니다.
  팀 repo가 있다면 지금 중단(Ctrl+C)하고 재실행 때 URL을 입력하세요.
  팀 repo를 새로 만들 관리자는 clone 대신 GitHub template 생성이 정본입니다:
  SETUP.md 6단계 참조 (gh repo create --template lemoncloud-io/2nd-brain --private)"
fi

if [ -d "$TARGET_DIR/.git" ]; then
  say "vault가 이미 있습니다: $TARGET_DIR (clone 생략)"
elif [ -e "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
  fail "$TARGET_DIR 폴더가 이미 있고 비어있지 않은데 git repo가 아닙니다.
  폴더를 비우거나 다른 경로를 지정해 재실행하세요: TARGET_DIR=~/다른경로 bash ..."
else
  say "vault clone 중: $REPO_URL → $TARGET_DIR"
  git clone "$REPO_URL" "$TARGET_DIR" || fail "clone 실패 — repo 주소와 팀 repo 초대 수락 여부를 확인하세요.
  로그인 문제라면 'gh auth login'으로 브라우저 로그인 후 재실행하세요."
fi

# 잔여 안전망: origin이 여전히 공개 템플릿이면 push·PR이 공개 repo로 향한다
CURRENT_ORIGIN="$(git -C "$TARGET_DIR" remote get-url origin 2>/dev/null || echo "")"
if [ -n "$CURRENT_ORIGIN" ] && [ "$(norm_url "$CURRENT_ORIGIN")" = "$(norm_url "$TEMPLATE_URL")" ]; then
  warn "origin이 공개 부트스트랩 템플릿입니다. 팀 repo가 생기면 전환하세요:
  git -C \"$TARGET_DIR\" remote set-url origin <팀-repo-URL>"
fi

# ── 7. VAULT_DIR 등록 ────────────────────────────────────────
if [ -z "$SHELL_RC" ]; then
  warn "자동 등록을 지원하지 않는 셸($SHELL_NAME)입니다. 셸 설정에 직접 추가하세요:
  export VAULT_DIR=\"$TARGET_DIR\""
else
  EXISTING="$(grep -s '^export VAULT_DIR=' "$SHELL_RC" | tail -1 | sed 's/^export VAULT_DIR=//; s/^"//; s/"$//' || true)"
  if [ -z "$EXISTING" ]; then
    printf '\nexport VAULT_DIR="%s"\n' "$TARGET_DIR" >> "$SHELL_RC"
    say "VAULT_DIR 등록됨 ($SHELL_RC)"
  elif [ "$EXISTING" = "$TARGET_DIR" ]; then
    say "VAULT_DIR 이미 등록됨 ($SHELL_RC)"
  else
    warn "VAULT_DIR이 다른 경로로 이미 등록되어 있습니다: $EXISTING
  이번 설치 경로($TARGET_DIR)를 쓰려면 $SHELL_RC에서 export VAULT_DIR 줄을 수정하세요."
  fi
fi

# ── 8. 구조 검증 ─────────────────────────────────────────────
[ -f "$TARGET_DIR/VAULT_RULES.md" ] || fail "VAULT_RULES.md가 없습니다 — repo 주소를 확인하세요."
[ -d "$TARGET_DIR/wiki" ] || warn "wiki/ 폴더가 없습니다 — vault 구조를 확인하세요."
say "구조 검증 통과"

# ── 9. 다음 단계 안내 ────────────────────────────────────────
# 비대화형 모드의 다음 단계는 호출자(SETUP.md)가 안내한다 — 기계가 읽을 한 줄만 남긴다.
if [ "$NON_INTERACTIVE" = "1" ]; then
  printf '\nSETUP_OK vault=%s\n' "$TARGET_DIR"
  exit 0
fi
cat <<'NEXT'

────────────────────────────────────────────
설치 완료! 다음 단계:

 0. (팀 repo를 처음 만드는 관리자만) projects/second-brain/config/team-settings.yaml을
    팀 값으로 교체 — vault.name · github.vault_repo · github.default_reviewer 등
    (docs/knowledge-wiki-setup-guide.md § 3 참조)
 1. Obsidian 실행 → "Open folder as vault" → 방금 만든 vault 폴더 선택
 2. Obsidian Settings → Community plugins → Restricted mode 끄기
    권장 플러그인: Git, Templater, Dataview
 3. Chrome에 Obsidian Web Clipper 설치, 저장 폴더를 Clippings/ 로 설정
 4. (터미널이 싫다면) Claude Desktop 앱을 설치하고 vault 폴더를 연결하면
    채팅으로 "클리핑 처리해줘"를 바로 쓸 수 있습니다.
    터미널을 쓴다면: 새 터미널에서  cd "$VAULT_DIR" && claude
    (첫 실행 시 브라우저 로그인 — 유료 플랜 계정 필요)
 5. 한글(hwp)·워드(docx)·PDF 문서를 위키에 넣으려면 "이 파일 잉게스트해줘"로 요청
    (변환 도구는 이 스크립트가 설치했습니다)

 전체 안내 문서: 팀 위키의 docs/non-developer-onboarding.md
────────────────────────────────────────────
NEXT
