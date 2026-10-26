import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { VaultIndex } from '../../server/index-store.ts';
import { findVaultRoot } from '../../shared/vault.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

const hasPython = spawnSync('python3', ['--version']).status === 0;

describe('lint 대조(vault_orphans.py)', () => {
  it('outgoing()이 파이썬 Vault.edges와 같다', (t) => {
    if (!hasPython) {
      t.skip('python3 없음');
      return;
    }
    const scripts = path.join(findVaultRoot(process.cwd()), 'projects/second-brain/config/scripts');
    const fx = makeFixtureVault();
    try {
      const py = spawnSync(
        'python3',
        [
          '-I',
          '-c',
          "import json,sys; sys.path.insert(0, sys.argv[2]); import vault_orphans as v; vt=v.Vault(sys.argv[1]); print(json.dumps({f: sorted(e) for f,e in vt.edges.items()}, ensure_ascii=False))",
          fx.root,
          scripts,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(py.status, 0, py.stderr);
      const expected = JSON.parse(py.stdout) as Record<string, string[]>;

      // 파이썬 edges에는 폴더 색인 README(`<!-- docmap: folder -->`)의 포함 간선이 더해진다.
      // 링크가 아니라서 outgoing()은 일부러 따라 하지 않는다. fixture에는 그런 README가 없다.
      const idx = new VaultIndex(fx.root);
      idx.build();
      const actual: Record<string, string[]> = {};
      for (const f of idx.files) {
        // alias만으로 닿는 링크는 파이썬에 없으므로 그 문서는 비교에서 뺀다.
        if (/\[\[알파[\]|#\\]/.test(fs.readFileSync(path.join(fx.root, f), 'utf8'))) {
          delete expected[f];
          continue;
        }
        actual[f] = idx.outgoing(f);
      }
      assert.ok(Object.keys(actual).length > 0);
      assert.deepEqual(actual, Object.fromEntries(Object.keys(actual).map((k) => [k, expected[k]])));
      assert.deepEqual([...idx.files].sort(), Object.keys(JSON.parse(py.stdout) as object).sort());
    } finally {
      fx.cleanup();
    }
  });
});
