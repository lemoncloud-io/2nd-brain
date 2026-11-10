// 참조 토큰 → 링크 해석(src/app/refs.ts)의 시험. 순수 함수만 본다 — Inline(tsx)은 이 조각을 그대로 그린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bundle, SourceDoc, SourceSpec } from '../../model/types.ts';
import { extractHeadings } from '../../model/slug.ts';
import { buildEntityIndex } from '../../src/app/entities.ts';
import { buildRefResolver, cardPosition, inlinePieces, linkRefs, sectionSummary, stripMarkdown } from '../../src/app/refs.ts';
import type { RefPiece } from '../../src/app/refs.ts';

const SPEC_MD = [
  '# SPEC: 데모',
  '',
  '## 7. 하네스',
  '',
  '### 7.9 성능',
  '',
  '#### 7.9.2 request·handle 줄 꼬리',
  '',
  '`PERF: > request` 줄의 꼬리를 **계약**으로 잠근다.',
  '두 번째 줄도 같은 문단이다.',
  '',
  '표는 미리보기에 넣지 않는다.',
  '',
  '#### 7.9.7 B9 — PERF 줄 계약 (D56)',
  '',
  '| 키 | 뜻 |',
  '| --- | --- |',
  '| mode | 모드 |',
  '',
  '```',
  '# 코드펜스 안의 샵은 헤딩이 아니다',
  '```',
  '',
].join('\n');

const PLAN_MD = ['# PLAN', '', '## T13 — B9 PERF 줄 계약 고정 (P1)', '', '- [x] **P1** T13-1 SPEC § 7.9.7 기록', ''].join('\n');

const HL_MD = ['# High-Levels', '', '## 확정된 결정', '', '| D55 | 콜드 KMS | ... |', ''].join('\n');

// 원본 하나를 Bundle 의 docs 꼴로.
function doc(spec: SourceSpec, body: string): SourceDoc {
  return { ...spec, title: spec.title ?? spec.id, frontmatter: {}, body, digest: '', headings: extractHeadings(body), missing: false, embedded: true };
}

const sources: SourceSpec[] = [
  { id: 'spec', path: 'projects/demo/docs/SPEC.md', title: 'SPEC 설계', role: 'primary', kind: 'doc' },
  { id: 'plan', path: 'projects/demo/docs/PLAN.md', title: 'PLAN 실행 계획', role: 'primary', kind: 'doc' },
  { id: 'high-levels', path: 'projects/demo/docs/high-levels.md', title: 'high-levels', role: 'primary', kind: 'doc' },
  { id: 'ledger', path: 'projects/demo/docs/status.yml', role: 'ledger', kind: 'data' },
];

function bundle(): Bundle {
  return {
    viewer: {
      schema_version: 1,
      meta: { title: '데모', kind: 'project' },
      sources,
      glossary: [{ id: 'g-harness', term: '하네스', easy: '로컬에서 띄운다. 묶음 B9 도 쓴다.', evidence: [{ source: 'spec' }] }],
      pages: [
        {
          id: 'checks',
          title: '체크',
          blocks: [
            {
              type: 'stages',
              stages: [
                { id: 'M4', title: '마일스톤 4', short: 'M4' },
                {
                  id: 'B9',
                  title: 'B9 PERF 줄 계약',
                  short: 'B9',
                  fields: [{ label: '결정', text: 'D56' }],
                  items: [{ id: 'B9.T13-3', label: 'T13-3 문서', criteria: '§ 7.9.7 절과 D56 을 본다' }],
                },
              ],
            },
          ],
        },
        {
          id: 'decisions',
          title: '결정',
          blocks: [
            {
              type: 'items',
              evidence: [{ source: 'spec' }],
              items: [
                { id: 'D5', label: 'D5 — 다섯', body: '다섯째 결정' },
                { id: 'D55', label: 'D55 — 콜드 KMS', body: '콜드 KMS 는 SDK 없이' },
                { id: 'D56', label: 'D56 — `PERF` 줄 꼬리는 계약으로 고정', body: '§ 7.9.2 의 줄 꼬리를 계약으로 잠근다(D23 은 없는 결정).' },
                { id: 'Q7', label: 'Q7 — 프라임 없는 열린 결정' },
              ],
            },
          ],
        },
      ],
    },
    docs: {
      spec: doc(sources[0]!, SPEC_MD),
      plan: doc(sources[1]!, PLAN_MD),
      'high-levels': doc(sources[2]!, HL_MD),
    },
    status: { B9: { status: 'done', label: '완료', tone: 'green', done: true, origin: 'ledger', evidence: [] } },
    backlinks: {},
    stamp: { builtAt: '', commit: null, dirty: false, docCount: 3, ymlDigest: '', ledgerDigest: null, counts: { unresolvedLinks: 0, missingReferences: 0, unverifiedCode: 0, inheritedEvidence: 0 } },
    issues: [],
  };
}

const data = bundle();
const resolver = buildRefResolver(data, buildEntityIndex(data));

// 조각을 "글|링크(href)" 꼴로 납작하게 — 단언을 짧게 쓰려는 것이다.
function flat(pieces: RefPiece[]): string[] {
  return pieces.map((p) => (p.type === 'text' ? p.text : `[${p.text}→${p.target.href}]`));
}

test('뷰어 안에 있는 항목 id 만 링크가 된다', () => {
  assert.deepEqual(flat(linkRefs('결정 D56으로 잠근다(D23).', resolver)), ['결정 ', '[D56→#/p/decisions/D56]', '으로 잠근다(D23).']);
});

test('항목 미리보기는 제목·종류·상태·페이지·첫 해설 한 줄이다', () => {
  const [piece] = linkRefs('B9', resolver);
  assert.equal(piece?.type, 'ref');
  if (piece?.type !== 'ref') return;
  assert.equal(piece.target.href, '#/p/checks/B9');
  assert.equal(piece.target.title, 'B9 PERF 줄 계약');
  assert.equal(piece.target.meta, '단계 · 완료 · 체크');
  assert.equal(piece.target.summary, 'D56');
});

test('버전 문자열·글자 속 숫자·없는 id 는 글자로 남는다', () => {
  assert.deepEqual(flat(linkRefs('v5.0.3 과 SHA256 과 D999 와 #/p/D56 과 x.D56', resolver)), ['v5.0.3 과 SHA256 과 D999 와 #/p/D56 과 x.D56']);
});

test('꼬리 조각이 붙은 id 는 `.id` 로 끝나는 유일한 항목으로 푼다', () => {
  assert.deepEqual(flat(linkRefs('T13-3 끝', resolver)), ['[T13-3→#/p/checks/B9.T13-3]', ' 끝']);
});

test('항목이 아닌 꼬리는 떼고 머리만 링크, 떼어 낸 꼬리도 다시 훑는다', () => {
  assert.deepEqual(flat(linkRefs('D5.1 과 M4-B9', resolver)), ['[D5→#/p/decisions/D5]', '.1 과 ', '[M4→#/p/checks/M4]', '-', '[B9→#/p/checks/B9]']);
});

test('프라임이 붙은 id 는 그대로, 없으면 프라임을 떼고 찾는다', () => {
  assert.deepEqual(flat(linkRefs('Q7′ 이관', resolver)), ['[Q7→#/p/decisions/Q7]', '′ 이관']);
});

test('용어 id 는 용어 페이지로 간다', () => {
  assert.deepEqual(flat(linkRefs('g-harness', resolver)), ['g-harness'], '소문자 id 는 토큰이 아니다');
});

test('이름 없는 § 절 번호는 SPEC 의 헤딩 슬러그로 간다', () => {
  const [piece] = linkRefs('§ 7.9.2', resolver);
  assert.equal(piece?.type, 'ref');
  if (piece?.type !== 'ref') return;
  assert.equal(piece.target.href, '#/docs/spec/792-requesthandle-%EC%A4%84-%EA%BC%AC%EB%A6%AC');
  assert.equal(piece.target.title, '7.9.2 request·handle 줄 꼬리');
  assert.equal(piece.target.meta, 'SPEC 설계');
  assert.equal(piece.target.summary, 'PERF: > request 줄의 꼬리를 계약으로 잠근다. 두 번째 줄도 같은 문단이다.');
});

test('§ 7.9 는 7.9.2 헤딩에 맞지 않고, 없는 절은 글자로 남는다', () => {
  assert.deepEqual(flat(linkRefs('§ 7.9 와 § 9.9.9', resolver)), ['[§ 7.9→#/docs/spec/79-%EC%84%B1%EB%8A%A5]', ' 와 § 9.9.9']);
});

test('문서 이름이 붙은 절은 그 문서로, 모르는 이름은 SPEC 으로 넘겨짚지 않는다', () => {
  assert.deepEqual(flat(linkRefs('SPEC § 7.9.7 과 baseline § 7.9.7', resolver)), [
    '[SPEC § 7.9.7→#/docs/spec/797-b9--perf-%EC%A4%84-%EA%B3%84%EC%95%BD-d56]',
    ' 과 baseline § 7.9.7',
  ]);
});

test('`PLAN T13` 은 그 문서의 T13 헤딩으로, 헤딩이 없는 `high-levels D55` 는 항목 링크로 떨어진다', () => {
  assert.deepEqual(flat(linkRefs('PLAN T13 · high-levels D55', resolver)), [
    '[PLAN T13→#/docs/plan/t13--b9-perf-%EC%A4%84-%EA%B3%84%EC%95%BD-%EA%B3%A0%EC%A0%95-p1]',
    ' · high-levels ',
    '[D55→#/p/decisions/D55]',
  ]);
});

test('`B9 D56` 처럼 이름 자리가 항목이면 둘 다 링크다', () => {
  assert.deepEqual(flat(linkRefs('B9 D56', resolver)), ['[B9→#/p/checks/B9]', ' ', '[D56→#/p/decisions/D56]']);
});

test('절 미리보기는 표·코드펜스를 건너뛰고, 문단이 없으면 비어 있다', () => {
  const spec = data.docs.spec!;
  const h797 = spec.headings.find((h) => h.text.startsWith('7.9.7'))!;
  assert.equal(sectionSummary(spec, h797), undefined, '표만 있는 절');
  const h79 = spec.headings.find((h) => h.text === '7.9 성능')!;
  assert.equal(sectionSummary(spec, h79), undefined, '바로 아래 절 헤딩이 오는 절');
  assert.equal(stripMarkdown('- [x] **P1** `a` [글](x) [[s|별칭]] | 칸 |'), '[x] P1 a 글 별칭 · 칸');
});

test('코드 스팬 안은 건드리지 않고 평문·굵게 안만 링크가 된다', () => {
  const pieces = inlinePieces('`D56` 과 **D56** 과 D56', resolver);
  assert.deepEqual(pieces[0], { type: 'code', text: 'D56' });
  assert.equal(pieces[1]?.type, 'text');
  const strong = pieces[2];
  assert.equal(strong?.type, 'strong');
  if (strong?.type === 'strong') assert.deepEqual(flat(strong.pieces), ['[D56→#/p/decisions/D56]']);
  assert.deepEqual(flat(pieces.slice(3) as RefPiece[]), [' 과 ', '[D56→#/p/decisions/D56]']);
});

test('해석기가 없으면(옛 viewer.yml·이름표 refs=false) 링크 없이 글자 그대로다', () => {
  assert.deepEqual(inlinePieces('D56 과 § 7.9.2', null), [{ type: 'text', text: 'D56 과 § 7.9.2' }]);
});

test('미리보기 카드는 아래에 두되 자리가 없으면 위로, 오른쪽 끝에서는 안으로 민다', () => {
  assert.deepEqual(cardPosition({ left: 10, top: 100, bottom: 120 }, 1000, 800), { left: 10, top: 126 });
  assert.deepEqual(cardPosition({ left: 900, top: 700, bottom: 720 }, 1000, 800), { left: 672, bottom: 106 });
});
