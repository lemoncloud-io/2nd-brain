// 시험용 localStorage. Map 으로 받거나, 던지는 저장소로 바꿔 끼운다. 끝나면 원래대로.
export function withStorage<T>(store: Map<string, string>, fn: () => T): T {
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    return fn();
  } finally {
    g.localStorage = prev;
  }
}

export function withThrowingStorage<T>(fn: () => T): T {
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  try {
    return fn();
  } finally {
    g.localStorage = prev;
  }
}
