// table 블록. 넓은 표는 상자 안에서만 가로로 스크롤한다 — 페이지 본문은 가로로 스크롤되지 않는다.

import type { TableBlock } from '../../model/types.ts';
import { Inline } from '../app/inline.tsx';

export function Table({
  block,
  selectedId,
  onSelect,
}: {
  block: TableBlock;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="tablebox scroll-x">
      <table>
        <thead>
          <tr>
            {block.columns.map((col) => (
              <th key={col.id} scope="col">
                {col.label}
                {/* derived 열은 원문이 아니라 해설이다. 표지를 붙여 등급을 드러낸다 */}
                {col.derived ? <span className="chip tag-derived"> 해설</span> : null}
              </th>
            ))}
            <th scope="col" aria-label="근거" />
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.id} id={row.id} aria-current={selectedId === row.id ? 'true' : undefined}>
              {block.columns.map((col) => {
                const cell = row.cells[col.id];
                const text = typeof cell === 'string' ? cell : cell?.text ?? '';
                const cellEvidence = typeof cell === 'string' ? undefined : cell?.evidence;
                return (
                  <td key={col.id} data-derived={col.derived ? 'true' : 'false'}>
                    <Inline text={text} />
                    {cellEvidence && cellEvidence.length > 0 ? (
                      <>
                        {' '}
                        <button type="button" className="cellbtn" onClick={() => onSelect(row.id)}>
                          근거
                        </button>
                      </>
                    ) : null}
                  </td>
                );
              })}
              <td>
                <button type="button" className="cellbtn" onClick={() => onSelect(row.id)}>
                  자세히
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
