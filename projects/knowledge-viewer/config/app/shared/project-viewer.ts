// `/api/project-viewer` 응답 — viewer.yml 하나를 project-viewer 셸의 model·loader 로 묶은 데이터(Bundle).
// 화면은 이것을 셸 컴포넌트(ProjectViewer)에 그대로 넘긴다. 서버와 화면이 함께 쓰는 형식이다.
import type { Bundle, Issue } from '../../../../project-viewer/config/shell/model/types.ts';

export type { Bundle, Issue };

/** 셸 폴더(볼트 상대경로). 안내 문구에 쓴다. */
export const SHELL_PATH = 'projects/project-viewer/config/shell';

/** 성공이면 Bundle, viewer.yml 검사 오류면 그 목록(경고 포함). */
export type ProjectViewerResponse =
  | { ok: true; spec: string; bundle: Bundle }
  | { ok: false; spec: string; issues: Issue[] };
