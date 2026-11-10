// 서술 문자열의 인라인 문법. 스키마가 허용하는 것은 평문·`코드`·**굵게** 셋뿐이다.
// HTML을 토큰으로 만들지 않는 것이 핵심이다 — 렌더러가 dangerouslySetInnerHTML을 쓸 일이 없어진다.

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string };

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let plain = '';

  const flush = () => {
    if (plain !== '') {
      tokens.push({ type: 'text', text: plain });
      plain = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      // 빈 코드(``)와 짝 없는 백틱은 문법이 아니라 글자로 둔다.
      if (end > i + 1) {
        flush();
        tokens.push({ type: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      plain += ch;
      i += 1;
      continue;
    }

    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        tokens.push({ type: 'strong', text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
      plain += '**';
      i += 2;
      continue;
    }

    plain += ch;
    i += 1;
  }

  flush();
  return tokens;
}

// 검색 색인처럼 문법 기호 없는 순수 글자가 필요한 곳에서 쓴다.
export function inlineToPlain(text: string): string {
  return parseInline(text)
    .map((t) => t.text)
    .join('');
}
