// archify iframe 높이 맞춤·그림 배율 연결. iframe 은 다른 출처(localhost)라 안을 재지 못한다 —
// 서버가 넣은 스크립트(server/archify-fit.ts)가 높이를 알리고, 여기서는 배율을 보낸다. 메시지는 출처·보낸 창·꼴을 모두 검사한다.
import { useEffect, useRef, useState, type RefObject } from 'react';

import { fitFrameHeight, fitSettingsMessage, parseFitMessage, type ArchifyZoom, type FitMessage } from '../../shared/archify-fit.ts';
import { frameIsOpaque } from '../reader/frame.ts';

/** 메시지 이벤트 중 검사에 쓰는 부분. 시험이 가짜를 넣는다. */
export type FitEventLike = { source: unknown; origin: string; data: unknown };

/**
 * 받은 메시지를 믿을지: 보낸 창이 이 iframe 이고, 출처가 iframe 주소의 출처와 같고, 꼴이 맞아야 한다. 아니면 null.
 * 창이 아직 없으면(null) 아무것도 받지 않는다.
 */
export function acceptFitMessage(event: FitEventLike, frameWindow: unknown, expectedOrigin: string): FitMessage | null {
  if (frameWindow === null || frameWindow === undefined || event.source !== frameWindow) return null;
  if (expectedOrigin === '' || event.origin !== expectedOrigin) return null;
  return parseFitMessage(event.data);
}

/** iframe 주소의 출처. 상대 주소는 지금 문서 기준이다. 못 읽으면 빈 문자열(아무 메시지도 받지 않는다). */
export function frameMessageOrigin(src: string, base: string): string {
  try {
    return new URL(src, base).origin;
  } catch {
    return '';
  }
}

/** 받기 검사에 쓸 출처(expected)와 보낼 때의 targetOrigin(target). */
export type FitChannel = { expected: string; target: string };

/**
 * 맞춤 메시지의 출처 짝. 보통은 둘 다 iframe 주소의 출처다.
 * 불투명 출처(개인 이름 뒤 — 서버가 CSP sandbox 로 낸 문서)면 안쪽이 보내는 출처는 `'null'` 이고,
 * 그 창에는 출처 이름으로 보낼 수 없어 `'*'` 로 보낸다(싣는 것은 배율뿐). 받기는 여전히 보낸 창(=이 iframe)을 검사한다.
 */
export function fitChannel(src: string, base: string, opaque: boolean): FitChannel {
  // 불투명 출처: 'null' 로 받고 '*' 로 보낸다.
  if (opaque) return { expected: 'null', target: '*' };
  // 보통: iframe 주소의 출처로 받고 보낸다.
  const origin = frameMessageOrigin(src, base);
  return { expected: origin, target: origin };
}

/**
 * iframe(ref)에 맞춤을 잇는다. src 는 `kv-fit=1` 이 붙은 주소(없으면 null — 잇지 않는다).
 * 돌려주는 값은 안쪽이 알린 높이(px, 최소·최대로 묶음)이고, 아직 모르면 null 이다 — 그동안은 CSS 기본 높이다.
 * 주소가 바뀌어도(테마 등) 마지막 높이는 둔다 — 다시 열릴 때 틀이 출렁이지 않게.
 */
export function useArchifyFit(frame: RefObject<HTMLIFrameElement | null>, src: string | null, zoom: ArchifyZoom): number | null {
  const [height, setHeight] = useState<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // 지금 배율을 iframe 에 보내는 함수. 안쪽이 먼저 말을 건 뒤에만 보낸다 — 아직 about:blank 이거나
  // 다른 출처로 옮겨 갔으면 postMessage 가 콘솔 오류를 남기기 때문이다.
  const sendRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (src === null) return;
    // 개인 이름 뒤면 틀 문서가 불투명 출처다 — 출처 짝을 그에 맞춘다.
    const { expected, target } = fitChannel(src, location.href, frameIsOpaque(location.hostname));
    let linked = false;
    const send = (): void => {
      const w = frame.current?.contentWindow;
      if (linked && w) w.postMessage(fitSettingsMessage(zoomRef.current), target);
    };
    sendRef.current = send;
    // 안쪽이 섰다고 하면 설정으로 답하고, 높이를 알리면 틀 높이로 쓴다.
    const onMessage = (e: MessageEvent): void => {
      const msg = acceptFitMessage(e, frame.current?.contentWindow ?? null, expected);
      if (msg === null) return;
      linked = true;
      if (msg.type === 'ready') send();
      else {
        const h = fitFrameHeight(msg.height);
        if (h !== null) setHeight(h);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      sendRef.current = () => {};
    };
  }, [frame, src]);
  // 배율이 바뀌면 다시 열지 않고 메시지로 보낸다.
  useEffect(() => {
    sendRef.current();
  }, [zoom]);
  return src === null ? null : height;
}
