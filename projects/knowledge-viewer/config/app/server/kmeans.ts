// 임베딩 묶음의 군집(순수). 코사인 k-means — 벡터를 단위 길이로 맞춘 뒤 내적으로 잰다. 디스크·네트워크를 만지지 않는다.
// 같은 입력이면 같은 답이다: 초기값은 고정 시드의 k-means++, 동점은 앞 번호가 이긴다.

/** 군집 수. 설계서 § 2차 소스 `embedding` 의 k = √(n/2) 를 반올림하고 2 보다 작게 두지 않는다. 문서가 k 보다 적으면 문서 수. */
export function kFor(n: number): number {
  if (n <= 0) return 0;
  return Math.min(n, Math.max(2, Math.round(Math.sqrt(n / 2))));
}

export const KMEANS_ITERATIONS = 20;
export const KMEANS_SEED = 0x6b76;

/** mulberry32 — 작고 결정적인 의사 난수. [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 단위 길이로 맞춘 사본. 길이 0 벡터는 0 그대로 둔다(모든 중심과 유사도 0). */
export function normalize(v: ArrayLike<number>): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) s += v[i]! * v[i]!;
  const out = new Float32Array(v.length);
  const len = Math.sqrt(s);
  if (len === 0) return out;
  for (let i = 0; i < v.length; i += 1) out[i] = v[i]! / len;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!;
  return s;
}

export type KMeansResult = { k: number; assign: number[]; iterations: number };

/**
 * 코사인 k-means. vectors 는 같은 차원이어야 한다. 초기 중심은 k-means++(거리 = 1 − 코사인, 고정 시드),
 * 반복은 최대 `iterations` 번이고 배정이 그대로면 멈춘다. 빈 군집은 자기 중심에서 가장 먼 점(그 점이 혼자인 군집이 아닌 것)으로
 * 다시 심는다 — 결과 군집은 비지 않는다(n ≥ k 일 때).
 */
export function kmeans(vectors: readonly ArrayLike<number>[], k: number, opts: { iterations?: number; seed?: number } = {}): KMeansResult {
  const n = vectors.length;
  const kk = Math.min(k, n);
  if (kk <= 0) return { k: 0, assign: [], iterations: 0 };
  const xs = vectors.map(normalize);
  const dim = xs[0]!.length;
  const rand = seededRandom(opts.seed ?? KMEANS_SEED);

  // k-means++: 첫 중심은 난수 하나, 다음부터는 가장 가까운 중심과의 거리 제곱에 비례해 고른다.
  const centers: Float32Array[] = [Float32Array.from(xs[Math.floor(rand() * n)]!)];
  const near = xs.map((x) => 1 - dot(x, centers[0]!));
  while (centers.length < kk) {
    let total = 0;
    for (const d of near) total += d * d;
    let pick = -1;
    if (total > 0) {
      let r = rand() * total;
      for (let i = 0; i < n; i += 1) {
        r -= near[i]! * near[i]!;
        if (r <= 0) {
          pick = i;
          break;
        }
      }
      if (pick < 0) pick = n - 1;
    } else {
      // 남은 점이 모두 중심과 같다 — 아직 중심이 아닌 첫 점을 쓴다(같은 벡터 여러 개).
      pick = centers.length;
    }
    const c = Float32Array.from(xs[pick]!);
    centers.push(c);
    for (let i = 0; i < n; i += 1) near[i] = Math.min(near[i]!, 1 - dot(xs[i]!, c));
  }

  const assign = new Array<number>(n).fill(-1);
  let it = 0;
  for (; it < (opts.iterations ?? KMEANS_ITERATIONS); it += 1) {
    let moved = 0;
    for (let i = 0; i < n; i += 1) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < kk; c += 1) {
        const s = dot(xs[i]!, centers[c]!);
        if (s > bestSim) {
          bestSim = s;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved += 1;
      }
    }
    reseedEmpty(xs, assign, centers, kk);
    // 중심 = 구성원 합을 단위 길이로(구면 k-means).
    for (let c = 0; c < kk; c += 1) {
      const sum = new Float32Array(dim);
      for (let i = 0; i < n; i += 1) {
        if (assign[i] !== c) continue;
        const x = xs[i]!;
        for (let d = 0; d < dim; d += 1) sum[d]! += x[d]!;
      }
      centers[c] = normalize(sum);
    }
    if (moved === 0) {
      it += 1;
      break;
    }
  }
  return { k: kk, assign, iterations: it };
}

/** 빈 군집마다, 구성원이 둘 이상인 군집에서 자기 중심과 가장 먼 점을 옮겨 심는다. */
function reseedEmpty(xs: Float32Array[], assign: number[], centers: Float32Array[], k: number): void {
  const size = new Array<number>(k).fill(0);
  for (const a of assign) size[a]! += 1;
  for (let c = 0; c < k; c += 1) {
    if (size[c]! > 0) continue;
    let far = -1;
    let farSim = Infinity;
    for (let i = 0; i < xs.length; i += 1) {
      const a = assign[i]!;
      if (size[a]! < 2) continue;
      const s = dot(xs[i]!, centers[a]!);
      if (s < farSim) {
        farSim = s;
        far = i;
      }
    }
    if (far < 0) return;
    size[assign[far]!]! -= 1;
    assign[far] = c;
    size[c] = 1;
    centers[c] = Float32Array.from(xs[far]!);
  }
}
