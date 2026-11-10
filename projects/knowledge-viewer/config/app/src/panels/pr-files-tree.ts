// PR 상세 패널의 바뀐 파일을 폴더 트리로 묶는 순수 함수. DOM 을 만지지 않는다.
// 한 갈래(자식이 폴더 하나뿐)인 폴더는 `a/b/c` 한 줄로 접는다 — GitHub 트리·VS Code 의 compact folders 와 같다.
import type { ChangedFile } from '../app/types.ts';

export type FileLeaf = { kind: 'file'; name: string; file: ChangedFile };
export type DirNode = { kind: 'dir'; name: string; path: string; children: TreeNode[] };
export type TreeNode = DirNode | FileLeaf;

type Draft = { dirs: Map<string, Draft>; files: ChangedFile[] };

const byName = (a: TreeNode, b: TreeNode): number => {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, 'en');
};

function finish(draft: Draft, prefix: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const [name, sub] of draft.dirs) {
    let dirName = name;
    let dirPath = prefix === '' ? name : `${prefix}/${name}`;
    let cur = sub;
    // 파일이 없고 하위 폴더가 하나뿐이면 그 폴더와 한 줄로 합친다.
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [[childName, child]] = cur.dirs;
      dirName = `${dirName}/${childName}`;
      dirPath = `${dirPath}/${childName}`;
      cur = child;
    }
    out.push({ kind: 'dir', name: dirName, path: dirPath, children: finish(cur, dirPath) });
  }
  for (const file of draft.files) out.push({ kind: 'file', name: file.path.slice(file.path.lastIndexOf('/') + 1), file });
  return out.sort(byName);
}

/** 바뀐 파일 목록 → 폴더 트리. 폴더가 파일보다 앞이고 각각 이름순이다. 잎은 원본 `ChangedFile` 을 그대로 든다. */
export function buildFileTree(files: ChangedFile[]): TreeNode[] {
  const root: Draft = { dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part);
      if (next === undefined) {
        next = { dirs: new Map(), files: [] };
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.push(file);
  }
  return finish(root, '');
}
