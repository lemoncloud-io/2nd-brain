// 처리되지 않은 오류는 현재 탭 메모리에만 둔다. 콘솔의 기본 오류 기록은 그대로 유지한다.
export type ViewerErrorKind = 'render' | 'runtime' | 'promise' | 'startup';
export type ViewerError = {
  kind: ViewerErrorKind;
  message: string;
  stack: string;
  componentStack: string;
  location: string;
  time: string;
};

export const ERROR_LABELS: Record<ViewerErrorKind, string> = {
  render: '화면 렌더링 오류',
  runtime: '스크립트 실행 오류',
  promise: '비동기 처리 오류',
  startup: '뷰어 시작 오류',
};

const LIMIT = 20_000;
const bounded = (text: string): string => text.length <= LIMIT ? text : text.slice(0, LIMIT) + '\n… (이하 생략)';

/** 오류 처리기 자체가 던지지 않도록 임의의 rejection 값과 잘못된 toString도 받는다. */
export function describeError(value: unknown): { message: string; stack: string } {
  try {
    if (value !== null && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
      const name = 'name' in value && typeof value.name === 'string' ? value.name : '';
      const stack = 'stack' in value && typeof value.stack === 'string' ? value.stack : '';
      return { message: bounded((name ? name + ': ' : '') + (value.message || '오류 메시지가 없습니다.')), stack: bounded(stack) };
    }
    if (typeof value === 'string') return { message: bounded(value || '오류 메시지가 없습니다.'), stack: '' };
    if (value === undefined || value === null) return { message: '오류 이유가 제공되지 않았습니다.', stack: '' };
    let text: string | undefined;
    try { text = JSON.stringify(value); } catch { /* 순환 객체는 String으로 시도한다. */ }
    return { message: bounded(text ?? String(value)), stack: '' };
  } catch {
    return { message: '오류 정보를 문자열로 변환할 수 없습니다.', stack: '' };
  }
}

export function createViewerError(value: unknown, kind: ViewerErrorKind): ViewerError {
  return {
    ...describeError(value), kind, componentStack: '', time: new Date().toISOString(),
    location: typeof window === 'undefined' ? '' : window.location.pathname + window.location.search + window.location.hash,
  };
}

export function errorDetails(error: ViewerError): string {
  return [ERROR_LABELS[error.kind], error.message, `발생 시각 (UTC): ${error.time}`, `화면 주소: ${error.location}`,
    error.stack, error.componentStack].filter(Boolean).join('\n\n');
}

let current: ViewerError | null = null;
const listeners = new Set<() => void>();
export const getViewerError = (): ViewerError | null => current;
export const noViewerError = (): null => null;
export function subscribeViewerError(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function reportViewerError(value: unknown, kind: ViewerErrorKind): void {
  if (current !== null) return; // 연쇄 오류가 첫 원인을 덮지 않게 한다.
  current = createViewerError(value, kind);
  listeners.forEach((listener) => listener());
}
export function clearViewerError(): void {
  if (current === null) return;
  current = null;
  listeners.forEach((listener) => listener());
}

/** cleanup을 반환해 개발 재로딩과 테스트에서 중복 구독을 남기지 않는다. preventDefault는 하지 않는다. */
export function installGlobalErrorHandlers(target: EventTarget): () => void {
  const onError = (event: Event): void => {
    const e = event as ErrorEvent;
    // 이미지 등 리소스 로드 실패는 각 컴포넌트가 처리한다.
    if (e.error == null && !e.message) return;
    const error = e.error ?? { message: e.message, stack: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '' };
    reportViewerError(error, 'runtime');
  };
  const onRejection = (event: Event): void => reportViewerError((event as PromiseRejectionEvent).reason, 'promise');
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
