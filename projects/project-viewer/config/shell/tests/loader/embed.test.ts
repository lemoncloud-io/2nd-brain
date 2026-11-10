// 통합 보기의 바꿔 끼우기 표와 어댑터, 그리고 주입받은 읽기로 도는 collect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { collect } from '../../loader/collect.ts';
import { BARE_REDIRECTS, BUNDLE_MODULE, EMBED_REDIRECTS, SHELL_DIR, embedRedirect, isShellStyle, shellDependencies } from '../../loader/embed-redirects.ts';
import { makeReadFile } from '../../loader/vault.ts';
import type { Bundle } from '../../model/types.ts';
import { setEmbed } from '../../src/embed/host.ts';
import type { EmbedHost } from '../../src/embed/host.ts';
import { formatRoute, vaultDocOf } from '../../src/embed/router.ts';
import { formatRoute as formatHash, parseHash } from '../../src/app/router.ts';

const MINI = path.join(import.meta.dirname, '..', 'fixtures', 'mini');
const DEMO = path.join(MINI, 'projects', 'demo');
const NOW = (): Date => new Date('2026-09-19T00:00:00.000Z');
const GIT = { commit: 'abcd1234', dirty: false };

test('바꿔 끼우기 표: 원래 모듈과 어댑터가 다 있고, 어댑터는 원래 모듈의 값 이름을 모두 내보낸다', async () => {
  for (const to of Object.values(BARE_REDIRECTS)) assert.ok(fs.existsSync(path.join(SHELL_DIR, to)), `어댑터 없음: ${to}`);
  for (const [from, to] of Object.entries(EMBED_REDIRECTS)) {
    assert.ok(fs.existsSync(path.join(SHELL_DIR, to)), `어댑터 없음: ${to}`);
    assert.ok(fs.existsSync(path.join(SHELL_DIR, from)), `원래 모듈 없음: ${from}`);
    // 셸이 원래 모듈에 값을 더하면(새 export) 어댑터도 따라가야 한다 — 빠지면 통합 보기 묶음이 깨진다.
    const original = Object.keys(await import(path.join(SHELL_DIR, from)));
    const adapter = new Set(Object.keys(await import(path.join(SHELL_DIR, to))));
    for (const name of original) assert.ok(adapter.has(name), `${to} 에 ${name} 이 없다`);
  }
});

test('embedRedirect: 셸 화면 코드의 import 만 바꾸고, 어댑터 자신·셸 밖·표 밖은 그대로다', () => {
  const app = path.join(SHELL_DIR, 'src', 'app', 'App.tsx');
  const top = path.join(SHELL_DIR, 'src', 'app', 'TopBar.tsx');
  const docs = path.join(SHELL_DIR, 'src', 'reader', 'DocsPage.tsx');
  const bundle = path.join(SHELL_DIR, 'src', 'bundle.ts');
  const adapter = path.join(SHELL_DIR, 'src', 'embed', 'router.ts');
  assert.equal(embedRedirect('./useRoute.ts', app), path.join(SHELL_DIR, 'src/embed/useRoute.ts'));
  assert.equal(embedRedirect('./theme.ts', top), path.join(SHELL_DIR, 'src/embed/theme.ts'));
  assert.equal(embedRedirect('../app/router.ts', docs), path.join(SHELL_DIR, 'src/embed/router.ts'));
  assert.equal(embedRedirect(BUNDLE_MODULE, bundle), path.join(SHELL_DIR, 'src/embed/bundle.ts'));
  assert.equal(embedRedirect('mermaid', path.join(SHELL_DIR, 'src', 'blocks', 'Mermaid.tsx')), path.join(SHELL_DIR, 'src/embed/mermaid.ts'));
  // 어댑터는 진짜 모듈을 부른다.
  assert.equal(embedRedirect('mermaid', path.join(SHELL_DIR, 'src', 'embed', 'mermaid.ts')), null);
  assert.equal(embedRedirect('../app/router.ts', adapter), null);
  assert.equal(embedRedirect('./router.ts', path.join(SHELL_DIR, '..', 'elsewhere', 'x.ts')), null);
  assert.equal(embedRedirect('./search.ts', app), null);
  assert.equal(embedRedirect('react', app), null);
  assert.equal(embedRedirect('./useRoute.ts', undefined), null);
});

test('셸 CSS 판정과 의존성 목록', () => {
  assert.equal(isShellStyle(path.join(SHELL_DIR, 'src', 'styles', 'base.css')), true);
  assert.equal(isShellStyle(`${path.join(SHELL_DIR, 'src', 'styles', 'base.css')}?direct`), true);
  assert.equal(isShellStyle(path.join(SHELL_DIR, 'src', 'embed', 'embed.css')), false);
  const deps = shellDependencies((p) => fs.readFileSync(p, 'utf8'));
  assert.ok(deps.includes('react') && deps.includes('react-dom'));
  assert.deepEqual(shellDependencies(() => '{'), []);
});

test('collect: viewer.yml 본문과 읽기 함수를 주면 디스크·볼트 루트 탐색 없이 같은 Bundle 을 만든다', () => {
  const disk = collect({ projectDir: DEMO, git: GIT, now: NOW });
  const read = makeReadFile(MINI);
  const seen: string[] = [];
  const viewerText = fs.readFileSync(path.join(DEMO, 'config', 'viewer.yml'), 'utf8');
  const injected = collect({
    projectDir: '/없는/폴더', // 디스크를 만지면 볼트 루트를 못 찾아 던진다
    git: GIT,
    now: NOW,
    viewerText,
    readFile: (p) => {
      seen.push(p);
      return read(p);
    },
  });
  assert.deepEqual(injected, disk);
  assert.ok(seen.includes('projects/demo/docs/overview.md'));
});

// 어댑터 시험용 Bundle: 볼트 문서 하나와 저장소 코드 하나.
function fakeBundle(): Bundle {
  const doc = (id: string, p: string, repo?: string) => ({
    id,
    path: p,
    kind: 'doc' as const,
    ...(repo === undefined ? {} : { repo }),
    title: id,
    frontmatter: {},
    body: '',
    digest: '',
    headings: [],
    missing: false,
    embedded: repo === undefined,
  });
  return {
    viewer: { schema_version: 1, meta: { title: 't', kind: 'explainer' }, sources: [], pages: [] },
    docs: { spec: doc('spec', 'projects/x/docs/spec.md'), code: doc('code', 'src/a.ts', 'org/repo') },
    status: {},
    backlinks: {},
    stamp: {
      builtAt: '',
      commit: null,
      dirty: false,
      docCount: 0,
      ymlDigest: '',
      ledgerDigest: null,
      counts: { unresolvedLinks: 0, missingReferences: 0, unverifiedCode: 0, inheritedEvidence: 0 },
    },
    issues: [],
  } as unknown as Bundle;
}

function fakeHost(): EmbedHost {
  return {
    readHash: () => '',
    writeHash: () => {},
    subscribe: () => () => {},
    docHref: (p, a) => `/v/${p}?src=local${a === undefined ? '' : `#${a}`}`,
    openDoc: () => {},
    theme: 'light',
  };
}

test('router 어댑터: 볼트 원본 문서는 바깥 주소, 저장소 코드·모르는 id·다른 화면은 원래 해시다', () => {
  setEmbed(fakeBundle(), fakeHost());
  assert.equal(formatRoute({ kind: 'docs', sourceId: 'spec' }), '/v/projects/x/docs/spec.md?src=local');
  assert.equal(formatRoute({ kind: 'docs', sourceId: 'spec', slug: '검사-규칙' }), '/v/projects/x/docs/spec.md?src=local#검사-규칙');
  assert.equal(formatRoute({ kind: 'docs', sourceId: 'code' }), formatHash({ kind: 'docs', sourceId: 'code' }));
  assert.equal(formatRoute({ kind: 'docs', sourceId: 'nope' }), '#/docs/nope');
  assert.equal(formatRoute({ kind: 'docs' }), '#/docs');
  assert.equal(formatRoute({ kind: 'page', pageId: 'p', itemId: 'i' }), '#/p/p/i');
  assert.deepEqual(vaultDocOf(parseHash('#/docs/spec/L12')), { path: 'projects/x/docs/spec.md', anchor: 'L12' });
});

test('embed.css: 넓은 화면(901px~)에서 셸 루트가 스크롤 칸 높이를 갖고, 근거 패널 높이 덧칠은 없다', () => {
  const css = fs.readFileSync(path.join(SHELL_DIR, 'src', 'embed', 'embed.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // 두 칸 스크롤의 .app{height:100%} 가 풀리려면 루트 높이가 고정이어야 한다 — 내용 높이면 .main 이 0 으로 접힌다.
  const wide = /@media\s*\(min-width:\s*901px\)\s*\{\s*\.pv-root\.pv-embed\s*\{([^}]*)\}/.exec(css);
  assert.ok(wide, '901px 이상 .pv-root.pv-embed 규칙이 없다');
  assert.match(wide[1], /height:\s*100%/);
  assert.match(wide[1], /min-height:\s*0/);
  // 좁은 화면은 그대로 내용 높이다(바깥 칸이 문서를 굴린다).
  assert.match(css, /^\.pv-root\.pv-embed\s*\{\s*height:\s*auto;\s*min-height:\s*100%;\s*\}/m);
  // 패널 높이는 셸 layout.css(.main 칸 기준)를 따른다 — 어림값 덧칠이 돌아오면 스탬프 밑으로 넘친다.
  assert.doesNotMatch(css, /\.panel/);
  assert.doesNotMatch(css, /--pv-view-h/);
});
