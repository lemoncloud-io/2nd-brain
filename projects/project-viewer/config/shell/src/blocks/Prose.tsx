// prose 블록. 짧은 해설 한 덩이. 인라인 문법만 해석한다.

import type { ProseBlock } from '../../model/types.ts';
import { InlineParagraphs } from '../app/inline.tsx';

export function Prose({ block }: { block: ProseBlock }): React.ReactElement {
  return <InlineParagraphs text={block.text} className="prose" />;
}
