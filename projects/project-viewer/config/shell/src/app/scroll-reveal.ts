// 스크롤바는 평소엔 감추고, 그 요소가 스크롤되는 동안만 보인다. 두 칸이 각자 스크롤되는 화면에서
// 막대가 늘 떠 있으면 어수선하다(오너 요청). 표시는 base.css 의 `[data-scrolling]` 규칙이 맡는다.

/** 스크롤이 멈춘 뒤 막대를 감추기까지의 시간(ms). */
export const SCROLL_HIDE_MS = 900;

/** 스크롤 이벤트의 대상 → 표시를 달 요소. 문서 스크롤이면 <html>. */
export function scrollHost(target: EventTarget | null, doc: Document): Element | null {
  if (target === doc || target === doc.documentElement || target === doc.body) return doc.documentElement;
  return typeof Element !== 'undefined' && target instanceof Element ? target : null;
}

/** 문서 전체의 스크롤을 잡아(capture — scroll 은 거품이 없다) 요소마다 표시를 켜고 멈추면 끈다. 해제 함수를 돌려준다. */
export function installScrollReveal(doc: Document = document, delay = SCROLL_HIDE_MS): () => void {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const onScroll = (e: Event): void => {
    const el = scrollHost(e.target, doc);
    if (el === null) return;
    el.setAttribute('data-scrolling', '');
    const prev = timers.get(el);
    if (prev !== undefined) clearTimeout(prev);
    timers.set(
      el,
      setTimeout(() => {
        el.removeAttribute('data-scrolling');
        timers.delete(el);
      }, delay),
    );
  };
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    doc.removeEventListener('scroll', onScroll, { capture: true });
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}
