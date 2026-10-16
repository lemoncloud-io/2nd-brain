import { createHash } from "node:crypto";
import type { S3EventRecord } from "aws-lambda";

/** One DynamoDB item per S3 object version. PK = docId (object key), SK = version. */
export interface DocItem {
  docId: string;
  version: string;
  bucket: string;
  size: number;
  etag: string;
  eventTime: string;
  eventName: string;
  /** Parsed JSON body (fields over 256 KiB or nested too deep replaced by `<field>$ref`, see offloadLargeFields); absent for non-JSON, over the parse cap, or a file row with child rows. */
  data?: Record<string, unknown>;
  ingestedAt: string;
  /** File row of a JSON array: number of child rows. */
  count?: number;
  /** Child row: the file row it came from, and its position in the array. */
  parent?: { docId: string; version: string };
  index?: number;
  /** File row whose records a transformer stored: its name (src/transformers/<name>.mts). */
  transformer?: string;
}

/** Version key when bucket versioning is off — one row per key; a re-upload is skipped by the conditional Put (first content wins). */
export const NO_VERSION = "null";

export function recordToItem(record: S3EventRecord, now = new Date()): DocItem {
  // S3 URL-encodes keys in event payloads ("+" for space, %xx for the rest).
  const docId = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  return {
    docId,
    version: record.s3.object.versionId ?? NO_VERSION,
    bucket: record.s3.bucket.name,
    size: record.s3.object.size ?? 0,
    etag: record.s3.object.eTag ?? "",
    eventTime: record.eventTime,
    eventName: record.eventName,
    ingestedAt: now.toISOString(),
  };
}

/** Only ObjectCreated events produce rows; everything else (Removed, Restore, ...) is ignored. */
export function isCreateEvent(record: S3EventRecord): boolean {
  return record.eventName.startsWith("ObjectCreated:");
}

/** Field threshold and `data` budget: a value over this many bytes stays in S3 and the row keeps a ref. */
export const MAX_INLINE_JSON_BYTES = 256 * 1024;

/**
 * Largest JSON object the 256 MB ingest function parses; above it the row is metadata only.
 * Measured locally (Node 22, SDK loaded, 2026-10-02): worst shape — many tiny objects — peaked at 199 MB RSS
 * for 4 MiB and 274 MB for 8 MiB; log-like records peaked at 137 MB for 4 MiB.
 */
export const MAX_PARSE_JSON_BYTES = 4 * 1024 * 1024;

/**
 * Most child rows one JSON array file may fan out to; above it the file stays one row. Measured on the
 * 256 MB function (2026-10-06): 25 concurrent conditional Puts wrote ~134 rows/s, so 5,000 timed out at 30 s
 * after 3,825 rows. A retry re-sends every Put (existing rows just fail the condition), so the whole file
 * must fit in one invocation: 1,000 rows ≈ 7.5 s plus parsing.
 */
export const MAX_CHILD_ROWS = 1000;

/**
 * Transformer path (`raw/<format>/…`) only — generic files keep the two caps above. Over either cap the event
 * fails (retry → DLQ → alarm) instead of the file silently becoming one generic row with none of its records.
 * Measured on the 1,024 MB / 300 s function (2026-10-13):
 * Bytes: a 32.5 MB file of 121 KB records peaked at 269 MB. Rows: 655 rows/s at the slowest (10,000 × 0.9 KB in 15.3 s),
 * so 50,000 rows ≈ 76 s, a quarter of the timeout (50,000 tiny rows took 51 s) — a retry re-sends every Put, so a file
 * that does not finish once never finishes. 0.9 KB records reach the byte cap first (~36,000).
 */
export const MAX_TRANSFORM_BYTES = 32 * 1024 * 1024;
export const MAX_TRANSFORMED_ROWS = 50_000;

/** The guard only cuts a value when the ref saves at least this much — smaller cuts just pile up refs. */
export const MIN_GUARD_SAVING_BYTES = 1024;

/**
 * DynamoDB nests maps and lists "up to 32 levels deep" (AWS "Constraints" › Nested attribute depth); deeper
 * fails the Put with "Nesting Levels have exceeded supported limits". AWS does not say how levels are counted,
 * so `data` is held to the strictest reading: `data` itself is level 1 and a scalar leaf is a level too.
 */
export const MAX_NESTING_DEPTH = 32;

/** An offloaded value at `<field>` is replaced by `<field>$ref` — a new key, so OpenSearch never sees one field as both a value and a ref. */
export const REF_SUFFIX = "$ref";

/** Where an offloaded value lives: the original S3 object version and a JSON Pointer (RFC 6901) into its body. */
export interface S3Ref {
  key: string;
  versionId: string;
  pointer: string;
  /** UTF-8 bytes of JSON.stringify(value). */
  bytes: number;
}

/** The S3 object a document came from; `pointer` is where the document sits in it ("" = the whole body). */
export interface RefSource {
  key: string;
  versionId: string;
  pointer?: string;
}

/** JSON-typed objects up to the parse cap get their body merged into `data`. */
export function shouldInlineJson(size: number, contentType: string | undefined): boolean {
  if (size <= 0 || size > MAX_PARSE_JSON_BYTES) return false;
  return /^application\/(json|.+\+json)\b/i.test(contentType ?? "");
}

export const parseJson = (body: string): { doc: unknown } | undefined => {
  try {
    return { doc: JSON.parse(body) };
  } catch {
    return undefined;
  }
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const utf8 = (s: string): number => Buffer.byteLength(s, "utf8");

export const jsonBytes = (v: unknown): number => utf8(JSON.stringify(v));

/** Whether `v` takes at most `room` levels: a scalar or empty map/list is 1, a map/list 1 + its deepest value. Never looks below `room`. */
const fitsDepth = (v: unknown, room: number): boolean =>
  room >= 1 && (typeof v !== "object" || v === null || (Array.isArray(v) ? v : Object.values(v)).every((x) => fitsDepth(x, room - 1)));

/**
 * DynamoDB size of a value (AWS "Item sizes and formats"): strings UTF-8 bytes; bool/null 1; list/map
 * 3 + 1 per element (+ key bytes); numbers "approximately" 1 + 1 per two significant digits — counted here
 * untrimmed plus one byte of margin, so the estimate never comes out under the real size.
 */
export function ddbSize(v: unknown): number {
  if (typeof v === "string") return utf8(v);
  if (typeof v === "number") return 2 + Math.ceil(String(v).replace(/\D/g, "").length / 2);
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + 1 + ddbSize(x), 3);
  if (isObj(v)) return Object.entries(v).reduce((n, [k, x]) => n + 1 + utf8(k) + ddbSize(x), 3);
  return 1;
}

interface Slot {
  parent: Obj;
  key: string;
  pointer: string;
  original: unknown;
  /** Objects above this slot, root first — a slot under an object that was cut is gone. */
  path: Obj[];
  size: number;
}

/**
 * Row data for one JSON document with every value that would not fit replaced by a ref to the
 * original S3 object (no copy is written — the value is already there). Pure: `doc` is not modified.
 *
 * 0. Depth rule — a value that would take `data` past MAX_NESTING_DEPTH is cut. A ref is a map of
 *    scalars (2 levels), so objects are descended only while their own fields could still take one;
 *    the object below that, and any array, is cut whole. Runs first so the size rules see the cut
 *    row, and again last: a size cut in an object near the bottom puts its ref one level too deep.
 * 1. Field rule — a value whose JSON is over `limit` bytes is cut. Objects are descended first, so
 *    their small fields stay; an object still over `limit` afterwards is cut whole. Arrays and
 *    scalars are cut whole (a ref inside an array would mix types in one OpenSearch field).
 * 2. Guard — while `data` is over `limit` in DynamoDB size: cut arrays/scalars largest first, then
 *    objects largest first, then the whole document. Only cuts that save ≥ MIN_GUARD_SAVING_BYTES.
 *
 * A non-object document becomes { value } (as before); its `value` ref points at the document itself.
 */
export function offloadLargeFields(doc: unknown, src: RefSource, limit = MAX_INLINE_JSON_BYTES): Obj {
  const base = src.pointer ?? "";
  const wrapped = !isObj(doc);
  const original: Obj = wrapped ? { value: doc } : doc;
  const copy = (o: Obj): Obj => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, isObj(v) ? copy(v) : v]));
  const data = copy(original);
  const refs = new Set<unknown>();
  const cutObjects = new Set<Obj>();

  const pointerOf = (parentPointer: string, parent: Obj, k: string): string =>
    wrapped && parent === data ? base : `${parentPointer}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`;
  const refTo = (pointer: string, value: unknown): S3Ref => ({ key: src.key, versionId: src.versionId, pointer, bytes: jsonBytes(value) });
  // ponytail: an existing `<field>$ref` key in the document would be overwritten — the value is still in S3
  const cut = (parent: Obj, k: string, ref: S3Ref): void => {
    if (isObj(parent[k])) cutObjects.add(parent[k] as Obj);
    delete parent[k];
    parent[k + REF_SUFFIX] = ref;
    refs.add(ref);
  };

  // 0. depth rule — `room` = levels left for the values of `o`
  // ponytail: deeper than ~1.6k objects (`copy`) or ~6.5k arrays (JSON.stringify) still overflows the stack → RangeError → DLQ
  //   (measured Node 22, 2026-10-02); catch it in ingest's enrich if such documents show up
  const depthRule = (o: Obj, orig: Obj, pointer: string, room: number): void => {
    for (const k of Object.keys(o)) {
      if (fitsDepth(o[k], room)) continue;
      const p = pointerOf(pointer, o, k);
      if (isObj(o[k]) && room > 2) depthRule(o[k] as Obj, orig[k] as Obj, p, room - 1);
      else cut(o, k, refTo(p, orig[k]));
    }
  };
  depthRule(data, original, base, MAX_NESTING_DEPTH - 1);

  // 1. field rule (post-order)
  // ponytail: re-serialises each descended object, O(size × depth of big objects); memoise if deep documents show up
  const fieldRule = (o: Obj, orig: Obj, pointer: string): void => {
    for (const k of Object.keys(o)) {
      if (refs.has(o[k]) || jsonBytes(orig[k]) <= limit) continue;
      const p = pointerOf(pointer, o, k);
      if (isObj(o[k])) fieldRule(o[k] as Obj, orig[k] as Obj, p);
      if (!isObj(o[k]) || jsonBytes(o[k]) > limit) cut(o, k, refTo(p, orig[k]));
    }
  };
  fieldRule(data, original, base);

  // 2. guard
  const slots = (o: Obj, orig: Obj, pointer: string, path: Obj[]): Slot[] =>
    Object.keys(o)
      .filter((k) => !refs.has(o[k]))
      .flatMap((k) => {
        const p = pointerOf(pointer, o, k);
        const here = { parent: o, key: k, pointer: p, original: orig[k], path, size: ddbSize(o[k]) };
        return isObj(o[k]) ? [here, ...slots(o[k] as Obj, orig[k] as Obj, p, [...path, o[k] as Obj])] : [here];
      });
  const total = { bytes: ddbSize(data) };
  const shrink = (candidates: Slot[]): void => {
    const largestFirst = [...candidates].sort((a, b) => b.size - a.size || (a.pointer < b.pointer ? -1 : 1));
    for (const s of largestFirst) {
      if (total.bytes <= limit || s.size < MIN_GUARD_SAVING_BYTES) return;
      if (s.path.some((o) => cutObjects.has(o))) continue;
      const ref = refTo(s.pointer, s.original);
      const saving = s.size - ddbSize(ref) - utf8(REF_SUFFIX);
      if (saving < MIN_GUARD_SAVING_BYTES) continue;
      cut(s.parent, s.key, ref);
      total.bytes -= saving;
    }
  };
  if (total.bytes > limit) shrink(slots(data, original, base, []).filter((s) => !isObj(s.parent[s.key])));
  if (total.bytes > limit) shrink(slots(data, original, base, []).filter((s) => isObj(s.parent[s.key])));
  if (total.bytes > limit) return { [(wrapped ? "value" : "") + REF_SUFFIX]: refTo(base, doc) };
  depthRule(data, original, base, MAX_NESTING_DEPTH - 1);
  return data;
}

/**
 * A JSON array file becomes one child row per element, linked to the file row by `parent` + `index`
 * (key: docId `<key>#<index>`, same version); each element's data follows offloadLargeFields with
 * pointers starting at `/<index>`. Undefined when `doc` is not an array or has more than MAX_CHILD_ROWS.
 * Each child gets its own partition key: under the file's docId they shared one partition, and 34 records
 * of 120 KB were throttled on every retry (measured 2026-10-06).
 */
export function childRows(file: DocItem, doc: unknown): DocItem[] | undefined {
  if (!Array.isArray(doc) || doc.length > MAX_CHILD_ROWS) return undefined;
  const parent = { docId: file.docId, version: file.version };
  return doc.map((record, index) => ({
    ...file,
    docId: `${file.docId}#${index}`,
    size: jsonBytes(record),
    parent,
    index,
    data: offloadLargeFields(record, { key: file.docId, versionId: file.version, pointer: `/${index}` }),
  }));
}

/** What a transformer (src/transformers/<name>.mts, picked by the S3 key `raw/<name>/…`) returns per record: the JSON, where it sits in the file, its size, and its own time. */
export interface Transformed {
  data: Record<string, unknown>;
  /** JSON Pointer into the original body ("/records/3") — becomes `raw$ref.pointer`. */
  pointer: string;
  /** UTF-8 bytes of the original record. */
  bytes: number;
  /** The record's own time (ISO); retention counts from it, else from ingestion. */
  time?: string;
}

/** A row built from transformer output — no bucket/etag/eventName copies, to stay under 1 KB (one write unit). */
export interface TransformedRow {
  docId: string;
  version: string;
  size: number;
  ingestedAt: string;
  /** The transformer that made the row — stack 2 picks the index and mapping by it (mappings/<name>.ts). */
  transformer: string;
  /** DynamoDB TTL attribute (epoch seconds); only when a retention is set. */
  ttl?: number;
  data: Record<string, unknown>;
}

/**
 * Row key shared by every transformer (10-12 meeting): `<hash(S3 key)>.<NNN>.json`, NNN = the record's
 * position in the file. Same file → same keys, so a retried event is skipped by the conditional Put;
 * a new upload of the same key is a new S3 version (sort key) and gets new rows.
 */
export const rowKey = (s3Key: string, index: number): string =>
  `${createHash("sha256").update(s3Key).digest("hex").slice(0, 16)}.${String(index).padStart(3, "0")}.json`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Transformer output → rows. Throws above MAX_TRANSFORMED_ROWS (the event fails, never a silent generic row). `ttlDays` 0 = keep forever. */
export function transformedRows(file: DocItem, items: Transformed[], ttlDays: number, transformer: string): TransformedRow[] {
  if (items.length > MAX_TRANSFORMED_ROWS) throw new Error(`${file.docId}: ${items.length} records over MAX_TRANSFORMED_ROWS ${MAX_TRANSFORMED_ROWS} — split the file`);
  return items.map(({ data, pointer, bytes, time }, index) => {
    const ref: S3Ref = { key: file.docId, versionId: file.version, pointer, bytes };
    const from = Date.parse(time ?? "") || Date.parse(file.ingestedAt);
    return {
      docId: rowKey(file.docId, index),
      version: file.version,
      size: bytes,
      ingestedAt: file.ingestedAt,
      transformer,
      ...(ttlDays > 0 ? { ttl: Math.floor((from + ttlDays * DAY_MS) / 1000) } : {}),
      data: { ...data, [`raw${REF_SUFFIX}`]: ref },
    };
  });
}

/** Where the Athena option reads from (skill aws-athena): `sidecar/<format>/<YYYY-MM-DD>/<file>.<ext>.jsonl`. */
export const SIDECAR_PREFIX = "sidecar/";

/**
 * `raw/<format>/<rest>` → `sidecar/<format>/<rest>.jsonl` — the whole file name kept, so `a.csv` and `a.json` in one
 * folder get two sidecars instead of one overwriting the other. The date folder is the raw path's, so the uploader's
 * `raw/<format>/<YYYY-MM-DD>/` is the Athena partition. Same raw key → same sidecar key, so a retry or a re-upload
 * overwrites it; ingest.ts writes it only for the key's latest version.
 */
export const sidecarKey = (rawKey: string): string => `${SIDECAR_PREFIX}${rawKey.slice("raw/".length)}.jsonl`;

/**
 * One NDJSON line per transformer row: the record's fields, `ingestedAt`, `raw$ref`, and the same ref as
 * `$`-free keys (`rawKey`/`rawVersionId`/`rawPointer`) — Athena's JSON SerDe cannot read a column with `$`.
 */
export const sidecarBody = (rows: TransformedRow[]): string =>
  rows
    .map(({ data, ingestedAt }) => {
      const ref = data[`raw${REF_SUFFIX}`] as S3Ref;
      return JSON.stringify({ ...data, ingestedAt, rawKey: ref.key, rawVersionId: ref.versionId, rawPointer: ref.pointer });
    })
    .join("\n") + "\n";
