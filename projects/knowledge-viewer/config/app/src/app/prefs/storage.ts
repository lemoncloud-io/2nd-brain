// localStorage 는 던질 수 있다(사생활 모드·차단·SSR). 설정 모듈은 전부 이 둘을 거친다.

/** 키 값을 읽는다. 없거나 못 읽으면 null. */
export function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 키 값을 쓴다. 못 써도 조용히 넘어간다 — 화면은 바뀐다. */
export function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장 못 해도 화면은 바뀐다
  }
}
