import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

import { LOCAL, parseSource, sourceKey } from '../../shared/source.ts';
import type { Source } from '../../shared/source.ts';
import { ApiError, getDoc, getInfo, getPrChanges, getPrRepos, getPrs, getTree } from './api.ts';
import { changedMapOf } from './changed.ts';
import { ChangedEventsContext, type ChangedEvents } from './events.ts';
import { FolderView } from './FolderView.tsx';
import { LazyBoundary } from './LazyBoundary.tsx';
import { GraphListView } from '../graph/GraphListView.tsx';
import { GraphControls, type GraphControlValues, type GraphHubs, type GraphStats } from '../graph/GraphControls.tsx';
import type { RotateMode } from '../graph/autorotate.ts';
import type { OrbitMode } from '../graph/orbit.ts';
import type { ClusterMode } from '../graph/cluster-mode.ts';
import { embeddingStore } from '../graph/embedding.ts';
import type { LabelMode } from '../graph/labels.ts';
import type { DampingLevel, MotionMode } from '../graph/motion.ts';
import { PANELS } from '../panels/registry.ts';
import { PanelHeading } from '../panels/PanelHeading.tsx';
import { isCollapsed, loadPrefs, savePrefs, toggleCollapsed, visiblePanels, type PanelPrefs } from '../panels/prefs.ts';
import { FileView } from '../reader/FileView.tsx';
import { HtmlFrame } from '../reader/HtmlFrame.tsx';
import { CopyPathButton } from '../reader/MetaPanel.tsx';
import { Reader } from '../reader/Reader.tsx';
import { TemplateView } from '../reader/TemplateView.tsx';
import { frameOrigin, isHtmlPath, rawHref, shouldHopToRaw } from '../reader/frame.ts';
import { TopBar } from './TopBar.tsx';
import { GlobalShortcuts } from './Shortcuts.tsx';
import { Tree } from './Tree.tsx';
// 설정은 기능별 파일에서 바로 가져온다 — 한 줄짜리 import 를 여러 PR 이 같이 고쳐 충돌하던 것을 막는다.
import { readLeftOpen, readRightOpen, writeLeftOpen, writeRightOpen } from './prefs/layout.ts';
import { useColumnResize } from './useColumnResize.ts';
import { appClassName, useDrawer } from './useDrawer.ts';
import { readSearchAll, writeSearchAll } from './prefs/search.ts';
import { useSearchFilter } from './search-filter.ts';
import { useApplyTheme } from './theme-apply.ts';
import {
  readGraphCluster,
  readGraphDamping,
  readGraphLabels,
  readGraphMotion,
  readGraphRotate,
  readGraphOrbit,
  writeGraphCluster,
  writeGraphDamping,
  writeGraphLabels,
  writeGraphMotion,
  writeGraphRotate,
  writeGraphOrbit,
} from './prefs/graph.ts';
import {
  folderOf,
  hrefFor,
  isFolderPath,
  isTemplatePath,
  parseLocation,
  searchTarget,
  type GraphTarget,
  type NavigateFn,
  type Route,
  type View,
} from './route.ts';
import type { DocChange, DocResponse, PrChanges, RevealRequest, TreeEntry, VaultInfo } from './types.ts';

// 지도는 three.js 를 끌어온다. 첫 화면(index 청크)에 싣지 않게 따로 불러온다.
const GraphView = lazy(() => import('../graph/GraphView.tsx'));

// 구독 컨텍스트는 events.ts 에 둔다(GraphView 가 App 을 불러오면 순환이 된다). 여기서도 내보낸다.
export { ChangedEventsContext };
export type { ChangedEvents };

const readRoute = (): Route => parseLocation(location.pathname, location.search, location.hash);

const dirOf = (p: string): string => p.split('/').slice(0, -1).join('/');

export function App() {
  // 화면 테마: 저장값을 <html data-theme data-scheme> 로. 에이전트 모드도 저장값으로 그린다(고르는 UI 만 없다).
  useApplyTheme();
  const [route, setRoute] = useState<Route>(readRoute);
  // 소스는 키로 고정한다. pr 소스는 주소를 읽을 때마다 새 객체라, 그대로 쓰면 의존성이 매번 바뀐다.
  const srcKey = sourceKey(route.src);
  const src = useMemo<Source>(() => parseSource(srcKey) ?? LOCAL, [srcKey]);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  /** getInfo 가 끝났는가(성공·실패 모두). 에이전트 hop 이 main 폴백을 기다리는 데 쓴다. */
  const [infoDone, setInfoDone] = useState(false);
  const [prs, setPrs] = useState<{ number: number; title: string }[]>([]);
  // main 을 못 써 local 로 떨어졌으면 그 까닭(배지 툴팁·짧은 알림).
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  // git 소스에 없는 문서라 폴더로 떨어졌을 때의 알림. 그 폴더 주소에서만 보인다.
  const [missing, setMissing] = useState<{ at: string; text: string } | null>(null);
  const [doc, setDoc] = useState<DocResponse | null>(null);
  // 텍스트 파일 보기(md 밖)의 PR 변경. 키(소스·경로)가 지금 주소와 같을 때만 PR 상세에 넘긴다.
  const [fileChange, setFileChange] = useState<{ key: string; change: DocChange | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<{ dir: string; entries: TreeEntry[] } | null>(null);
  const [reveal, setReveal] = useState<RevealRequest>({ dir: '', tick: 0 });
  const [prefs, setPrefsState] = useState<PanelPrefs>(() => loadPrefs(PANELS));
  const setPrefs = useCallback((p: PanelPrefs) => {
    setPrefsState(p);
    savePrefs(p);
  }, []);
  const [rightOpen, setRightOpen] = useState<boolean>(readRightOpen);
  const [leftOpen, setLeftOpen] = useState<boolean>(readLeftOpen);
  const [searchAll, setSearchAllState] = useState<boolean>(readSearchAll);
  // 검색 상자의 질의. 트리를 거른다(SearchBox 가 search-filter 저장소에 쓴다).
  const searchFilter = useSearchFilter();
  const setSearchAll = useCallback((on: boolean) => {
    writeSearchAll(on);
    setSearchAllState(on);
  }, []);
  // 왼쪽·오른쪽 열 폭: 손잡이를 끌면 따라가고 놓으면 저장, 더블클릭은 기본 폭(useColumnResize.ts).
  const leftResize = useColumnResize('left');
  const rightResize = useColumnResize('right');
  const toggleRight = useCallback(() => {
    setRightOpen((v) => {
      writeRightOpen(!v);
      return !v;
    });
  }, []);
  const toggleLeft = useCallback(() => {
    setLeftOpen((v) => {
      writeLeftOpen(!v);
      return !v;
    });
  }, []);
  // 좁은 폭(≤ 900px)은 양옆 열이 서랍이다. ◧·◨·[·] 는 서랍을 열고 닫고, 넓은 폭의 펴기 저장값은 건드리지 않는다.
  const { narrow, drawer, toggle: toggleDrawer, close: closeDrawer } = useDrawer();
  const onToggleLeft = useCallback(() => (narrow ? toggleDrawer('left') : toggleLeft()), [narrow, toggleDrawer, toggleLeft]);
  const onToggleRight = useCallback(() => (narrow ? toggleDrawer('right') : toggleRight()), [narrow, toggleDrawer, toggleRight]);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // src 를 주지 않으면 지금 소스를 둔다. view 를 주지 않으면 리더(doc)로 간다 — 기존 호출(트리·링크·검색)은 늘 문서를 연다.
  // 지도 인자(깊이·모드·전체)는 GraphTarget 으로 준다. 주소가 상태다.
  const navigate = useCallback<NavigateFn>(
    (path: string, anchor?: string, to?: Source, view?: View | GraphTarget) => {
      history.pushState(null, '', hrefFor(path, anchor, route.agent, to ?? src, view));
      setRoute(readRoute());
    },
    [route.agent, src],
  );

  // 같은 경로를 다른 소스로 연다.
  const pathRef = useRef(route.path);
  pathRef.current = route.path;
  // 지도 보기에서 소스를 바꾸면 지도(깊이·모드·전체)를 그대로 둔다. 지도 데이터는 소스와 무관하다(주 색인).
  const { depth: gDepth, mode: gMode, all: gAll } = route.graph;
  const setSource = useCallback(
    (to: Source) =>
      navigate(pathRef.current, undefined, to, route.view === 'graph' ? { view: 'graph', depth: gDepth, mode: gMode, all: gAll } : undefined),
    [navigate, route.view, gDepth, gMode, gAll],
  );

  // 볼트 정보: 배지·main 폴백·배지 머리. 한 번만 읽는다.
  // main 을 못 쓰는데 주소가 main(기본)이면 local 로 바꿔 연다 — 한 번, 첫 진입에만.
  useEffect(() => {
    let live = true;
    getInfo().then(
      (i) => {
        if (!live) return;
        setInfo(i);
        setInfoDone(true);
        // 임베딩 묶음: 서버가 쓸 수 있다고 알리면 ⚙ 설정·조절 패널에 선택지가 나온다(켜 두었으면 상태를 다시 묻는다).
        embeddingStore.setAvailable(i.embeddings);
        const main = i.sources?.main;
        if (main === undefined || main.available) return;
        const cur = readRoute();
        if (cur.src.kind !== 'main') return;
        setFallbackReason(main.reason ?? 'origin/master 를 읽지 못했다');
        // 지도 주소로 들어왔으면 지도 인자도 그대로 옮긴다.
        const keep = cur.view === 'graph' ? { view: 'graph' as const, ...cur.graph } : undefined;
        history.replaceState(null, '', hrefFor(cur.path, cur.anchor, cur.agent, LOCAL, keep));
        setRoute(readRoute());
      },
      () => {
        // 정보가 없어도 화면은 산다.
        if (live) setInfoDone(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // 선택 상자의 PR: 볼트 레포 PR 만, 한 번만(폴링하지 않는다). 에이전트 모드는 선택 상자가 없다.
  const agentAtStart = useRef(route.agent);
  useEffect(() => {
    if (agentAtStart.current) return;
    let live = true;
    Promise.all([getPrRepos(), getPrs(null, false)]).then(
      ([r, l]) => {
        if (!live || r.vaultRepo === null || l.repo !== r.vaultRepo) return;
        setPrs(l.prs.map((p) => ({ number: p.number, title: p.title })));
      },
      () => {
        // PR 을 못 읽어도 main·local 은 고를 수 있다.
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const expandDir = useCallback((dir: string) => setReveal((r) => ({ dir, tick: r.tick + 1 })), []);

  // 첫 진입·앱 안 이동·뒤로가기 모두 현재 문서의 폴더를 트리에서 펼친다.
  useEffect(() => expandDir(dirOf(route.path)), [route.path, expandDir]);
  // 문서를 고르면(트리·패널 링크·지도 노드) 서랍을 닫는다.
  useEffect(() => closeDrawer(), [route.path, closeDrawer]);

  const toggleView = useCallback(
    () => navigate(route.path, undefined, undefined, route.view === 'graph' ? 'doc' : { view: 'graph', ...route.graph }),
    [navigate, route.path, route.view, route.graph],
  );

  // 검색 상자에서 고르면: 문서 보기는 그 문서를 열고, 지도 보기는 그 문서가 중심인 지도로 간다.
  const onSearchPick = useCallback(
    (p: string) => navigate(p, undefined, undefined, searchTarget({ view: route.view, graph: route.graph }, p)),
    [navigate, route.view, route.graph],
  );

  // 허브 펼침은 세션 상태다(주소에 쓰지 않는다). 깊이·모드·전체 보기는 주소에서 읽고 주소로 바꾼다.
  const [hubs, setHubs] = useState<GraphHubs>('keep');
  // 제목 표시(주요만·전부·없음)는 브라우저에 남는 설정이다.
  const [graphLabels, setGraphLabels] = useState<LabelMode>(readGraphLabels);
  // 카메라 움직임(부드럽게·바로)과 감쇠 강도도 브라우저에 남는 설정이다.
  const [graphMotion, setGraphMotion] = useState<MotionMode>(readGraphMotion);
  const [graphDamping, setGraphDamping] = useState<DampingLevel>(readGraphDamping);
  // 묶음 기준과 자동 회전도 브라우저에 남는 설정이다.
  const [graphCluster, setGraphCluster] = useState<ClusterMode>(readGraphCluster);
  const [graphRotate, setGraphRotate] = useState<RotateMode>(readGraphRotate);
  const [graphOrbit, setGraphOrbit] = useState<OrbitMode>(readGraphOrbit);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const onGraphChange = useCallback(
    (next: Partial<GraphControlValues>) => {
      if (next.hubs !== undefined) setHubs(next.hubs);
      if (next.labels !== undefined) {
        setGraphLabels(next.labels);
        writeGraphLabels(next.labels);
      }
      if (next.motion !== undefined) {
        setGraphMotion(next.motion);
        writeGraphMotion(next.motion);
      }
      if (next.damping !== undefined) {
        setGraphDamping(next.damping);
        writeGraphDamping(next.damping);
      }
      if (next.cluster !== undefined) {
        setGraphCluster(next.cluster);
        writeGraphCluster(next.cluster);
      }
      if (next.rotate !== undefined) {
        setGraphRotate(next.rotate);
        writeGraphRotate(next.rotate);
      }
      if (next.orbit !== undefined) {
        setGraphOrbit(next.orbit);
        writeGraphOrbit(next.orbit);
      }
      if (next.depth === undefined && next.mode === undefined && next.all === undefined) return;
      navigate(route.path, undefined, undefined, {
        view: 'graph',
        depth: next.depth ?? route.graph.depth,
        mode: next.mode ?? route.graph.mode,
        all: next.all ?? route.graph.all,
      });
    },
    [navigate, route.path, route.graph],
  );

  const hash = route.anchor === '' ? '' : `#${route.anchor}`;
  const hop = shouldHopToRaw(route);
  const isHtml = isHtmlPath(route.path);
  // 지도는 md 문서에서만 그린다. 그 밖의 경로는 view=graph 여도 보통 화면(안내문)이다.
  const graphMode = route.view === 'graph' && route.path.endsWith('.md');

  // 에이전트 모드: iframe 안은 읽을 수 없으므로 원본 주소로 건너뛴다.
  // git 소스(main·pr)면 /api/info 를 기다린다 — main 을 못 쓰면 폴백(local)과 같은 소스로, 그리고 git 소스 html 은
  // git 포트 출처(info.gitRawPort)로 건너뛰어야 한다. local 은 바로 건너뛴다.
  const mainUnavailable = info?.sources?.main.available === false;
  const gitRawPort = info?.gitRawPort ?? null;
  const hopWaits = src.kind !== 'local' && !infoDone;
  useEffect(() => {
    if (!hop || hopWaits) return;
    const to = src.kind === 'main' && mainUnavailable ? LOCAL : src;
    location.replace(rawHref(frameOrigin(location.hostname, location.port, to, gitRawPort), route.path, hash, to));
  }, [hop, hopWaits, mainUnavailable, gitRawPort, route.path, hash, src]);

  useEffect(() => {
    const leaf = isFolderPath(route.path) ? `${folderOf(route.path).split('/').pop() ?? ''}/` : (route.path.split('/').pop() ?? '');
    document.title = `${leaf} · knowledge-viewer`;
    setDoc(null);
    setError(null);
    setFolder(null);
    setMissing((m) => (m !== null && m.at === route.path ? m : null));
    let live = true;
    if (isFolderPath(route.path)) {
      // 폴더 주소: README 가 있으면 그 문서로 바꿔 열고, 없으면 목록이 기본 화면이다.
      const dir = folderOf(route.path);
      getTree(dir, src).then(
        (t) => {
          if (!live) return;
          const readme = t.entries.find((e) => e.kind === 'md' && e.name === 'README.md');
          if (readme) {
            // 없는 문서에서 떨어져 왔으면 알림을 README 로 옮겨 단다.
            setMissing((m) => (m !== null && m.at === route.path ? { ...m, at: readme.path } : m));
            history.replaceState(null, '', hrefFor(readme.path, undefined, route.agent, src));
            setRoute(readRoute());
            return;
          }
          setFolder({ dir, entries: t.entries });
        },
        (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
      );
      return () => {
        live = false;
      };
    }
    if (!route.path.endsWith('.md')) return;
    getDoc(route.path, src).then(
      (d) => live && setDoc(d),
      (e: unknown) => {
        if (!live) return;
        // git 소스에 없는 문서: 알림을 달고 그 폴더 목록으로 떨어뜨린다(소스는 그대로).
        if (e instanceof ApiError && e.status === 404 && src.kind !== 'local') {
          const folderPath = `${dirOf(route.path)}/`;
          setMissing({ at: folderPath, text: `이 소스엔 없는 문서: ${route.path}` });
          history.replaceState(null, '', hrefFor(folderPath, undefined, route.agent, src));
          setRoute(readRoute());
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [route.path, route.agent, src]);

  // PR 변경 목록: pr 소스일 때 PR 번호마다 한 번, 읽은 문서의 머리가 받은 목록의 머리와 다를 때만 다시 받는다.
  // 같은 PR 을 이미 받는 중이면(문서가 와서 docHead 만 생긴 경우) 그 요청을 그대로 둔다.
  // live 판정은 요청 객체로 한다: 더 새 요청이 나갔거나 pr 소스를 떠났으면 늦게 온 응답을 버린다.
  const prNumber = src.kind === 'pr' ? src.number : null;
  const docHead = doc !== null && doc.source === srcKey ? doc.head : null;
  const [prChanges, setPrChanges] = useState<{ n: number; data: PrChanges } | null>(null);
  const prChangesRef = useRef(prChanges);
  prChangesRef.current = prChanges;
  // 받다 실패한 PR 과 그 까닭(PR 상세 패널이 보인다).
  const [prChangesError, setPrChangesError] = useState<{ n: number; text: string } | null>(null);
  const prRequest = useRef<{ n: number } | null>(null);
  useEffect(() => {
    if (prNumber === null) {
      prRequest.current = null;
      setPrChanges(null);
      setPrChangesError(null);
      return;
    }
    const have = prChangesRef.current;
    const sameN = have !== null && have.n === prNumber;
    if (sameN && (docHead === null || have.data.headCommit.startsWith(docHead))) return;
    if (!sameN) {
      // 다른 PR 의 표시는 바로 지운다. 같은 PR 의 머리만 바뀌었으면 새 목록이 올 때까지 옛 표시를 둔다.
      if (have !== null) setPrChanges(null);
      if (prRequest.current?.n === prNumber) return;
    }
    const req = { n: prNumber };
    prRequest.current = req;
    getPrChanges(prNumber).then(
      (c) => {
        if (prRequest.current !== req) return;
        prRequest.current = null;
        setPrChanges({ n: prNumber, data: c });
        setPrChangesError(null);
      },
      (e: unknown) => {
        // 변경 목록을 못 읽어도 문서는 읽힌다. 표시만 없다.
        if (prRequest.current !== req) return;
        prRequest.current = null;
        setPrChangesError({ n: prNumber, text: e instanceof Error ? e.message : String(e) });
      },
    );
  }, [prNumber, docHead]);
  const changes = prChanges !== null && prChanges.n === prNumber ? prChanges.data : null;
  const changesError = prChangesError !== null && prChangesError.n === prNumber ? prChangesError.text : null;
  const changed = useMemo(() => (changes === null ? undefined : changedMapOf(changes.files)), [changes]);

  // PR 배지 클릭: 오른쪽 열을 펴고(꺼 둔 PR 상세 패널은 켜고) 그 패널로 스크롤한다. 스크롤은 열이 그려진 뒤.
  const [scrollTick, setScrollTick] = useState(0);
  const onBadgeClick = useCallback(() => {
    if (route.agent) return;
    if (narrow) {
      if (drawer !== 'right') toggleDrawer('right');
    } else if (!rightOpen) {
      setRightOpen(true);
      writeRightOpen(true);
    }
    if (prefs.off.includes('prdetail')) setPrefs({ ...prefs, off: prefs.off.filter((id) => id !== 'prdetail') });
    setScrollTick((t) => t + 1);
  }, [route.agent, narrow, drawer, toggleDrawer, rightOpen, prefs, setPrefs]);
  useEffect(() => {
    if (scrollTick === 0) return;
    document.getElementById('panel-prdetail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [scrollTick]);

  // 파일 감시: 지금 보는 문서가 바뀌면 스크롤을 두고 다시 가져온다.
  // 숨은 탭은 연결을 닫는다 — 같은 출처 HTTP/1.1 연결은 6개뿐이라 탭이 쌓이면 fetch 가 멈춘다.
  // 같은 연결을 지도도 쓴다. 구독자는 컨텍스트(ChangedEventsContext)로 귀를 붙인다.
  const listenersRef = useRef(new Set<(path: string) => void>());
  const events = useMemo<ChangedEvents>(
    () => ({
      subscribe(cb) {
        const set = listenersRef.current;
        set.add(cb);
        return () => {
          set.delete(cb);
        };
      },
    }),
    [],
  );
  // 감시는 워크트리(local) 것이다. git 소스를 보는 동안엔 이벤트를 무시한다(연결은 유지).
  const srcRef = useRef(src);
  srcRef.current = src;
  useEffect(() => {
    if (typeof EventSource === 'undefined' || typeof document === 'undefined') return;
    const refetch = () => {
      const cur = pathRef.current;
      if (srcRef.current.kind !== 'local') return;
      if (!cur.endsWith('.md')) return;
      getDoc(cur, LOCAL).then(
        (d) => {
          if (pathRef.current === cur && srcRef.current.kind === 'local') {
            setDoc(d);
            setError(null);
          }
        },
        () => {
          // 지우는 중이면 옛 화면을 둔다.
        },
      );
    };
    // 서버는 경로를 부호화하지 않고 보낸다. 그대로 비교한다.
    // 리더 재조회가 첫 리스너다. 자식(지도)의 effect 가 먼저 돌아 집합에 먼저 들어가므로, 집합에 넣지 않고 맨 앞에서 부른다.
    // 숨은 탭에서 닫혀 있던 사이의 변경은 경로를 모른다 — 다시 연결할 때 리더를 다시 가져오고 구독자에게는 '' 를 한 번 보낸다.
    const onChanged = (ev: MessageEvent<string>) => {
      if (ev.data === pathRef.current) refetch();
      for (const cb of [...listenersRef.current]) cb(ev.data);
    };
    let es: EventSource | null = null;
    const connect = () => {
      if (es !== null) return;
      es = new EventSource('/api/events');
      es.addEventListener('changed', onChanged as EventListener);
    };
    const disconnect = () => {
      if (es === null) return;
      es.removeEventListener('changed', onChanged as EventListener);
      es.close();
      es = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        disconnect();
      } else if (es === null) {
        connect();
        // 닫혀 있던 사이의 변경은 받지 못했다. 리더를 한 번 다시 가져오고, 구독자(지도)에게도 빈 경로로 한 번 알린다.
        refetch();
        for (const cb of [...listenersRef.current]) cb('');
      }
    };
    if (document.visibilityState !== 'hidden') connect();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      disconnect();
    };
  }, []);

  if (hop) return null;

  // 좁은 폭은 서랍이 열렸을 때만 오른쪽 패널을 그린다(닫힌 서랍이 데이터를 긁지 않게).
  const rightShown = !route.agent && (narrow ? drawer === 'right' : rightOpen);
  const leftShownForBar = narrow ? drawer === 'left' : leftOpen;
  const rightShownForBar = narrow ? drawer === 'right' : rightOpen;
  // 배지 머리: 읽은 문서의 커밋, 없으면 main 머리(pr 은 문서를 읽기 전엔 모른다).
  const head = doc !== null && doc.source === srcKey ? doc.head : src.kind === 'main' ? (info?.sources?.main.head ?? null) : null;
  const mainAvailable = info?.sources?.main.available ?? true;

  return (
    <ChangedEventsContext.Provider value={events}>
      <div
        className={appClassName({ agent: route.agent, leftOpen, rightOpen, drawer })}
        style={{ '--left-w': `${leftResize.width}px`, '--right-w': `${rightResize.width}px` } as React.CSSProperties}
      >
        <TopBar
          path={route.path}
          agent={route.agent}
          view={route.view}
          rightOpen={rightShownForBar}
          leftOpen={leftShownForBar}
          docTitle={doc?.title}
          onExpand={expandDir}
          onNavigate={navigate}
          onSearchPick={onSearchPick}
          onToggleRight={onToggleRight}
          onToggleLeft={onToggleLeft}
          onToggleView={toggleView}
          src={src}
          prs={prs}
          mainAvailable={mainAvailable}
          onSourceChange={setSource}
          info={info}
          head={head}
          fallbackReason={fallbackReason}
          changes={changes}
          changesError={changesError}
          onBadgeClick={onBadgeClick}
          panels={PANELS}
          panelPrefs={prefs}
          onPanelPrefs={setPrefs}
          searchAll={searchAll}
          onSearchAll={setSearchAll}
        />
        <nav className="col col-left" aria-label="볼트 트리">
          <Tree key={srcKey} current={route.path} agent={route.agent} src={src} reveal={reveal} onOpen={navigate} changed={changed} filter={searchFilter} />
        </nav>
        <main className={isHtml ? 'col col-center col-center-frame' : graphMode ? 'col col-center col-center-graph' : 'col col-center'}>
          {!isHtml && missing !== null && missing.at === route.path ? (
            <p className="notice notice-src" role="status">
              {missing.text}
            </p>
          ) : null}
          {isHtml ? (
            // git 소스 html 은 /api/info 의 git 포트를 안 뒤에 연다 — 다른 포트로 먼저 요청을 보내지 않게.
            src.kind !== 'local' && !infoDone ? (
              <p className="notice">불러오는 중…</p>
            ) : (
              <HtmlFrame path={route.path} hash={hash} src={src} gitRawPort={gitRawPort} />
            )
          ) : graphMode && route.agent ? (
            // 에이전트 모드는 캔버스 대신 텍스트 목록이다. 그래프 라이브러리를 불러오지 않는다.
            <GraphListView center={route.path} depth={route.graph.depth} hubs={hubs} all={route.graph.all} src={src} />
          ) : graphMode ? (
            // 지도 청크를 못 받으면 루트 전체가 아니라 가운데 열에만 안내를 남긴다. 주소가 바뀌면 오류를 걷고 다시 그린다.
            <LazyBoundary
              resetKey={`${route.path}\0${route.view}\0${route.graph.mode}`}
              fallback={(message) => <p className="notice">지도를 불러오지 못했다 — 새로고침해 달라: {message}</p>}
            >
              <Suspense fallback={<p className="notice">지도를 불러오는 중…</p>}>
                <GraphView
                  center={route.path}
                  agent={route.agent}
                  navigate={navigate}
                  depth={route.graph.depth}
                  mode={route.graph.mode}
                  all={route.graph.all}
                  hubs={hubs}
                  labels={graphLabels}
                  motion={graphMotion}
                  damping={graphDamping}
                  cluster={graphCluster}
                  rotate={graphRotate}
                  orbit={graphOrbit}
                  legendInCanvas={!rightShown}
                  onStats={setGraphStats}
                />
              </Suspense>
            </LazyBoundary>
          ) : error !== null ? (
            <p className="notice">{error}</p>
          ) : folder !== null ? (
            <FolderView
              dir={folder.dir}
              entries={folder.entries}
              agent={route.agent}
              src={src}
              onNavigate={navigate}
              changed={changed}
              gitRawPort={gitRawPort}
            />
          ) : isFolderPath(route.path) ? (
            <p className="notice">불러오는 중…</p>
          ) : !route.path.endsWith('.md') ? (
            <FileView
              path={route.path}
              src={src}
              agent={route.agent}
              anchor={route.anchor}
              gitRawPort={gitRawPort}
              onChange={(change) => setFileChange({ key: `${srcKey}\0${route.path}`, change })}
            />
          ) : doc === null ? (
            <p className="notice">불러오는 중…</p>
          ) : (
            isTemplatePath(route.path) ? (
              <TemplateView doc={doc} />
            ) : (
              <Reader doc={doc} agent={route.agent} src={src} anchor={route.anchor} onNavigate={navigate} gitRawPort={gitRawPort} />
            )
          )}
        </main>
        <aside className="col col-right" aria-label="보조 패널">
          {/* 에이전트 모드와 접힌 상태는 오른쪽 열이 안 보인다(display: none). 숨은 패널이 데이터를 긁지 않게 아예 그리지 않는다. 켜기·순서는 ⚙ 안이다. */}
          {rightShown && isHtml && (
            <section className="panel">
              <h3>경로</h3>
              <p className="frame-panel-path">{route.path}</p>
              <CopyPathButton path={route.path} />
            </section>
          )}
          {/* 지도 모드는 문서 패널 대신 지도 조절 패널을 그린다. 패널 설정은 두 모드 모두 위에 둔다. */}
          {rightShown && graphMode && (
            <section className="panel">
              <h3>지도 조절</h3>
              <GraphControls
                depth={route.graph.depth}
                mode={route.graph.mode}
                all={route.graph.all}
                hubs={hubs}
                labels={graphLabels}
                motion={graphMotion}
                damping={graphDamping}
                cluster={graphCluster}
                rotate={graphRotate}
                orbit={graphOrbit}
                onChange={onGraphChange}
                legend={graphStats?.kinds ?? []}
                nodes={graphStats?.nodes}
                links={graphStats?.links}
              />
            </section>
          )}
          {rightShown &&
            !graphMode &&
            visiblePanels(PANELS, prefs).map((p) => {
              if (p.needsDoc !== false && doc === null) return null;
              const body = p.render({
                doc,
                path: route.path,
                agent: route.agent,
                src,
                navigate,
                setSource,
                changes,
                change: doc?.change ?? (fileChange?.key === `${srcKey}\0${route.path}` ? fileChange.change : null),
                changesError,
              });
              // 그릴 것이 없다는 패널(예: pr 소스가 아닐 때의 PR 상세)은 제목도 뺀다.
              if (body === null) return null;
              // 접힌 패널은 제목만 그린다 — 본문을 마운트하지 않으니 데이터도 긁지 않는다. 접힘은 설정(localStorage)에 남는다.
              const collapsed = isCollapsed(prefs, p.id);
              return (
                <section key={p.id} id={`panel-${p.id}`} className={collapsed ? 'panel panel-collapsed' : 'panel'}>
                  <PanelHeading panel={p} collapsed={collapsed} onToggle={() => setPrefs(toggleCollapsed(prefs, p.id))} />
                  {collapsed ? null : body}
                </section>
              );
            })}
        </aside>
        {/* 좁은 폭의 서랍 바깥 덮개: 누르면 서랍을 닫는다. 넓은 폭에서는 서랍이 없으니 그리지 않는다. */}
        {drawer !== null && !route.agent ? <div className="drawer-scrim" aria-hidden="true" onClick={closeDrawer} /> : null}
        {/* 열 폭 손잡이: 열 안에 두면 열과 같이 스크롤돼 사라진다. 격자 칸에 겹쳐 두고 가장자리에 붙인다(layout.css). */}
        <div
          className="col-resizer col-resizer-left"
          role="separator"
          aria-orientation="vertical"
          aria-label="왼쪽 패널 폭"
          title="끌어서 폭 조절 · 더블클릭은 기본 폭"
          onPointerDown={leftResize.onPointerDown}
          onDoubleClick={leftResize.onDoubleClick}
        />
        <div
          className="col-resizer col-resizer-right"
          role="separator"
          aria-orientation="vertical"
          aria-label="오른쪽 패널 폭"
          title="끌어서 폭 조절 · 더블클릭은 기본 폭"
          onPointerDown={rightResize.onPointerDown}
          onDoubleClick={rightResize.onDoubleClick}
        />
        {/* 전역 단축키와 ? 도움말. 에이전트 모드는 조절 단추가 없으니 단축키도 걸지 않는다. */}
        {route.agent ? null : (
          <GlobalShortcuts path={route.path} docTitle={doc?.title} onToggleLeft={onToggleLeft} onToggleRight={onToggleRight} onToggleView={toggleView} onSearchAll={setSearchAll} />
        )}
      </div>
    </ChangedEventsContext.Provider>
  );
}
