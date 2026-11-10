// 화면 확장 등록부: 빈 확장(유닛 시험은 늘 빈 모듈)과 모양 검사, 확장이 정적으로 부를 면의 순환 금지.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_UIS, ARCHIFY_ZOOM_ROW, DEFAULT_REMOTE_IMAGE_HOSTS, EXT_VIEWS, checkUiExtension } from '../../src/ext/registry.ts';
import { SHORTCUTS } from '../../src/app/shortcuts.ts';
import type { CenterViewExtension } from '../../src/ext/define.ts';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** 합성 보기 하나. 바꿀 칸만 덮어쓴다. */
const view = (over: Partial<CenterViewExtension> = {}): CenterViewExtension => ({
  id: 'atlas',
  title: '데모 지도',
  icon: () => null,
  home: { path: 'projects/demo/README.md' },
  load: async () => ({ default: () => null }),
  ...over,
});

describe('화면 확장 등록부', () => {
  it('유닛 시험의 확장은 빈 모듈이다: 앱 0·보기 0·호스트 빈 목록·그림 글자 줄 없음', () => {
    assert.deepEqual(APP_UIS, []);
    assert.deepEqual(EXT_VIEWS, []);
    assert.deepEqual(DEFAULT_REMOTE_IMAGE_HOSTS, []);
    assert.equal(ARCHIFY_ZOOM_ROW, false);
  });

  it('맞는 확장은 빈 칸을 채워 그대로 낸다', () => {
    const r = checkUiExtension({ views: [view({ archifyZoom: true, shortcut: { key: 'q', desc: '데모 지도 보기' } })], remoteImageHosts: ['img.example.com'] });
    assert.deepEqual(r.apps, []);
    assert.deepEqual(r.views.map((v) => v.id), ['atlas']);
    assert.deepEqual(r.remoteImageHosts, ['img.example.com']);
    assert.equal(r.archifyZoomRow, true);
    assert.equal(checkUiExtension({}).archifyZoomRow, false);
  });

  it('앱 id 문법·중복을 거른다', () => {
    const app = { id: 'demo-board', title: '데모 보드', icon: 'checklist' as const, load: async () => ({ App: () => null }) };
    assert.throws(() => checkUiExtension({ apps: [{ ...app, id: 'Demo' }] }), /앱 id 가 올바르지 않다/);
    assert.throws(() => checkUiExtension({ apps: [app, app] }), /앱 id 가 겹친다/);
  });

  it('보기 id 문법·예약어·중복, home 경로를 거른다', () => {
    assert.throws(() => checkUiExtension({ views: [view({ id: '9x' })] }), /보기 id 가 올바르지 않다/);
    assert.throws(() => checkUiExtension({ views: [view({ id: 'graph' })] }), /예약어/);
    assert.throws(() => checkUiExtension({ views: [view({ id: 'doc' })] }), /예약어/);
    assert.throws(() => checkUiExtension({ views: [view(), view()] }), /보기 id 가 겹친다/);
    assert.throws(() => checkUiExtension({ views: [view({ home: { path: '' } })] }), /home\.path/);
  });

  it('단축키는 수식어 없는 한 글자이고 코어 키·다른 보기와 겹치지 않는다', () => {
    const taken = SHORTCUTS.find((s) => s.id === 'view.graph')!.keys[0]!;
    assert.throws(() => checkUiExtension({ views: [view({ shortcut: { key: taken, desc: 'x' } })] }), /이미 쓰인다/);
    assert.throws(() => checkUiExtension({ views: [view({ shortcut: { key: 'mod+a', desc: 'x' } })] }), /한 글자/);
    assert.throws(() => checkUiExtension({ views: [view({ shortcut: { key: 'A', desc: 'x' } })] }), /한 글자/);
    assert.throws(
      () => checkUiExtension({ views: [view({ shortcut: { key: 'q', desc: 'x' } }), view({ id: 'atlas-two', shortcut: { key: 'q', desc: 'y' } })] }),
      /이미 쓰인다/,
    );
    // 코어 표를 바꿔 끼우면 그 표 기준으로 본다.
    assert.doesNotThrow(() => checkUiExtension({ views: [view({ shortcut: { key: taken, desc: 'x' } })] }, []));
  });

  it('허용 호스트는 빈 문자열을 받지 않는다', () => {
    assert.throws(() => checkUiExtension({ remoteImageHosts: [' '] }), /호스트가 올바르지 않다/);
  });

  it('확장이 정적으로 부를 면(define)의 정적 import 그래프에 등록부가 없다(순환 금지)', () => {
    const seen = new Set<string>();
    // 타입 전용이 아닌 상대 import 만 따라간다.
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.[^']+)';/gm)) walk(path.resolve(path.dirname(file), m[1]!));
    };
    walk(path.join(srcDir, 'ext', 'define.ts'));
    assert.equal(seen.has(path.join(srcDir, 'ext', 'registry.ts')), false);
  });
});
