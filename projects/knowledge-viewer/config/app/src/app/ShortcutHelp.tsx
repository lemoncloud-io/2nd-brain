// 단축키 도움말 오버레이. 단축키 표(shortcuts.ts)를 그룹별로 그린다. ?·Esc·바깥 클릭·닫기 단추로 닫힌다.
import { useEffect, useRef } from 'react';

import type { ShortcutPlatformChoice } from './prefs/shortcuts.ts';
import { GROUPS, SHORTCUTS, keyParts, keysFor, matchShortcut, type Platform, type Shortcut } from './shortcuts.ts';

type Props = {
  /** 표기 플랫폼(토글 반영 뒤). */
  platform: Platform;
  /** 토글 값 — 자동이면 detected 를 따른다. */
  choice: ShortcutPlatformChoice;
  /** 브라우저가 판정한 실제 플랫폼. 키 매칭은 늘 이것이다. */
  detected: Platform;
  onChoice: (c: ShortcutPlatformChoice) => void;
  onClose: () => void;
  table?: Shortcut[];
};

const PLATFORM_LABEL: Record<Platform, string> = { mac: '맥', win: '윈도·리눅스' };

const CHOICES: { id: ShortcutPlatformChoice; label: (d: Platform) => string }[] = [
  { id: 'auto', label: (d) => `자동(${PLATFORM_LABEL[d]})` },
  { id: 'mac', label: () => '맥' },
  { id: 'win', label: () => '윈도' },
];

const SCOPE_NOTE: Partial<Record<Shortcut['scope'], string>> = { native: '기본 동작' };

function Keys({ combo, platform }: { combo: string; platform: Platform }) {
  const parts = keyParts(combo, platform);
  return (
    <span className="kbd-combo" data-combo={combo}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && platform === 'win' ? <span className="kbd-plus">+</span> : null}
          <kbd className="kbd">{p}</kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutHelp({ platform, choice, detected, onChoice, onClose, table = SHORTCUTS }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 열려 있는 동안은 모달이다: 캡처 단계에서 키를 먼저 받아 ?·Esc 로 닫고, 나머지 키는 뒤(전역 단축키·지도의 Space)로 흘려보내지 않는다.
  // Tab 은 흘려보낸다(포커스 이동). 열 때 대화 상자에 포커스를 두고, 닫으면 전에 있던 곳으로 돌려준다.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return;
      const esc = e.key === 'Escape';
      const q = matchShortcut(e, '?', detected) && !(e.target instanceof HTMLElement && e.target.tagName === 'INPUT');
      if (esc || q) {
        e.preventDefault();
        closeRef.current();
      }
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      before?.focus();
    };
  }, [detected]);

  return (
    <div
      className="kbd-help-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="kbd-help" role="dialog" aria-modal="true" aria-label="단축키 도움말" tabIndex={-1} ref={dialog}>
        <header className="kbd-help-head">
          <h2 className="kbd-help-title">단축키</h2>
          <div className="kbd-help-platform" role="radiogroup" aria-label="표기">
            {CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={choice === c.id}
                className={choice === c.id ? 'kbd-help-pf kbd-help-pf-on' : 'kbd-help-pf'}
                onClick={() => onChoice(c.id)}
              >
                {c.label(detected)}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn kbd-help-close" aria-label="닫기" title="닫기 (Esc)" onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="kbd-help-note">
          {PLATFORM_LABEL[platform]} 표기. 입력 상자 안에서는 Esc 와 {platform === 'mac' ? '⌘' : 'Ctrl'} 조합만 듣는다.
          {platform !== detected ? ` 이 브라우저는 ${PLATFORM_LABEL[detected]} 키로 듣는다.` : ''}
        </p>
        <div className="kbd-help-groups">
          {GROUPS.map((g) => {
            const rows = table.filter((s) => s.group === g.id);
            if (rows.length === 0) return null;
            return (
              <section key={g.id} className="kbd-help-group" data-group={g.id}>
                <h3 className="kbd-help-h">{g.label}</h3>
                <table className="kbd-help-table">
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} data-shortcut={s.id}>
                        <td className="kbd-help-keys">
                          {keysFor(s, platform).map((combo, i) => (
                            <span key={combo}>
                              {i > 0 ? <span className="kbd-or">또는</span> : null}
                              <Keys combo={combo} platform={platform} />
                            </span>
                          ))}
                        </td>
                        <td className="kbd-help-desc">
                          {s.desc}
                          {SCOPE_NOTE[s.scope] !== undefined ? <span className="kbd-help-scope">{SCOPE_NOTE[s.scope]}</span> : null}
                          {s.desktopOnly ? <span className="kbd-help-scope kbd-help-desktop">데스크톱</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
