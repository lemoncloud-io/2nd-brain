import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';

const { Highlight } = await import('../../src/app/Highlight.tsx');

test('Highlight: 범위를 mark 로 감싼다(코드포인트 단위)', () => {
  assert.equal(renderToStaticMarkup(createElement(Highlight, { text: '지식 관리', ranges: [[0, 2]] })), '<mark class="hl">지식</mark> 관리');
  assert.equal(
    renderToStaticMarkup(createElement(Highlight, { text: 'agent memory', ranges: [[0, 5], [6, 9]] })),
    '<mark class="hl">agent</mark> <mark class="hl">mem</mark>ory',
  );
  assert.equal(renderToStaticMarkup(createElement(Highlight, { text: 'plain', ranges: [] })), 'plain');
});
