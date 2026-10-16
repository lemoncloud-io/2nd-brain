/**
 * Transformer (mts) for Cloudflare AI Gateway logs: file body in, one JSON per LLM call out, holding only
 * the fields the aggregations need (model, tokens, latency, status, time). Free text — instructions,
 * input, output, reasoning, JSON schemas — is not returned; it stays in the S3 original.
 * Field list: chosen for per-model token, cost, latency and status aggregations.
 *
 * A transformer only reads the file. Row keys, the S3 ref and retention are the ingest's job (transform.ts).
 * S3 path: raw/llm-gateway-log/<date>/<file>. Run locally: `npx tsx scripts/run-transform.mts llm-gateway-log <file>`.
 */
import type { Transformed } from "../transform.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((cur, k) => (isObj(cur) ? cur[k] : undefined), o);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const iso = (v: unknown): string | undefined => {
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
};
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** A Gateway API export: { source: { gateway }, records: [...] }. Undefined for any other shape. */
export const exportRecords = (doc: unknown): { gateway?: string; records: unknown[] } | undefined =>
  isObj(doc) && Array.isArray(doc.records) ? { gateway: str(get(doc, "source.gateway")), records: doc.records } : undefined;

/** The chosen fields of one log record; fields missing from the record are left out. */
export const projectRecord = (r: unknown, gateway: string | undefined): Obj => {
  const createdAt = iso(get(r, "created_at"));
  const fields: Obj = {
    responseId: str(get(r, "response.id")),
    createdAt,
    dayKst: createdAt && new Date(Date.parse(createdAt) + KST_OFFSET_MS).toISOString().slice(0, 10),
    gateway,
    provider: str(get(r, "provider")),
    model: str(get(r, "model")),
    statusCode: num(get(r, "status_code")),
    success: bool(get(r, "success")),
    responseStatus: str(get(r, "response.status")),
    errorCode: str(get(r, "response.error.code")),
    incompleteReason: str(get(r, "response.incomplete_details.reason")),
    durationMs: num(get(r, "duration_ms")),
    cached: bool(get(r, "cached")),
    tokensIn: num(get(r, "tokens_in")),
    cachedTokens: num(get(r, "response.usage.input_tokens_details.cached_tokens")),
    cacheWriteTokens: num(get(r, "response.usage.input_tokens_details.cache_write_tokens")),
    tokensOut: num(get(r, "tokens_out")),
    reasoningTokens: num(get(r, "response.usage.output_tokens_details.reasoning_tokens")),
    totalTokens: num(get(r, "response.usage.total_tokens")),
    webSearchRequests: num(get(r, "response.tool_usage.web_search.num_requests")),
    imageGenTokens: num(get(r, "response.tool_usage.image_gen.total_tokens")),
    reasoningEffort: str(get(r, "request.reasoning.effort")),
    maxOutputTokens: num(get(r, "request.max_output_tokens")),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
};

/** File body → one JSON per record, in file order. Undefined when the body is not a Gateway export. */
// ponytail: export JSON only — Logpush (gzip NDJSON, encrypted bodies) is added once a real file is in hand
export const transform = (body: string): Transformed[] | undefined => {
  const parsed = exportRecords((() => {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  })());
  return parsed?.records.map((record, index) => {
    const data = projectRecord(record, parsed.gateway);
    return { data, pointer: `/records/${index}`, bytes: Buffer.byteLength(JSON.stringify(record)), time: data.createdAt as string | undefined };
  });
};
