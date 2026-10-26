import type { ReactNode } from 'react';

import { isPlainClick } from './links.ts';
import { hrefFor } from './route.ts';
import { changedUnder, type ChangedMap } from './changed.ts';
import { Delta } from './Tree.tsx';
import type { Source, TreeEntry } from './types.ts';
import { frameOrigin, rawHref } from '../reader/frame.ts';

type Props = {
  dir: string;
  entries: TreeEntry[];
  agent: boolean;
  src: Source;
  onNavigate: (path: string) => void;
  /** PR 소스일 때 그 PR 이 바꾼 파일(볼트 경로 → A·M·D·R). */
  changed?: ChangedMap;
  /** /api/info 의 git 소스 출처 포트. 모르면 주 포트 + 1. */
  gitRawPort?: number | null;
};

/** README 가 없는 폴더의 기본 화면 — 안에 있는 폴더·문서 목록. */
export function FolderView({ dir, entries, agent, src, onNavigate, changed, gitRawPort }: Props) {
  const dirs = entries.filter((e) => e.kind === 'dir');
  const files = entries.filter((e) => e.kind !== 'dir');
  const link = (target: string, label: string, badge?: string, mark?: ReactNode, deleted = false) => (
    <a
      className="folder-row"
      href={hrefFor(target, undefined, agent, src)}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        onNavigate(target);
      }}
    >
      <span className={deleted ? 'folder-row-label tree-deleted' : 'folder-row-label'}>{label}</span>
      {mark}
      {badge ? <span className="badge badge-local">{badge}</span> : null}
    </a>
  );
  const origin = typeof location === 'undefined' ? '' : frameOrigin(location.hostname, location.port, src, gitRawPort);
  return (
    <section className="folder-view" data-vault-path={`${dir}/`}>
      <h1 className="folder-title">{dir === '' ? '/' : dir.split('/').pop()}</h1>
      <p className="notice">README.md 가 없는 폴더다. 안에 있는 항목이다.</p>
      {dirs.length > 0 ? (
        <ul className="folder-list" aria-label="폴더">
          {dirs.map((e) => (
            <li key={e.path}>
              {link(
                `${e.path}/`,
                `${e.name}/`,
                undefined,
                changedUnder(changed, e.path) ? <span className="tree-dot" title="이 PR 이 바꾼 문서가 있다" /> : null,
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul className="folder-list" aria-label="문서">
          {files.map((e) => (
            <li key={e.path}>
              {e.kind === 'md' || e.kind === 'html'
                ? link(
                    e.path,
                    e.title ?? e.name,
                    e.ignored ? 'local' : e.kind === 'html' ? 'html' : undefined,
                    <Delta status={changed?.get(e.path)} />,
                    changed?.get(e.path) === 'D',
                  )
                : (
                  <a className="folder-row" href={rawHref(origin, e.path, '', src)} target="_blank" rel="noreferrer">
                    <span className={changed?.get(e.path) === 'D' ? 'folder-row-label tree-deleted' : 'folder-row-label'}>{e.name}</span>
                    <Delta status={changed?.get(e.path)} />
                    <span className="badge badge-local">file</span>
                  </a>
                )}
            </li>
          ))}
        </ul>
      ) : null}
      {entries.length === 0 ? <p className="notice">비어 있다.</p> : null}
    </section>
  );
}
