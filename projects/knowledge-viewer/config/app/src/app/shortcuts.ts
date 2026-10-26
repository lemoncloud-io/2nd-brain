// 키보드 단축키 — 정의 표·플랫폼 판정·표기·매칭. 순수 모듈이다(React·DOM 전역을 만지지 않는다).
// 표가 단일 출처다: 전역 훅(useShortcuts.ts)이 scope 'app' 항목을 묶고, 도움말(ShortcutHelp.tsx)과 README 표가 같은 표를 그린다.
//
// 조합 문법: 수식어를 '+' 로 잇고 끝에 키 하나. 수식어는 mod(맥 ⌘ / 그 밖 Ctrl)·ctrl·alt·shift·meta.
// 키는 글자(소문자)·기호('/', '?', '[', ']', ',')·이름(escape·enter·space·arrowup·arrowdown·arrowleft·arrowright).
// 그래프 그룹의 shift(누르고 있기)·hover(마우스 올림)는 설명용 토큰이다.

export type Platform = 'mac' | 'win';

export type ShortcutGroup = 'nav' | 'search' | 'panel' | 'doc' | 'graph';

/**
 * app: 전역 훅이 처리한다(이 앱이 잡는 키).
 * native: 브라우저나 그 위젯(링크·검색 상자)이 이미 하는 일 — 도움말에 적기만 하고 잡지 않는다.
 * graph: 지도 캔버스가 스스로 처리한다(src/graph/interaction.ts) — 도움말에 적기만 한다.
 */
export type ShortcutScope = 'app' | 'native' | 'graph';

export type Shortcut = {
  id: string;
  /** 같은 동작의 대체 조합. 도움말에는 "또는" 으로 잇는다. */
  keys: string[];
  /** 맥에서만 다른 조합(브라우저 기본 키가 플랫폼마다 다른 경우). */
  macKeys?: string[];
  desc: string;
  group: ShortcutGroup;
  scope: ShortcutScope;
  /** 누르고 있을 때 반복 입력도 받는가(트리 이동). 기본은 받지 않는다. */
  repeat?: boolean;
  /** 키보드·마우스가 있어야 되는 동작(폰·태블릿엔 Shift·Space·호버가 없다). 도움말에 "데스크톱" 이라 적는다. */
  desktopOnly?: boolean;
};

export const GROUPS: { id: ShortcutGroup; label: string }[] = [
  { id: 'nav', label: '탐색' },
  { id: 'search', label: '검색' },
  { id: 'panel', label: '패널' },
  { id: 'doc', label: '문서' },
  { id: 'graph', label: '그래프' },
];

export const SHORTCUTS: Shortcut[] = [
  { id: 'help', keys: ['?'], desc: '단축키 도움말 열기·닫기', group: 'nav', scope: 'app' },
  { id: 'escape', keys: ['escape'], desc: '도움말·메뉴·검색 닫기(입력 상자에서도)', group: 'nav', scope: 'app' },
  { id: 'view.graph', keys: ['g'], desc: '연결 지도 ↔ 문서', group: 'nav', scope: 'app' },
  { id: 'tree.next', keys: ['j', 'arrowdown'], desc: '트리 다음 항목(트리 밖에서 j 는 현재 문서 행으로)', group: 'nav', scope: 'app', repeat: true },
  { id: 'tree.prev', keys: ['k', 'arrowup'], desc: '트리 이전 항목(트리 밖에서 k 는 현재 문서 행으로)', group: 'nav', scope: 'app', repeat: true },
  { id: 'tree.expand', keys: ['arrowright'], desc: '트리 폴더 펴기 · 편 폴더면 첫 항목으로', group: 'nav', scope: 'app', repeat: true },
  { id: 'tree.collapse', keys: ['arrowleft'], desc: '트리 폴더 접기 · 상위 폴더로', group: 'nav', scope: 'app', repeat: true },
  { id: 'tree.open', keys: ['enter'], desc: '트리에서 고른 항목 열기', group: 'nav', scope: 'native' },

  { id: 'search.focus', keys: ['/', 'mod+k'], desc: '검색창으로(제목 즉시 검색·트리 필터)', group: 'search', scope: 'app' },
  { id: 'search.all', keys: ['mod+shift+f'], desc: '전체 검색 — raw·archive 포함을 켜고 검색창으로', group: 'search', scope: 'app' },
  { id: 'search.pick', keys: ['arrowdown', 'arrowup'], desc: '검색 결과 고르기(검색창 안)', group: 'search', scope: 'native' },
  { id: 'search.go', keys: ['enter'], desc: '고른 결과 열기(없으면 첫 결과)', group: 'search', scope: 'native' },

  { id: 'panel.left', keys: ['['], desc: '왼쪽 패널(트리) 접기·펴기', group: 'panel', scope: 'app' },
  { id: 'panel.right', keys: [']'], desc: '오른쪽 패널 접기·펴기', group: 'panel', scope: 'app' },
  { id: 'settings', keys: [','], desc: '⚙ 설정 메뉴 열기(첫 조절에 포커스, Esc 로 닫기)', group: 'panel', scope: 'app' },

  { id: 'bookmark', keys: ['b'], desc: '현재 문서 북마크 추가·해제', group: 'doc', scope: 'app' },
  { id: 'doc.top', keys: ['t'], desc: '문서 맨 위로', group: 'doc', scope: 'app' },
  { id: 'history.back', keys: ['alt+arrowleft'], macKeys: ['mod+['], desc: '뒤로', group: 'doc', scope: 'native' },
  { id: 'history.forward', keys: ['alt+arrowright'], macKeys: ['mod+]'], desc: '앞으로', group: 'doc', scope: 'native' },

  { id: 'graph.pan', keys: ['shift'], desc: '누른 채 끌기·휠 — 노드 선택 없이 이동·줌', group: 'graph', scope: 'graph', desktopOnly: true },
  { id: 'graph.reset', keys: ['space'], desc: '초기 보기로(관성 전환)', group: 'graph', scope: 'graph', desktopOnly: true },
  { id: 'graph.hover', keys: ['hover'], desc: '노드에 마우스 — 닿은 간선 강조', group: 'graph', scope: 'graph', desktopOnly: true },
];

/** 이 앱이 절대 잡지 않는 브라우저 기본 조합(탭·창·주소창·새로고침·인쇄·저장·찾기·히스토리). */
export const BROWSER_RESERVED = [
  'mod+w',
  'mod+t',
  'mod+l',
  'mod+r',
  'mod+p',
  'mod+n',
  'mod+q',
  'mod+s',
  'mod+o',
  'mod+f',
  'mod+d',
  'mod+h',
  'mod+shift+t',
  'mod+shift+n',
  'mod+shift+w',
  'mod+shift+r',
  'mod+[',
  'mod+]',
  'alt+arrowleft',
  'alt+arrowright',
];

/** 이 플랫폼에서 쓰는 조합. */
export function keysFor(s: Shortcut, platform: Platform): string[] {
  return platform === 'mac' && s.macKeys !== undefined ? s.macKeys : s.keys;
}

type NavLike = { platform?: string; userAgent?: string; userAgentData?: { platform?: string } | null } | null | undefined;

/** 맥(또는 iOS)인가. userAgentData.platform → platform → userAgent 순으로 본다. */
export function isMac(nav: NavLike): boolean {
  if (nav === null || nav === undefined) return false;
  const p = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(p);
}

export function detectPlatform(nav: NavLike = typeof navigator === 'undefined' ? undefined : navigator): Platform {
  return isMac(nav) ? 'mac' : 'win';
}

export type Combo = { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string };

export function parseCombo(combo: string): Combo {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const has = (m: string) => parts.includes(m);
  return { mod: has('mod'), ctrl: has('ctrl'), alt: has('alt'), shift: has('shift'), meta: has('meta'), key };
}

/** 수식어(mod·ctrl·meta·alt)가 붙은 조합인가 — 글자를 치는 조합이 아니라 입력 상자 안에서도 받는다. */
export function hasCommandModifier(combo: string): boolean {
  const c = parseCombo(combo);
  return c.mod || c.ctrl || c.meta || c.alt;
}

const KEY_LABEL: Record<string, { mac: string; win: string }> = {
  escape: { mac: 'Esc', win: 'Esc' },
  enter: { mac: 'Enter', win: 'Enter' },
  space: { mac: 'Space', win: 'Space' },
  arrowup: { mac: '↑', win: '↑' },
  arrowdown: { mac: '↓', win: '↓' },
  arrowleft: { mac: '←', win: '←' },
  arrowright: { mac: '→', win: '→' },
  shift: { mac: '⇧', win: 'Shift' },
  hover: { mac: '마우스 올림', win: '마우스 올림' },
};

/** 키캡 하나하나의 글. 맥은 ⌃⌥⇧⌘ 순, 그 밖은 Ctrl·Alt·Shift·Win 순. 수식어 없는 글자는 소문자, 있으면 대문자. */
export function keyParts(combo: string, platform: Platform): string[] {
  const c = parseCombo(combo);
  const mac = platform === 'mac';
  const ctrl = c.ctrl || (c.mod && !mac);
  const meta = c.meta || (c.mod && mac);
  const out: string[] = [];
  if (mac) {
    if (ctrl) out.push('⌃');
    if (c.alt) out.push('⌥');
    if (c.shift) out.push('⇧');
    if (meta) out.push('⌘');
  } else {
    if (ctrl) out.push('Ctrl');
    if (c.alt) out.push('Alt');
    if (c.shift) out.push('Shift');
    if (meta) out.push('Win');
  }
  const named = KEY_LABEL[c.key];
  const modified = out.length > 0;
  out.push(named !== undefined ? named[platform] : modified ? c.key.toUpperCase() : c.key);
  return out;
}

/** 조합을 플랫폼 표기로 — 맥 "⌘K"·"⇧⌘F", 그 밖 "Ctrl+K"·"Ctrl+Shift+F". */
export function formatKeys(combo: string, platform: Platform): string {
  return keyParts(combo, platform).join(platform === 'mac' ? '' : '+');
}

export type KeyEventLike = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

const CODE_KEY: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'space',
};

/**
 * 이벤트의 키 이름(조합 문법). e.key 가 ASCII 한 글자면 그 글자(소문자), 이름 키면 소문자 이름.
 * 한글 입력기("ㅎ")·맥 ⌥ 조합("©")처럼 ASCII 가 아니면 물리 키(e.code)로 되돌린다 — 그래야 한글 자판에서도 g·b·t 가 듣는다.
 * ASCII 일 때 e.code 를 보지 않는 까닭: 드보락·아제르티 사용자에게는 글자가 맞다.
 */
export function eventKey(e: KeyEventLike): string {
  const k = e.key;
  if (k === ' ' || k === 'Spacebar') return 'space';
  // 일부 자판·자동화는 Shift+/ 를 key '/' 그대로 보낸다. 사람이 뜻한 것은 '?' 다.
  if (k === '/' && e.shiftKey) return '?';
  if (k.length === 1 && k.charCodeAt(0) < 128) return k.toLowerCase();
  if (k.length > 1 && /^[A-Za-z]+$/.test(k) && k !== 'Process' && k !== 'Unidentified' && k !== 'Dead') return k.toLowerCase();
  const code = e.code ?? '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === 'Slash' && e.shiftKey) return '?';
  return CODE_KEY[code] ?? k.toLowerCase();
}

/** Shift 를 눌러야 나오는 기호. 조합에 shift 를 적지 않아도 Shift 가 눌린 채로 들어온다. */
const SHIFTED = new Set(['?', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '{', '}', '|', ':', '"', '<', '>', '~']);

/**
 * 키 이벤트가 조합에 맞는가. mod 는 맥이면 ⌘(meta), 그 밖이면 Ctrl 이다.
 * 수식어는 정확히 맞아야 한다(⌘K 자리에 ⌘⇧K 는 아니다). 단 '?' 같은 Shift 기호는 Shift 유무를 보지 않는다.
 */
export function matchShortcut(e: KeyEventLike, combo: string, platform: Platform): boolean {
  const c = parseCombo(combo);
  const mac = platform === 'mac';
  const wantMeta = c.meta || (c.mod && mac);
  const wantCtrl = c.ctrl || (c.mod && !mac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== c.alt) return false;
  const k = eventKey(e);
  if (SHIFTED.has(c.key)) return k === c.key;
  if (e.shiftKey !== c.shift) return false;
  return k === c.key;
}

type TargetLike = { tagName?: string; isContentEditable?: boolean; type?: string } | null | undefined;

/** 글자를 치는 곳인가 — input·textarea·select·contenteditable. 거기서는 수식어 없는 전역 단축키를 무시한다(Esc 는 받는다). */
export function isTypingTarget(el: TargetLike): boolean {
  if (el === null || el === undefined) return false;
  if (el.isContentEditable === true) return true;
  const t = (el.tagName ?? '').toUpperCase();
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
}

/** 입력 상자 안에서도 받는 조합인가 — Esc 와 수식어 조합(⌘K 등). '/'·'g' 같은 글자는 글자다. */
export function allowedWhileTyping(combo: string): boolean {
  return parseCombo(combo).key === 'escape' || hasCommandModifier(combo);
}

/** 이 이벤트가 맞는 app 단축키 id 와 조합. 없으면 null. */
export function findShortcut(e: KeyEventLike, platform: Platform, typing: boolean, table: Shortcut[] = SHORTCUTS): { id: string; combo: string } | null {
  for (const s of table) {
    if (s.scope !== 'app') continue;
    for (const combo of keysFor(s, platform)) {
      if (typing && !allowedWhileTyping(combo)) continue;
      if (matchShortcut(e, combo, platform)) return { id: s.id, combo };
    }
  }
  return null;
}
