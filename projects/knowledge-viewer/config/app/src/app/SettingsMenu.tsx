// 상단바 ⚙ 설정 메뉴. 자주 안 쓰는 조절(소스·검색 범위·화면 테마·다이어그램 테마·원격 이미지·패널 켜기)을 한 곳에 모아 상단 줄이 넘치지 않게 한다.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { DEFAULT_REMOTE_IMAGE_HOSTS, parseHostList } from '../../shared/image-src.ts';
import type { Source } from '../../shared/source.ts';
import { embeddingStatusText, embeddingStore } from '../graph/embedding.ts';
import type { EmbeddingStore } from '../graph/embedding.ts';
import { MermaidThemeSelect } from '../reader/MermaidThemeSelect.tsx';
import { remoteImageStore, useRemoteImages, type RemoteImageStore } from '../reader/remote-images.ts';
import { PanelSettings } from '../panels/PanelSettings.tsx';
import type { PanelPrefs } from '../panels/prefs.ts';
import type { Panel } from '../panels/registry.ts';
import { IconGear } from './icons.tsx';
import { emitShortcutEvent, onShortcutEvent } from './shortcut-events.ts';
import { SourceSelect } from './SourceSelect.tsx';
import { ThemeSelect } from './ThemeSelect.tsx';

export type SettingsPanelProps = {
  src: Source;
  prs: { number: number; title: string }[];
  mainAvailable: boolean;
  onSourceChange: (src: Source) => void;
  /** main 을 못 써 local 로 떨어졌으면 그 까닭. 메뉴 안에 글로 보인다. */
  fallbackReason: string | null;
  /** 검색이 raw·archive 까지 보는가. */
  searchAll: boolean;
  onSearchAll: (on: boolean) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  /** 오른쪽 열 패널 켜기·순서(등록부와 설정). 없으면 패널 목록을 그리지 않는다. */
  panels?: Panel[];
  panelPrefs?: PanelPrefs;
  onPanelPrefs?: (p: PanelPrefs) => void;
  /** 임베딩 묶음 상태 저장소. 시험이 가짜를 준다. 기본은 앱의 것. */
  embedding?: EmbeddingStore;
  /** 원격 이미지 보기 저장소. 시험이 가짜를 준다. 기본은 앱의 것. */
  remoteImages?: RemoteImageStore;
};

/**
 * "지도" 줄: 임베딩 묶음 켜기 + 상태 글 + 색인 단추. 서버가 쓸 수 있다고 알릴 때만 그린다.
 * 켜면 상태를 묻고 색인 전이면 색인을 시작한다(색인 중에는 3 초마다 다시 묻는다).
 */
function EmbeddingRow({ store }: { store: EmbeddingStore }) {
  const v = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (!v.available) return null;
  const state = v.status?.state;
  // 모델 없음·Ollama 없음에서도 누를 수 있다 — `ollama pull`·`ollama serve` 뒤에 끄고 켜지 않고 바로 다시 시도한다(서버가 다시 확인한다).
  const canBuild = v.enabled && v.status !== null && state !== 'building' && state !== 'off';
  return (
    <>
      <span className="settings-h">지도</span>
      <div className="settings-cell settings-inline">
        <label className="settings-row" title={`본문 임베딩(로컬 Ollama ${v.model ?? ''})으로 묶음을 만든다 — 본문은 이 머신 밖으로 나가지 않는다`}>
          <input type="checkbox" checked={v.enabled} onChange={(e) => void store.setEnabled(e.target.checked)} />
          <span>임베딩 묶음</span>
        </label>
        <span className="settings-note" role="status">
          {embeddingStatusText(v)}
        </span>
        {v.enabled ? (
          <button type="button" className="settings-link" disabled={!canBuild} onClick={() => void store.build()} title="바뀐 문서만 다시 벡터화하고 군집을 다시 센다">
            색인
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * "이미지" 줄: 원격 이미지 보기 토글(기본 끔) + "허용 호스트…" 접이식 편집 칸.
 * 허용 호스트는 켜면 바로 그리고, 그 밖은 리더 배지의 "불러오기" 를 눌러야 그 하나만 요청한다.
 * 편집 칸은 한 줄에 하나(쉼표·공백도 된다), `*.도메인` 은 하위 호스트 전부다. 꼴이 아닌 칸은 저장 때 버린다.
 */
function RemoteImageRow({ store }: { store: RemoteImageStore }) {
  const v = useRemoteImages(store);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? v.hosts.join('\n');
  const commit = () => {
    if (draft === null) return;
    store.setHosts(parseHostList(draft));
    setDraft(null);
  };
  const isDefault = v.hosts.length === DEFAULT_REMOTE_IMAGE_HOSTS.length && v.hosts.every((h, i) => h === DEFAULT_REMOTE_IMAGE_HOSTS[i]);
  return (
    <>
      <span className="settings-h">이미지</span>
      <div className="settings-cell settings-inline">
        <label className="settings-row" title="켜면 허용 호스트의 원격 이미지를 바로 그린다. 그 밖은 배지의 「불러오기」를 눌러야 그 하나만 요청한다">
          <input type="checkbox" checked={v.enabled} onChange={(e) => store.setEnabled(e.target.checked)} />
          <span>원격 이미지 보기</span>
        </label>
        <button type="button" className="settings-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? '호스트 닫기' : '허용 호스트…'}
        </button>
      </div>
      {open ? (
        <div className="settings-span remote-hosts">
          <textarea
            className="remote-hosts-input"
            aria-label="허용 호스트(한 줄에 하나, *.도메인 가능)"
            rows={3}
            spellCheck={false}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />
          <div className="settings-inline remote-hosts-actions">
            <span className="remote-hosts-hint">한 줄에 하나 · *.도메인 · https 만</span>
            <button type="button" className="settings-link" disabled={draft === null} onMouseDown={(e) => e.preventDefault()} onClick={commit}>
              적용
            </button>
            <button
              type="button"
              className="settings-link"
              disabled={isDefault && draft === null}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft(null);
                store.resetHosts();
              }}
            >
              기본값
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 메뉴 안쪽. 시험이 따로 그린다. 한 줄이 "라벨 | 조절" 인 압축 격자다 — 절 제목을 따로 두지 않는다. */
export function SettingsPanel(p: SettingsPanelProps) {
  const [panelsOpen, setPanelsOpen] = useState(false);
  const panelList = p.panels !== undefined && p.panelPrefs !== undefined && p.onPanelPrefs !== undefined;
  return (
    <div className="settings-pop" role="dialog" aria-label="설정">
      <div className="settings-grid">
        <span className="settings-h">소스</span>
        <div className="settings-cell">
          <SourceSelect src={p.src} prs={p.prs} mainAvailable={p.mainAvailable} onChange={p.onSourceChange} />
          {p.fallbackReason !== null && p.src.kind === 'local' ? (
            <p className="settings-note" role="status">
              메인을 못 열어 로컬로 연다: {p.fallbackReason}
            </p>
          ) : null}
        </div>
        <span className="settings-h">검색</span>
        <label className="settings-row">
          <input type="checkbox" checked={p.searchAll} onChange={(e) => p.onSearchAll(e.target.checked)} />
          <span>raw·archive 포함</span>
        </label>
        <span className="settings-h">테마</span>
        <ThemeSelect compact />
        <span className="settings-h">다이어그램</span>
        <MermaidThemeSelect compact />
        <EmbeddingRow store={p.embedding ?? embeddingStore} />
        <RemoteImageRow store={p.remoteImages ?? remoteImageStore} />
        <span className="settings-h">패널</span>
        <div className="settings-cell settings-inline">
          <label className="settings-row">
            <input type="checkbox" checked={p.leftOpen} onChange={p.onToggleLeft} />
            <span>왼쪽 트리</span>
          </label>
          <label className="settings-row">
            <input type="checkbox" checked={p.rightOpen} onChange={p.onToggleRight} />
            <span>오른쪽 패널</span>
          </label>
          {panelList ? (
            <button type="button" className="settings-link" aria-expanded={panelsOpen} onClick={() => setPanelsOpen((v) => !v)}>
              {panelsOpen ? '목록 닫기' : '켜기·순서…'}
            </button>
          ) : null}
        </div>
        {panelList && panelsOpen ? (
          <div className="settings-span">
            <PanelSettings panels={p.panels!} prefs={p.panelPrefs!} onChange={p.onPanelPrefs!} />
          </div>
        ) : null}
      </div>
      <button type="button" className="settings-help" onClick={() => emitShortcutEvent('help')}>
        <span>단축키 도움말</span>
        <kbd className="kbd">?</kbd>
      </button>
    </div>
  );
}

/** ⚙ 단추 + 메뉴. Esc·바깥 클릭으로 닫힌다. 소스를 고르면 닫힌다. */
export function SettingsMenu(p: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  // 단축키: , 는 메뉴를 열고 닫는다(열면 첫 조절에 포커스). 도움말이 열리면 메뉴는 닫는다.
  const [focusFirst, setFocusFirst] = useState(false);
  useEffect(() => {
    const offSettings = onShortcutEvent('settings', () => {
      setOpen((v) => !v);
      setFocusFirst(true);
    });
    const offHelp = onShortcutEvent('help', () => setOpen(false));
    return () => {
      offSettings();
      offHelp();
    };
  }, []);
  useEffect(() => {
    if (!focusFirst) return;
    setFocusFirst(false);
    if (open) root.current?.querySelector<HTMLElement>('.settings-pop select, .settings-pop input, .settings-pop button')?.focus();
  }, [open, focusFirst]);
  return (
    <div className="settings-wrap" ref={root}>
      <button
        type="button"
        className="icon-btn settings-toggle"
        aria-label="설정"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="설정 — 소스·검색 범위·테마·다이어그램·이미지·패널 켜기·순서"
        onClick={() => setOpen((v) => !v)}
      >
        <IconGear />
      </button>
      {open ? (
        <SettingsPanel
          {...p}
          onSourceChange={(s) => {
            setOpen(false);
            p.onSourceChange(s);
          }}
        />
      ) : null}
    </div>
  );
}
