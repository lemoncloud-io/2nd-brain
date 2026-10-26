// 소스(main·local·PR)의 파일 목록만으로 링크를 해석한다. 규칙은 VaultIndex.resolve와 같은 함수(resolveWith)다.
import { buildLookup, resolveWith } from './index-store.ts';
import type { Resolution } from './index-store.ts';

export type { Resolution };

export class SourceResolver {
  private readonly tables: Parameters<typeof resolveWith>[0];
  private readonly aliasLookup: ((nameLower: string) => string[]) | undefined;

  /**
   * @param files 소스의 md 경로 목록(lint 범위로 이미 걸러진 것)
   * @param aliasLookup 별칭 표 폴백. 소문자 이름을 받아 경로를 낸다. 없으면 별칭은 풀리지 않는다.
   */
  constructor(files: Iterable<string>, aliasLookup?: (nameLower: string) => string[]) {
    this.aliasLookup = aliasLookup;
    const list = [...files];
    this.tables = { files: new Set(list), ...buildLookup(list) };
  }

  resolve(source: string, link: { kind: 'wiki' | 'md'; target: string }): Resolution {
    return resolveWith(this.tables, this.aliasLookup, source, link);
  }
}
