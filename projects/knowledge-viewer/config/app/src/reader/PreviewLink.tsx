import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { sourceKey } from '../../shared/source.ts';
import { getPreview } from '../app/api.ts';
import { isPlainClick } from '../app/links.ts';
import type { PreviewResponse, Source } from '../app/types.ts';
import { CARD_MAX_HEIGHT, CARD_MAX_WIDTH, placeCard, type Placement } from './preview-place.ts';

const SHOW_MS = 250;
const HIDE_MS = 180;
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 100;

const cache = new Map<string, { preview: PreviewResponse; at: number }>();
const inflight = new Map<string, Promise<PreviewResponse>>();

// 소스마다 내용이 다르다. 키에 소스를 넣는다.
const keyOf = (path: string, anchor: string | null, src?: Source): string =>
  `${src === undefined ? '' : sourceKey(src)}|${path}#${anchor ?? ''}`;

function cached(key: string): PreviewResponse | null {
  const hit = cache.get(key);
  if (hit === undefined) return null;
  if (Date.now() - hit.at >= TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.preview;
}

function load(path: string, anchor: string | null, src?: Source): Promise<PreviewResponse> {
  const key = keyOf(path, anchor, src);
  const hit = cached(key);
  if (hit !== null) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running !== undefined) return running;
  const req = getPreview(path, anchor ?? '', src)
    .then((preview) => {
      cache.delete(key);
      cache.set(key, { preview, at: Date.now() });
      if (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      return preview;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, req);
  return req;
}

export type PreviewLinkProps = {
  path: string;
  anchor: string | null;
  href: string;
  agent: boolean;
  /** 미리보기를 읽을 소스. 없으면 API 기본(local). */
  src?: Source;
  title?: string;
  onNavigate: (path: string, anchor?: string) => void;
  children: ReactNode;
};

/** 본문 링크. agent 모드는 카드 없는 평범한 링크다(read_page에 카드가 섞이지 않게). */
export function PreviewLink(props: PreviewLinkProps) {
  return props.agent ? <PlainLink {...props} /> : <HoverLink {...props} />;
}

function useClick(props: PreviewLinkProps, before?: () => void) {
  const { path, anchor, onNavigate } = props;
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(e)) return; // 수정키 클릭은 브라우저가 새 탭 등으로 처리한다.
    e.preventDefault();
    before?.();
    onNavigate(path, anchor === null || anchor === '' ? undefined : anchor);
  };
}

function PlainLink(props: PreviewLinkProps) {
  const onClick = useClick(props);
  return (
    <a href={props.href} data-vault-path={props.path} title={props.title} onClick={onClick}>
      {props.children}
    </a>
  );
}

const excerptComponents = {
  a: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  img: () => null,
};

function HoverLink(props: PreviewLinkProps) {
  const { path, anchor, src, href, title, children } = props;
  const anchorEl = useRef<HTMLAnchorElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const openRef = useRef(false);
  const suppressFocus = useRef(false);
  const alive = useRef(true);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState('');
  const [place, setPlace] = useState<Placement>({ left: 12, top: 12, side: 'below' });

  const clearTimers = () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  };
  const hide = () => {
    clearTimers();
    openRef.current = false;
    setOpen(false);
  };
  const reposition = () => {
    const rect = anchorEl.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const measured = cardEl.current?.getBoundingClientRect();
    const size = {
      width: measured?.width ?? Math.min(CARD_MAX_WIDTH, vw - 24),
      height: measured?.height ?? Math.min(CARD_MAX_HEIGHT, vh - 24),
    };
    setPlace(placeCard(rect, { width: vw, height: vh }, size));
  };
  const show = () => {
    if (!alive.current || document.visibilityState !== 'visible') return;
    openRef.current = true;
    setError('');
    setPreview(cached(keyOf(path, anchor, src)));
    reposition();
    setOpen(true);
    load(path, anchor, src).then(
      (data) => {
        if (alive.current && openRef.current) setPreview(data);
      },
      (e: unknown) => {
        if (alive.current && openRef.current) setError(e instanceof Error ? e.message : '미리보기를 읽지 못했다');
      },
    );
  };
  const enter = () => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(showTimer.current);
    if (!openRef.current) showTimer.current = window.setTimeout(show, SHOW_MS);
  };
  const leave = () => {
    window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(hide, HIDE_MS);
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimers();
    };
  }, []);
  // 대상이 바뀌면 닫는다.
  useEffect(() => {
    hide();
    setPreview(null);
    setError('');
  }, [path, anchor, src]);
  // 내용이 차면 실제 크기로 자리를 다시 잡는다.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, preview, error]);
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (cardEl.current?.contains(e.target as Node)) return;
      const r = anchorEl.current?.getBoundingClientRect();
      if (r === undefined || r.bottom < 0 || r.top > window.innerHeight) hide();
      else reposition();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      hide();
      if (document.activeElement !== anchorEl.current) {
        suppressFocus.current = true;
        anchorEl.current?.focus();
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onClick = useClick(props, hide);
  const chips = preview === null ? [] : [preview.type, preview.status].filter((v): v is string => v !== null && v !== '');

  return (
    <>
      <a
        ref={anchorEl}
        href={href}
        data-vault-path={path}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={() => {
          if (suppressFocus.current) suppressFocus.current = false;
          else {
            window.clearTimeout(hideTimer.current);
            show();
          }
        }}
        onBlur={(e) => {
          if (!cardEl.current?.contains(e.relatedTarget as Node | null)) leave();
        }}
        onClick={onClick}
      >
        {children}
      </a>
      {open &&
        createPortal(
          <div
            ref={cardEl}
            id={id}
            className="preview-card"
            role="dialog"
            aria-label="링크 미리보기"
            style={{ left: place.left, top: place.top }}
            onMouseEnter={() => window.clearTimeout(hideTimer.current)}
            onMouseLeave={leave}
            onFocus={() => window.clearTimeout(hideTimer.current)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== anchorEl.current) leave();
            }}
          >
            {preview === null && error === '' && (
              <p className="preview-note" role="status">
                불러오는 중…
              </p>
            )}
            {error !== '' && (
              <p className="preview-note preview-error" role="status">
                {error}
              </p>
            )}
            {preview !== null && (
              <>
                <header className="preview-head">
                  <strong className="preview-title">{preview.title}</strong>
                  {chips.map((c, i) => (
                    <span key={i} className="badge badge-local">
                      {c}
                    </span>
                  ))}
                </header>
                {preview.excerpt !== '' && (
                  <div className="preview-excerpt">
                    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={excerptComponents}>
                      {preview.excerpt}
                    </Markdown>
                  </div>
                )}
                <p className="preview-path">{preview.path}</p>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
