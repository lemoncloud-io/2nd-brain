// 출처: projects/project-viewer/config/shell/model/frontmatter.ts (2026-10-23 복사)
// frontmatter 분리. 본문은 바이트 그대로 남겨야 한다 — 리더가 "원문 그대로"를 표방하기 때문이다.
import { parse as parseYaml } from 'yaml';

export interface SplitResult {
  data: Record<string, unknown>;
  body: string;
  bodyStartLine: number; // 1부터. 원문에서 본문 첫 줄이 몇 번째 줄인가
}

const OPEN = /^---\r?\n/;

export function splitFrontmatter(text: string): SplitResult {
  const open = OPEN.exec(text);
  if (!open) return { data: {}, body: text, bodyStartLine: 1 };

  const headStart = open[0].length;
  // 닫는 구분선은 줄 전체가 정확히 '---'인 줄이어야 한다.
  const close = /(^|\n)---[ \t]*(\r?\n|$)/.exec(text.slice(headStart));
  if (!close) return { data: {}, body: text, bodyStartLine: 1 };

  const rawHead = text.slice(headStart, headStart + close.index + (close[1] ? 1 : 0));
  const bodyOffset = headStart + close.index + close[0].length;
  const body = text.slice(bodyOffset);

  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(rawHead);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // frontmatter가 깨져도 본문 렌더는 살린다. 검사는 본문 쪽 계약이 담당한다.
    data = {};
  }

  const consumed = text.slice(0, bodyOffset);
  const bodyStartLine = consumed.split('\n').length;
  return { data, body, bodyStartLine };
}

/** frontmatter의 aliases를 목록으로 돌려준다. 문자열 하나도 목록이 되고, 다듬어 빈 값은 뺀다. */
export function aliasesOf(data: Record<string, unknown>): string[] {
  const raw = data.aliases;
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return items
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

/** ``` 또는 ~~~ 펜스 안의 줄을 뺀다. AST 파서는 쓰지 않는다. */
function stripFences(body: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    if (fence === null) {
      const m = FENCE_OPEN.exec(line);
      if (m) {
        fence = m[1];
        continue;
      }
      out.push(line);
    } else {
      const t = line.trim();
      if (t.length >= fence.length && [...t].every((c) => c === fence![0])) fence = null;
    }
  }
  return out.join('\n');
}

/** 표시 제목. frontmatter title(비어 있지 않은 문자열)이 우선하고, 다음은 펜스를 뗀 본문의 첫 H1이고, 없으면 파일 이름(.md 제외)이다. */
/** `{{title}}` 같은 자리표시자가 든 제목. 템플릿의 제목은 뜻이 없으니 파일 이름을 쓴다. */
export function isPlaceholderTitle(title: string): boolean {
  return /\{\{[^}]*\}\}/.test(title);
}

export function titleOf(path: string, data: Record<string, unknown>, body: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const fallback = base.endsWith('.md') ? base.slice(0, -3) : base;
  const fm = data.title;
  if (typeof fm === 'string' && fm.trim() !== '') return isPlaceholderTitle(fm) ? fallback : fm.trim();
  const h1 = /^#[ \t]+(.+)$/m.exec(stripFences(body))?.[1]?.trim();
  if (h1) return isPlaceholderTitle(h1) ? fallback : h1;
  return fallback;
}
