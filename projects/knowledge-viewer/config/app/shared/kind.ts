// 문서 종류(kind)와 클러스터 키. 서버와 클라이언트가 같은 함수를 쓴다.
// 판정 규칙은 설계 문서 § 문서 종류·§ 클러스터링의 표와 같다.

export type Kind = 'concept' | 'tool' | 'model' | 'framework' | 'pattern' | 'protocol' | 'topic' | 'project' | 'idea' | 'output' | 'doc' | 'other';

export const KINDS: readonly Kind[] = ['concept', 'tool', 'model', 'framework', 'pattern', 'protocol', 'topic', 'project', 'idea', 'output', 'doc', 'other'];

/** wiki/ 아래에서 type 값이 곧 종류인 일곱 가지. */
const WIKI_KINDS: readonly Kind[] = ['concept', 'tool', 'model', 'framework', 'pattern', 'protocol', 'topic'];

/** type 이 이 값이면 어디에 있든 산출물이다. */
const OUTPUT_TYPES: ReadonlySet<string> = new Set(['project-output', 'query-output', 'run-log', 'lint-report', 'weekly-report']);

/** type 이 이 값이면 어디에 있든 문서(설계·계획)다. */
const DOC_TYPES: ReadonlySet<string> = new Set(['design', 'plan']);

/** 경로 판정은 조각으로 한다 — `wikis/` 가 `wiki/` 로 읽히면 안 된다. */
const segsOf = (p: string): string[] => p.split('/');

/** 위에서부터 첫 일치. `type` 은 문자열일 때만 쓴다. */
export function kindOf(path: string, data: Record<string, unknown>): Kind {
  const segs = segsOf(path);
  const type = typeof data.type === 'string' ? data.type : '';
  const top = segs[0];

  if (top === 'wiki' && segs.length > 1) {
    const hit = WIKI_KINDS.find((k) => k === type);
    if (hit) return hit;
  }
  if (type === 'project' || (top === 'projects' && segs.length === 3 && segs[2] === 'README.md')) return 'project';
  if (type === 'idea' || (top === 'areas' && segs[1] === 'ideas' && segs.length > 2)) return 'idea';
  if (OUTPUT_TYPES.has(type) || segs.slice(0, -1).includes('outputs')) return 'output';
  if ((top === 'docs' && segs.length > 1) || DOC_TYPES.has(type)) return 'doc';
  return 'other';
}

/** `topics` 가 문자열 목록이면 다듬어 빈 값을 뺀다. 문자열 하나도 목록으로 본다. */
export function topicsOf(data: Record<string, unknown>): string[] {
  const raw = data.topics;
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const s = t.trim();
    if (s) out.push(s);
  }
  return out;
}

/** 1차 클러스터 소스 `meta`. 위에서부터 첫 일치. */
export function clusterKeyOf(path: string, kind: Kind, topics: string[]): string {
  const segs = segsOf(path);
  const top = segs[0] ?? '';
  const isDir = segs.length > 1;

  if (top === 'wiki' && isDir) return topics[0] !== undefined ? `topic:${topics[0]}` : `type:${kind}`;
  if (top === 'projects' && isDir) {
    const name = segs[1] ?? '';
    // projects/@<org>/<repo>/ 는 조직·저장소 두 조각이 이름이다. 파일 바로 위가 아니어야 폴더다.
    if (name.startsWith('@') && segs.length > 3) return `project:${name}/${segs[2]}`;
    if (!name.startsWith('@') && segs.length > 2) return `project:${name}`;
  }
  if (top === 'areas' && segs[1] === 'ideas' && segs.length > 2) return 'ideas';
  if (top === 'docs' && isDir) return 'docs';
  // 루트에 놓인 문서는 첫 폴더가 없다.
  return isDir ? `dir:${top}` : 'root';
}
