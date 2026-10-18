# 비개발자 온보딩 가이드 — 터미널 없이 팀 위키 쓰기
<!-- origin: lemoncloud-io/knowledge@6f4088ca:docs/non-developer-onboarding.md -->

작성일: 2026-08-24
대상: 문서를 읽고·쓰고·클리핑하는 비개발자 팀원 (Tier 1)

> 개발자·자동화 담당자용 상세 가이드는 [`knowledge-wiki-setup-guide.md`](knowledge-wiki-setup-guide.md)를 본다. 이 문서는 터미널을 **설치할 때 딱 한 번**만 쓰고, 이후 모든 작업을 Obsidian과 Claude 채팅으로 하는 경로다.

## 끝나면 되는 것

- 웹에서 본 글을 브라우저 버튼 한 번으로 위키에 저장(클리핑)한다.
- Obsidian에서 팀 위키를 읽고 편집한다.
- Claude 채팅에 "클리핑 처리해줘"라고 입력하면 정리·분류·PR 생성까지 자동으로 된다.
- git, 브랜치, 커밋, PR을 직접 다루지 않는다 — 전부 Claude가 대신한다.

## 준비물 (시작 전에 받아 둘 것)

| 항목 | 어디서 받나 |
| --- | --- |
| 팀 vault repo 주소 (예: `https://github.com/<org>/<repo>.git`) | 팀 관리자 |
| GitHub 계정 + 팀 repo 접근 권한(초대) | 팀 관리자 |
| Claude 유료 플랜 계정 (Pro 이상 — 무료 플랜은 Claude Code 사용 불가) | 회사 좌석 또는 개인 구독 |

## 1단계 — 설치 스크립트 실행 (터미널을 쓰는 유일한 순간)

스크립트 하나가 필요한 프로그램(Git, Obsidian, Claude Code, GitHub CLI, 문서 변환 도구 pandoc·uv)을 설치하고, GitHub에 브라우저로 로그인시키고, 팀 위키를 내 컴퓨터(`~/knowledge`)로 복사하고, 환경 설정까지 끝낸다. 이미 설치·설정된 것은 건너뛰므로 실패해도 다시 실행하면 된다.

### macOS

1. `Cmd+Space` → "터미널" 검색 → 실행.
2. 아래 한 줄을 통째로 복사해 붙여넣고 Enter:

   ```bash
   bash -c "$(curl -fsSL https://raw.githubusercontent.com/lemoncloud-io/2nd-brain/master/projects/second-brain/config/scripts/setup-vault-mac.sh)"
   ```

### Windows

1. 시작 메뉴 → "PowerShell" 검색 → 실행.
2. 아래 한 줄을 통째로 복사해 붙여넣고 Enter:

   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/lemoncloud-io/2nd-brain/master/projects/second-brain/config/scripts/setup-vault-windows.ps1).TrimStart([char]0xFEFF)))
   ```

### 스크립트가 묻는 것 (순서대로)

- **(macOS) 관리자 비밀번호** — Homebrew 설치용. 컴퓨터 로그인 비밀번호를 입력한다.
- **GitHub 로그인** — 브라우저가 열리면 GitHub 계정으로 로그인하고 화면의 코드를 입력한다.
- **git 커밋에 기록할 이름·이메일** — 본인 이름과 회사 이메일을 입력한다 (문서 변경 기록에 표시되는 정보).
- **"팀 vault repo URL을 입력하세요"** — 준비물로 받아 둔 팀 repo 주소를 붙여넣는다. **이 단계를 건너뛰면 안 된다** — 건너뛰면 팀 위키가 아니라 공개 템플릿이 복사된다. 실수로 Enter만 쳤다면 `~/knowledge` 폴더를 지우고 스크립트를 다시 실행해 URL을 입력한다.

마지막에 "설치 완료! 다음 단계"가 출력되면 성공이다. 이후로는 터미널을 닫아도 된다.

## 2단계 — Obsidian에서 위키 열기

1. Obsidian 실행 → **Open folder as vault** → 홈 폴더의 `knowledge` 선택.
2. 왼쪽 파일 목록에 `wiki`, `Clippings`, `VAULT_RULES.md`가 보이면 정상.
3. 설정(⚙) → **Community plugins** → **Restricted mode 끄기(Turn off)**.
4. **Browse**에서 다음 플러그인을 설치·활성화:
   - **Git** — 팀원들이 올린 최신 문서를 자동으로 받아온다.
     설정에서 **auto-pull만 켜고 push 관련 자동화는 모두 끈다.** 올리는 쪽(commit·push·PR)은 Claude가 담당한다.
   - **Templater**, **Dataview** — 노트 템플릿·목록 기능 (권장).

읽고 싶은 문서는 `wiki/INDEX.md`에서 시작하면 된다.

## 3단계 — 웹 클리핑 버튼 만들기

1. Chrome 웹 스토어에서 **Obsidian Web Clipper** 확장 설치.
2. 확장 설정에서 vault를 `knowledge`로, 저장 폴더(Note location)를 **`Clippings`**로 지정.
3. 아무 웹 페이지에서 확장 버튼을 눌러 저장해 본다 — Obsidian의 `Clippings` 폴더에 파일이 생기면 성공.

저장만 하면 된다. 정리·분류는 다음 단계의 Claude가 한다.

## 4단계 — Claude Desktop 앱에 위키 폴더 연결

1. <https://claude.ai/download>에서 **Claude Desktop 앱** 설치 → 회사(유료 플랜) 계정으로 로그인.
2. 앱에서 폴더 연결(Cowork) 기능으로 홈 폴더의 `knowledge`를 연결한다.
3. 연결되면 채팅창에 이렇게 입력해 본다:

   ```text
   클리핑 처리해줘
   ```

   Claude가 `Clippings`의 새 파일을 읽고 → 위키 문서로 정리하고 → 검토용 PR(변경 제안)까지 만든 뒤 링크를 보여준다. 링크를 열어 내용을 확인하고 팀 규칙에 따라 승인받으면 끝이다.

자주 쓰는 채팅 문구:

| 하고 싶은 것 | 입력 |
| --- | --- |
| 클리핑 정리 | "클리핑 처리해줘" |
| 위키에서 찾기 | "○○에 대해 vault에서 찾아줘" |
| 주간 보고 | "주간 보고" |

## 하면 안 되는 것

- **`raw/`·`archive/` 폴더의 파일을 수정·이동·삭제하지 않는다** — 원본 보존 구역이다.
- **비밀번호·토큰·개인정보·고객사 자료를 위키에 넣지 않는다** — 한 번 올라간 기록은 지워도 이력에 남는다.
- Obsidian Git 플러그인으로 **직접 push하지 않는다** — 올리기는 Claude의 PR 경로만 쓴다.

## 문제 해결

| 증상 | 조치 |
| --- | --- |
| 스크립트가 "clone 실패 — repo 주소와 팀 repo 초대 수락 여부를 확인하세요" | 팀 repo 초대 메일을 수락했는지, 주소 오타가 없는지 확인 후 재실행. 계속 실패하면 팀 관리자에게 문의. |
| "GitHub 로그인 실패" | 스크립트를 다시 실행해 브라우저 로그인을 다시 시도한다. |
| "공개 템플릿을 clone합니다 — 팀 위키가 아닙니다" 경고가 떴다 | 팀 repo 주소를 입력하지 않고 넘어간 것. `~/knowledge` 폴더를 지우고 스크립트를 다시 실행해 그때 주소를 붙여넣는다. |
| (Windows) "Git을 설치했지만 … 새 PowerShell 창을 열어" | PowerShell 창을 닫고 새로 연 뒤 스크립트를 다시 붙여넣는다. |
| (Windows) "심링크 N개가 텍스트 파일로 체크아웃됐습니다" 경고 | Windows 설정 → 개발자 모드(Developer Mode) 켜기 → 경고문에 적힌 안내대로 다시 체크아웃. 모르겠으면 팀 관리자에게 경고문을 그대로 전달한다. |
| 채팅에서 Claude가 폴더를 못 읽는다 | Desktop 앱에서 `knowledge` 폴더가 연결돼 있는지 확인 후 앱 재시작. |
| Obsidian에 남의 최신 글이 안 보인다 | Git 플러그인의 pull을 수동 실행(명령 팔레트 → "Git: Pull") 또는 Obsidian 재시작. |

해결 안 되면: 화면의 에러 문구를 **그대로 복사**해 팀 관리자나 Claude 채팅에 붙여넣는다.

## 팀 관리자용 체크리스트 (온보딩 시켜 주는 사람)

- [ ] (팀 repo가 아직 없으면) `docs/wiki-vault-setup-free.md` 절차로 생성 —
  공개 템플릿을 clone하는 것이 아니라 **GitHub template 생성**(`gh repo create --template ... --private`)이 정본.
  무료 공유가 목적이면 유료 org에 만들지 않는다(좌석 비용 발생, 같은 문서 참조)
- [ ] 팀 vault repo에 신규 팀원 초대 (읽기·쓰기 권한 — 무료 플랜으로 성립)
- [ ] 팀 repo 주소를 전달 (스크립트가 물을 때 붙여넣을 값)
- [ ] Claude 유료 플랜 좌석 확인
- [ ] 온보딩 후 첫 클리핑 PR이 **팀 repo**로 열렸는지 확인 (공개 템플릿 repo가 아닌지)
- [ ] `projects/second-brain/config/team-settings.yaml`이 팀 값으로 교체돼 있는지 확인 (repo 최초 구축 시 1회)
