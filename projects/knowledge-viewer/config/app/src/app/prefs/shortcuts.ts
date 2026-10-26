// 단축키 도움말의 표기 플랫폼: 자동(브라우저 판정)·맥·윈도. 키 매칭은 늘 실제 플랫폼을 따르고, 이것은 표기만 바꾼다.
import { readKey, writeKey } from './storage.ts';

export type ShortcutPlatformChoice = 'auto' | 'mac' | 'win';

const KEY = 'knowledge-viewer.shortcut-platform';

export function parseShortcutPlatform(v: unknown): ShortcutPlatformChoice {
  return v === 'mac' || v === 'win' ? v : 'auto';
}

export function readShortcutPlatform(): ShortcutPlatformChoice {
  return parseShortcutPlatform(readKey(KEY));
}

export function writeShortcutPlatform(v: ShortcutPlatformChoice): void {
  writeKey(KEY, v);
}
