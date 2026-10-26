// 이미지 src 판정과 위키 이미지 임베드의 볼트 경로 풀이. 순수 함수만 둔다 — 화면(리더)과 서버(/api/doc)가 함께 쓴다.
//
// markdown.ts 옆에 따로 둔 까닭: markdown.ts 는 링크 캐시 지문(server/link-cache.ts PARSER_SOURCES)에 들어간다.
// 이미지 규칙은 링크 추출과 무관하다. markdown.ts 의 옛 `imageMode`(data: 만 inline)는 지문을 바꾸지 않으려고 글자 그대로
// 남아 있을 뿐 아무도 쓰지 않는다 — 판정은 이 파일의 것이 정본이다. 다음 지문 재생성 때 함께 지운다.

/** 볼트 안 이미지로 그리는 확장자(소문자). 그 밖의 상대경로는 배지다. */
export const RAW_IMAGE_EXT: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']);

/**
 * 이미지를 어떻게 다룰지. 판정만 하는 순수 함수라 화면 없이 테스트한다.
 * - inline: `data:` — 그대로 그린다.
 * - raw: 볼트 상대경로 이미지 — 지금 소스의 `/raw` 로 그린다(문서 기준 풀이·볼트 밖 거절은 리더가 한다).
 * - badge-external: 원격(`http(s):`·`//host`) — 요청하지 않고 배지 + 외부 링크.
 * - badge-relative: 그 밖(절대경로·`file:`·`javascript:`·이미지 아닌 확장자·빈 값) — 배지만.
 */
export type ImageMode = 'inline' | 'raw' | 'badge-external' | 'badge-relative';

/** `a/b.PNG?v=1#x` → `a/b.PNG`. 쿼리·해시는 파일 경로가 아니다. */
export function stripQueryHash(src: string): string {
  const cut = src.search(/[?#]/);
  return cut === -1 ? src : src.slice(0, cut);
}

/** 경로 마지막 조각의 확장자(소문자). 없으면 빈 문자열이다. */
function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** 볼트에서 그리는 이미지 파일인가(확장자만 본다, 대소문자 무관). */
export function isRawImagePath(path: string): boolean {
  return RAW_IMAGE_EXT.has(extOf(stripQueryHash(path)));
}

export function imageMode(src: string): ImageMode {
  const raw = src.trim();
  if (raw === '') return 'badge-relative';
  if (/^data:/i.test(raw)) return 'inline';
  // 프로토콜 없는 `//host/a.png`도 원격이다.
  if (/^https?:/i.test(raw) || raw.startsWith('//')) return 'badge-external';
  // 스킴(`file:`·`javascript:` 등)·절대경로·역슬래시(`\\host`)는 볼트 상대경로가 아니다.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) return 'badge-relative';
  return isRawImagePath(raw) ? 'raw' : 'badge-relative';
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const slashes = (p: string): number => p.split('/').length - 1;

/**
 * 위키 이미지 임베드 `![[그림.png]]`·`![[sub/그림.png]]` 의 볼트 경로. Obsidian 은 파일명(또는 경로 꼬리)만 적으므로
 * 소스의 이미지 파일 목록에서 대소문자 없이 꼬리가 맞는 것을 찾는다. 여럿이면 링크 해석(resolveWith)과 같은 순서 —
 * 문서와 같은 폴더 → `/` 수 → 알파벳. 스킴·`..`·이미지 아닌 확장자는 null 이다.
 */
export function resolveImageEmbed(source: string, target: string, images: readonly string[]): string | null {
  const t = target.trim().replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (t === '' || /^[a-z][a-z0-9+.-]*:/i.test(t) || !isRawImagePath(t)) return null;
  if (t.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
  const want = t.toLowerCase();
  const hits = images.filter((p) => {
    const lower = p.toLowerCase();
    return lower === want || lower.endsWith(`/${want}`);
  });
  if (hits.length === 0) return null;
  const here = dirOf(source);
  const sorted = [...hits].sort((a, b) => {
    const sa = dirOf(a) === here ? 0 : 1;
    const sb = dirOf(b) === here ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (slashes(a) !== slashes(b)) return slashes(a) - slashes(b);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted[0] ?? null;
}

// ── 원격 이미지(사용자 토글 + 허용 호스트, 2026-10-24) ─────────────────────────────
// 토글을 켜도 `https:` 만 그린다 — `http:`·`//host` 는 허용 호스트여도 배지다. 판정은 리더(imageSrc.ts)가 한다.

/** 기본 허용 호스트 — 조직 CDN. ⚙ 에서 바꾸고 "기본값" 으로 되돌린다. */
export const DEFAULT_REMOTE_IMAGE_HOSTS: readonly string[] = ['image.lemoncloud.io', 'file.eureka.codes'];

/** 목록 한 칸의 꼴: `호스트` 또는 `*.도메인`. 점이 하나 이상, 글자는 영문·숫자·`-`. 홀로 `*`·포트·경로는 아니다. */
const HOST_ENTRY = /^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** 한 칸을 비교용 꼴로(소문자·끝 점 없음). 꼴이 아니면 null. */
export function normalizeHostEntry(entry: string): string | null {
  const e = entry.trim().toLowerCase().replace(/\.$/, '');
  return HOST_ENTRY.test(e) ? e : null;
}

/** 쉼표·공백·줄로 나뉜 글을 목록으로. 꼴이 아닌 칸은 버리고 중복은 한 번만 둔다. */
export function parseHostList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,]+/)) {
    const e = normalizeHostEntry(part);
    if (e !== null && !out.includes(e)) out.push(e);
  }
  return out;
}

/**
 * 호스트가 목록에 있는가. 정확 일치, 또는 `*.도메인` 이 그 도메인의 하위 호스트와 맞는다(도메인 자체는 아니다).
 * 대소문자·끝 점은 보지 않는다. 꼬리 비교는 `.` 경계로만 한다 — `image.lemoncloud.io.attacker.com` 은 `image.lemoncloud.io` 가 아니다.
 */
export function isAllowedHost(hostname: string, list: readonly string[]): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (h === '') return false;
  return list.some((raw) => {
    const e = normalizeHostEntry(raw);
    if (e === null) return false;
    return e.startsWith('*.') ? h.endsWith(e.slice(1)) && h.length > e.length - 1 : h === e;
  });
}

/** `https://` 원격 이미지의 정규 주소와 호스트. 그 밖(`http:`·`//host`·사용자 정보 `a@b`·못 읽는 주소)은 null 이다. */
export function httpsImage(src: string): { href: string; host: string } | null {
  const raw = src.trim();
  if (!/^https:\/\//i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname === '' || u.username !== '' || u.password !== '') return null;
  return { href: u.href, host: u.hostname };
}
