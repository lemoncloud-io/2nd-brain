// 구 경위선 궤도 장식(3D) — 노드 뭉치 바깥에 지구본처럼 경선·위선을 희미하게 그린다. 데이터와 무관한 장식이다.
// 순수 모듈이다(three 를 부르지 않는다 — 조절 패널과 함께 index 청크에 들어가도 된다). three 물체로 만드는 층은 engines.ts 의 build3d 다.

export type OrbitMode = 'on' | 'off';
export const ORBIT_MODES: readonly { mode: OrbitMode; label: string }[] = [
  { mode: 'on', label: '켬' },
  { mode: 'off', label: '끔' },
];
export const DEFAULT_ORBIT_MODE: OrbitMode = 'on';
export function isOrbitMode(v: unknown): v is OrbitMode {
  return v === 'on' || v === 'off';
}

/** 경선 수 — 30° 간격. 북극에서 남극까지의 반원이다. */
export const ORBIT_MERIDIANS = 12;
/** 위선 수 — ±60°·±30°·적도. 극 사이를 위선 수 + 1 로 고르게 나눈다. */
export const ORBIT_PARALLELS = 5;
/** 선 하나의 분할 수. */
export const ORBIT_SEGMENTS = 64;
/** 보통 보기의 반지름 배수 — 바깥 홉 껍질(홉 수 × R) 조금 바깥. */
export const ORBIT_NEAR_K = 1.15;
/** 전체 보기의 반지름 배수 — 고립 노드가 앉는 바깥 궤도(forces.ts isolatedRadius 의 3R) 그 자리. */
export const ORBIT_ALL_K = 3;
/** 선의 불투명도. 안개(depthPass)가 뒤쪽을 배경색으로 더 덮는다. */
export const ORBIT_OPACITY = 0.1;

/**
 * 격자 반지름. R 은 홉 껍질 하나의 반지름(forces.ts radiusFor)이다. 보통 보기는 홉 n 인 노드가 n·R 껍질에 앉으므로
 * 가장 바깥 홉(hops, 1 미만이나 NaN 이면 1)의 껍질을 1.15 배로 감싼다. 전체 보기는 홉이 없다 — 고립 노드 궤도 3R 이다.
 */
export function orbitRadius(R: number, all: boolean, hops = 1): number {
  if (all) return ORBIT_ALL_K * R;
  return ORBIT_NEAR_K * (hops >= 1 ? hops : 1) * R;
}

/**
 * 구 격자의 꼭짓점(x,y,z 를 잇달아). LineSegments 용 — 선분마다 두 점이라 점 수는 (경선 + 위선) × 분할 × 2 다.
 * 극은 ±y(three 의 위쪽)다. 경선을 먼저, 위선을 남쪽부터 담는다.
 */
export function orbitGridPositions(radius: number, meridians: number, parallels: number, segments: number): Float32Array {
  const out = new Float32Array((meridians + parallels) * segments * 2 * 3);
  let i = 0;
  const put = (theta: number, phi: number) => {
    const s = Math.sin(theta);
    out[i++] = radius * s * Math.cos(phi);
    out[i++] = radius * Math.cos(theta);
    out[i++] = radius * s * Math.sin(phi);
  };
  // 경선: 경도 φ 고정, 극각 θ 0 → π.
  for (let m = 0; m < meridians; m++) {
    const phi = (m / meridians) * 2 * Math.PI;
    for (let k = 0; k < segments; k++) {
      put((k / segments) * Math.PI, phi);
      put(((k + 1) / segments) * Math.PI, phi);
    }
  }
  // 위선: 극각 θ 고정, 경도 φ 0 → 2π.
  for (let p = 0; p < parallels; p++) {
    const theta = Math.PI - ((p + 1) / (parallels + 1)) * Math.PI;
    for (let k = 0; k < segments; k++) {
      put(theta, (k / segments) * 2 * Math.PI);
      put(theta, ((k + 1) / segments) * 2 * Math.PI);
    }
  }
  return out;
}
