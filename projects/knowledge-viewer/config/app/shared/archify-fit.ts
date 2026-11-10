// archify 틀 맞춤의 약속 — 서버가 archify html 에 넣는 스크립트와 화면(ArchifyView)이 함께 쓴다.
// iframe 은 다른 출처(localhost)라 부모가 안을 재지 못한다. 그래서 안쪽 스크립트가 높이를 알리고,
// 부모는 그림 배율을 보낸다. 옵트인 쿼리(`kv-fit=1`)가 있을 때만 서버가 스크립트를 넣는다.

/** 서버 주입을 켜는 쿼리 이름. 값은 `1` 만 받는다. */
export const ARCHIFY_FIT_PARAM = 'kv-fit';

/** iframe → 부모: 스크립트가 섰다(데이터 없음). 부모는 설정으로 답한다. */
export const FIT_READY = 'kv-archify:ready';
/** iframe → 부모: 내용 높이(px). */
export const FIT_HEIGHT = 'kv-archify:height';
/** 부모 → iframe: 그림 배율(%). */
export const FIT_SETTINGS = 'kv-archify:settings';

/** 그림 배율 단계(%). 100 은 지금 그대로다. */
export const ARCHIFY_ZOOM_STEPS = [100, 115, 130, 150] as const;
export type ArchifyZoom = (typeof ARCHIFY_ZOOM_STEPS)[number];
export const DEFAULT_ARCHIFY_ZOOM: ArchifyZoom = 100;

/**
 * 틀 최소 높이(px). 그림 위 도구줄의 내보내기 메뉴(위 3rem + 최대 100vh-5.5rem)가 잘리지 않고,
 * 짧은 흐름(flow-log 920×700)이 좁은 폭에서도 머리·그림·도구를 한 번에 보이는 높이다.
 */
export const ARCHIFY_FRAME_MIN_HEIGHT = 480;
/** 틀 최대 높이(px). 안쪽이 잘못 자라도 문서가 끝없이 길어지지 않게 막는 상한이다. */
export const ARCHIFY_FRAME_MAX_HEIGHT = 20000;

/** 배율 단계 값인가. */
export function isArchifyZoom(v: unknown): v is ArchifyZoom {
  return typeof v === 'number' && (ARCHIFY_ZOOM_STEPS as readonly number[]).includes(v);
}

/** 쿼리 문자열(`?…` 또는 빈 문자열)이 맞춤 주입을 바라는가. */
export function wantsArchifyFit(search: string): boolean {
  try {
    return new URLSearchParams(search).get(ARCHIFY_FIT_PARAM) === '1';
  } catch {
    return false;
  }
}

/** 알린 높이를 틀 높이로: 올림한 뒤 최소·최대 사이로 묶는다. 수가 아니면 null. */
export function fitFrameHeight(reported: unknown): number | null {
  if (typeof reported !== 'number' || !Number.isFinite(reported)) return null;
  return Math.min(ARCHIFY_FRAME_MAX_HEIGHT, Math.max(ARCHIFY_FRAME_MIN_HEIGHT, Math.ceil(reported)));
}

export type FitMessage = { type: 'ready' } | { type: 'height'; height: number };

/** iframe 이 보낸 메시지의 꼴을 검사한다. 모르는 꼴·잘못된 값은 null. */
export function parseFitMessage(data: unknown): FitMessage | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d['type'] === FIT_READY) return { type: 'ready' };
  if (d['type'] === FIT_HEIGHT) {
    const h = d['height'];
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return null;
    return { type: 'height', height: h };
  }
  return null;
}

/** 부모가 iframe 에 보내는 설정 메시지. */
export function fitSettingsMessage(zoom: ArchifyZoom): { type: typeof FIT_SETTINGS; zoom: ArchifyZoom } {
  return { type: FIT_SETTINGS, zoom };
}

/** 쿼리를 붙인 archify 주소: 기존 쿼리 뒤에 `kv-fit=1` 을 더한다. hash 는 그대로 끝에 둔다. */
export function withFitParam(url: string): string {
  const i = url.indexOf('#');
  const base = i < 0 ? url : url.slice(0, i);
  const hash = i < 0 ? '' : url.slice(i);
  return `${base}${base.includes('?') ? '&' : '?'}${ARCHIFY_FIT_PARAM}=1${hash}`;
}
