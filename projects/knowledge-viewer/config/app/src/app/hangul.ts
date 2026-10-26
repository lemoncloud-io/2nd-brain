// 한글 초성 검색의 글자 단위 규칙. 순수 함수다 — DOM·React 없음.
// 음절(가~힣, U+AC00~U+D7A3)은 초성 19자 중 하나로 풀린다. 질의의 호환 자음(ㄱ~ㅎ, U+3131~U+314E)은
// 음절의 초성에 맞고, 평자음(ㄱ·ㄷ·ㅂ·ㅅ·ㅈ)은 된소리 초성(ㄲ·ㄸ·ㅃ·ㅆ·ㅉ)에도 맞는다. 라틴은 소문자로 비교한다.

export const CHOSEONG: readonly string[] = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const SYL_BASE = 0xac00;
const SYL_END = 0xd7a3;
/** 초성 하나가 차지하는 음절 수(중성 21 × 종성 28). */
const PER_CHOSEONG = 21 * 28;
const JAMO_CONSONANT_FIRST = 0x3131; // ㄱ
const JAMO_CONSONANT_LAST = 0x314e; // ㅎ

/** 평자음 → 된소리. 질의의 평자음은 둘 다에 맞는다. */
const TENSE: Readonly<Record<string, string>> = { ㄱ: 'ㄲ', ㄷ: 'ㄸ', ㅂ: 'ㅃ', ㅅ: 'ㅆ', ㅈ: 'ㅉ' };

/** 완성형 음절이면 그 초성, 아니면 null. */
export function choseongOf(ch: string): string | null {
  const code = ch.codePointAt(0);
  if (code === undefined || code < SYL_BASE || code > SYL_END) return null;
  return CHOSEONG[Math.floor((code - SYL_BASE) / PER_CHOSEONG)] ?? null;
}

/** 호환 자음(ㄱ~ㅎ, 겹자음 ㄳ·ㄵ… 포함)인가. */
export function isConsonantJamo(ch: string): boolean {
  const code = ch.codePointAt(0);
  return code !== undefined && code >= JAMO_CONSONANT_FIRST && code <= JAMO_CONSONANT_LAST;
}

/** NFC 로 모은 뒤 코드포인트 단위로 자르고, 한 글자로 남는 소문자만 적용한다(길이가 바뀌는 특수 소문자는 그대로). */
export function foldChars(s: string): string[] {
  return Array.from(s.normalize('NFC'), (ch) => {
    const lower = ch.toLowerCase();
    return Array.from(lower).length === 1 ? lower : ch;
  });
}

/**
 * 질의 글자 q 가 본문 글자 c 에 맞는가. 둘 다 foldChars 를 거친 글자다.
 * 같으면 exact, q 가 자음이고 c 의 초성이 q(또는 q 의 된소리)면 initial, 아니면 null.
 */
export function charMatches(q: string, c: string): 'exact' | 'initial' | null {
  if (q === c) return 'exact';
  if (!isConsonantJamo(q)) return null;
  const cho = choseongOf(c);
  if (cho === null) return null;
  return cho === q || TENSE[q] === cho ? 'initial' : null;
}
