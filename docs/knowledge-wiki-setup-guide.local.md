# Knowledge Wiki Setup Guide — 이 템플릿의 덧붙임

이 문서는 [`knowledge-wiki-setup-guide.md`](knowledge-wiki-setup-guide.md)(다른 곳에서 관리되는 사본)에 이 볼트가 덧붙이는 내용이다. 그 문서의 절 번호를 따라 읽는다.

## 3. 저장소 clone — 템플릿에서 시작할 때

- 이 저장소는 **초기 부트스트랩용 템플릿**이다. 가이드의 `<vault-repo>` 자리에 처음에는 이 템플릿 저장소를 넣어 clone한다.
- `~/knowledge`는 예시 경로일 뿐이다. 핵심은 clone한 폴더를 `VAULT_DIR`로 **명시 지정**하는 것이다. `CLAUDE.md` § Vault Root는 어떤 툴도 `~/knowledge`로 조용히 폴백하지 못하게 하므로, 다른 위치에 clone했다면 그 경로를 홈 기준(`$HOME/...`)으로 `VAULT_DIR`에 지정한다. 개인 머신의 절대경로는 문서에 남기지 않는다.
- clone 직후 origin은 템플릿 저장소를 가리킨다. 본인/팀 소유의 git으로 전환한다.

```bash
git remote set-url origin <YOUR_GIT_REMOTE_URL>   # 예: git@github.com:<you>/<your-vault>.git
git remote -v                                     # origin이 본인 저장소인지 확인
git push -u origin master                         # 최초 1회 본인 저장소로 push
```

이후 clone·push·PR은 모두 본인 저장소를 기준으로 한다. 가이드 뒤쪽의 `<vault-repo>`도 본인 저장소로 읽는다.

- 이어서 배포 값을 본인/팀 값으로 교체한다. 스킬 본문은 건드리지 않는다 — 조직 고유 값의 단일 출처는 이 파일이다.

```bash
$EDITOR projects/second-brain/config/team-settings.yaml
# vault.name · github.vault_repo · github.default_reviewer · mail.weekly_report.to
```

## 5. Obsidian 플러그인 — 추가 후보

| 플러그인 | 용도 | 권장 설정 |
| --- | --- | --- |
| Claudian | 클로드 실행 플러그인 | 기본값으로 시작 |
