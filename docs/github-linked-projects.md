# GitHub-Linked Projects
<!-- origin: lemoncloud-io/knowledge@f68f1d38:docs/github-linked-projects.md -->

Contract for tracking external GitHub repos in this vault. It is a separate document so it is
read when registering or syncing a repo rather than loaded every session.

Summary and entry point: `VAULT_RULES.md` § GitHub-Linked Projects.
Skills: `projects/second-brain/config/skills/github-project-link.md` (clone + register) and
`github-project-sync.md` (detect + propose).

## Scope

External GitHub repos are tracked in the vault as lightweight status/goal notes. Knowledge
promotion and output collection are out of scope for this layer.

## Identity and Paths

- Identity is `org/repo`. Never record machine-specific clone paths in the vault.
- Local clones live at `$GITHUB_DIR/<org>/<folder>` (usually `<repo>`). Resolve `GITHUB_DIR`
  from the environment first; default to `~/Documents` when unset. This mirrors the
  `VAULT_DIR` resolution rule in `CLAUDE.md`.
- The vault link point is `projects/@<org>/<folder>/README.md`, where `<folder>` is the same
  name as the local clone folder under `$GITHUB_DIR/<org>/` — usually the repo name, or a
  qualifier-suffixed name for version-line clones (e.g. `my-lib-v42`). The `@` prefix
  marks a GitHub-linked project; the repo identity always comes from the note's `repo`
  frontmatter, not the folder name.

## Note Contract

- Lightweight: `README.md` only, using `templates/project-readme-github.md`. Create
  `outputs/` only when actually needed.
- Frontmatter keeps the standard project contract and adds `repo` (the `org/repo` coordinate,
  machine-readable link marker) and `last_synced`.
- Optional `branch` frontmatter pins the tracked main branch when the working main line
  differs from the repo's default branch (e.g. a version-line branch like `feat/v4.2` on
  `my-lib`, tracked as folder `my-lib-v42`). Workflows that read repo docs or activity
  must use the pinned branch when present. Because the vault folder mirrors the clone folder,
  the clone is always at `$GITHUB_DIR/<org>/<folder>` — no remote-URL scanning needed.

## Lanes

Sub-folders under `projects/@<org>/<folder>/` carry promoted or in-progress work tied to that
repo. A lane lives under the project folder, not at the vault root. Two lane kinds are in use:

- **Feature/execution lanes** — one folder per work item, flat under the repo folder
  (`<slug>/`, e.g. `my-app/flow-json-round-trip/`,
  `my-api/subscription-lifecycle/`). These hold execution state for feature
  specs and analyses.
- **Domain policy lane** — `domains/<domain>/` (e.g.
  `my-api/domains/subscription/`). Reference copies of repo
  policy docs that are not work items. The repo is canonical: frontmatter carries
  `type: domain`, `canonical: repo`, `source_path`, `source_branch`, `source_commit`,
  `last_synced`. Bodies stay unchanged except link fixes recorded in the lane README's
  `## Snapshot`; drift is resolved by re-syncing from the repo, never by editing the vault copy
  into a fork.

## Index

- Two-level. [`projects/README.md`](../projects/README.md) gets one row per org; the per-repo table lives in
  `projects/@<org>/README.md` and must be updated on registration and status changes.
- `status: done` → move the folder to `archive/projects/@<org>/<repo>/`.

## Write Boundaries

- 이 절의 write boundary는 `github-project-link`/`github-project-sync` 같은 **등록·동기화 workflow**에 적용된다.
- Never change external repos remotely: no commits, no pushes. Local untracked analysis
  artifacts inside a clone (e.g. `graphify-out/`, a local `.graphifyignore`) are allowed but
  must never be staged, committed, or pushed.
- Sync agents detect and propose changes; the user decides final `status`/`goal`/`next_action`
  values before they are written.

사용자가 제품 개발을 별도로 요청한 경우에는 이 등록·동기화 workflow가 repo를 수정하지 않고, 확인된 `repo`
identity와 local clone 좌표를 개발 workflow에 handoff한다. 이후 spec/plan은 vault가, 코드·테스트·worktree·commit은
대상 repo가 소유한다. 역할·repo별 세션·검증 계약은 `projects/devops/docs/backend-harness-repository-boundary.md`를 따른다(해당 문서가 있는 볼트에서만).

## Access and Visibility

- Repo access follows each member's own GitHub permissions. Notes are visible to the whole
  team, but sync coverage varies by who runs it: repos the runner cannot access are skipped
  and recorded in the report — normal behavior, not an error.
- Personal GitHub-linked projects use the same `@<owner>/<repo>` structure; the owner segment
  already distinguishes team orgs from personal accounts. Mark them `scope: personal` in
  frontmatter (default `scope: team`).
- Personal projects are exempt from INDEX reachability (`VAULT_RULES.md` § Note Contracts,
  Reachability): shared pages need not link them. Material promoted out of them — into an idea,
  a goal project or a wiki note — is an ordinary document and must be reachable from INDEX.
- This vault is a shared team repo: personal project notes are visible to the whole team.
  Record only metadata that is fine to share; privately-managed personal projects belong in a
  personal vault, not here.
- Alternatively, a personal owner can stay local-only: gitignore `projects/@<owner>/` so its
  notes never reach the shared repo. Local-only owners get no row in the shared
  `projects/README.md` index (that file is tracked); their org index inside the ignored folder
  is the only index.

## Tooling Fallback

Workflows may read a local clone when present and must fall back to the `gh` API when absent.
If `gh` is missing or unauthenticated, report it explicitly; never fail silently.
