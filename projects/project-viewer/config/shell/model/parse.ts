// yml 텍스트 → 검증된 문서. 실패는 ModelError로 던진다(호출자가 issues를 그대로 모은다).
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';

import type { Issue, LedgerDoc, ViewerDoc } from './types.ts';
import { ledgerSchema, viewerSchema } from './schema.ts';

export class ModelError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => `[${i.code}] ${i.where} — ${i.message}`).join('\n'));
    this.name = 'ModelError';
    this.issues = issues;
  }
}

/** zod의 경로를 `pages[1].blocks[0].nodes[3]` 형태로 적는다. */
export function formatPath(segments: readonly (string | number)[]): string {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out === '' ? seg : `.${seg}`;
  }
  return out;
}

function toIssues(error: z.ZodError, prefix: string): Issue[] {
  const issues: Issue[] = [];
  for (const issue of error.issues) {
    const base = formatPath(issue.path);
    if (issue.code === 'unrecognized_keys') {
      // 모르는 키는 키마다 한 건으로 적어야 어디를 고칠지 보인다.
      for (const key of issue.keys) {
        issues.push({ level: 'error', code: 'E_SCHEMA', message: `모르는 키: ${key}`, where: prefix + formatPath([...issue.path, key]) });
      }
      continue;
    }
    issues.push({ level: 'error', code: 'E_SCHEMA', message: issue.message, where: prefix + base });
  }
  return issues;
}

function loadYaml(text: string, prefix: string): unknown {
  try {
    return parseYaml(text, { prettyErrors: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const line = /at line (\d+)/.exec(message)?.[1];
    throw new ModelError([
      { level: 'error', code: 'E_YAML', message, where: line ? `${prefix}line ${line}` : prefix || '' },
    ]);
  }
}

export function parseViewer(text: string): ViewerDoc {
  const raw = loadYaml(text, '');
  const parsed = viewerSchema.safeParse(raw);
  if (!parsed.success) throw new ModelError(toIssues(parsed.error, ''));
  return parsed.data;
}

export function parseLedger(text: string, prefix = ''): LedgerDoc {
  const raw = loadYaml(text, prefix);
  const parsed = ledgerSchema.safeParse(raw);
  if (!parsed.success) throw new ModelError(toIssues(parsed.error, prefix));
  return parsed.data;
}
