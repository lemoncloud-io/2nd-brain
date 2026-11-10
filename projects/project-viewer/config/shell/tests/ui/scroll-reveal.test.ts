// 스크롤바 표시: 스크롤 이벤트가 오면 data-scrolling 을 달고, 멈춘 뒤 떼는지. 가짜 문서로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { installScrollReveal, scrollHost } from '../../src/app/scroll-reveal.ts';

class FakeEl {
  attrs = new Map<string, string>();
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
}

function fakeDoc() {
  const listeners: ((e: Event) => void)[] = [];
  const documentElement = new FakeEl();
  const doc = {
    documentElement,
    body: new FakeEl(),
    addEventListener: (_t: string, fn: (e: Event) => void) => listeners.push(fn),
    removeEventListener: (_t: string, fn: (e: Event) => void) => listeners.splice(listeners.indexOf(fn), 1),
    fire: (target: unknown) => listeners.forEach((fn) => fn({ target } as unknown as Event)),
    listeners,
  };
  return doc;
}

test('문서 스크롤의 대상은 <html>, 요소 스크롤은 그 요소', () => {
  const doc = fakeDoc();
  assert.equal(scrollHost(doc as unknown as Document, doc as unknown as Document), doc.documentElement);
  assert.equal(scrollHost(doc.body as unknown as EventTarget, doc as unknown as Document), doc.documentElement);
  assert.equal(scrollHost(null, doc as unknown as Document), null);
});

test('스크롤 중엔 data-scrolling, 멈추면 뗀다 · 해제하면 듣지 않는다', async () => {
  const g = globalThis as { Element?: unknown };
  const had = 'Element' in g;
  const prevElement = g.Element;
  g.Element = FakeEl;
  try {
    const doc = fakeDoc();
    const el = new FakeEl();
    const off = installScrollReveal(doc as unknown as Document, 20);
    doc.fire(el);
    assert.ok(el.attrs.has('data-scrolling'));
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(!el.attrs.has('data-scrolling'));
    off();
    assert.equal(doc.listeners.length, 0);
  } finally {
    if (had) g.Element = prevElement;
    else delete g.Element;
  }
});

test('막대는 평소 투명, data-scrolling 일 때만 색', () => {
  const css = readFileSync(new URL('../../src/styles/base.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\*\s*\{\s*scrollbar-color:\s*transparent transparent;/);
  assert.match(css, /\[data-scrolling\]\s*\{\s*scrollbar-color:\s*var\(--line-strong\) transparent;/);
});
