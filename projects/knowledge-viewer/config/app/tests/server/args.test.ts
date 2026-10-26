// CLI 인자 — private/ 기본값과 숨김 플래그.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from '../../server/main.ts';

test('private 는 기본으로 보인다', () => {
  assert.equal(parseArgs([], {} as NodeJS.ProcessEnv).includePrivate, true);
});

test('--hide-private 와 환경 변수로 숨긴다, --include-private 는 되돌린다', () => {
  assert.equal(parseArgs(['--hide-private'], {} as NodeJS.ProcessEnv).includePrivate, false);
  assert.equal(parseArgs([], { KNOWLEDGE_VIEWER_HIDE_PRIVATE: '1' } as NodeJS.ProcessEnv).includePrivate, false);
  assert.equal(parseArgs(['--include-private'], { KNOWLEDGE_VIEWER_HIDE_PRIVATE: '1' } as NodeJS.ProcessEnv).includePrivate, true);
});

test('--graph-hub 는 양의 정수만 받는다', () => {
  assert.equal(parseArgs([], {} as NodeJS.ProcessEnv).graphHub, undefined);
  assert.equal(parseArgs(['--graph-hub', '3'], {} as NodeJS.ProcessEnv).graphHub, 3);
  assert.throws(() => parseArgs(['--graph-hub', 'x'], {} as NodeJS.ProcessEnv), /graph-hub/);
  assert.throws(() => parseArgs(['--graph-hub', '1.5'], {} as NodeJS.ProcessEnv), /graph-hub/);
  assert.throws(() => parseArgs(['--graph-hub', '0'], {} as NodeJS.ProcessEnv), /graph-hub/);
});
