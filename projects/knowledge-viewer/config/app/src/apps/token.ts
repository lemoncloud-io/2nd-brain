// 앱 토큰 읽기. 서버가 /apps/<id> 응답에만 `<meta name="kv-app-token">` 을 넣는다(server/static.ts).
// localStorage 에 두지 않는다 — 문서가 살아 있는 동안 meta 에서 읽기만 한다.

/** meta 이름. 서버 static.ts 의 APP_TOKEN_META 와 같다. */
export const APP_TOKEN_META = 'kv-app-token';

/** 문서의 앱 토큰. 없으면 ''(다른 주소로 처음 연 문서 — 새로 고침하면 서버가 넣어 준다). */
export function readAppToken(doc: Pick<Document, 'querySelector'> | undefined = typeof document === 'undefined' ? undefined : document): string {
  const el = doc?.querySelector(`meta[name="${APP_TOKEN_META}"]`);
  const v = el?.getAttribute('content') ?? '';
  return /^[0-9a-f]+$/i.test(v) ? v : '';
}
