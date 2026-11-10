// sequence 블록. 번호 붙은 스텝과 자리(lane) 알약.

import type { SequenceBlock } from '../../model/types.ts';
import { Inline } from '../app/inline.tsx';

export function Sequence({
  block,
  selectedId,
  onSelect,
}: {
  block: SequenceBlock;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="stack">
      {block.fields && block.fields.length > 0 ? (
        <div className="row">
          {block.fields.map((field, i) => (
            <span className="chip" key={i}>
              {field.label}: <Inline text={field.text} />
            </span>
          ))}
        </div>
      ) : null}
      <ol className="sequence" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {block.steps.map((step, i) => (
          <li className="step" key={step.id} id={step.id}>
            <span className="step__num nums" aria-hidden="true">
              {i + 1}
            </span>
            <button
              type="button"
              className="pick"
              aria-current={selectedId === step.id ? 'true' : undefined}
              onClick={() => onSelect(step.id)}
            >
              <span className="pick__label">
                <Inline text={step.label} refs={false} />
                {step.lane ? <span className="chip chip--code step__lane">{step.lane}</span> : null}
              </span>
              {step.easy ? (
                <span className="pick__body">
                  <Inline text={step.easy} refs={false} />
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
