// 단계 띠·stages 블록의 정적 마크업. parent·after를 안 쓴 뷰어는 옛 DOM과 바이트 단위로 같아야 한다
// (공용 도구는 선언하지 않은 기능 때문에 결과가 바뀌면 안 된다). 기준 마크업
// fixtures/legacy-stages-dom.html은 이 기능을 넣기 직전의 컴포넌트로 sample-bundle.json을 그린 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Bundle, StagesBlock, StatusView } from '../../model/types.ts';
import { withSsr } from './ssr.ts';
import type { Load } from './ssr.ts';

const bundle = JSON.parse(readFileSync(new URL('../fixtures/sample-bundle.json', import.meta.url), 'utf8')) as Bundle;
const legacy = readFileSync(new URL('../fixtures/legacy-stages-dom.html', import.meta.url), 'utf8');

type Comp = (props: Record<string, unknown>) => React.ReactElement;

async function render(load: Load, b: Bundle): Promise<{ strip: string[]; stages: string[] }> {
  const m = (await load('/src/blocks/StageStrip.tsx')) as {
    StageStrip: Comp;
    findStageStrip: (b: Bundle) => { pageId: string; block: StagesBlock };
  };
  const s = (await load('/src/blocks/Stages.tsx')) as { Stages: Comp };
  const strip = m.findStageStrip(b);
  return {
    strip: [null, 'S2'].map((cur) => renderToStaticMarkup(createElement(m.StageStrip, { bundle: b, strip, currentId: cur }))),
    stages: [null, 'S2.C1'].map((sel) =>
      renderToStaticMarkup(createElement(s.Stages, { bundle: b, block: strip.block, selectedId: sel, onSelect: () => {} })),
    ),
  };
}

function withLinks(): Bundle {
  const b = structuredClone(bundle);
  const block = b.viewer.pages.flatMap((p) => p.blocks).find((x) => x.type === 'stages') as StagesBlock;
  // S1·S2를 마일스톤으로, S3~S5를 S2 아래 묶음으로. S5는 S3 다음.
  block.stages[2]!.parent = 'S2';
  block.stages[3]!.parent = 'S2';
  block.stages[4]!.parent = 'S2';
  block.stages[4]!.after = ['S3'];
  return b;
}

test('parent·after가 없는 뷰어의 단계 띠와 stages 블록은 옛 DOM과 같다', async () => {
  const out = await withSsr((load) => render(load, bundle));
  assert.equal([...out.strip, ...out.stages].join('\n') + '\n', legacy);
});

test('parent가 있으면 띠는 최상위 단계를 한 줄로 두고 하위 단계를 부모 뒤 묶음 틀에 넣는다', async () => {
  const b = withLinks();
  const out = await withSsr((load) => render(load, b));
  const html = out.strip[0]!;
  // 시각 순서 = DOM 순서 = 초점 순서
  const order = [...html.matchAll(/href="#\/p\/stages\/([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(order, ['S1', 'S2', 'S3', 'S4', 'S5']);
  assert.match(html, /<div class="stagestrip__group stagestrip__group--blue" role="group" aria-label="S2 실측 묶음">/);
  assert.equal((html.match(/stagestrip__item--sub/g) ?? []).length, 3);
  // 자기 항목이 있는 부모는 하위 집계를 붙이지 않는다
  assert.doesNotMatch(html, /stagestrip__tally/);
  // 하위 단계의 tone 색은 그대로
  assert.match(html, /stagestrip__item stagestrip__item--muted stagestrip__item--sub" href="#\/p\/stages\/S3"/);
});

test('자기 항목이 없는 부모 칩에는 끝난 하위 단계 수가 붙는다', async () => {
  const b = withLinks();
  const block = b.viewer.pages.flatMap((p) => p.blocks).find((x) => x.type === 'stages') as StagesBlock;
  delete block.stages[1]!.items;
  b.status['S3'] = { ...(b.status['S1'] as StatusView) };
  const out = await withSsr((load) => render(load, b));
  assert.match(out.strip[0]!, /<span class="stagestrip__tally">1\/3<\/span>/);
});

test('parent·after가 있는 stages 블록은 흐름/목록 전환과 흐름 그림을 기본으로 보인다', async () => {
  const b = withLinks();
  const out = await withSsr((load) => render(load, b));
  const html = out.stages[0]!;
  assert.match(html, /aria-label="단계 보기 방식"/);
  assert.match(html, /<button type="button" class="btn" aria-pressed="true">흐름<\/button>/);
  assert.match(html, /class="flow"/);
  // 최상위 단계는 가로 파이프라인, 하위 단계는 그 아래 묶음 칸. 초점 순서는 보이는 순서(파이프라인 → 묶음 칸)
  const nodes = [...html.matchAll(/class="(flow__node|flow__kid) [^"]*"[^>]*aria-label="([^"·]+) ·/g)].map((x) => `${x[1]}:${x[2]}`);
  assert.deepEqual(nodes, [
    'flow__node:설계 합의',
    'flow__node:흐름 실측',
    'flow__kid:결제 연동',
    'flow__kid:운영 점검',
    'flow__kid:외부 공개',
  ]);
  assert.match(html, /<ol class="flow__pipe flow__pipe--groups" style="--flow-n:2" aria-label="[^"]*">/);
  // 지금 단계(S2)는 표지를 달고, 묶음 칸의 부모라 아래로 내려가는 선을 갖는다
  assert.match(html, /<li class="flow__stop is-now flow__stop--group"><span class="flow__now" aria-hidden="true">지금 ▼<\/span>/);
  assert.match(html, /<span class="flow__notch flow__notch--blue" aria-hidden="true"><\/span>/);
  // 묶음 칸은 파이프라인 줄(가로로 구르는 칸) 밖, 그 아래에 있다
  assert.match(html, /<\/ol><\/div><div class="flow__lane flow__lane--blue" role="group" aria-label="S2 실측 묶음">/);
  // after는 선 대신 칸의 표지(S3가 안 끝났으니 호박색)
  assert.match(html, /<span class="flow__dep flow__dep--blocking"[^>]*>← S3 결제<\/span>/);
  assert.doesNotMatch(html, /<svg/);
  // 아무것도 고르지 않았으면 지금 단계(S2)의 상세가 아래에 열린다
  assert.match(html, /<div class="stages__detail" id="S2">/);
});

test('어휘가 motion·struck을 선언한 상태만 진행 중 칩·점과 취소선 클래스를 받는다', async () => {
  const marked = (b: Bundle): Bundle => {
    const c = structuredClone(b);
    c.status['S2'] = { ...(c.status['S2'] as StatusView), motion: 'pulse' };
    c.status['S4'] = { ...(c.status['S4'] as StatusView), label: '폐기', struck: true };
    c.status['S4.C2'] = { ...(c.status['S4.C2'] as StatusView), label: '폐기', struck: true };
    return c;
  };
  // 선언이 없는 상태(S1·S3 …)는 손대지 않는다 — 옛 뷰어와 같은 칩이다
  const flat = await withSsr((load) => render(load, marked(bundle)));
  const strip = flat.strip[0]!;
  // 진행 중 칩은 칩 자체에 도는 테 클래스가 붙고(선언한 칩 하나만), 점은 가만히 있어 pulse 클래스가 없다
  assert.doesNotMatch(strip, /stagestrip__dot--pulse/);
  assert.match(strip, /class="stagestrip__item stagestrip__item--blue stagestrip__item--pulse" href="#\/p\/stages\/S2"/);
  assert.equal((strip.match(/stagestrip__item--pulse/g) ?? []).length, 1);
  assert.match(strip, /class="stagestrip__item stagestrip__item--muted stagestrip__item--struck" href="#\/p\/stages\/S4"/);
  assert.equal((strip.match(/--struck/g) ?? []).length, 1);
  const list = flat.stages[0]!;
  assert.match(list, /<span class="badge badge--blue badge--pulse">진행 중<\/span>/);
  assert.match(list, /class="stages__listBtn stages__listBtn--struck"><span class="badge badge--muted badge--struck"><span class="strike">폐기<\/span>/);
  // 선언이 없는 상태 배지는 옛 마크업 그대로
  assert.match(list, /<span class="badge badge--green">검증 완료<\/span>/);

  // 흐름 그림 — 진행 중 알약에 점, 폐기 칸은 is-struck
  const out = await withSsr((load) => render(load, marked(withLinks())));
  const flow = out.stages[0]!;
  assert.match(flow, /class="flow__pill flow__pill--blue flow__pill--pulse">진행 중</);
  assert.match(flow, /class="flow__kid flow__tone--muted flow__state--todo is-struck"/);

  // 폐기 항목은 단계 상세에서 점선 칸 + 제목 취소선
  const s4 = await withSsr(async (load) => {
    const s = (await load('/src/blocks/Stages.tsx')) as { Stages: Comp };
    const b = marked(bundle);
    const block = b.viewer.pages.flatMap((p) => p.blocks).find((x) => x.type === 'stages') as StagesBlock;
    return renderToStaticMarkup(createElement(s.Stages, { bundle: b, block, selectedId: 'S4.C2', onSelect: () => {} }));
  });
  assert.match(s4, /<h4><span class="strike">/);
  assert.match(s4, /<button type="button" class="pick pick--struck" id="S4.C2"[^>]*><span class="pick__label"><span class="strike">/);
});
