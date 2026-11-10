// 테스트 공용 조립기. 테스트 러너는 *.test.ts만 실행하므로 이 파일은 자동 실행되지 않는다.
import type { CheckResult, EvidenceRef, Issue, ResolvedEvidence, ResolvedTarget } from '../../model/types.ts';
import { checkProject } from '../../model/check.ts';

export const SPEC_MD = [
  '---',
  'title: 데모 사양',
  'status: in_progress',
  '---',
  '',
  '# 데모 사양',
  '',
  '첫 문단이다.',
  '',
  '## 구성 단위',
  '',
  '입력부와 처리부와 출력부로 나눈다.',
  '',
  '## 검사 규칙',
  '',
  '모르는 키는 오류다. 유일한 문구.',
  '',
].join('\n');

export const NOTES_MD = ['# 메모', '', '두 번째 원본이다.', ''].join('\n');

export const DEFAULT_FILES: Record<string, string> = {
  'docs/spec.md': SPEC_MD,
  'docs/notes.md': NOTES_MD,
};

export function makeReadFile(files: Record<string, string>): (p: string) => string | null {
  return (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p]! : null);
}

export function run(
  viewerText: string,
  files: Record<string, string> = DEFAULT_FILES,
  readRepoFile?: (repo: string, path: string) => string | null,
): CheckResult {
  return checkProject({ viewerText, readFile: makeReadFile(files), readRepoFile });
}

export function codes(result: CheckResult): string[] {
  return result.issues.map((i) => i.code);
}

export function pick(result: CheckResult, code: string): Issue | undefined {
  return result.issues.find((i) => i.code === code);
}

/** 오류 코드와 위치를 함께 단언한다. "언젠가 실패했다"만 보는 테스트를 막기 위해서다. */
export function assertIssue(
  result: CheckResult,
  code: string,
  where: string,
): Issue {
  const hit = result.issues.find((i) => i.code === code && i.where === where);
  if (!hit) {
    throw new Error(
      `기대한 이슈 ${code} @ ${where} 가 없다. 실제: ${JSON.stringify(
        result.issues.map((i) => `${i.code} @ ${i.where}`),
        null,
        2,
      )}`,
    );
  }
  return hit;
}

/** 최소 골격 — kind: explainer, prose 블록 하나. */
export function viewerYml(body: string): string {
  return ['schema_version: 1', 'meta:', '  title: 데모', '  kind: explainer', body].join('\n');
}

export const MINIMAL = viewerYml(
  [
    'sources:',
    '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
    'pages:',
    '  - id: P1',
    '    title: 개요',
    '    blocks:',
    '      - type: prose',
    '        id: B1',
    '        text: 한 줄 요약이다.',
    '        evidence: [{source: spec, at: "검사 규칙"}]',
  ].join('\n'),
);

/** 검사를 통과한 뷰어의 근거 자리는 resolved가 채워져 있다. */
export function resolvedOf(evidence: EvidenceRef[] | undefined, index = 0): ResolvedTarget {
  const ref = evidence?.[index] as ResolvedEvidence | undefined;
  if (!ref) throw new Error(`근거[${index}]가 없다`);
  return ref.resolved;
}
