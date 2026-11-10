// project-viewer 셸 화면 코드가 데이터를 받는 가상 모듈. 이 앱(통합 보기)에서는 Vite 플러그인이 셸 어댑터(src/embed/bundle.ts)로
// 바꿔 끼운다. 타입 검사만을 위한 선언이다 — 셸 쪽(src/bundle.ts)이 Bundle 로 좁힌다.
declare module 'virtual:viewer-bundle' {
  const bundle: unknown;
  export default bundle;
}
