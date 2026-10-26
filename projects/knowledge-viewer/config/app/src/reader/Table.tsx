// 표 보기 — 감싸개(가로 스크롤)·첫 열·짧은 셀 클래스·행 상세 모달·열 폭 드래그.
// react-markdown `components` 의 table/thead/tr/th/td 를 맡는다. 에이전트 모드에는 클래스만 붙이고 손잡이·클릭은 붙이지 않는다.
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Components } from 'react-markdown';

import { isPlainClick } from '../app/links.ts';
import { hastText, isShortCell, pairRow, type HastNode } from './table.ts';

/** 드래그로 줄일 수 있는 열의 최소 폭(px). */
const MIN_COL_WIDTH = 40;

type RowPairs = Array<{ head: ReactNode | null; cell: ReactNode }>;

type TableApi = {
  agent: boolean;
  /** 헤더 행의 셀 자식. 헤더 tr 이 그려질 때 채우고, 셀 클릭 때 읽는다. */
  headers: { current: ReactNode[] };
  startResize: (col: number, th: HTMLTableCellElement, e: ReactPointerEvent<HTMLElement>) => void;
  openRow: (cells: ReactNode[], from: HTMLTableCellElement) => void;
};

const TableCtx = createContext<TableApi | null>(null);
const SectionCtx = createContext<'head' | 'body'>('body');
/** 지금 행의 셀 자식들(React 노드). 행 상세가 이것을 다시 그린다. */
const RowCtx = createContext<ReactNode[]>([]);

type CellProps<T extends 'th' | 'td'> = ComponentProps<T> & { node?: HastNode; colIndex?: number };

function cellClass(colIndex: number | undefined, node: HastNode | undefined): string | undefined {
  if (colIndex === 0) return 'cell-first';
  return isShortCell(hastText(node)) ? 'cell-short' : undefined;
}

/** 클릭한 곳이 링크·단추·접기 같은 자체 동작 요소 안이면 행 상세를 열지 않는다. */
function insideInteractive(target: EventTarget | null, cell: HTMLElement): boolean {
  const el = target instanceof Element ? target.closest('a, button, summary, details') : null;
  return el !== null && cell.contains(el);
}

function RowDialog({ pairs, from, onClose }: { pairs: RowPairs; from: HTMLTableCellElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      from.focus();
    };
  }, [from, onClose]);
  return createPortal(
    <div
      className="row-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="row-dialog" role="dialog" aria-modal="true" aria-label="행 상세" tabIndex={-1}>
        <div className="row-dialog-head">
          <span className="row-dialog-title">행 상세</span>
          <button type="button" className="row-dialog-close" aria-label="닫기" title="닫기 (Esc)" onClick={onClose}>
            ×
          </button>
        </div>
        <dl className="row-dialog-list">
          {pairs.map((p, i) => (
            <div key={i} className="row-dialog-item">
              <dt>{p.head ?? `열 ${i + 1}`}</dt>
              <dd>{p.cell}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}

function Table({ agent, children }: { agent: boolean; children?: ReactNode }) {
  const headers = useRef<ReactNode[]>([]);
  // 열 폭: 처음 드래그할 때 모든 열의 그려진 폭을 재어 두고, 그 뒤로는 그 열만 바꾼다. 세션 안에서만 산다(저장 안 함).
  const [widths, setWidths] = useState<number[] | null>(null);
  const widthsRef = useRef<number[] | null>(null);
  widthsRef.current = widths;
  const [dialog, setDialog] = useState<{ pairs: RowPairs; from: HTMLTableCellElement } | null>(null);

  const startResize = useCallback((col: number, th: HTMLTableCellElement, e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const row = th.parentElement;
    const cells = row === null ? [th] : Array.from(row.children);
    const base = widthsRef.current ?? cells.map((c) => c.getBoundingClientRect().width);
    const startX = e.clientX;
    const startW = base[col] ?? MIN_COL_WIDTH;
    const move = (ev: PointerEvent) => {
      const next = base.slice();
      next[col] = Math.max(MIN_COL_WIDTH, startW + (ev.clientX - startX));
      widthsRef.current = next;
      setWidths(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const openRow = useCallback((cells: ReactNode[], from: HTMLTableCellElement) => {
    setDialog({ pairs: pairRow(headers.current, cells), from });
  }, []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const api: TableApi = { agent, headers, startResize, openRow };
  const total = widths === null ? null : widths.reduce((a, b) => a + b, 0);
  return (
    <TableCtx.Provider value={api}>
      <div className="table-wrap">
        <table
          className={[agent ? '' : 'table-live', widths === null ? '' : 'table-fixed'].filter((c) => c !== '').join(' ') || undefined}
          style={total === null ? undefined : { tableLayout: 'fixed', width: total }}
        >
          {widths !== null && (
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
          )}
          {children}
        </table>
      </div>
      {dialog !== null && <RowDialog pairs={dialog.pairs} from={dialog.from} onClose={closeDialog} />}
    </TableCtx.Provider>
  );
}

function Thead({ node: _node, children, ...props }: ComponentProps<'thead'> & { node?: HastNode }) {
  return (
    <SectionCtx.Provider value="head">
      <thead {...props}>{children}</thead>
    </SectionCtx.Provider>
  );
}

function Tr({ node: _node, children, ...props }: ComponentProps<'tr'> & { node?: HastNode }) {
  const section = useContext(SectionCtx);
  const api = useContext(TableCtx);
  // 셀 요소에만 열 번호를 붙인다. 셀 사이의 줄바꿈 텍스트는 세지 않는다.
  const cells: ReactNode[] = [];
  const indexed = Children.toArray(children).map((child) => {
    if (!isValidElement<{ children?: ReactNode; colIndex?: number }>(child)) return child;
    cells.push(child.props.children);
    return cloneElement(child, { colIndex: cells.length - 1 });
  });
  if (section === 'head' && api !== null) api.headers.current = cells;
  return (
    <RowCtx.Provider value={cells}>
      <tr {...props}>{indexed}</tr>
    </RowCtx.Provider>
  );
}

function Th({ node, children, colIndex, ...props }: CellProps<'th'>) {
  const api = useContext(TableCtx);
  const ref = useRef<HTMLTableCellElement>(null);
  const live = api !== null && !api.agent;
  return (
    <th ref={ref} className={cellClass(colIndex, node)} {...props}>
      {children}
      {live && (
        <span
          className="th-resizer"
          role="separator"
          aria-orientation="vertical"
          title="끌어서 열 폭 조절"
          onPointerDown={(e) => {
            if (ref.current !== null) api.startResize(colIndex ?? 0, ref.current, e);
          }}
        />
      )}
    </th>
  );
}

function Td({ node, children, colIndex, ...props }: CellProps<'td'>) {
  const api = useContext(TableCtx);
  const cells = useContext(RowCtx);
  const className = cellClass(colIndex, node);
  if (api === null || api.agent) {
    return (
      <td className={className} {...props}>
        {children}
      </td>
    );
  }
  const onClick = (e: MouseEvent<HTMLTableCellElement>) => {
    if (!isPlainClick(e) || insideInteractive(e.target, e.currentTarget)) return;
    api.openRow(cells, e.currentTarget);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableCellElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) api.openRow(cells, e.currentTarget);
  };
  return (
    <td className={className} tabIndex={-1} onClick={onClick} onKeyDown={onKeyDown} {...props}>
      {children}
    </td>
  );
}

/** Reader 의 `components` 에 펼쳐 넣는다. `agent` 가 참이면 손잡이·클릭·모달 없이 클래스만 붙는다. */
export function tableComponents(agent: boolean): Pick<Components, 'table' | 'thead' | 'tr' | 'th' | 'td'> {
  return {
    table: ({ children }) => <Table agent={agent}>{children}</Table>,
    thead: Thead,
    tr: Tr,
    th: Th as Components['th'],
    td: Td as Components['td'],
  };
}
