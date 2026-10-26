import { useCallback, useEffect, useRef, useState } from 'react';

import type { Heading } from '../app/types.ts';
import { activeHeadingIndex } from './toc-active.ts';

/** 목차 클릭 뒤 이 시간 동안은 스크롤 판정으로 활성 항목을 덮지 않는다(클릭한 절이 바닥 근처여도 그 절이 남게). */
const CLICK_PIN_MS = 400;

/**
 * 목차 스크롤 스파이. 가운데 열(.col-center)의 스크롤을 보고 지금 읽는 절의 헤딩 인덱스를 돌려준다.
 *
 * - 헤딩 위치는 문서가 바뀔 때·본문 크기가 바뀔 때(ResizeObserver, 또는 판정 때 scrollHeight 가 달라졌을 때)만 잰다.
 *   스크롤마다 getBoundingClientRect 를 부르지 않는다.
 * - scroll 은 rAF 로 묶어 프레임당 한 번 판정한다(scrollTop·clientHeight·scrollHeight 세 값 + 배열 한 번 훑기).
 * - headings 배열이 바뀌면(문서 전환) 처음부터 다시 잰다.
 * - 목차 패널은 오른쪽 열에 있어 리더 DOM 의 조상이 아니다. 그래서 컨테이너는 document 에서 찾는다.
 */
export function useActiveHeading(headings: readonly Heading[]): { active: number; pin: (index: number) => void } {
  // 처음엔 -1: 헤딩 위치를 잰 뒤(effect)에야 판정한다. SSR·첫 그리기에는 활성 항목이 없다.
  const [active, setActive] = useState(-1);
  const pinUntil = useRef(0);

  const pin = useCallback((index: number) => {
    pinUntil.current = performance.now() + CLICK_PIN_MS;
    setActive(index);
  }, []);

  useEffect(() => {
    setActive(-1);
    if (headings.length === 0 || typeof document === 'undefined') return;
    const scroller = document.querySelector<HTMLElement>('.col-center');
    if (scroller === null) return;

    let tops: number[] = [];
    let measuredHeight = -1;
    const measure = () => {
      measuredHeight = scroller.scrollHeight;
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
      tops = headings.map((h) => {
        const el = document.getElementById(h.slug);
        return el === null || !scroller.contains(el) ? Number.NaN : el.getBoundingClientRect().top - base;
      });
    };
    const judge = () => {
      if (performance.now() < pinUntil.current) return;
      const content = scroller.scrollHeight;
      // 내용 높이가 바뀌었으면(늦게 그려진 그림·mermaid) 다시 잰다. ResizeObserver 와 겹쳐도 높이가 같으면 다시 재지 않는다.
      if (content !== measuredHeight) measure();
      setActive(activeHeadingIndex(tops, { scrollTop: scroller.scrollTop, viewport: scroller.clientHeight, content }));
    };

    let frame = 0;
    const onScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        judge();
      });
    };

    measure();
    judge();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    // 본문 크기가 바뀌면(이미지·mermaid·임베드가 늦게 그려짐, 열 폭 변경) 다시 잰다.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      measure();
      onScroll();
    });
    const article = scroller.querySelector('article.doc');
    if (ro !== null) {
      ro.observe(scroller);
      if (article !== null) ro.observe(article);
    }
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [headings]);

  return { active, pin };
}

/** 사용자가 목차 패널을 직접 스크롤한 뒤 이 시간 동안은 활성 항목을 따라가지 않는다. */
const USER_HOLD_MS = 1000;

/** el 을 감싼 가장 가까운 세로 스크롤 컨테이너(목차 패널이 든 오른쪽 열). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

/**
 * 활성 목차 항목이 패널의 보이는 영역 밖이면 패널만 최소로 스크롤한다(block: 'nearest' 와 같은 셈).
 * scrollIntoView 는 조상 스크롤을 전부 움직이므로 쓰지 않는다 — 가운데 열·페이지는 건드리지 않는다.
 * 사용자가 패널을 휠·터치·스크롤바로 움직인 직후 1초는 따라가지 않는다.
 * 문서가 막 바뀐 렌더(첫 판정)에서는 따라가지 않는다 — 문서를 열 때마다 오른쪽 열이 목차로 튀지 않게.
 */
export function useFollowActive(listRef: { current: HTMLElement | null }, active: number, headings: readonly Heading[]): void {
  const userAt = useRef(0);
  const seen = useRef<readonly Heading[] | null>(null);
  const hasList = headings.length > 0;

  useEffect(() => {
    const list = listRef.current;
    const p = list === null ? null : scrollParent(list);
    if (p === null) return;
    const mark = () => {
      userAt.current = performance.now();
    };
    p.addEventListener('wheel', mark, { passive: true });
    p.addEventListener('touchmove', mark, { passive: true });
    p.addEventListener('pointerdown', mark, { passive: true });
    return () => {
      p.removeEventListener('wheel', mark);
      p.removeEventListener('touchmove', mark);
      p.removeEventListener('pointerdown', mark);
    };
  }, [listRef, hasList]);

  useEffect(() => {
    if (seen.current !== headings) {
      seen.current = headings;
      return;
    }
    const list = listRef.current;
    const item = active < 0 || list === null ? undefined : (list.children[active] as HTMLElement | undefined);
    const p = list === null ? null : scrollParent(list);
    if (p === null || item === undefined) return;
    if (performance.now() - userAt.current < USER_HOLD_MS) return;
    const box = p.getBoundingClientRect();
    if (box.height === 0) return;
    const r = item.getBoundingClientRect();
    if (r.top < box.top) p.scrollTop -= box.top - r.top;
    else if (r.bottom > box.bottom) p.scrollTop += Math.min(r.bottom - box.bottom, r.top - box.top);
  }, [active, headings, listRef]);
}
