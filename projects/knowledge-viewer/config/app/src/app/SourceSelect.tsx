import { parseSource, sourceKey } from '../../shared/source.ts';
import type { Source } from '../../shared/source.ts';
import { sourceOptions } from './source-ui.ts';

type Props = {
  src: Source;
  prs: { number: number; title: string }[];
  mainAvailable: boolean;
  onChange: (src: Source) => void;
};

/** 어느 소스로 볼지: 메인(origin/master) · 로컬(워크트리) · PR 머리. */
export function SourceSelect({ src, prs, mainAvailable, onChange }: Props) {
  const opts = sourceOptions(prs, mainAvailable, src);
  const fixed = opts.filter((o) => !o.value.startsWith('pr:'));
  const prOpts = opts.filter((o) => o.value.startsWith('pr:'));
  const value = sourceKey(src);
  return (
    <select
      className={`src-select src-select-${src.kind}`}
      aria-label="소스"
      title="어느 소스로 볼지"
      value={value}
      onChange={(e) => {
        const next = parseSource(e.target.value);
        if (next !== null && sourceKey(next) !== value) onChange(next);
      }}
    >
      {fixed.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {prOpts.length > 0 ? (
        <optgroup label="PR">
          {prOpts.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}
