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
