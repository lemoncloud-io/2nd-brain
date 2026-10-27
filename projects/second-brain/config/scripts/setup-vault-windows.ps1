# setup-vault-windows.ps1 — 비개발자용 vault 온보딩 스크립트 (Windows 10 1809+)
# origin: lemoncloud-io/knowledge@e5a3687:projects/second-brain/config/scripts/setup-vault-windows.ps1
#
# 하는 일:
#   1. Git·Obsidian·Claude Code CLI·GitHub CLI·문서 변환 도구(pandoc·uv)가 없으면 설치
#      (winget + 공식 설치기). 변환 도구는 -SkipConverters 로 건너뛸 수 있다
#   2. GitHub 브라우저 로그인(gh auth login) + git 사용자 정보(이름·이메일) 설정
#   3. 팀 vault repo URL을 물어 clone (기본 경로: $HOME\knowledge)
#   4. VAULT_DIR 사용자 환경변수 등록
#   5. 구조·심링크 검증 후 다음 단계 안내
#
# 사용법 — git이 없어도 됨. PowerShell에 아래 한 줄만 붙여넣으면 끝
# (파일 다운로드·실행 정책 설정 불필요):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/lemoncloud-io/2nd-brain/master/projects/second-brain/config/scripts/setup-vault-windows.ps1).TrimStart([char]0xFEFF)))
#   (이 파일은 Windows PowerShell 5.1의 파일 실행 시 한글 깨짐을 막으려 UTF-8 BOM을
#    달고 있다. irm은 BOM을 그대로 문자열에 넘겨 PowerShell 7의 파서가 실패하므로
#    TrimStart로 벗긴다 — BOM이 이미 없으면 무해한 no-op이다.)
#
# repo/경로를 미리 지정하려면 인자를 붙인다:
#   & ([scriptblock]::Create((irm ...).TrimStart([char]0xFEFF))) -RepoUrl https://github.com/<org>/<repo>.git -TargetDir "$HOME\my-vault"
# 파일로 받아 실행할 때:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\setup-vault-windows.ps1 [-RepoUrl <url>] [-TargetDir <경로>] [-SkipConverters]
#
# 비대화형 모드 — 사람이 아니라 에이전트(Claude Code의 셸 도구 등)가 실행할 때. SETUP.md가 쓴다:
#   powershell -ExecutionPolicy Bypass -File setup-vault-windows.ps1 -NonInteractive `
#     -RepoUrl <url> -Name <이름> -Email <이메일> [-TargetDir <경로>] [-WithObsidian]
#   묻는 단계를 전부 인자로 받고, 입력이 필요한 단계는 기다리지 않고 이유를 출력하며 실패한다:
#   gh 미로그인이면 중단(gh auth login --web 선행), -RepoUrl이 없거나 공개 템플릿이면 중단.
#   Claude Code 설치는 건너뛰고(이미 실행 중), Obsidian은 -WithObsidian일 때만 설치한다.
#
# 필요 선행 조건: winget(Windows 10/11 기본 내장 '앱 설치 관리자') — 없으면 안내 후 중단
# 재실행해도 안전하다(이미 설치/클론/설정된 항목은 건너뜀).
#
# 기본 RepoUrl은 공개 부트스트랩 템플릿이다. 실제 clone 대상은 5번 단계에서 팀 repo
# URL을 물어 결정한다 — 조직 값의 단일 출처는 projects/second-brain/config/team-settings.yaml.
param(
    [string]$RepoUrl   = "https://github.com/lemoncloud-io/2nd-brain.git",
    [string]$TargetDir = "$HOME\knowledge",
    [switch]$SkipConverters,
    [switch]$NonInteractive,
    [switch]$WithObsidian,
    [string]$Name  = "",
    [string]$Email = ""
)
$ErrorActionPreference = "Stop"
$canPrompt = -not $NonInteractive
$TemplateUrl = "https://github.com/lemoncloud-io/2nd-brain.git"

function Say($msg)  { Write-Host "`n==> $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "`n[주의] $msg" -ForegroundColor Yellow }
function Fail($msg) {
    Write-Host "`n[실패] $msg" -ForegroundColor Red
    # exit는 스크립트블록(한 줄 부트스트랩)에서 호출한 PowerShell 세션까지 종료시킨다 —
    # 창이 닫혀 실패 메시지를 읽을 수 없다. throw는 이 스크립트만 중단하고 창을 남긴다.
    throw "setup-vault-windows 중단됨"
}
# URL 비교용 정규화: 프로토콜·ssh 접두·.git 접미를 벗겨 host/org/repo만 남긴다
function Get-NormalizedRepoUrl($u) {
    (($u -replace '^https?://','' -replace '^git@','' -replace ':','/' -replace '\.git$','').TrimEnd('/'))
}

# 비대화형 입력은 설치를 시작하기 전에 검사한다 — 도구를 다 깐 뒤 clone 단계에서 멈추지 않게.
if ($NonInteractive -and -not (Test-Path (Join-Path $TargetDir ".git")) -and
    ((Get-NormalizedRepoUrl $RepoUrl) -eq (Get-NormalizedRepoUrl $TemplateUrl))) {
    Fail "-NonInteractive에는 -RepoUrl <내 위키 repo URL>이 필요합니다 (공개 템플릿은 clone하지 않습니다).`n새 repo는 먼저 만드세요: gh repo create <이름> --template lemoncloud-io/2nd-brain --private"
}

# ── 0. winget 확인 ───────────────────────────────────────────
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "winget이 없습니다. Microsoft Store에서 '앱 설치 관리자(App Installer)'를 설치한 뒤 재실행하세요."
}
# Windows PowerShell 5.1은 네이티브 명령이 stderr에 쓰고 그 stderr가 리다이렉트되면
# 출력을 ErrorRecord로 바꾼다. $ErrorActionPreference="Stop"과 만나면 "로그인 안 됨" 같은
# 정상 상태 보고가 스크립트를 중단시킨다 (gh auth status가 대표적).
# 네이티브 호출은 이 함수로 감싼다 — $LASTEXITCODE는 그대로 보존된다.
function Invoke-Native {
    param([Parameter(Mandatory)][scriptblock]$Command)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $Command } finally { $ErrorActionPreference = $prev }
}

# 심링크 생성 권한(개발자 모드 또는 관리자) 점검. 이 vault는 .claude/skills를 심링크로
# 추적하므로, 권한이 없으면 core.symlinks=true clone이 체크아웃 단계에서 실패한다.
# New-Item -ItemType SymbolicLink는 쓰지 않는다 — Windows PowerShell 5.1의 구현이 개발자 모드를
# 인식하지 못해 항상 관리자를 요구하고, git은 되는데 probe만 실패하는 오탐이 난다(실기기 확인).
# cmd mklink는 git과 같은 CreateSymbolicLink 경로라 개발자 모드를 그대로 반영한다.
function Test-SymlinkPrivilege {
    $base = Join-Path ([IO.Path]::GetTempPath()) ("vault-symlink-probe-" + [guid]::NewGuid().ToString("N"))
    $target = "$base-target"; $link = "$base-link"
    try {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        cmd /c "mklink /D `"$link`" `"$target`"" 2>&1 | Out-Null
        return (Test-Path $link)
    } catch { return $false }
    finally {
        # 링크는 rmdir로 지운다. Remove-Item -Recurse는 디렉터리 심링크를 따라가 대상까지 지운다.
        if (Test-Path $link) { cmd /c "rmdir `"$link`"" 2>&1 | Out-Null }
        Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
    }
}
function Update-SessionPath {
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
}

# ── 1. Git ───────────────────────────────────────────────────
if (Get-Command git -ErrorAction SilentlyContinue) {
    Say "Git 확인됨: $(git --version)"
} else {
    Say "Git 설치 중..."
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    Update-SessionPath
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Fail "Git을 설치했지만 git 명령을 아직 찾지 못합니다. 새 PowerShell 창을 열어 이 스크립트를 다시 실행하세요."
    }
}

# ── 2. Obsidian (비대화형 모드는 -WithObsidian일 때만) ───────
$obsidianInstalled = Invoke-Native { winget list --id Obsidian.Obsidian -e 2>$null } | Select-String "Obsidian"
if ($obsidianInstalled) {
    Say "Obsidian 확인됨"
} elseif ($NonInteractive -and -not $WithObsidian) {
    Say "Obsidian 설치 건너뜀 (필요하면 -WithObsidian)"
} else {
    Say "Obsidian 설치 중..."
    winget install --id Obsidian.Obsidian -e --accept-source-agreements --accept-package-agreements
}

# ── 3. Claude Code CLI (공식 설치기 — 자동 업데이트됨) ──────
# 비대화형 모드는 Claude 안에서 돌므로 설치하지 않는다(PATH 등록만 아래에서 보장).
if ($NonInteractive) {
    Say "Claude Code 설치 건너뜀 (비대화형 모드)"
} elseif (Get-Command claude -ErrorAction SilentlyContinue) {
    Say "Claude Code 확인됨"
} else {
    Say "Claude Code 설치 중..."
    Invoke-Native { irm https://claude.ai/install.ps1 | iex }
}
# 공식 설치기는 %USERPROFILE%\.local\bin 에 넣고 PATH 영구 등록은 사용자에게 맡긴다
# (설치기 스스로 "not in your PATH"라고 안내한다). 등록하지 않으면 이 세션에서만 잡히고
# 새 PowerShell에서 claude를 찾지 못한다 — 안내문의 "새 PowerShell에서 claude"와 어긋난다.
# 설치 여부와 무관하게 매 실행 보장한다(재실행 안전).
$claudeBin = "$HOME\.local\bin"
if (Test-Path $claudeBin) {
    $userPath = [Environment]::GetEnvironmentVariable("Path","User")
    if (-not $userPath) { $userPath = "" }
    if (($userPath -split ";") -notcontains $claudeBin) {
        $joined = if ($userPath.TrimEnd(";")) { $userPath.TrimEnd(";") + ";" + $claudeBin } else { $claudeBin }
        [Environment]::SetEnvironmentVariable("Path", $joined, "User")
        Say "PATH에 $claudeBin 등록됨 (새 PowerShell부터 적용)"
    }
    if (($env:Path -split ";") -notcontains $claudeBin) { $env:Path += ";$claudeBin" }
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Warn "claude 명령을 아직 찾지 못했습니다 — 설치는 됐을 수 있으니 새 PowerShell에서 'claude --version'으로 확인하세요."
}

# ── 3b. 문서 변환 도구 (pandoc · uv) ─────────────────────────
# hwp·doc·pdf를 위키에 넣는 변환 스킬(hwp2md·doc2md·pdf2md-ingest)의 공통 전제.
# 웹 클리핑만 쓰는 구성원은 -SkipConverters 로 건너뛴다. 실패해도 온보딩은 계속된다.
if ($SkipConverters) {
    Say "문서 변환 도구 설치 건너뜀 (-SkipConverters)"
} else {
    foreach ($tool in @(@{ cmd = "pandoc"; id = "JohnMacFarlane.Pandoc" }, @{ cmd = "uv"; id = "astral-sh.uv" })) {
        if (Get-Command $tool.cmd -ErrorAction SilentlyContinue) {
            Say "$($tool.cmd) 확인됨"
        } else {
            Say "$($tool.cmd) 설치 중 (hwp·doc·pdf 변환용)..."
            winget install --id $tool.id -e --accept-source-agreements --accept-package-agreements
            Update-SessionPath
            if (-not (Get-Command $tool.cmd -ErrorAction SilentlyContinue)) {
                Warn "$($tool.cmd) 명령을 아직 찾지 못했습니다 — 새 PowerShell에서 '$($tool.cmd) --version'으로 확인하세요. (hwp·doc·pdf 변환에만 필요, 온보딩은 계속됩니다)"
            }
        }
    }
}

# ── 3c. 지식 뷰어 런타임 (Node.js 24+) ───────────────────────
# "볼트 뷰어 열어줘"·"연결 그래프 보여줘"(projects/knowledge-viewer)의 전제 — 루트 package.json engines.
# 실패해도 온보딩은 계속된다.
$nodeMajor = 0
if (Get-Command node -ErrorAction SilentlyContinue) { $nodeMajor = [int](Invoke-Native { node -p "process.versions.node.split('.')[0]" }) }
if ($nodeMajor -ge 24) {
    Say "Node.js 확인됨: $(node --version)"
} else {
    Say "Node.js 설치 중 (지식 뷰어용)..."
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Update-SessionPath
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Warn "node 명령을 아직 찾지 못했습니다 — 새 PowerShell에서 'node --version'으로 확인하세요. (지식 뷰어에만 필요, 온보딩은 계속됩니다)"
    }
}

# ── 4. GitHub 로그인 + git 사용자 정보 ───────────────────────
# 프라이빗 팀 repo clone과 이후 커밋·PR(Claude 위임 포함)에 필요하다.
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Say "GitHub CLI 설치 중..."
    winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
    Update-SessionPath
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Fail "GitHub CLI를 설치했지만 gh 명령을 아직 찾지 못합니다. 새 PowerShell 창을 열어 이 스크립트를 다시 실행하세요."
    }
}
Invoke-Native { gh auth status 2>$null } | Out-Null
if ($LASTEXITCODE -eq 0) {
    Say "GitHub 로그인 확인됨"
} elseif ($NonInteractive) {
    # 로그인은 일회용 코드를 사용자가 브라우저에 입력해야 한다 — 호출자(SETUP.md)가 먼저 끝낸다.
    Fail "GitHub 로그인이 필요합니다. 먼저 'gh auth login --web --git-protocol https'로 로그인한 뒤 재실행하세요."
} else {
    Say "GitHub 로그인 — 브라우저가 열리면 안내를 따르세요"
    Invoke-Native { gh auth login --web --git-protocol https }
    if ($LASTEXITCODE -ne 0) { Fail "GitHub 로그인 실패 — 재실행하세요." }
}
Invoke-Native { gh auth setup-git 2>$null } | Out-Null   # HTTPS clone/push에 gh 자격증명 사용

# gh 로그인 단계의 "Press Enter"에서 엔터를 여러 번 누르면 남은 개행을 아래 Read-Host가
# 먹어 이름·이메일이 빈 값으로 넘어간다(실기기 확인). 묻기 전에 입력 버퍼를 비운다.
if ($canPrompt) { try { while ([Console]::KeyAvailable) { [Console]::ReadKey($true) | Out-Null } } catch { } }
if ($Name)  { git config --global user.name $Name }
if ($Email) { git config --global user.email $Email }
if ($canPrompt -and -not (Invoke-Native { git config --global user.name 2>$null })) {
    $gitName = Read-Host "git 커밋에 기록할 이름 (예: 홍길동)"
    if ($gitName) { git config --global user.name $gitName }
}
if ($canPrompt -and -not (Invoke-Native { git config --global user.email 2>$null })) {
    $gitEmail = Read-Host "git 커밋에 기록할 이메일 (회사 이메일)"
    if ($gitEmail) { git config --global user.email $gitEmail }
}
if (-not (Invoke-Native { git config --global user.name 2>$null }) -or -not (Invoke-Native { git config --global user.email 2>$null })) {
    Warn "git 사용자 정보 미설정 — 커밋 시 필요합니다:`n  git config --global user.name `"이름`" ; git config --global user.email `"이메일`""
}

# ── 5. 팀 repo 지정 + vault clone ────────────────────────────
if ($canPrompt -and -not (Test-Path (Join-Path $TargetDir ".git")) -and ($RepoUrl -eq $TemplateUrl)) {
    $inputUrl = Read-Host "팀 vault repo URL을 입력하세요 (예: https://github.com/<org>/<repo>.git — 엔터 = 공개 템플릿으로 시작)"
    if ($inputUrl) { $RepoUrl = $inputUrl }
    if ($RepoUrl -eq $TemplateUrl) {
        Warn "공개 템플릿($TemplateUrl)을 clone합니다 — 팀 위키가 아닙니다.`n팀 repo가 있다면 지금 중단(Ctrl+C)하고 재실행 때 URL을 입력하세요.`n팀 repo를 새로 만들 관리자는 clone 대신 GitHub template 생성이 정본입니다:`n  SETUP.md 6단계 참조 (gh repo create --template lemoncloud-io/2nd-brain --private)"
    }
}

if (Test-Path (Join-Path $TargetDir ".git")) {
    Say "vault가 이미 있습니다: $TargetDir (clone 생략)"
} elseif ((Test-Path $TargetDir) -and (Get-ChildItem $TargetDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Fail "$TargetDir 폴더가 이미 있고 비어있지 않은데 git repo가 아닙니다. 폴더를 비우거나 -TargetDir로 다른 경로를 지정해 재실행하세요."
} else {
    if (-not (Test-SymlinkPrivilege)) {
        Warn "심링크 생성 권한이 없습니다 — clone이 체크아웃 단계에서 실패할 수 있습니다.`n지금 중단(Ctrl+C)하고 Windows 설정 → 개인 정보 및 보안 → 개발자용 → 개발자 모드를 켠 뒤`n이 스크립트를 다시 실행하는 것을 권합니다. (또는 PowerShell을 관리자로 실행)"
    }
    Say "vault clone 중: $RepoUrl → $TargetDir"
    # core.symlinks=true: .claude/skills 상대 심링크 보존 시도 (검증은 7번 단계)
    Invoke-Native { git clone -c core.symlinks=true $RepoUrl $TargetDir }
    if ($LASTEXITCODE -ne 0) {
        Fail "clone 실패. 순서대로 확인하세요:`n  1) 심링크 권한 — 개발자 모드가 꺼져 있으면 체크아웃이 실패합니다 (설정 → 개인 정보 및 보안 → 개발자용).`n  2) repo 주소와 팀 repo 초대 수락 여부.`n  3) 로그인 — 'gh auth login'으로 브라우저 로그인 후 재실행."
    }
}

# 잔여 안전망: origin이 여전히 공개 템플릿이면 push·PR이 공개 repo로 향한다
$currentOrigin = Invoke-Native { git -C $TargetDir remote get-url origin 2>$null }
if ($currentOrigin -and ((Get-NormalizedRepoUrl $currentOrigin) -eq (Get-NormalizedRepoUrl $TemplateUrl))) {
    Warn "origin이 공개 부트스트랩 템플릿입니다. 팀 repo가 생기면 전환하세요:`n  git -C `"$TargetDir`" remote set-url origin <팀-repo-URL>"
}

# ── 6. VAULT_DIR 등록 ────────────────────────────────────────
$existingVaultDir = [Environment]::GetEnvironmentVariable("VAULT_DIR", "User")
if (-not $existingVaultDir) {
    [Environment]::SetEnvironmentVariable("VAULT_DIR", $TargetDir, "User")
    Say "VAULT_DIR 사용자 환경변수 등록됨: $TargetDir"
} elseif ($existingVaultDir -eq $TargetDir) {
    Say "VAULT_DIR 이미 등록됨: $TargetDir"
} else {
    Warn "VAULT_DIR이 다른 경로로 이미 등록되어 있습니다: $existingVaultDir`n이번 설치 경로($TargetDir)를 쓰려면 시스템 설정 → 환경 변수에서 VAULT_DIR을 수정하세요."
}

# ── 7. 구조 검증 ─────────────────────────────────────────────
if (-not (Test-Path (Join-Path $TargetDir "VAULT_RULES.md"))) {
    Fail "VAULT_RULES.md가 없습니다 — repo 주소를 확인하세요."
}
if (-not (Test-Path (Join-Path $TargetDir "wiki"))) {
    Warn "wiki/ 폴더가 없습니다 — vault 구조를 확인하세요."
}
# 심링크 검증: git 인덱스 기준 symlink(mode 120000)가 디스크에서 ReparsePoint가 아니면
# Developer Mode 꺼진 체크아웃 — .claude/skills가 텍스트 파일로 떨어져 스킬이 동작하지 않는다.
$symlinkPaths = @(git -C $TargetDir ls-files -s | Select-String '^120000' | ForEach-Object { ($_.Line -split "`t")[-1] })
$brokenLinks = @($symlinkPaths | Where-Object {
    $item = Get-Item (Join-Path $TargetDir $_) -Force -ErrorAction SilentlyContinue
    -not ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint))
})
if ($brokenLinks.Count -gt 0) {
    Warn "심링크 $($brokenLinks.Count)개가 텍스트 파일로 체크아웃됐습니다 (예: $($brokenLinks[0])).`n.claude/skills가 동작하지 않습니다. Windows 설정 → 개발자 모드(Developer Mode)를 켠 뒤:`n  git -C `"$TargetDir`" checkout -- .`n으로 다시 체크아웃하거나 폴더를 지우고 재실행하세요."
} else {
    Say "구조 검증 통과"
}

# ── 8. 다음 단계 안내 ────────────────────────────────────────
# 비대화형 모드의 다음 단계는 호출자(SETUP.md)가 안내한다 — 기계가 읽을 한 줄만 남긴다.
if ($NonInteractive) {
    Write-Host "`nSETUP_OK vault=$TargetDir"
    return
}
Write-Host @"

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
    터미널을 쓴다면: 새 PowerShell에서  cd `$env:VAULT_DIR ; claude
    (첫 실행 시 브라우저 로그인 — 유료 플랜 계정 필요)
 5. 한글(hwp)·워드(docx)·PDF 문서를 위키에 넣으려면 "이 파일 잉게스트해줘"로 요청
    (변환 도구는 이 스크립트가 설치했습니다)

 전체 안내 문서: 팀 위키의 docs/non-developer-onboarding.md
────────────────────────────────────────────
"@
