// 확장 화면의 지연 청크가 쓰는 호스트 면. 확장은 코어 내부 파일 대신 이 파일에서 받는다.
// 이 파일은 등록부(route.ts 경유)를 부르므로 확장 ui.ts 가 정적으로 부르면 안 된다 — load() 안의 청크에서만 쓴다.
export { sourceKey } from '../../shared/source.ts';
export { hrefFor } from '../app/route.ts';
export { isPlainClick } from '../app/links.ts';
export { ChangedEventsContext } from '../app/events.ts';
export { ArchifyFrame } from '../archify/ArchifyFrame.tsx';
export { useArchifyZoom } from '../archify/archify-zoom.ts';
export type { CenterViewProps, FramePorts, NavigateFn, Source } from './define.ts';
