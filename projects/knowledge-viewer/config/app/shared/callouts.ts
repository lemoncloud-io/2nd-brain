// Obsidian callout `> [!type] 제목` 의 AST 변환. 순수 함수만 둔다 — DOM도 React도 건드리지 않는다.
// markdown.ts 옆에 따로 둔 까닭은 embeds.ts 와 같다(링크 캐시 지문 밖에 둔다).
//
// 결과 DOM(에이전트 모드도 같다):
//   <aside class="callout callout-<계열>" data-callout="<종류>">
//     <div class="callout-title"><span class="callout-icon" data-icon="<아이콘>"></span><span class="callout-title-text">제목</span></div>
//     <div class="callout-body">본문</div>
//   </aside>
// 접기(`[!x]-` 기본 접힘, `[!x]+` 기본 펼침)는 aside 안에 <details>, 제목이 <summary> 다.

import { visit } from 'unist-util-visit';

import type { Blockquote, BlockContent, DefinitionContent, Paragraph, PhrasingContent, Root } from 'mdast';

/** 아이콘 이름. 화면(src/app/icons.tsx CalloutIcon)이 같은 이름을 그린다. 없는 계열은 note 아이콘. */
export type CalloutIconName = 'note' | 'abstract' | 'info' | 'tip' | 'success' | 'question' | 'warning' | 'danger';

/** 계열 → [아이콘, 색 톤]. 색 톤은 CSS(src/styles/callout.css)의 `--tone-*` 묶음 이름이다. */
export const CALLOUT_FAMILIES = {
  note: ['note', 'blue'],
  info: ['info', 'blue'],
  todo: ['info', 'blue'],
  tip: ['tip', 'blue'],
  abstract: ['abstract', 'blue'],
  example: ['note', 'blue'],
  success: ['success', 'green'],
  question: ['question', 'amber'],
  warning: ['warning', 'amber'],
  failure: ['danger', 'red'],
  danger: ['danger', 'red'],
  bug: ['danger', 'red'],
  quote: ['note', 'muted'],
} as const satisfies Record<string, readonly [CalloutIconName, 'blue' | 'amber' | 'red' | 'green' | 'muted']>;

export type CalloutFamily = keyof typeof CALLOUT_FAMILIES;

/** Obsidian 의 별칭 종류 → 계열. */
const ALIASES: Record<string, CalloutFamily> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

const isFamily = (t: string): t is CalloutFamily => Object.hasOwn(CALLOUT_FAMILIES, t);

/** 종류(소문자) → 계열. 모르는 종류는 note 다. */
export function calloutFamily(type: string): CalloutFamily {
  const t = type.toLowerCase();
  return isFamily(t) ? t : Object.hasOwn(ALIASES, t) ? ALIASES[t]! : 'note';
}

/** 제목이 없을 때 쓰는 이름: 종류의 첫 글자만 대문자(`warning` → `Warning`, `my-type` → `My-type`). */
export function defaultTitle(type: string): string {
  const t = type.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// 첫 줄 머리: `[!종류]` 뒤에 접기 표시(`-`·`+`)가 붙을 수 있다. 종류는 공백·`]` 없는 한 덩이.
const HEAD = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/;

export type CalloutHead = { type: string; fold: '' | '-' | '+' };

/** 문자열 머리가 callout 표시인가. 순수 판정 — 시험용으로도 내보낸다. */
export function parseCalloutHead(text: string): (CalloutHead & { rest: string }) | null {
  const m = HEAD.exec(text);
  if (m === null) return null;
  return { type: m[1]!.toLowerCase(), fold: (m[2] ?? '') as CalloutHead['fold'], rest: text.slice(m[0].length) };
}

type HData = { hName?: string; hProperties?: Record<string, unknown> };
const dataOf = (node: { data?: unknown }): HData => (node.data ?? ((node as { data?: unknown }).data = {})) as HData;

/** 첫 문단을 제목 줄(첫 줄 바꿈 앞)과 나머지로 가른다. 줄 바꿈은 텍스트의 `\n` 이나 `break` 노드다. */
function splitFirstLine(children: PhrasingContent[]): { title: PhrasingContent[]; rest: PhrasingContent[] } {
  for (let i = 0; i < children.length; i += 1) {
    const c = children[i]!;
    if (c.type === 'break') return { title: children.slice(0, i), rest: children.slice(i + 1) };
    if (c.type !== 'text') continue;
    const nl = c.value.indexOf('\n');
    if (nl === -1) continue;
    const before = c.value.slice(0, nl);
    const after = c.value.slice(nl + 1);
    return {
      title: [...children.slice(0, i), ...(before === '' ? [] : [{ type: 'text', value: before } as PhrasingContent])],
      rest: [...(after === '' ? [] : [{ type: 'text', value: after } as PhrasingContent]), ...children.slice(i + 1)],
    };
  }
  return { title: children, rest: [] };
}

/** 끝 공백을 뗀다(제목 끝의 `  ` 같은 것). 빈 텍스트 노드는 버린다. */
function trimEnd(nodes: PhrasingContent[]): PhrasingContent[] {
  const out = [...nodes];
  const last = out[out.length - 1];
  if (last?.type === 'text') {
    const v = last.value.trimEnd();
    if (v === '') out.pop();
    else out[out.length - 1] = { ...last, value: v };
  }
  return out;
}

function mergeClass(props: Record<string, unknown>, add: string[]): void {
  const cls = Array.isArray(props.className) ? (props.className as string[]) : [];
  props.className = [...add, ...cls.filter((c) => !add.includes(c))];
}

/** blockquote 하나를 callout 으로 바꾼다. callout 표시가 없으면 false. */
function toCallout(node: Blockquote): boolean {
  const first = node.children[0];
  if (first?.type !== 'paragraph') return false;
  const lead = first.children[0];
  if (lead?.type !== 'text') return false;
  const head = parseCalloutHead(lead.value);
  if (head === null) return false;

  const inline: PhrasingContent[] = [...(head.rest === '' ? [] : [{ ...lead, value: head.rest }]), ...first.children.slice(1)];
  const { title, rest } = splitFirstLine(inline);
  const titleNodes = trimEnd(title);
  const family = calloutFamily(head.type);
  const [icon] = CALLOUT_FAMILIES[family];

  const titleLine: Paragraph = {
    type: 'paragraph',
    children: [
      { type: 'emphasis', children: [], data: { hName: 'span', hProperties: { className: ['callout-icon'], dataIcon: icon } } } as PhrasingContent,
      {
        type: 'emphasis',
        children: titleNodes.length === 0 ? [{ type: 'text', value: defaultTitle(head.type) }] : titleNodes,
        data: { hName: 'span', hProperties: { className: ['callout-title-text'] } },
      } as PhrasingContent,
    ],
    data: { hName: head.fold === '' ? 'div' : 'summary', hProperties: { className: ['callout-title'] } },
  } as Paragraph;

  const restPara: Paragraph[] = rest.length === 0 || rest.every((c) => c.type === 'text' && c.value.trim() === '') ? [] : [{ type: 'paragraph', children: rest }];
  const bodyBlocks = [...restPara, ...node.children.slice(1)] as (BlockContent | DefinitionContent)[];
  const parts: (BlockContent | DefinitionContent)[] = [titleLine];
  if (bodyBlocks.length > 0) {
    parts.push({ type: 'blockquote', children: bodyBlocks, data: { hName: 'div', hProperties: { className: ['callout-body'] } } } as Blockquote);
  }

  node.children =
    head.fold === ''
      ? parts
      : [{ type: 'blockquote', children: parts, data: { hName: 'details', hProperties: head.fold === '+' ? { open: true } : {} } } as Blockquote];
  const data = dataOf(node);
  data.hName = 'aside';
  const props = (data.hProperties ??= {});
  mergeClass(props, ['callout', `callout-${family}`]);
  props.dataCallout = head.type;
  return true;
}

/**
 * `> [!type] 제목` 으로 시작하는 인용을 callout 으로 바꾼다. 인용 안의 인용(중첩 callout)도 본다.
 * 이미 바꾼 그릇(hName 이 있는 blockquote — 본문·details)은 다시 보지 않는다.
 * 모르는 종류는 note 계열에 `data-callout` 만 원래 이름이다.
 */
export function remarkCallouts(): (tree: Root) => void {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      if ((node.data as HData | undefined)?.hName !== undefined) return;
      toCallout(node);
    });
  };
}
