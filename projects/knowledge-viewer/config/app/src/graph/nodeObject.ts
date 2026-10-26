// 노드 하나의 three.js 물체. 홉별 투명도는 nodeOpacity 로 안 되므로 구를 직접 만든다.
// 중심: 흰 고리. 허브: 와이어프레임 고리. 펼칠 수 있는(잘린) 노드: 옆에 작은 `+`.
// 제목은 주요 노드(labels.ts)에 빌드 때 붙이고, 그 밖은 처음 필요할 때(호버·겹침 제거를 통과할 때) 붙인다.
// 제목 스프라이트(캔버스 텍스처)는 비싸다 — 전체 보기(노드 2천여 개)의 병목이므로 필요할 때만 만든다.
// 구·고리의 지오메트리와 재질은 모듈에 두고 모든 노드가 같이 쓴다(페이지가 살아 있는 동안 둔다). 라이브러리는 노드를 지울 때
// dispose 를 부르지만, three.js 는 dispose 된 지오메트리·재질·텍스처도 다음에 그릴 때 다시 올린다(라이브러리의 공용 재질도 같다).
// 깊이감(depth.ts): 매 프레임 depthPass 가 물체의 scale 과 구·고리의 재질(불투명도 단계)을 바꾼다. 재질을 나눠 쓰려고
// 불투명도는 DEPTH_LEVELS 단계로 양자화한다. 노드 재질은 안개를 받지 않는다(fog: false) — 뒤로 갈수록 흐려지는 것은
// 불투명도가 맡고, 안개는 간선이 맡는다. 둘을 겹치면 뒤 노드가 통째로 사라진다.
import { DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, RingGeometry, SphereGeometry, Sprite } from 'three';
import SpriteText from 'three-spritetext';

import type { GraphNode } from '../app/types.ts';
import { opacityAt } from './depth.ts';
import { KIND_OFF_ALPHA } from './kind-highlight.ts';
import { opacityOf, radiusOf } from './scale.ts';

/** 제목 스프라이트의 높이를 그래프 좌표 h 로 맞춘다(가로는 글자 비율대로). 노드 위에 붙도록 자리도 옮긴다. */
export function sizeLabel(label: SpriteText, n: GraphNode, h: number): void {
  const aspect = label.scale.y === 0 ? 1 : label.scale.x / label.scale.y;
  label.scale.set(aspect * h, h, 1);
  label.position.y = radiusOf(n.in + n.out) + 0.6 * h + 1;
}

/** 제목 글자. 캔버스(--graph-bg)가 늘 어두우므로 밝은 색 하나다. */
export const LABEL_COLOR = '#e4eaf0';
export const LABEL_FONT = "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
/** 제목의 화면 글자 크기(px). 2D 는 이 크기로 쓰고, 3D 는 depthPass 가 프레임마다 카메라 거리에 맞춰 스프라이트를 이 크기(× 깊이 배수)로 맞춘다. */
export const LABEL_PX = 12;
/** 3D 제목 스프라이트를 만들 때의 높이(그래프 좌표). 첫 프레임에 depthPass 가 화면 크기 기준으로 다시 잰다. */
export const LABEL_HEIGHT = 4;

/** 물체에 적어 두는 노드 모양. depthPass 가 매 프레임 읽고 쓴다. */
export type NodeLook = {
  node: GraphNode;
  sphere: Mesh;
  ring: Mesh | null;
  color: string;
  /** 고리 색('#ffffff' 는 중심). */
  ringColor: string;
  ringWire: boolean;
  /** 지난 프레임에 적용한 불투명도 단계(양자화한 t). 같으면 재질을 바꾸지 않는다. */
  level: number;
  /** 지난 프레임에 범례 종류 강조로 흐리게 그렸는가(kind-highlight.ts). */
  dim: boolean;
};

export const lookOf = (obj: Group): NodeLook | undefined => obj.userData.look as NodeLook | undefined;

/** 노드 물체에 제목 스프라이트를 붙인다. 처음 필요할 때 한 번만 부른다. */
export function addLabel(obj: Group, n: GraphNode): SpriteText {
  const label = new SpriteText(n.title, LABEL_HEIGHT, LABEL_COLOR);
  label.fontFace = LABEL_FONT;
  label.material.fog = false;
  label.position.set(0, radiusOf(n.in + n.out) + 5, 0);
  obj.add(label);
  return label;
}

// 반지름은 0.1 단위로 맞춰 같은 지오메트리를 나눠 쓴다(눈으로는 차이가 없다).
const round = (r: number): number => Math.round(r * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const spheres = new Map<number, SphereGeometry>();
const rings = new Map<string, RingGeometry>();
const lamberts = new Map<string, MeshLambertMaterial>();
const basics = new Map<string, MeshBasicMaterial>();

function sphereOf(r: number): SphereGeometry {
  let g = spheres.get(r);
  if (g === undefined) {
    g = new SphereGeometry(r, 16, 12);
    spheres.set(r, g);
  }
  return g;
}

function ringOf(inner: number, outer: number, segments: number): RingGeometry {
  const key = `${inner}|${outer}|${segments}`;
  let g = rings.get(key);
  if (g === undefined) {
    g = new RingGeometry(inner, outer, segments);
    rings.set(key, g);
  }
  return g;
}

function lambertOf(color: string, opacity: number): MeshLambertMaterial {
  const key = `${color}|${opacity}`;
  let m = lamberts.get(key);
  if (m === undefined) {
    m = new MeshLambertMaterial({ color, transparent: true, opacity, fog: false });
    lamberts.set(key, m);
  }
  return m;
}

function basicOf(color: string, wireframe: boolean, opacity: number): MeshBasicMaterial {
  const key = `${color}|${wireframe}|${opacity}`;
  let m = basics.get(key);
  if (m === undefined) {
    m = new MeshBasicMaterial({ color, wireframe, side: DoubleSide, transparent: true, opacity, fog: false });
    basics.set(key, m);
  }
  return m;
}

// `+` 배지. 글자 스프라이트 하나를 만들어 두고 그 재질(텍스처)을 모든 배지가 같이 쓴다.
let plusProto: SpriteText | null = null;

function plusBadge(r: number): Sprite {
  if (plusProto === null) {
    plusProto = new SpriteText('+', 6, LABEL_COLOR);
    plusProto.material.fog = false;
  }
  const s = new Sprite(plusProto.material);
  s.scale.copy(plusProto.scale);
  // 구의 오른쪽 위. 고리(r+2) 바깥에 둔다.
  s.position.set(r + 3.5, r + 2, 0);
  return s;
}

/**
 * 깊이 단계 t(양자화한 값)에 맞는 재질로 바꾼다. dim 이면(범례 종류 강조에서 다른 종류) 불투명도에 KIND_OFF_ALPHA 를 곱한다.
 * 단계와 dim 이 같으면 아무것도 하지 않는다 — 재질은 색·불투명도별로 나눠 쓰므로 바꿔도 포인터 교체뿐이다.
 */
export function applyDepth(look: NodeLook, t: number, dim = false): void {
  if (look.level === t && look.dim === dim) return;
  look.level = t;
  look.dim = dim;
  const f = opacityAt(t) * (dim ? KIND_OFF_ALPHA : 1);
  look.sphere.material = lambertOf(look.color, round2(opacityOf(look.node.hop) * f));
  if (look.ring !== null) look.ring.material = basicOf(look.ringColor, look.ringWire, round2(f));
}

/**
 * 노드 물체와, 제목을 바로 붙이는 노드(주요 노드)면 그 제목. 그 밖은 label 이 null 이다.
 * plus 는 "펼칠 수 있다"(잘렸고 아직 펼치지 않았다)이다 — 참이면 `+` 배지를 붙인다.
 */
export function buildNodeObject(
  n: GraphNode,
  color: string,
  isCenter: boolean,
  plus = false,
  withLabel = isCenter || n.hub,
): { obj: Group; label: SpriteText | null } {
  const r = round(radiusOf(n.in + n.out));
  const obj = new Group();
  const sphere = new Mesh(sphereOf(r), lambertOf(color, opacityOf(n.hop)));
  obj.add(sphere);
  let ring: Mesh | null = null;
  const ringColor = isCenter ? '#ffffff' : color;
  const ringWire = !isCenter;
  if (isCenter) {
    ring = new Mesh(ringOf(r + 1.5, r + 2.5, 48), basicOf(ringColor, false, 1));
  } else if (n.hub) {
    ring = new Mesh(ringOf(r + 1, r + 2, 24), basicOf(ringColor, true, 1));
  }
  if (ring !== null) obj.add(ring);
  if (plus) obj.add(plusBadge(r));
  const look: NodeLook = { node: n, sphere, ring, color, ringColor, ringWire, level: 0, dim: false };
  obj.userData.look = look;
  return { obj, label: withLabel ? addLabel(obj, n) : null };
}
