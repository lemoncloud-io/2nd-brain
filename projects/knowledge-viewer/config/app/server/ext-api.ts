// 확장 서버 코드가 쓰는 면. 확장은 이 파일에서만 코어 서버 기능을 받는다 — 코어 내부 파일·패키지를 직접 부르지 않게.
// zod 도 여기서 다시 내보낸다(확장 폴더에는 node_modules 가 없다).
export { z } from 'zod';
export { segmentsBlocked } from '../shared/scope.ts';
export type { Source } from '../shared/source.ts';
export type { SourceReader } from './source.ts';
export type { ApiResult } from './handlers.ts';
export type { ExtApiContext, ExtApiRoute } from './ext.ts';
