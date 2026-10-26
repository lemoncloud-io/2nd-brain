// 뷰어 모음 등록부 빌더. 볼트의 스킬 등록 레이어(.claude/skills/<이름> → SKILL.md)를 훑어 frontmatter 에
// `viewer:` 블록이 있는 스킬만 모아 볼트 전용 등록부(projects/knowledge-viewer/viewers.yml)를 만든다.
// 정본은 각 SKILL.md 의 viewer 블록이다. 등록부는 생성 파일이고 도구 폴더(config/) 밖에 있어 볼트마다 다르다.
// 이 모듈은 파일을 쓰지 않는다 — 쓰기는 CLI(viewers-build.ts)만 한다.
import fs from 'node:fs';
import path from 'node:path';

import { stringify } from 'yaml';

import { splitFrontmatter } from '../../shared/frontmatter.ts';
import { parseEntry, REGISTRY_PATH } from './viewers.ts';

/** 스킬 등록 레이어. 볼트에서 쓸 수 있는 스킬만 여기에 걸린다(상대 심링크 또는 폴더). */
export const SKILLS_DIR = '.claude/skills';
/** order 를 주지 않은 항목의 순서. 같은 order 끼리는 id 순. */
const DEFAULT_ORDER = 1000;

export type BuildProblem = { skill: string; reason: string };
export type BuildResult = {
  /** 등록부에 들어갈 항목(순서대로). 등록부 항목 모양 그대로다. */
  entries: Record<string, unknown>[];
  /** 훑은 등록 항목 수, viewer 블록이 없어 건너뛴 수. */
  scanned: number;
  skipped: number;
  /** 빼고 넘어간 항목의 사유. 빌드는 멈추지 않는다. */
  problems: BuildProblem[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 루트 안의 실제 경로면 볼트 상대경로(/ 구분), 밖이면 null. */
function insideRel(root: string, abs: string): string | null {
  const rel = path.relative(root, abs);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** 등록 레이어를 훑어 viewer 블록이 있는 스킬을 모은다. 같은 SKILL.md 를 두 이름이 가리키면 한 번만 센다. */
export function collectViewers(rootDir: string): BuildResult {
  const root = fs.realpathSync(rootDir);
  const dir = path.join(root, SKILLS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return { entries: [], scanned: 0, skipped: 0, problems: [] };
  }
  const problems: BuildProblem[] = [];
  const found: { order: number; id: string; entry: Record<string, unknown> }[] = [];
  const seenSkill = new Set<string>();
  const seenId = new Set<string>();
  let skipped = 0;
  for (const name of names) {
    const label = `${SKILLS_DIR}/${name}`;
    let real: string;
    try {
      real = fs.realpathSync(path.join(dir, name));
    } catch {
      problems.push({ skill: label, reason: '가리키는 곳이 없다(끊긴 심링크)' });
      continue;
    }
    const skillAbs = path.join(real, 'SKILL.md');
    const skill = insideRel(root, skillAbs);
    if (skill === null) {
      problems.push({ skill: label, reason: '볼트 밖을 가리킨다' });
      continue;
    }
    if (!fs.existsSync(skillAbs)) {
      skipped++; // SKILL.md 가 없는 등록 항목(평면 스킬 등)은 뷰어가 아니다.
      continue;
    }
    if (seenSkill.has(skill)) continue;
    seenSkill.add(skill);
    const data = splitFrontmatter(fs.readFileSync(skillAbs, 'utf8')).data;
    const v = data.viewer;
    if (v === undefined) {
      skipped++;
      continue;
    }
    if (!isObj(v)) {
      problems.push({ skill, reason: 'viewer 는 객체여야 한다' });
      continue;
    }
    let order = DEFAULT_ORDER;
    if (v.order !== undefined) {
      if (typeof v.order !== 'number' || !Number.isInteger(v.order)) {
        problems.push({ skill, reason: 'viewer.order 는 정수다' });
        continue;
      }
      order = v.order;
    }
    const raw = { id: v.id, title: v.title, description: v.description, skill, open: v.open };
    const parsed = parseEntry(raw, found.length + 1);
    if (typeof parsed === 'string') {
      problems.push({ skill, reason: parsed.replace(/^\d+번째 항목/, 'viewer') });
      continue;
    }
    if (seenId.has(parsed.id)) {
      problems.push({ skill, reason: `viewer.id(${parsed.id})가 다른 스킬과 겹친다` });
      continue;
    }
    seenId.add(parsed.id);
    // 등록부에는 사람이 쓴 open 을 그대로 싣는다(파서가 채운 null 기본값은 싣지 않는다).
    const open = Object.fromEntries(Object.entries(v.open as Record<string, unknown>).filter(([, x]) => x !== undefined));
    found.push({ order, id: parsed.id, entry: { id: parsed.id, title: parsed.title, description: parsed.description, skill, open } });
  }
  found.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries: found.map((f) => f.entry), scanned: names.length, skipped, problems };
}

const HEADER = [
  '# 뷰어 모음 패널 등록부 — 생성 파일. 손으로 고치지 않는다.',
  `# 만드는 법: (cd projects/knowledge-viewer/config/app && npm run viewers-build)  · 확인만: npm run viewers-build -- --check`,
  `# 원본: ${SKILLS_DIR}/<이름>/SKILL.md frontmatter 의 viewer 블록 { id, order?, title, description, open }.`,
  '# 이 볼트에 등록된 스킬만 들어간다. 볼트마다 다르며 도구 폴더(config/) 밖에 둔다.',
  '#   open.kind static          → { path: <볼트 상대경로 html>, ask? }',
  '#   open.kind server          → { url?, port?, launch?, ask }   port 가 있으면 127.0.0.1:<port> 핑',
  '#   open.kind project-viewers → { ask? }   projects/<name>/outputs/viewer/index.html 마다 펼친다',
];

/** 등록부 본문. 같은 입력이면 같은 바이트다(시각을 넣지 않는다). */
export function renderRegistry(entries: Record<string, unknown>[]): string {
  const body = stringify({ schema_version: 1, viewers: entries }, { lineWidth: 0 });
  return `${HEADER.join('\n')}\n${body}`;
}

export { REGISTRY_PATH };
