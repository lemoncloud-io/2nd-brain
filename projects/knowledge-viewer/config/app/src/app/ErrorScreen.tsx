import { useEffect, useRef, useState } from 'react';
import { ERROR_LABELS, errorDetails, type ViewerError } from './errors.ts';

export function ErrorScreen({ error, onRetry }: { error: ViewerError; onRetry?: () => void }) {
  const [copied, setCopied] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [error]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(errorDetails(error));
      setCopied('오류 내용을 복사했습니다.');
    } catch {
      setCopied('복사하지 못했습니다. 아래 오류 내용을 선택해 복사해 주세요.');
    }
  };
  return (
    <section className="viewer-error" role="alert" aria-label="뷰어 오류">
      <p className="viewer-error-kind">{ERROR_LABELS[error.kind]}</p>
      <h1 ref={heading} tabIndex={-1}>뷰어에서 오류가 발생했습니다</h1>
      <p className="viewer-error-message">{error.message}</p>
      <dl className="viewer-error-meta">
        <dt>화면 주소</dt><dd>{error.location}</dd>
        <dt>발생 시각</dt><dd><time dateTime={error.time}>{new Date(error.time).toLocaleString('ko-KR', { timeZoneName: 'short' })}</time></dd>
      </dl>
      <div className="viewer-error-actions">
        {onRetry && <button type="button" onClick={onRetry}>다시 시도</button>}
        <button type="button" onClick={() => window.location.reload()}>새로고침</button>
        <a href="/">볼트 홈</a>
        <button type="button" onClick={copy}>오류 내용 복사</button>
      </div>
      {copied && <p role="status">{copied}</p>}
      <details className="viewer-error-details">
        <summary>오류 상세 · 스택 확인</summary>
        <pre>{errorDetails(error)}</pre>
      </details>
    </section>
  );
}
