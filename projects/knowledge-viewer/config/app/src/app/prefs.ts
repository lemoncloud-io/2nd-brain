// 보는 사람마다 다른 화면 설정 — 묶음 파일. **여기에 함수를 쓰지 않는다.**
// 설정은 기능별 파일(prefs/layout.ts·search.ts·graph.ts …)에 두고 여기서는 다시 내보내기만 한다.
// 까닭: 같은 날 여러 PR 이 이 파일 끝에 함수를 덧붙이면 같은 자리에서 충돌한다(2026-10-23 #939·#940).
// 새 기능의 설정은 prefs/<기능>.ts 를 만들고 아래에 한 줄을 더한다. tests/ui/prefs-barrel.test.ts 가 지킨다.
export * from './prefs/layout.ts';
export * from './prefs/search.ts';
export * from './prefs/graph.ts';
export * from './prefs/theme.ts';
export * from './prefs/shortcuts.ts';
export * from './prefs/images.ts';
