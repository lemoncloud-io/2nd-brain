// 화면 확장 가상 모듈의 타입. 빌드는 extVirtual 플러그인이, 시험은 tests/helpers/ext-hooks.ts 가 실제 파일로 푼다.
// 타입 검사는 이 계약만 본다 — 유닛 검사가 확장 구현을 따라가지 않는다.
declare module 'virtual:knowledge-viewer-ext/ui' {
  const ext: import('./define.ts').ViewerUiExtension;
  export default ext;
}
