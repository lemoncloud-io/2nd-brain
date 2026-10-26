// 본문 HTML 정화 규칙. rehype-sanitize 기본값에서 시작해 필요한 것만 더한다.
import { defaultSchema, type Options } from 'rehype-sanitize';

import { CALLOUT_FAMILIES } from '../../shared/callouts.ts';

const EXTRA_TAGS = ['details', 'summary', 'img', 'br', 'sub', 'sup', 'kbd', 'aside'];

/** callout(remarkCallouts) 이 다는 클래스. 값 고정이라 다른 class 는 벗겨진다. 최상위 블록이 되므로 `changed` 도 둔다. */
const CALLOUT_CLASSES = ['callout', ...Object.keys(CALLOUT_FAMILIES).map((f) => `callout-${f}`), 'changed'];

type AttrDef = NonNullable<Options['attributes']>[string];

/**
 * img src 로 통과시키는 꼴. rehypeImageSrcToTitle 이 만든 것만이다:
 * `data:` · 같은 출처 `/raw/<경로>`(local, 첫 글자 `@`·`/` 아님) · git 출처 `http://localhost:<포트>/raw/@main|@pr/<n>/…`
 * · 원격 `https://…`(토글 켬 + 허용 호스트일 때만 남는다 — 그릴지는 rehypeImageSrcToTitle 이 정한다).
 * 그 밖의 `http:`·`//host`·절대경로(`/etc/…`)·`javascript:`·`file:` 은 여기서도 벗겨진다.
 */
export const IMG_SRC = /^(?:data:|https:\/\/|\/raw\/(?![@/])|http:\/\/localhost:\d{1,5}\/raw\/@(?:main|pr\/\d+)\/)/;

/** "불러오기" 배지의 주소(data-remote-ask). `https://` 만 남는다. */
export const REMOTE_ASK = /^https:\/\//;

/**
 * 태그별 규칙이 있으면 sanitize 는 `'*'` 를 보지 않는다. 기본 스키마에서 className 튜플이 있고
 * 최상위 블록이 될 수 있는 태그(h2·ul·ol)는 그 튜플에 `changed` 를 더해야 표식이 남는다.
 * (a·li·section·input 은 최상위 블록이 아니고, code 의 표식은 <pre> 로 옮긴다.)
 */
const CHANGED_BLOCK_TAGS = ['h2', 'ul', 'ol'];
function withChangedClass(defs: AttrDef | undefined): AttrDef {
  return (defs ?? []).map((d) => (Array.isArray(d) && d[0] === 'className' ? [...d, 'changed'] : d)) as AttrDef;
}
const changedBlockAttrs = Object.fromEntries(
  CHANGED_BLOCK_TAGS.map((t) => [t, withChangedClass(defaultSchema.attributes?.[t])]),
);

/**
 * - 태그: 기본 + details·summary·img·br·sub·sup·kbd (script·iframe 등은 기본에 없다).
 * - td·th: className 은 표 보기 값(`cell-first`·`cell-short`)만.
 * - img: alt·title·src·loading(lazy)·decoding(async)·data-in-link(1)·data-remote-ask(`https://…`)만. src 는 `data:`·`/raw/…`·
 *   git 출처 `/raw/@…`·`https://…` 만 통과한다(IMG_SRC — `imageMode` 'inline'·'raw', 원격은 토글 켬 + 허용 호스트).
 *   나머지는 src 가 벗겨져 배지로 그린다. width·height 는 기본 `'*'` 에 있다.
 * - href: 기본 + `wikilink:`(remarkWikilinks가 만든 표시). 상대 경로·`#`는 프로토콜이 없어 그대로 통과한다.
 * - callout(remarkCallouts): aside 는 `callout`·`callout-<계열>`·`changed` 클래스와 `data-callout`,
 *   div·summary 는 `callout-title`·`callout-body`, span 은 `callout-icon`(+`data-icon`)·`callout-title-text` 만.
 *   details 의 `open` 은 기본 `'*'` 에 있다.
 * - 임베드(remarkEmbeds): a 의 `data-embed` 를 더 허용한다. img 의 width·height 는 기본 `'*'` 에 있다.
 * - 주석은 버린다(allowComments 기본 false).
 * - id 접두(`user-content-`)는 붙이지 않는다. 헤딩 id가 검사기 슬러그와 같아야 앵커가 맞는다.
 * - PR 변경 표시(remarkChanged): 클래스는 `changed` 하나만, `data-changed`·`data-removed` 만 더 허용한다.
 *   h2·ul·ol 은 태그별 className 튜플에도 `changed` 를 더한다(기존 값은 그대로).
 *   다른 클래스·다른 `data-*` 는 여전히 벗겨진다.
 */
export const SANITIZE_SCHEMA: Options = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), ...EXTRA_TAGS])],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), ['className', 'changed'], 'dataChanged', 'dataRemoved'],
    ...changedBlockAttrs,
    img: ['alt', 'title', ['src', IMG_SRC], ['loading', 'lazy'], ['decoding', 'async'], ['dataInLink', '1'], ['dataRemoteAsk', REMOTE_ASK]],
    a: [...(defaultSchema.attributes?.a ?? []), 'dataEmbed'],
    aside: [['className', ...CALLOUT_CLASSES], 'dataCallout'],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'callout-title', 'callout-body', 'changed']],
    summary: [...(defaultSchema.attributes?.summary ?? []), ['className', 'callout-title']],
    span: [['className', 'callout-icon', 'callout-title-text'], 'dataIcon'],
    // 표 보기 클래스. 값 고정이라 다른 class 는 그대로 벗겨진다.
    td: [['className', 'cell-first', 'cell-short']],
    th: [['className', 'cell-first', 'cell-short']],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...new Set([...(defaultSchema.protocols?.href ?? []), 'wikilink'])],
    // http 는 git 출처(localhost)용, https 는 원격 이미지(토글 켬)용이다. 값은 IMG_SRC 가 다시 묶는다.
    src: ['data', 'http', 'https'],
  },
  clobber: [],
  allowComments: false,
};
