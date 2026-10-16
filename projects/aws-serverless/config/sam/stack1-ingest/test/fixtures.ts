/**
 * Synthetic JSON fixtures sized around the 256 KiB (262,144-byte) threshold or nested around DynamoDB's
 * 32-level limit. Generated from sizes and depths only — no customer data or samples.
 */
export const KiB = 1024;

export const utf8 = (s: string): number => Buffer.byteLength(s, "utf8");

/** A string of exactly `bytes` UTF-8 bytes, built from `ch` and topped up with ASCII when `ch` is multibyte. */
export const str = (bytes: number, ch = "x"): string =>
  ch.repeat(Math.floor(bytes / utf8(ch))) + "x".repeat(bytes % utf8(ch));

/** JSON text of exactly `bytes` bytes: {"pad":"xxx…"}. */
export const jsonFile = (bytes: number): string => `{"pad":"${str(bytes - utf8('{"pad":""}'))}"}`;

const logRecord = (i: number): Record<string, unknown> => ({
  id: `req-${i}`,
  model: "model-a",
  tokens: { in: 1200 + i, out: 300 },
  cost: 0.0042,
  status: 200,
});

/** JSON text of `inner` wrapped in `n` objects {"a": …} — built as text, so any depth is cheap. */
export const nested = (n: number, inner: string): string => '{"a":'.repeat(n) + inner + "}".repeat(n);

/** JSON texts keyed by case name. */
export const JSON_FIXTURES: Record<string, string> = {
  "255KiB file": jsonFile(255 * KiB),
  "exactly 256KiB file": jsonFile(256 * KiB),
  "256KiB+1 byte file": jsonFile(256 * KiB + 1),
  "one big field + small fields": JSON.stringify({ ...logRecord(1), body: str(300 * KiB) }),
  "nested big value": JSON.stringify({
    id: "req-2",
    request: { model: "model-a", temperature: 0.2, messages: [{ role: "user", content: str(300 * KiB) }] },
    response: { status: 200, usage: { total: 1500 } },
  }),
  "object of small values over 256KiB": JSON.stringify({
    id: "req-3",
    headers: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`h${i}`, "v".repeat(80)])),
  }),
  "three 200KiB fields (guard)": JSON.stringify({ id: "req-4", a: str(200 * KiB), b: str(200 * KiB), c: str(200 * KiB) }),
  "big array": JSON.stringify({ meta: { source: "batch", count: 4000 }, items: Array.from({ length: 4000 }, (_, i) => logRecord(i)) }),
  "multibyte (Korean) strings": JSON.stringify({
    제목: "합성 한글 문서",
    본문: str(270 * KiB, "가"),
    "a/b~c": str(270 * KiB, "나"),
    요약: "짧은 값",
  }),
  "root array over 256KiB": JSON.stringify(Array.from({ length: 4000 }, (_, i) => logRecord(i))),
  "flat object of tiny values over 256KiB": JSON.stringify(Object.fromEntries(Array.from({ length: 30000 }, (_, i) => [`k${i}`, i]))),
  // under 256 KiB as a file (4 bytes per "[1],"), but ~7 bytes per element in DynamoDB → ~420 KB — the guard's reason to run on small files too
  "under 256KiB file, DynamoDB encoding over 400KB": JSON.stringify(Array.from({ length: 60000 }, () => [1])),
  // depth: data = level 1, a scalar leaf is a level too (MAX_NESTING_DEPTH)
  "nested exactly 32 levels": nested(31, "1"),
  "object nesting past 32 levels": `{"id":"deep-1","deep":${nested(40, "1")}}`,
  "array nesting past 32 levels": `{"id":"deep-2","matrix":${"[".repeat(40)}1${"]".repeat(40)}}`,
  // 300 KiB string in an object at level 31: the field rule's ref would sit at level 32 with its scalars at 33
  "300KiB value at level 31": `{"id":"deep-3","deep":${nested(29, JSON.stringify({ body: str(300 * KiB), n: 1 }))}}`,
};

export const NOT_JSON = { csv: "line,temp\nA1,72.5\n", invalid: '{"broken": ' };
