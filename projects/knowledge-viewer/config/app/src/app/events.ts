// 파일 감시(SSE) 구독. App 이 EventSource 하나를 열고, 지도처럼 따로 불러오는 화면이 여기에 귀를 붙인다.
// App ↔ GraphView 가 서로를 불러오지 않게 따로 둔다(GraphView 는 lazy 청크다).
import { createContext } from 'react';

export type ChangedEvents = { subscribe(cb: (path: string) => void): () => void };

export const ChangedEventsContext = createContext<ChangedEvents>({ subscribe: () => () => {} });
