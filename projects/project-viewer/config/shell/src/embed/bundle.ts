// 가상 모듈(virtual:viewer-bundle)의 통합 보기 판. 셸 화면 코드는 모듈 최상위에서 데이터를 한 번 받으므로
// (`const bundle = bundleData`), 지금 그리는 Bundle 로 속성 읽기를 넘기는 대리 객체를 준다.
// ProjectViewer 는 Bundle 이 바뀌면 셸 App 을 새로 마운트한다 — 첫 마운트 때 계산해 둔 색인도 새로 만든다.
import type { Bundle } from '../../model/types.ts';
import { embedBundle } from './host.ts';

// 속성 읽기·열거를 지금 Bundle 로 넘긴다. 쓰기는 하지 않는다(셸은 데이터를 고치지 않는다).
const live = new Proxy({} as Bundle, {
  get: (_target, key) => Reflect.get(embedBundle(), key),
  has: (_target, key) => Reflect.has(embedBundle(), key),
  ownKeys: () => Reflect.ownKeys(embedBundle()),
  getOwnPropertyDescriptor: (_target, key) => {
    const desc = Reflect.getOwnPropertyDescriptor(embedBundle(), key);
    // 대리 대상({})에 없는 속성은 설정 가능으로 알려야 한다(Proxy 불변식).
    return desc === undefined ? undefined : { ...desc, configurable: true };
  },
});

export default live;
