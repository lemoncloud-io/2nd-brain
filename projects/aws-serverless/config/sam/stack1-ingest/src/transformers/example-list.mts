/**
 * Example transformer — copy this file to start a new format. Reads { "items": [{ "id", "time", "value", ... }] }
 * and returns one JSON per item with only id/time/value. Synthetic format, no customer data; S3 path
 * raw/example-list/<date>/<file>, index mapping in stack2-index/src/mappings/example-list.ts.
 *
 * Contract (every transformer): export `transform(body)` → one { data, pointer, bytes, time } per record, or
 * undefined when the body is not this format (the ingest then stores the file the generic way).
 * Row keys, raw$ref, TTL and the index are the ingest's job — do not add them here.
 * Run locally: `npx tsx scripts/run-transform.mts example-list <file>`.
 */
import type { Transformed } from "../transform.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const transform = (body: string): Transformed[] | undefined => {
  const doc = (() => {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  })();
  if (!isObj(doc) || !Array.isArray(doc.items)) return undefined;
  return doc.items.map((item, index) => {
    const it = isObj(item) ? item : {};
    const time = typeof it.time === "string" && !Number.isNaN(Date.parse(it.time)) ? new Date(it.time).toISOString() : undefined;
    const data = Object.fromEntries(
      Object.entries({ id: it.id, time, value: it.value }).filter(([, v]) => v !== undefined),
    );
    return { data, pointer: `/items/${index}`, bytes: Buffer.byteLength(JSON.stringify(item)), time };
  });
};
