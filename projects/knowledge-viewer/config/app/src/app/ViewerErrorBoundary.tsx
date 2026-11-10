import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './ErrorScreen.tsx';
import { clearViewerError, createViewerError, getViewerError, noViewerError, subscribeViewerError, type ViewerError } from './errors.ts';

type Props = { children: ReactNode; resetKey?: string; root?: boolean };
type State = { error: ViewerError | null; key: string | undefined };

/** 본문 오류는 중앙에서 처리하고, 탐색 화면 자체의 실패는 root 경계가 받는다. */
export class ViewerErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }
  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: createViewerError(error, 'render') };
  }
  componentDidCatch(_error: unknown, info: ErrorInfo): void {
    this.setState(({ error }) => error === null ? null : { error: { ...error, componentStack: (info.componentStack ?? '').slice(0, 20_000) } });
  }
  retry = (): void => {
    clearViewerError();
    this.setState({ error: null });
  };
  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const screen = <ErrorScreen error={this.state.error} onRetry={this.retry} />;
    return this.props.root ? <main className="viewer-fatal">{screen}</main> : screen;
  }
}

/** window.error / unhandledrejection도 콘솔 대신 중앙 영역에서 읽을 수 있게 한다. */
export function RuntimeErrorGate({ children }: { children: ReactNode }) {
  const error = useSyncExternalStore(subscribeViewerError, getViewerError, noViewerError);
  return error === null ? children : <ErrorScreen error={error} onRetry={clearViewerError} />;
}
