import type { S3Event } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { childRows, isCreateEvent, MAX_TRANSFORM_BYTES, offloadLargeFields, parseJson, recordToItem, shouldInlineJson, SIDECAR_PREFIX, sidecarBody, sidecarKey, transformedRows, type DocItem, type TransformedRow } from "./transform.js";
import { loadTransformer, transformerName } from "./route.js";

const TABLE_NAME = process.env.TABLE_NAME ?? "";
/** Rows from a transformer expire this many days after the record's time (0 = never). */
const TTL_DAYS = Number(process.env.TTL_DAYS ?? "0");
/** Athena option: also write each transformed file as NDJSON under sidecar/ (off unless the company chose Athena). */
const SIDECAR = process.env.SIDECAR_ENABLED === "true";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

/**
 * S3 ObjectCreated → one DynamoDB row per (docId, version), plus one child row per record for a JSON array.
 * Idempotent: every Put is conditional on the key not existing, so a retry of an already-written
 * row is a no-op (counted as skipped) and never bumps ingestedAt or emits a MODIFY. Child rows go
 * first and the file row last, so an existing file row means all its children are in.
 * Throws on any other failure so Lambda retries and, after that, routes the event to the DLQ.
 */
export const handler = async (event: S3Event): Promise<{ written: number; skipped: number }> => {
  if (!TABLE_NAME) throw new Error("TABLE_NAME env var missing");
  if (!(TTL_DAYS >= 0)) throw new Error(`bad TTL_DAYS ${process.env.TTL_DAYS}`);
  let written = 0;
  let skipped = 0;
  for (const record of event.Records) {
    const item = recordToItem(record);
    // our own sidecar writes fire this function too — no row for them
    if (!isCreateEvent(record) || (SIDECAR && item.docId.startsWith(SIDECAR_PREFIX))) {
      skipped++;
      continue;
    }
    const children = await enrich(item);
    for (const batch of chunks(children, CHILD_PUT_CONCURRENCY)) {
      const results = await Promise.all(batch.map(putOnce));
      written += results.filter(Boolean).length;
      skipped += results.filter((r) => !r).length;
    }
    // before the file row: a retry after a failed write rewrites it (the file row marks "all done")
    if (SIDECAR && item.transformer) await writeSidecar(item, children as TransformedRow[]);
    if (!(await putOnce(item))) {
      skipped++;
      console.log(JSON.stringify({ msg: "already-ingested", docId: item.docId, version: item.version }));
      continue;
    }
    written++;
    console.log(JSON.stringify({ msg: "ingested", docId: item.docId, version: item.version, size: item.size, count: item.count }));
  }
  return { written, skipped };
};

const CHILD_PUT_CONCURRENCY = 25;

/** No ACL argument: the Lambda boundary denies s3:PutObjectAcl. */
const writeSidecar = async (file: DocItem, rows: TransformedRow[]): Promise<void> => {
  await s3.send(new PutObjectCommand({ Bucket: file.bucket, Key: sidecarKey(file.docId), Body: sidecarBody(rows), ContentType: "application/x-ndjson" }));
};

const chunks = <T>(rows: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, i * n + n));

/**
 * Conditional Put; false when the row is already there. Matched by error name, not `instanceof`: the SDK's
 * instanceof compares class names, and the minified bundle names every DynamoDB exception class `t`, so a
 * throttling error passed as "already there" and the row was silently dropped (measured 2026-10-06).
 */
const putOnce = async (row: DocItem | TransformedRow): Promise<boolean> => {
  try {
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: row, ConditionExpression: "attribute_not_exists(docId)" }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
    return false;
  }
};

/**
 * JSON objects up to the parse cap are read once (GET). A key under `raw/<name>/` whose src/transformers/<name>.mts
 * exists is read whatever its content type (up to MAX_TRANSFORM_BYTES — over it, or over MAX_TRANSFORMED_ROWS, the
 * event fails), and if the transformer reads it becomes one row per record (rows and file row carry `transformer: <name>`). Otherwise
 * generic: fields over 256 KiB become refs to this object version, and a JSON array returns its child rows while
 * the file row keeps only `count`.
 */
async function enrich(item: DocItem): Promise<Array<DocItem | TransformedRow>> {
  const versionId = item.version === "null" ? undefined : item.version;
  const name = transformerName(item.docId);
  const transform = name ? await loadTransformer(name) : undefined;
  if (transform && item.size > MAX_TRANSFORM_BYTES) throw new Error(`${item.docId}: ${item.size} B over MAX_TRANSFORM_BYTES ${MAX_TRANSFORM_BYTES} — split the file`);
  const head = await s3.send(new HeadObjectCommand({ Bucket: item.bucket, Key: item.docId, VersionId: versionId }));
  const json = shouldInlineJson(item.size, head.ContentType);
  // a transformer reads any content type (CSV, NDJSON, ...) — it says "not mine" by returning undefined
  if (!json && !(transform && item.size > 0)) return [];
  const obj = await s3.send(new GetObjectCommand({ Bucket: item.bucket, Key: item.docId, VersionId: versionId }));
  const body = await obj.Body?.transformToString("utf-8");
  if (name && transform && body !== undefined) {
    const items = transform(body);
    if (items) {
      const rows = transformedRows(item, items, TTL_DAYS, name);
      item.count = rows.length;
      item.transformer = name;
      return rows;
    }
  }
  if (!json) return [];
  const parsed = body === undefined ? undefined : parseJson(body);
  if (!parsed) return [];
  const children = childRows(item, parsed.doc);
  if (children) item.count = children.length;
  else item.data = offloadLargeFields(parsed.doc, { key: item.docId, versionId: item.version });
  return children ?? [];
};
