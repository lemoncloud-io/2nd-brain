// 가운데 열의 텍스트 파일 보기(md·html 이 아닌 파일). 데이터는 /api/file — 서버가 JSON 문자열로만 준다.
// 읽기 전용: 파일 이름 머리, 줄 번호, 고정폭, 가로 스크롤(긴 줄을 접지 않는다). 문법 강조는 없다 — 의존성에 하이라이터가 없다.
// pr 소스면 바뀐 줄을 hunk 덩어리로 칠한다. 덩어리는 리더와 같은 표식(.doc 안의 .changed·data-changed·data-removed)이라
// PR 상세의 이전·다음 변경(CHANGED_IN_DOC)이 그대로 센다.
import { useEffect, useMemo, useState } from 'react';

import { sourceKey, type Source } from '../../shared/source.ts';
import { getFile } from '../app/api.ts';
import type { DocChange } from '../app/types.ts';
import { formatSize, lineOfAnchor, segmentsOf, splitLines, type FileLine, type FileResponse } from './file-lines.ts';
import { frameOrigin, rawHref } from './frame.ts';
import { CopyPathButton } from './MetaPanel.tsx';

type BodyProps = {
  file: FileResponse;
  agent: boolean;
  /** 원본(/raw) 주소. 바이너리·잘림 안내의 링크다. */
  rawUrl: string;
  /** 앵커 `#L12` 의 줄. 그 줄을 강조한다. */
  targetLine?: number | null;
};

function Line({ line, target }: { line: FileLine; target: number | null }) {
  return (
    <span className={line.n === target ? 'file-line file-line-target' : 'file-line'} id={`L${line.n}`}>
      {/* 번호는 ::before 로 그린다 — 본문을 고를 때 번호가 따라오지 않게. */}
      <span className="file-ln" data-ln={line.n} aria-hidden="true" />
      <span className="file-text">{line.text}</span>
    </span>
  );
}

/** 응답 하나를 그린다(요청 없음). SSR 시험이 이것을 그린다. */
export function FileBody({ file, agent, rawUrl, targetLine = null }: BodyProps) {
  const lines = useMemo(() => splitLines(file.text), [file.text]);
  const segments = useMemo(() => segmentsOf(lines, file.change), [lines, file.change]);
  const name = file.path.split('/').pop() ?? file.path;

  if (agent) {
    // 에이전트 모드: 스타일 없는 텍스트. 바뀐 줄 덩어리는 data-changed 로만 표시한다.
    if (file.binary) {
      return (
        <p data-vault-path={file.path} data-binary="1">
          바이너리 파일 — <a href={rawUrl}>원본 받기</a>
        </p>
      );
    }
    return (
      <pre data-vault-path={file.path} data-size={file.size} data-truncated={file.truncated ? '1' : undefined}>
        {segments.map((s, i) =>
          s.kind === 'line' ? (
            `${s.line.text}\n`
          ) : s.kind === 'hunk' ? (
            <span key={i} data-changed="1" data-lines={`${s.start}-${s.end}`}>
              {s.lines.map((l) => `${l.text}\n`).join('')}
            </span>
          ) : (
            <span key={i} data-removed={s.count} data-after={s.afterLine} />
          ),
        )}
      </pre>
    );
  }

  const status = file.change?.status ?? null;
  return (
    <section className="doc file-view" data-vault-path={file.path}>
      <header className="file-view-head">
        <h1 className="file-view-name">{name}</h1>
        <span className="file-view-meta">
          {file.binary ? '바이너리' : `${lines.length}줄`} · {formatSize(file.size)}
        </span>
        <a className="file-view-raw" href={rawUrl} target="_blank" rel="noreferrer">
          원본
        </a>
        <CopyPathButton path={file.path} />
      </header>
      <p className="file-view-path">{file.path}</p>
      {file.changeError !== undefined ? <p className="notice">이 파일의 변경을 못 읽었다: {file.changeError}</p> : null}
      {status !== null && file.change !== undefined ? (
        <p className="doc-change-summary">
          이 PR: {status} · 추가 {file.change.added}줄 · 삭제 {file.change.deleted}줄
        </p>
      ) : null}
      {file.binary ? (
        <p className="notice file-view-binary">
          바이너리 파일 —{' '}
          <a href={rawUrl} target="_blank" rel="noreferrer">
            원본 받기
          </a>
        </p>
      ) : (
        <>
          {file.truncated ? (
            <p className="notice">
              앞 {formatSize(new TextEncoder().encode(file.text).length)}만 보인다(전체 {formatSize(file.size)}) —{' '}
              <a href={rawUrl} target="_blank" rel="noreferrer">
                원본 받기
              </a>
            </p>
          ) : null}
          {lines.length === 0 ? (
            <p className="notice">빈 파일이다.</p>
          ) : (
            <pre className="file-code" style={{ ['--ln-ch' as string]: String(String(lines.length).length) }}>
              <code>
                {segments.map((s) =>
                  s.kind === 'line' ? (
                    <Line key={s.line.n} line={s.line} target={targetLine} />
                  ) : s.kind === 'hunk' ? (
                    <span key={`h${s.start}`} className="file-hunk changed" data-lines={`${s.start}-${s.end}`}>
                      {s.lines.map((l) => (
                        <Line key={l.n} line={l} target={targetLine} />
                      ))}
                    </span>
                  ) : (
                    <span key={`r${s.afterLine}`} className="file-removed" data-removed={s.count} />
                  ),
                )}
              </code>
            </pre>
          )}
        </>
      )}
    </section>
  );
}

type Props = {
  path: string;
  src: Source;
  agent: boolean;
  /** 주소의 앵커. `L12` 면 그 줄로 옮긴다. */
  anchor: string;
  /** /api/info 의 git 소스 출처 포트. 모르면 주 포트 + 1. */
  gitRawPort?: number | null;
  /** 받은 파일의 변경(pr 소스). PR 상세 패널이 쓴다. */
  onChange?: (change: DocChange | null) => void;
};

export function FileView({ path, src, agent, anchor, gitRawPort, onChange }: Props) {
  // 받은 것은 요청 키(소스·경로)와 함께 둔다 — 주소가 바뀐 뒤 새 응답이 오기 전에 옛 파일을 그리지 않게.
  const key = `${sourceKey(src)}\0${path}`;
  const [got, setGot] = useState<{ key: string; file: FileResponse | null; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    getFile(path, src).then(
      (f) => {
        if (!live) return;
        setGot({ key, file: f, error: null });
        onChange?.(f.change ?? null);
      },
      (e: unknown) => live && setGot({ key, file: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // onChange 는 부모가 렌더마다 새로 만든다 — 다시 받지 않게 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const file = got !== null && got.key === key ? got.file : null;
  const error = got !== null && got.key === key ? got.error : null;

  // `#L12`: 그린 뒤 그 줄을 가운데로. 줄은 받은 뒤에 생기므로 :target 이 아니라 클래스로 강조한다.
  useEffect(() => {
    const n = lineOfAnchor(anchor);
    if (file === null || n === null) return;
    document.getElementById(`L${n}`)?.scrollIntoView({ block: 'center' });
  }, [file, anchor]);

  if (error !== null) return <p className="notice">{error}</p>;
  if (file === null) return <p className="notice">불러오는 중…</p>;
  const rawUrl = rawHref(frameOrigin(location.hostname, location.port, src, gitRawPort), path, '', src);
  return <FileBody file={file} agent={agent} rawUrl={rawUrl} targetLine={lineOfAnchor(anchor)} />;
}
