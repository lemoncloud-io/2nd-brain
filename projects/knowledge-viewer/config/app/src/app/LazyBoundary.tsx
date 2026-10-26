// lazy 로 불러온 화면(지도)의 오류 경계. 청크를 못 받으면(다시 빌드한 뒤 열려 있던 탭 등) React 루트 전체가 내려가지 않고
// 그 자리에 안내만 남긴다. resetKey(주소의 경로·보기·모드)가 바뀌면 오류를 걷고 자식을 다시 그린다.
// key 로 경계를 새로 만들지 않는다 — 그러면 중심을 옮길 때마다 지도(엔진)가 새로 만들어진다. 자식은 그대로 두고 오류만 걷는다.
import { Component } from 'react';
import type { ReactNode } from 'react';

type Props = { children: ReactNode; resetKey: string; fallback: (message: string) => ReactNode };
type State = { message: string | null; key: string };

export class LazyBoundary extends Component<Props, State> {
  state: State = { message: null, key: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.key ? null : { message: null, key: props.resetKey };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    return this.state.message === null ? this.props.children : this.props.fallback(this.state.message);
  }
}
