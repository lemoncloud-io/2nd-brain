// 코어 시험이 쓰는 합성 확장 값. 이 볼트의 실제 확장(ext/)과 무관한 이름(demo)만 쓴다.
import { createHash } from 'node:crypto';
import path from 'node:path';

import type { AppServer, ViewerApp } from '../../server/apps/registry.ts';
import type { ViewerAppUi } from '../../src/apps/registry.ts';
import type { CenterViewExtension } from '../../src/ext/define.ts';

/** 데모 글 경로 → 앱 화면 해시의 id(경로 SHA-256 앞 16자). */
export const demoPostId = (p: string): string => createHash('sha256').update(p).digest('hex').slice(0, 16);

/** 합성 앱 화면 둘. 하나만 docLink(데모 글 md → 그 글 화면)를 갖는다. */
export const FAKE_APP_UIS: ViewerAppUi[] = [
  {
    id: 'demo-board',
    title: '데모 보드',
    icon: 'checklist',
    load: async () => ({ App: () => null }),
    docLink: (p) => (/^projects\/demo\/posts\/[^/]+\.md$/.test(p) ? `view=post&id=${demoPostId(p)}` : null),
  },
  { id: 'demo-desk', title: '데모 데스크', icon: 'pr', load: async () => ({ App: () => null }) },
];

/** 아무 요청에나 {ok:true} 로 답하는 앱 서버. */
const fakeServer = async (): Promise<AppServer> => ({ handle: (_q, r) => r.end('{"ok":true}'), close: async () => {} });

/** 합성 앱 서버 둘(화면과 같은 id). 하나는 볼트 tmp/ 아래 저장소를 쓴다. */
export const FAKE_APPS: ViewerApp[] = [
  { id: 'demo-board', title: '데모 보드', storeDir: (r) => path.join(r, 'tmp', 'demo', 'board'), server: fakeServer },
  { id: 'demo-desk', title: '데모 데스크', server: fakeServer },
];

/** 합성 원격 이미지 허용 호스트 기본값. */
export const FAKE_HOSTS: string[] = ['img.example.com', '*.cdn.example.org'];

/** 합성 가운데 열 확장 화면 하나: 옛 경로·단축키 q·안쪽 해시 라우터·목차 숨김·그림 글자 줄을 모두 켠다. */
export const FAKE_VIEW: CenterViewExtension = {
  id: 'atlas',
  title: '데모 지도',
  icon: () => null,
  home: { path: 'projects/demo/README.md', anchor: '/map' },
  legacyPaths: ['projects/demo/outputs/site/index.html'],
  shortcut: { key: 'q', desc: '데모 지도 보기' },
  hashRouted: true,
  hidePanels: ['toc'],
  archifyZoom: true,
  load: async () => ({ default: () => null }),
};
