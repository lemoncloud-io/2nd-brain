// 왼쪽 내비게이터. sources를 group별로 묶고, 없는 원본은 흐리게 두되 숨기지 않는다
// (없다는 사실 자체가 리뷰에 필요한 정보다).

import type { Bundle, SourceDoc } from '../../model/types.ts';
import { formatRoute } from '../app/router.ts';

const NO_GROUP = '그 밖';

export function groupDocs(bundle: Bundle): { group: string; docs: SourceDoc[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, SourceDoc[]>();
  // sources에 적힌 순서를 그대로 지킨다 — 쓴 사람이 정한 순서가 곧 읽는 순서다.
  for (const spec of bundle.viewer.sources) {
    const doc = bundle.docs[spec.id];
    if (doc === undefined) continue;
    const group = spec.group ?? NO_GROUP;
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      order.push(group);
    }
    byGroup.get(group)!.push(doc);
  }
  return order.map((group) => ({ group, docs: byGroup.get(group) ?? [] }));
}

export function Navigator({
  bundle,
  currentId,
  onNavigate,
}: {
  bundle: Bundle;
  currentId?: string;
  onNavigate?: () => void;
}): React.ReactElement {
  const groups = groupDocs(bundle);

  return (
    <nav className="reader__nav" aria-label="원본 목록">
      {groups.map(({ group, docs }) => (
        <section className="nav-group" key={group}>
          <h3 className="nav-group__title">{group}</h3>
          <ul className="nav-group__list">
            {docs.map((doc) => (
              <li key={doc.id}>
                <a
                  className={`nav-item${doc.missing ? ' nav-item--missing' : ''}`}
                  href={formatRoute({ kind: 'docs', sourceId: doc.id })}
                  aria-current={doc.id === currentId ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  <span className="nav-item__title">{doc.title}</span>
                  {doc.missing ? <span className="nav-item__flag">없음</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
