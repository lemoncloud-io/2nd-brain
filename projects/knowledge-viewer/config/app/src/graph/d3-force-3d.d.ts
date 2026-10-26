// d3-force-3d 는 타입 선언을 싣지 않는다. 이 앱이 쓰는 두 힘만 최소로 적는다.
declare module 'd3-force-3d' {
  type NodeFn<N, T> = T | ((node: N, i: number, nodes: N[]) => T);

  export interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[], ...args: unknown[]) => void;
  }

  export interface RadialForce<N> extends Force<N> {
    strength(): (node: N, i: number, nodes: N[]) => number;
    strength(strength: NodeFn<N, number>): RadialForce<N>;
    radius(): (node: N, i: number, nodes: N[]) => number;
    radius(radius: NodeFn<N, number>): RadialForce<N>;
  }

  export interface ManyBodyForce<N> extends Force<N> {
    strength(): (node: N, i: number, nodes: N[]) => number;
    strength(strength: NodeFn<N, number>): ManyBodyForce<N>;
    distanceMax(): number;
    distanceMax(d: number): ManyBodyForce<N>;
    distanceMin(distance: number): ManyBodyForce<N>;
    distanceMax(distance: number): ManyBodyForce<N>;
  }

  export function forceRadial<N = object>(radius: NodeFn<N, number>, x?: number, y?: number, z?: number): RadialForce<N>;
  export function forceManyBody<N = object>(): ManyBodyForce<N>;
}
