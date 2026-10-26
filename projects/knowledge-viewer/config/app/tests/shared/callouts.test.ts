// remarkCallouts: `> [!type] 제목` → aside 그릇(hName·hProperties). 종류·별칭·제목·접기·모르는 종류·중첩·일반 인용.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHast } from 'mdast-util-to-hast';
import { toString } from 'mdast-util-to-string';

import type { Root } from 'mdast';

import { calloutFamily, defaultTitle, parseCalloutHead, remarkCallouts } from '../../shared/callouts.ts';
import { parseMarkdown } from '../../shared/markdown.ts';

type El = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: El[]; value?: string };

function hast(md: string): El {
  const tree: Root = parseMarkdown(md);
  remarkCallouts()(tree);
  return toHast(tree) as unknown as El;
}

const els = (n: El): El[] => (n.children ?? []).filter((c) => c.type === 'element');
const text = (n: El): string => (n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(text).join(''));
const find = (n: El, pred: (e: El) => boolean): El | undefined => {
  if (n.type === 'element' && pred(n)) return n;
  for (const c of n.children ?? []) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return undefined;
};
const hasClass = (e: El, c: string): boolean => Array.isArray(e.properties?.className) && (e.properties!.className as string[]).includes(c);

test('parseCalloutHead: 종류·접기·나머지', () => {
  assert.deepEqual(parseCalloutHead('[!WARNING] 제목'), { type: 'warning', fold: '', rest: '제목' });
  assert.deepEqual(parseCalloutHead('[!note]- 접힘'), { type: 'note', fold: '-', rest: '접힘' });
  assert.deepEqual(parseCalloutHead('[!tip]+'), { type: 'tip', fold: '+', rest: '' });
  assert.equal(parseCalloutHead('[note] 아님'), null);
  assert.equal(parseCalloutHead('본문 [!note]'), null);
});

test('calloutFamily: 별칭 표와 모르는 종류(note)', () => {
  const want: Record<string, string> = {
    note: 'note', info: 'info', todo: 'todo', tip: 'tip', hint: 'tip', important: 'tip',
    abstract: 'abstract', summary: 'abstract', tldr: 'abstract',
    warning: 'warning', caution: 'warning', attention: 'warning',
    danger: 'danger', error: 'danger', bug: 'bug', failure: 'failure', fail: 'failure', missing: 'failure',
    success: 'success', check: 'success', done: 'success',
    question: 'question', help: 'question', faq: 'question',
    example: 'example', quote: 'quote', cite: 'quote',
    'my-thing': 'note', constructor: 'note', toString: 'note',
  };
  for (const [t, f] of Object.entries(want)) assert.equal(calloutFamily(t), f, t);
});

test('defaultTitle: 첫 글자만 대문자', () => {
  assert.equal(defaultTitle('warning'), 'Warning');
  assert.equal(defaultTitle('ABSTRACT'), 'Abstract');
  assert.equal(defaultTitle('my-type'), 'My-type');
});

test('제목 있는 callout: aside·제목 줄(아이콘+제목)·본문', () => {
  const root = hast('> [!warning] 조심할 것\n> 첫 줄 본문\n>\n> 둘째 문단');
  const aside = els(root)[0]!;
  assert.equal(aside.tagName, 'aside');
  assert.deepEqual(aside.properties?.className, ['callout', 'callout-warning']);
  assert.equal(aside.properties?.dataCallout, 'warning');
  const [title, body] = els(aside);
  assert.equal(title!.tagName, 'div');
  assert.ok(hasClass(title!, 'callout-title'));
  const [icon, label] = els(title!);
  assert.ok(hasClass(icon!, 'callout-icon'));
  assert.equal(icon!.properties?.dataIcon, 'warning');
  assert.equal(text(label!), '조심할 것');
  assert.equal(body!.tagName, 'div');
  assert.ok(hasClass(body!, 'callout-body'));
  assert.deepEqual(els(body!).map((p) => text(p)), ['첫 줄 본문', '둘째 문단']);
});

test('제목 없으면 종류 이름(첫 글자 대문자), 본문 없으면 제목 줄만', () => {
  const aside = els(hast('> [!abstract]'))[0]!;
  assert.equal(els(aside).length, 1);
  assert.equal(text(find(aside, (e) => hasClass(e, 'callout-title-text'))!), 'Abstract');
  assert.equal(find(aside, (e) => hasClass(e, 'callout-icon'))!.properties?.dataIcon, 'abstract');
});

test('제목 줄의 인라인 서식은 그대로 남는다', () => {
  const aside = els(hast('> [!info] **굵은** `코드` 제목\n> 본문'))[0]!;
  const label = find(aside, (e) => hasClass(e, 'callout-title-text'))!;
  assert.ok(find(label, (e) => e.tagName === 'strong'));
  assert.ok(find(label, (e) => e.tagName === 'code'));
  assert.equal(text(find(aside, (e) => hasClass(e, 'callout-body'))!).trim(), '본문');
});

test('접기 -: details(닫힘) > summary 제목 + 본문', () => {
  const aside = els(hast('> [!note]- 접힌 제목\n> 숨은 본문'))[0]!;
  const details = els(aside)[0]!;
  assert.equal(details.tagName, 'details');
  assert.equal(details.properties?.open, undefined);
  const [summary, body] = els(details);
  assert.equal(summary!.tagName, 'summary');
  assert.ok(hasClass(summary!, 'callout-title'));
  assert.equal(text(body!).trim(), '숨은 본문');
});

test('접기 +: details open', () => {
  const details = els(els(hast('> [!tip]+ 펼친 제목\n> 본문'))[0]!)[0]!;
  assert.equal(details.tagName, 'details');
  assert.equal(details.properties?.open, true);
});

test('모르는 종류: note 계열 클래스 + data-callout 은 원래 이름, 제목은 종류 이름', () => {
  const aside = els(hast('> [!custom-kind]\n> 본문'))[0]!;
  assert.deepEqual(aside.properties?.className, ['callout', 'callout-note']);
  assert.equal(aside.properties?.dataCallout, 'custom-kind');
  assert.equal(text(find(aside, (e) => hasClass(e, 'callout-title-text'))!), 'Custom-kind');
});

test('일반 인용은 blockquote 그대로', () => {
  const root = hast('> 그냥 인용\n> [!note] 둘째 줄');
  assert.equal(els(root)[0]!.tagName, 'blockquote');
});

test('중첩 callout 도 바뀐다', () => {
  const aside = els(hast('> [!warning] 바깥\n> > [!info] 안쪽\n> > 안 본문'))[0]!;
  const inner = find(find(aside, (e) => hasClass(e, 'callout-body'))!, (e) => e.tagName === 'aside');
  assert.ok(inner);
  assert.equal(inner!.properties?.dataCallout, 'info');
});

test('목록·코드가 든 본문도 블록 그대로', () => {
  const md = '> [!example] 예\n> - 하나\n> - 둘\n>\n> ```\n> code\n> ```';
  const tree = parseMarkdown(md);
  remarkCallouts()(tree);
  assert.match(toString(tree), /하나/);
  const body = find(toHast(tree) as unknown as El, (e) => hasClass(e, 'callout-body'))!;
  assert.deepEqual(els(body).map((e) => e.tagName), ['ul', 'pre']);
});
