// 뷰어 모음 패널을 SSR 로 그려 항목·상태 점·버튼 문구·주소를 본다. 열기 규칙은 viewerAction 으로 따로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { viewerAction, type Viewer, type ViewersResponse } from '../../src/panels/viewers-api.ts';

const { ViewersPanel } = await import('../../src/panels/ViewersPanel.tsx');

const SKILL = 'projects/demo/config/skills/demo-view/SKILL.md';
const base = { description: '한 줄 설명', skill: SKILL, group: null };
const V: Viewer[] = [
  { ...base, id: 'site', title: '데모 사이트 보기', open: { kind: 'static', path: 'projects/demo/outputs/site/index.html', ask: null }, status: 'ok' },
  { ...base, id: 'gone', title: '없는 사이트', open: { kind: 'static', path: 'projects/demo/outputs/x/index.html', ask: '데모 빌드해줘' }, status: 'missing' },
  { ...base, id: 'on', title: '켜진 서버', open: { kind: 'server', url: 'http://127.0.0.1:43187/?agent=claude', port: 43187, launch: 'desk', ask: '이슈 보여줘' }, status: 'up' },
  { ...base, id: 'off', title: '꺼진 서버', open: { kind: 'server', url: 'http://localhost:8787/#single', port: 8787, launch: 'gr', ask: '골든리뷰 보여줘' }, status: 'down' },
  { ...base, id: 'man', title: '앱 셸', open: { kind: 'server', url: null, port: null, launch: null, ask: '두유 시작' }, status: 'manual' },
  { ...base, id: 'pv:a', title: 'a 뷰어', group: '프로젝트 뷰어', open: { kind: 'static', path: 'projects/a/outputs/viewer/index.html', ask: 'a 뷰어 보여줘' }, status: 'ok' },
];

const render = (data: ViewersResponse, agent = false): string =>
  renderToStaticMarkup(createElement(ViewersPanel, { agent, navigate: () => {}, initial: data, port: '8792' }));

const card = (html: string, id: string): string => {
  const at = html.indexOf(`data-viewer-id="${id}"`);
  assert.ok(at >= 0, id);
  const i = html.lastIndexOf('<li', at);
  return html.slice(i, html.indexOf('</li>', i));
};

test('viewerAction: static ok 는 같은 포트 localhost /raw, server up 은 등록부 url 그대로', () => {
  assert.deepEqual(viewerAction(V[0]!, '8792'), { kind: 'open', href: 'http://localhost:8792/raw/projects/demo/outputs/site/index.html' });
  assert.deepEqual(viewerAction(V[2]!, '8792'), { kind: 'open', href: 'http://127.0.0.1:43187/?agent=claude' });
  assert.deepEqual(viewerAction(V[3]!, '8792'), { kind: 'ask', text: '골든리뷰 보여줘', reason: '서버 꺼짐' });
  assert.deepEqual(viewerAction(V[4]!, '8792'), { kind: 'ask', text: '두유 시작', reason: '클로드가 띄운다' });
  assert.deepEqual(viewerAction(V[1]!, '8792'), { kind: 'ask', text: '데모 빌드해줘', reason: '파일 없음' });
  assert.deepEqual(viewerAction({ ...V[1]!, open: { kind: 'static', path: 'x.html', ask: null } }, '8792'), { kind: 'none', reason: '파일 없음' });
});

test('viewerAction: 경로의 @ 는 /raw/@ 소스 접두와 섞이지 않게 부호화하고, # 도 부호화한다', () => {
  const v: Viewer = { ...V[0]!, open: { kind: 'static', path: 'projects/@org/a#b/index.html', ask: null } };
  assert.deepEqual(viewerAction(v, '8778'), { kind: 'open', href: 'http://localhost:8778/raw/projects/@org/a%23b/index.html' });
});

test('열 수 있는 항목은 새 탭 링크, 꺼진 항목은 흐린 본체 + 요청 버튼', () => {
  const html = render({ viewers: V, fetchedAt: '2026-10-24T00:00:00Z', error: null });
  const site = card(html, 'site');
  assert.match(site, /<a class="viewer-main" href="http:\/\/localhost:8792\/raw\/projects\/demo\/outputs\/site\/index.html" target="_blank" rel="noopener noreferrer"/);
  assert.ok(site.includes('데모 사이트 보기'));
  assert.ok(site.includes('한 줄 설명'));
  assert.ok(!site.includes('클로드에게 요청'));
  assert.match(site, /viewer-dot-ok/);

  const off = card(html, 'off');
  assert.match(off, /class="viewer viewer-down viewer-off"/);
  assert.match(off, /<span class="viewer-main" aria-disabled="true"/);
  assert.ok(off.includes('서버 꺼짐'));
  assert.ok(off.includes('클로드에게 요청'));
  assert.ok(!off.includes('target="_blank"'));

  assert.match(card(html, 'on'), /href="http:\/\/127.0.0.1:43187\/\?agent=claude" target="_blank"/);
  assert.match(card(html, 'on'), /viewer-dot-up/);
  assert.match(card(html, 'gone'), /viewer-dot-missing/);
  assert.ok(card(html, 'gone').includes('파일 없음'));
  assert.ok(card(html, 'man').includes('클로드가 띄운다'));
});

test('지침서 링크는 항상 있고 SKILL.md 를 리더(local 소스)로 연다', () => {
  const html = render({ viewers: V, fetchedAt: '', error: null });
  for (const v of V) assert.ok(card(html, v.id).includes(`href="/v/${SKILL}?src=local" data-vault-path="${SKILL}"`), v.id);
  const agentHtml = render({ viewers: V, fetchedAt: '', error: null }, true);
  assert.ok(agentHtml.includes(`href="/v/${SKILL}?agent=claude&amp;src=local"`));
});

test('묶음 머리는 한 번, 개수·새로 고침 버튼', () => {
  const html = render({ viewers: V, fetchedAt: '', error: null });
  assert.equal(html.split('class="viewers-group"').length - 1, 1);
  assert.ok(html.includes('6개'));
  assert.ok(html.includes('aria-label="새로 고침"'));
});

test('오류 한 줄과 함께 남은 항목을 그린다, 비면 빈 문구', () => {
  const html = render({ viewers: [V[0]!], fetchedAt: '', error: 'viewers.yml: 2번째 항목(b)에 description 이 없다' });
  assert.ok(html.includes('viewers.yml: 2번째 항목(b)에 description 이 없다'));
  assert.ok(html.includes('data-viewer-id="site"'));
  assert.ok(render({ viewers: [], fetchedAt: '', error: null }).includes('등록된 뷰어 없음'));
});
