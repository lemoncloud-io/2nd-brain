// `viewer.yml`(project-viewer 셸의 스펙) → 빌드 산출물 경로. 서버와 화면이 함께 쓴다. 순수 함수다.
// 셸 cli 는 `<프로젝트>/config/viewer.yml` 만 읽고, 산출물은 `<프로젝트>/outputs/viewer/index.html` 로 고정이다
// (projects/project-viewer/config/shell/vite.config.ts 의 outDir — 스키마에 산출 경로 필드는 없다).

export const VIEWER_SPEC_NAME = 'viewer.yml';

/** 이름이 정확히 `viewer.yml` 인 파일인가(폴더는 어디든). */
export function isViewerSpecPath(path: string): boolean {
  return path === VIEWER_SPEC_NAME || path.endsWith(`/${VIEWER_SPEC_NAME}`);
}

/** cli 빌드 대상이면 프로젝트 폴더(`projects/devops/config/viewer.yml` → `projects/devops`). 아니면 null. */
export function viewerProjectOf(path: string): string | null {
  const m = /^(.+)\/config\/viewer\.yml$/.exec(path);
  return m === null ? null : m[1]!;
}

/** 스펙의 빌드 산출물. cli 가 빌드하지 않는 위치(`config/` 밖)는 null 이다. */
export function viewerOutputOf(path: string): string | null {
  const project = viewerProjectOf(path);
  return project === null ? null : `${project}/outputs/viewer/index.html`;
}

/** 산출물 → 그 스펙(viewerOutputOf 의 반대). `<프로젝트>/outputs/viewer/index.html` 이 아니면 null. 스펙이 실제로 있는지는 보지 않는다. */
export function viewerSpecOfOutput(path: string): string | null {
  const m = /^(.+)\/outputs\/viewer\/index\.html$/.exec(path);
  return m === null ? null : `${m[1]!}/config/${VIEWER_SPEC_NAME}`;
}

/** 빌드 명령(볼트 루트에서 돌린다). */
export function viewerBuildCommand(project: string): string {
  return `node projects/project-viewer/config/shell/cli.ts build ${project}`;
}

/** `/api/viewer-spec` 응답. 시각은 ms(epoch)다. */
export type ViewerSpecResponse = {
  spec: string;
  /** cli 빌드 대상이면 프로젝트 폴더, 아니면 null. */
  project: string | null;
  /** 산출물 경로. 빌드 대상이 아니면 null. */
  output: string | null;
  /** 이 소스에 산출물이 있는가. */
  exists: boolean;
  /** 산출물이 스펙보다 오래됐는가. 둘 중 하나의 시각을 모르면 null. */
  stale: boolean | null;
  /** 시각의 근거: 디스크 수정 시각(mtime) 또는 마지막 커밋 시각(commit). 모르면 null. */
  basis: 'mtime' | 'commit' | null;
  specTime: number | null;
  outputTime: number | null;
};
