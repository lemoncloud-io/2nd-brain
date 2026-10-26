// PR 상세 패널: pr 소스일 때 그 PR 의 번호·제목·작성자·브랜치·머리와 바뀐 파일 목록, 지금 문서의 변경 이동 단추.
// 데이터는 App 이 받은 변경 목록(/api/pr/<n>/changes)과 문서의 change 다. 이 패널은 따로 요청하지 않는다.
import { useEffect, useRef, useState } from 'react';

import { isPlainClick } from '../app/links.ts';
import { hrefFor } from '../app/route.ts';
import { prHeadLag } from '../app/source-ui.ts';
import type { ChangedFile, DocChange, PrChanges, Source } from '../app/types.ts';
import { CHANGED_IN_DOC } from '../reader/changed-dom.ts';
import { formatUpdated } from './pr-format.ts';
import { nextChangedIndex } from './pr-detail.ts';

/** 바로 앞에 옮겨 간 자리에서 이만큼 안이면 "그 자리에 있다"로 본다(px). */
const SAME_SPOT = 2;

export type PrDetailPanelProps = {
  changes: PrChanges | null;
  change: DocChange | null;
  /** 변경 목록 요청이 실패한 까닭(화면 쪽). */
  changesError: string | null;
  /** 문서 응답의 changeError(서버가 변경 목록을 못 뜸). */
  changeError: string | null;
  path: string;
  agent: boolean;
  src: Source;
  navigate: (path: string, anchor?: string, src?: Source) => void;
};

export function PrDetailPanel({ changes, change, changesError, changeError, path, agent, src, navigate }: PrDetailPanelProps) {
  if (changes === null) return <p className="panel-empty">{changesError !== null ? '변경 목록을 못 읽었다' : '불러오는 중…'}</p>;
  const inList = change !== null && change.status !== null;
  const lag = prHeadLag(changes);
  return (
    <div className="pr-detail">
      <p className="pr-detail-title">
        <a className="pr-detail-num" href={changes.url} target="_blank" rel="noreferrer" title="GitHub 에서 열기">
          #{changes.number}
        </a>{' '}
        <span>{changes.title}</span>
      </p>
      <p className="pr-detail-line">
        {changes.author} · <span className="pr-detail-ref">{changes.head}</span> → <span className="pr-detail-ref">{changes.base}</span>
      </p>
      <p className="pr-detail-line">
        머리 <code>{changes.headCommit.slice(0, 8)}</code>
        {lag === null ? null : (
          <>
            {' '}
            <span className="pr-head-lag" title={lag.title}>
              {lag.text}
            </span>
          </>
        )}{' '}
        · 갱신 {formatUpdated(changes.updatedAt, Date.now())}
      </p>
      <p className="pr-detail-note">역링크·검색은 로컬 기준</p>
      {changeError !== null ? (
        <p className="pr-detail-note pr-detail-error" title={changeError}>
          이 문서의 변경을 못 읽었다: {changeError}
        </p>
      ) : inList ? (
        <ChangeNav change={change} path={path} />
      ) : null}
      <h4 className="pr-detail-files-head">바뀐 파일 {changes.files.length}</h4>
      <ul className="pr-detail-files">
        {changes.files.map((f) => (
          <FileRow key={`${f.status}:${f.path}`} file={f} current={f.path === path} agent={agent} src={src} navigate={navigate} />
        ))}
      </ul>
    </div>
  );
}

function FileRow({ file, current, agent, src, navigate }: { file: ChangedFile; current: boolean; agent: boolean; src: Source; navigate: PrDetailPanelProps['navigate'] }) {
  const label = file.status === 'R' && file.from !== undefined ? `${file.from} → ${file.path}` : file.path;
  let body;
  if (file.status === 'D') {
    body = <span className="pr-file-deleted">{label}</span>;
  } else {
    // md 는 리더, 그 밖은 가운데 열의 텍스트 파일 보기(html 은 iframe)로 연다 — 같은 앱 안 링크다.
    body = (
      <a
        href={hrefFor(file.path, undefined, agent, src)}
        data-vault-path={file.path}
        onClick={(e) => {
          if (!isPlainClick(e)) return;
          e.preventDefault();
          navigate(file.path, undefined, src);
        }}
      >
        {label}
      </a>
    );
  }
  return (
    <li className={current ? 'pr-file pr-file-current' : 'pr-file'} aria-current={current ? 'true' : undefined}>
      <span className={`pr-file-status pr-file-status-${file.status}`}>{file.status}</span>
      {body}
    </li>
  );
}

/** 스크롤 열(.col-center) 안에서 요소 가운데의 위치. */
const centerIn = (el: Element, box: Element): number => {
  const r = el.getBoundingClientRect();
  return r.top + r.height / 2 - box.getBoundingClientRect().top + box.scrollTop;
};

function ChangeNav({ change, path }: { change: DocChange; path: string }) {
  const [count, setCount] = useState(0);
  // 바로 앞에 옮겨 간 블록. 스크롤이 그대로면 그 다음·이전으로 간다(맨 위·맨 아래 블록은 가운데로 못 오기 때문).
  const last = useRef<{ idx: number; scrollTop: number; count: number } | null>(null);

  // 리더가 같은 렌더에서 블록을 그린 뒤 센다.
  useEffect(() => {
    last.current = null;
    setCount(document.querySelectorAll(CHANGED_IN_DOC).length);
  }, [change, path]);

  const go = (dir: 1 | -1) => {
    const els = Array.from(document.querySelectorAll(CHANGED_IN_DOC));
    if (els.length === 0) return;
    const box = els[0]!.closest('.col-center') ?? document.scrollingElement ?? document.documentElement;
    const prev = last.current;
    let idx: number;
    if (prev !== null && prev.count === els.length && Math.abs(box.scrollTop - prev.scrollTop) <= SAME_SPOT) {
      idx = (prev.idx + dir + els.length) % els.length;
    } else {
      const positions = els.map((el) => centerIn(el, box));
      // 맨 위에서 "다음"은 첫 블록부터.
      const current = dir === 1 && box.scrollTop <= SAME_SPOT ? -Infinity : box.scrollTop + box.clientHeight / 2;
      idx = nextChangedIndex(positions, current + (dir === 1 ? SAME_SPOT : -SAME_SPOT), dir);
    }
    const target = els[idx];
    if (target === undefined) return;
    target.scrollIntoView({ block: 'center' });
    last.current = { idx, scrollTop: box.scrollTop, count: els.length };
  };

  return (
    <div className="pr-detail-change">
      <span>
        추가 {change.added}줄 · 삭제 {change.deleted}줄 · 블록 {count}개
      </span>
      <span className="pr-detail-nav">
        <button type="button" className="pr-detail-btn" disabled={count === 0} onClick={() => go(-1)}>
          이전 변경
        </button>
        <button type="button" className="pr-detail-btn" disabled={count === 0} onClick={() => go(1)}>
          다음 변경
        </button>
      </span>
    </div>
  );
}
