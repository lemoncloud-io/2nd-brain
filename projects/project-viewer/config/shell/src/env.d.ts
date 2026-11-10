/// <reference types="vite/client" />

// 앱은 데이터를 이 가상 모듈 하나로만 받는다. 실제 구현은 loader의 Vite 플러그인이 만든다.
declare module 'virtual:viewer-bundle' {
  import type { Bundle } from '../model/types.ts';
  const bundle: Bundle;
  export default bundle;
}
