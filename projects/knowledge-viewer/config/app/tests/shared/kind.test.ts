import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { KINDS, clusterKeyOf, kindOf, topicsOf } from '../../shared/kind.ts';

describe('kindOf', () => {
  it('wiki/ 아래는 type 이 위키 종류면 그 종류다', () => {
    assert.equal(kindOf('wiki/a.md', { type: 'tool' }), 'tool');
  });
  it('wiki/ 아래라도 type 이 없으면 other 다', () => {
    assert.equal(kindOf('wiki/a.md', {}), 'other');
  });
  it('projects/<name>/README.md 는 type 과 무관하게 project 다', () => {
    assert.equal(kindOf('projects/x/README.md', { type: 'concept' }), 'project');
  });
  it('type: project 는 어디서든 project 다', () => {
    assert.equal(kindOf('projects/x/notes.md', { type: 'project' }), 'project');
  });
  it('areas/ideas/ 아래는 idea 다', () => {
    assert.equal(kindOf('areas/ideas/i.md', {}), 'idea');
  });
  it('type 이 산출물 종류면 output 이다', () => {
    assert.equal(kindOf('projects/x/outputs/r.md', { type: 'query-output' }), 'output');
  });
  it('outputs/ 아래는 output 이다', () => {
    assert.equal(kindOf('outputs/2026.md', {}), 'output');
  });
  it('프로젝트 안의 outputs/ 도 output 이다(type 이 없거나 meeting-note 여도)', () => {
    assert.equal(kindOf('projects/x/outputs/r.md', {}), 'output');
    assert.equal(kindOf('projects/x/outputs/m.md', { type: 'meeting-note' }), 'output');
  });
  it('파일 이름이 outputs 인 것은 폴더가 아니다', () => {
    assert.equal(kindOf('wiki/outputs', {}), 'other');
  });
  it('docs/ 아래는 doc 이다', () => {
    assert.equal(kindOf('docs/x.md', {}), 'doc');
  });
  it('type: design 은 doc 이다', () => {
    assert.equal(kindOf('projects/x/docs/d.md', { type: 'design' }), 'doc');
  });
  it('wiki/ 가 아닌 곳의 위키 type 이름이나 모르는 type 은 other 다', () => {
    assert.equal(kindOf('projects/x/wiki/w.md', { type: 'dou-wiki' }), 'other');
    assert.equal(kindOf('projects/x/notes.md', { type: 'tool' }), 'other');
  });
  it('문자열이 아닌 type 은 무시한다', () => {
    assert.equal(kindOf('wiki/a.md', { type: 3 }), 'other');
  });
  it('경로는 조각으로 비교한다(접두 문자열이 아니다)', () => {
    assert.equal(kindOf('wikis/a.md', { type: 'tool' }), 'other');
    assert.equal(kindOf('docs-old/x.md', {}), 'other');
  });
  it('KINDS 는 선언 순서다', () => {
    assert.deepEqual([...KINDS], ['concept', 'tool', 'model', 'framework', 'pattern', 'protocol', 'topic', 'project', 'idea', 'output', 'doc', 'other']);
  });
});

describe('topicsOf', () => {
  it('목록은 다듬어 빈 값을 뺀다', () => {
    assert.deepEqual(topicsOf({ topics: ['a', ' b ', ''] }), ['a', 'b']);
  });
  it('문자열 하나도 목록이다', () => {
    assert.deepEqual(topicsOf({ topics: 'a' }), ['a']);
  });
  it('없으면 빈 목록이다', () => {
    assert.deepEqual(topicsOf({}), []);
  });
  it('문자열이 아닌 항목은 뺀다', () => {
    assert.deepEqual(topicsOf({ topics: ['a', 1, null] }), ['a']);
  });
});

describe('clusterKeyOf', () => {
  it('wiki/ 아래이고 topics 가 있으면 첫 topic', () => {
    assert.equal(clusterKeyOf('wiki/a.md', 'concept', ['ctx']), 'topic:ctx');
  });
  it('wiki/ 아래이고 topics 가 없으면 종류', () => {
    assert.equal(clusterKeyOf('wiki/a.md', 'concept', []), 'type:concept');
  });
  it('projects/<name>/', () => {
    assert.equal(clusterKeyOf('projects/demo/README.md', 'project', []), 'project:demo');
  });
  it('projects/@<org>/<repo>/', () => {
    assert.equal(clusterKeyOf('projects/@org/repo/x.md', 'other', []), 'project:@org/repo');
  });
  it('areas/ideas/', () => {
    assert.equal(clusterKeyOf('areas/ideas/i.md', 'idea', []), 'ideas');
  });
  it('docs/', () => {
    assert.equal(clusterKeyOf('docs/x.md', 'doc', []), 'docs');
  });
  it('그 밖은 첫 폴더', () => {
    assert.equal(clusterKeyOf('areas/daily/d.md', 'other', []), 'dir:areas');
  });
  it('폴더 없는 루트 문서', () => {
    assert.equal(clusterKeyOf('VAULT_RULES.md', 'other', []), 'root');
  });
  it('projects/ 바로 아래 파일은 프로젝트가 아니다', () => {
    assert.equal(clusterKeyOf('projects/x.md', 'other', []), 'dir:projects');
  });
});
