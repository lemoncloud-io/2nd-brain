// 묶음(클러스터 힘) 기준 — 설정·조절 패널이 쓰는 순수 값. 라이브러리를 불러오지 않는다(index 청크에 들어간다).
// 임베딩(embedding)은 사용자별 선택이다: 서버가 쓸 수 있다고 알릴 때만 선택지에 나오고, 군집이 없으면 메타로 조용히 돌아간다.
export type ClusterMode = 'meta' | 'community' | 'embedding' | 'none';
type ClusterOption = { mode: ClusterMode; label: string; title: string };
/** 늘 보이는 세 선택지. 임베딩은 clusterModes(true) 일 때 커뮤니티 뒤에 끼운다. */
export const CLUSTER_MODES: readonly ClusterOption[] = [
  { mode: 'meta', label: '메타', title: '같은 종류·폴더끼리 모은다(서버가 준 cluster 키)' },
  { mode: 'community', label: '커뮤니티', title: '링크로 찾은 커뮤니티(라벨 전파)끼리 모은다' },
  { mode: 'none', label: '없음', title: '묶지 않는다 — 링크·반발만' },
];
export const EMBEDDING_MODE: ClusterOption = {
  mode: 'embedding',
  label: '임베딩',
  title: '본문 임베딩(로컬 Ollama)의 k-means 군집끼리 모은다',
};
/** 묶음 선택지. 서버가 임베딩을 쓸 수 있다고 알렸을 때만(embeddingAvailable) 넷째 항목 `임베딩` 이 들어간다. */
export function clusterModes(embeddingAvailable: boolean): readonly ClusterOption[] {
  return embeddingAvailable ? [CLUSTER_MODES[0]!, CLUSTER_MODES[1]!, EMBEDDING_MODE, CLUSTER_MODES[2]!] : CLUSTER_MODES;
}
export const DEFAULT_CLUSTER_MODE: ClusterMode = 'meta';
export function isClusterMode(v: unknown): v is ClusterMode {
  return v === 'meta' || v === 'community' || v === 'embedding' || v === 'none';
}

/** 실제로 쓰는 묶음 기준. 임베딩을 골랐어도 군집이 없으면(꺼짐·Ollama 없음·색인 전) 메타로 돌아간다. */
export function effectiveClusterMode(mode: ClusterMode, embeddingReady: boolean): ClusterMode {
  return mode === 'embedding' && !embeddingReady ? 'meta' : mode;
}

/**
 * 2D 지도에 묶음 이름(무게중심 글자)을 그리는가. 이름이 뜻이 있는 것은 메타 키(종류:폴더)와 임베딩 군집 이름(`#3 · 제목`)뿐이라
 * **묶음이 메타·임베딩일 때만** 그리고, 제목을 `없음` 으로 두면 묶음 이름도 숨긴다 — 사용자는 "글자 없음" 을 기대한다(2026-10-24 전체 보기 2D 에서 관찰).
 * cluster 는 실제로 쓰는 기준(effectiveClusterMode)이다.
 */
export function showClusterLabels(labelMode: 'major' | 'all' | 'none', cluster: ClusterMode): boolean {
  return labelMode !== 'none' && (cluster === 'meta' || cluster === 'embedding');
}
