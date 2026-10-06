import type { DynamoDBRecord } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

/** OpenSearch document body: the DynamoDB row plus `@timestamp` for time-series queries. */
export interface IndexDoc {
  docId: string;
  version: string;
  "@timestamp": string;
  [key: string]: unknown;
}

export type BulkOp =
  | { action: "index"; id: string; doc: IndexDoc }
  | { action: "delete"; id: string };

/** OpenSearch `_id`: one document per (docId, version) — re-indexing the same row is idempotent. */
export function docIdOf(docId: string, version: string): string {
  return `${docId}#${version}`;
}

/** Read a dotted path ("data.ts") from a row; undefined when any segment is missing. */
function pick(row: Record<string, unknown>, path: string): unknown {
  let cur: unknown = row;
  for (const seg of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * `@timestamp` = the row field named by TIMESTAMP_FIELD (default eventTime = S3 upload time),
 * falling back to ingestedAt, then now. Point it at a field inside `data` (e.g. data.ts) when the
 * documents carry their own event time — otherwise a bulk upload of a year of logs lands in one hour.
 */
export function timestampOf(row: Record<string, unknown>, field: string): string {
  for (const candidate of [pick(row, field), row.ingestedAt]) {
    const iso = toIso(candidate);
    if (iso) return iso;
  }
  return new Date().toISOString();
}

// Epoch values below this are read as seconds (anything before 1973 in ms is not a real event time).
const EPOCH_SECONDS_LIMIT = 1e11;

/** Normalises to ISO-8601 so the `date` mapping never sees a format JS accepts but OpenSearch rejects (RFC 2822 etc.). */
function toIso(value: unknown): string | undefined {
  let ms: number;
  if (typeof value === "string") ms = Date.parse(value);
  else if (typeof value === "number" && Number.isFinite(value)) ms = value < EPOCH_SECONDS_LIMIT ? value * 1000 : value;
  else return undefined;
  if (Number.isNaN(ms)) return undefined;
  try {
    return new Date(ms).toISOString();
  } catch {
    return undefined; // RangeError: outside the representable date range → fall through to the next candidate
  }
}

export function recordToOp(record: DynamoDBRecord, timestampField = "eventTime"): BulkOp | undefined {
  const keys = record.dynamodb?.Keys;
  if (!keys) return undefined;
  const { docId, version } = unmarshall(keys as Record<string, AttributeValue>) as { docId: string; version: string };
  const id = docIdOf(docId, version);

  if (record.eventName === "REMOVE") return { action: "delete", id };

  const image = record.dynamodb?.NewImage;
  if (!image) return undefined;
  const row = unmarshall(image as Record<string, AttributeValue>) as Record<string, unknown>;
  return { action: "index", id, doc: { ...row, docId, version, "@timestamp": timestampOf(row, timestampField) } };
}

/** NDJSON body for `_bulk`: one action line (+ one document line for index). */
export function toBulkBody(ops: BulkOp[], index: string): string {
  const lines: string[] = [];
  for (const op of ops) {
    if (op.action === "index") {
      lines.push(JSON.stringify({ index: { _index: index, _id: op.id } }), JSON.stringify(op.doc));
    } else {
      lines.push(JSON.stringify({ delete: { _index: index, _id: op.id } }));
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/**
 * Index mapping: every string is a keyword (exact match / aggregations) with a `.text` sub-field
 * for full-text search; numbers keep their type; `@timestamp` is the time-series axis.
 * date_detection is off: a date-looking string would otherwise become a `date` field and the next
 * non-date value in that field would fail the whole batch (mapper_parsing_exception → DLQ).
 * Known date fields are mapped explicitly below.
 */
export const INDEX_BODY = {
  settings: { index: { number_of_shards: 1 } },
  mappings: {
    date_detection: false,
    dynamic_templates: [
      {
        strings_as_keyword: {
          match_mapping_type: "string",
          mapping: { type: "keyword", ignore_above: 1024, fields: { text: { type: "text" } } },
        },
      },
    ],
    properties: {
      "@timestamp": { type: "date" },
      docId: { type: "keyword" },
      version: { type: "keyword" },
      size: { type: "long" },
      eventTime: { type: "date" },
      ingestedAt: { type: "date" },
    },
  },
} as const;
