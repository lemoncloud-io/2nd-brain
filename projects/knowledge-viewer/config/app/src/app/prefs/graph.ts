// 지도(그래프 뷰) 설정: 제목 표시 방식, 카메라 움직임(부드럽게·바로)과 감쇠 강도.
import { DEFAULT_LABEL_MODE, isLabelMode } from '../../graph/labels.ts';
import type { LabelMode } from '../../graph/labels.ts';
import { DEFAULT_ROTATE_MODE, isRotateMode } from '../../graph/autorotate.ts';
import type { RotateMode } from '../../graph/autorotate.ts';
import { DEFAULT_CLUSTER_MODE, isClusterMode } from '../../graph/cluster-mode.ts';
import type { ClusterMode } from '../../graph/cluster-mode.ts';
import { DEFAULT_DAMPING_LEVEL, DEFAULT_MOTION_MODE, isDampingLevel, isMotionMode } from '../../graph/motion.ts';
import type { DampingLevel, MotionMode } from '../../graph/motion.ts';
import { DEFAULT_ORBIT_MODE, isOrbitMode } from '../../graph/orbit.ts';
import type { OrbitMode } from '../../graph/orbit.ts';
import { readKey, writeKey } from './storage.ts';

const GRAPH_LABELS_KEY = 'knowledge-viewer.graph-labels';
const GRAPH_MOTION_KEY = 'knowledge-viewer.graph-motion';
const GRAPH_DAMPING_KEY = 'knowledge-viewer.graph-damping';
const GRAPH_CLUSTER_KEY = 'knowledge-viewer.graph-cluster';
const GRAPH_ROTATE_KEY = 'knowledge-viewer.graph-rotate';

/** 지도의 제목 표시(주요만·전부·없음). 기본은 주요만이다. 모르는 값도 기본으로. */
export function readGraphLabels(): LabelMode {
  const v = readKey(GRAPH_LABELS_KEY);
  return isLabelMode(v) ? v : DEFAULT_LABEL_MODE;
}

export function writeGraphLabels(mode: LabelMode): void {
  writeKey(GRAPH_LABELS_KEY, mode);
}

/** 지도 카메라의 움직임(부드럽게·바로). 기본은 부드럽게다. 모르는 값도 기본으로. */
export function readGraphMotion(): MotionMode {
  const v = readKey(GRAPH_MOTION_KEY);
  return isMotionMode(v) ? v : DEFAULT_MOTION_MODE;
}

export function writeGraphMotion(mode: MotionMode): void {
  writeKey(GRAPH_MOTION_KEY, mode);
}

/** 관성의 감쇠 강도(약·중·강). 기본은 중이다. 모르는 값도 기본으로. */
export function readGraphDamping(): DampingLevel {
  const v = readKey(GRAPH_DAMPING_KEY);
  return isDampingLevel(v) ? v : DEFAULT_DAMPING_LEVEL;
}

export function writeGraphDamping(level: DampingLevel): void {
  writeKey(GRAPH_DAMPING_KEY, level);
}

/** 묶음(클러스터 힘) 기준 — 메타(기본)·커뮤니티·없음. 모르는 값도 기본으로. */
export function readGraphCluster(): ClusterMode {
  const v = readKey(GRAPH_CLUSTER_KEY);
  return isClusterMode(v) ? v : DEFAULT_CLUSTER_MODE;
}

export function writeGraphCluster(mode: ClusterMode): void {
  writeKey(GRAPH_CLUSTER_KEY, mode);
}

/** 자동 회전 — 끔(기본)·자동. 모르는 값도 기본으로. */
export function readGraphRotate(): RotateMode {
  const v = readKey(GRAPH_ROTATE_KEY);
  return isRotateMode(v) ? v : DEFAULT_ROTATE_MODE;
}

export function writeGraphRotate(mode: RotateMode): void {
  writeKey(GRAPH_ROTATE_KEY, mode);
}

const GRAPH_EMBEDDING_KEY = 'knowledge-viewer.graph-embedding';

/** 임베딩 묶음 켜기(사용자별 선택). 기본은 꺼짐 — '1' 일 때만 켜짐이다. */
export function readGraphEmbedding(): boolean {
  return readKey(GRAPH_EMBEDDING_KEY) === '1';
}

export function writeGraphEmbedding(on: boolean): void {
  writeKey(GRAPH_EMBEDDING_KEY, on ? '1' : '0');
}

// 궤도 장식(구 경위선, 3D) — 켬(기본)·끔. 모르는 값도 기본으로.
const GRAPH_ORBIT_KEY = 'knowledge-viewer.graph-orbit';

export function readGraphOrbit(): OrbitMode {
  const v = readKey(GRAPH_ORBIT_KEY);
  return isOrbitMode(v) ? v : DEFAULT_ORBIT_MODE;
}

export function writeGraphOrbit(mode: OrbitMode): void {
  writeKey(GRAPH_ORBIT_KEY, mode);
}
