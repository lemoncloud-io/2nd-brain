import type { DocResponse } from '../app/types.ts';
import { CopyPathButton } from './MetaPanel.tsx';

/** `templates/` 아래 문서. 렌더하면 자리표시자와 빈 절만 남아 뜻이 없다 — 원문 그대로와 자리표시자 목록을 보여 준다. */
export function TemplateView({ doc }: { doc: DocResponse }) {
  const fm = doc.frontmatterRaw ?? '';
  const full = fm !== '' ? `${fm}\n${doc.body}` : doc.body;
  const placeholders = [...new Set([...full.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[0]))];
  const sections = [...doc.body.matchAll(/^(#{1,6})[ \t]+(.+)$/gm)].map((m) => ({ depth: m[1].length, text: m[2].trim() }));
  return (
    <section className="template-view" data-vault-path={doc.path}>
      <header className="template-head">
        <span className="badge badge-template">템플릿</span>
        <h1 className="template-title">{doc.title}</h1>
        <CopyPathButton path={doc.path} />
      </header>
      <p className="notice">노트 종류의 frontmatter·절 계약이다. 새 노트를 만들 때 이 모양을 따른다. 아래는 원문 그대로다.</p>
      {placeholders.length > 0 ? (
        <p className="template-placeholders">
          자리표시자: {placeholders.map((p) => (
            <code key={p}>{p}</code>
          ))}
        </p>
      ) : null}
      {sections.length > 0 ? (
        <p className="template-sections">
          절: {sections.map((s, i) => (
            <span key={i} className="template-section" style={{ marginLeft: (s.depth - 1) * 8 }}>
              {'#'.repeat(s.depth)} {s.text}
            </span>
          ))}
        </p>
      ) : null}
      <pre className="template-source">
        <code>{full}</code>
      </pre>
    </section>
  );
}
