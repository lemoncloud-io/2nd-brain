import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { Client, type API } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { INDEX_BODY, mappedRecordToOp, recordToOp, toBulkBody, type BulkOp } from "./transform.js";
import { loadMapping, transformerOf } from "./route.js";

const ENDPOINT = process.env.COLLECTION_ENDPOINT ?? "";
const INDEX = process.env.INDEX_NAME ?? "docs";
const TIMESTAMP_FIELD = process.env.TIMESTAMP_FIELD ?? "eventTime";
const REGION = process.env.AWS_REGION ?? "ap-northeast-2";
/** Overrides every mapping's ID_FIELD when set (`docId` = row key, for masked samples whose ids are all one placeholder). */
const INDEX_ID_FIELD = process.env.INDEX_ID_FIELD || undefined;

const client = new Client({
  ...AwsSigv4Signer({ region: REGION, service: "aoss", getCredentials: () => defaultProvider()() }),
  node: ENDPOINT,
});

const readyIndexes = new Set<string>();

/**
 * Stream record → op. A row stack 1 made with transformer <name> goes to index `<IndexName>-<name>` with
 * src/mappings/<name>.ts (strict fields, `_id` = its ID_FIELD) — formats never share an index, since each has
 * its own strict mapping. Any other row, or a format with no mapping file, is indexed whole into `<IndexName>`.
 */
async function toOp(record: DynamoDBRecord): Promise<{ op?: BulkOp; body: unknown }> {
  const name = transformerOf(record);
  const mapping = name ? await loadMapping(name) : undefined;
  if (!name || !mapping) return { op: recordToOp(record, TIMESTAMP_FIELD), body: INDEX_BODY };
  const op = mappedRecordToOp(record, Object.keys(mapping.INDEX_BODY.mappings.properties), INDEX_ID_FIELD ?? mapping.ID_FIELD);
  return { op: op && { ...op, index: `${INDEX}-${name}` }, body: mapping.INDEX_BODY };
}

/**
 * A MODIFY (a hand edit — stack 1 never overwrites a row) that moves the row to another index or `_id`
 * (`data.<ID_FIELD>` or `transformer` changed) also deletes where the old image was indexed; otherwise the old
 * document stays searchable forever. The old image read as a REMOVE gives that target.
 */
async function toOps(record: DynamoDBRecord): Promise<Array<{ op: BulkOp; body: unknown }>> {
  const next = await toOp(record);
  const ops = next.op ? [next as { op: BulkOp; body: unknown }] : [];
  if (record.eventName !== "MODIFY" || !record.dynamodb?.OldImage) return ops;
  const prev = await toOp({ ...record, eventName: "REMOVE" });
  const at = (op?: BulkOp): string | undefined => op && `${op.index ?? INDEX}/${op.id}`;
  return prev.op && at(prev.op) !== at(next.op) ? [prev as { op: BulkOp; body: unknown }, ...ops] : ops;
}

/**
 * Drops a guarded delete (one carrying the expiring row's `ingestedAt`) when the document was written by a
 * later row with the same `_id` — that row is still live and owns the document. One `_mget` per batch.
 */
async function guardDeletes(ops: BulkOp[]): Promise<BulkOp[]> {
  const guarded = ops.filter((op): op is Extract<BulkOp, { action: "delete" }> & { ingestedAt: string } => op.action === "delete" && op.ingestedAt !== undefined);
  if (guarded.length === 0) return ops;
  const res = await client.mget({ body: { docs: guarded.map((op) => ({ _index: op.index ?? INDEX, _id: op.id, _source: ["ingestedAt"] })) } });
  const docs = (res.body as { docs: Array<{ found?: boolean; _source?: { ingestedAt?: string } }> }).docs;
  const owned = new Set<BulkOp>(
    guarded.filter((op, i) => {
      const current = docs[i]?.found ? Date.parse(docs[i]._source?.ingestedAt ?? "") : NaN;
      return current > Date.parse(op.ingestedAt);
    }),
  );
  if (owned.size) console.log(JSON.stringify({ msg: "delete skipped — a later row owns the document", count: owned.size }));
  return ops.filter((op) => !owned.has(op));
}

/**
 * DynamoDB Stream batch → one `_bulk` call. INSERT/MODIFY index the document, REMOVE deletes it
 * (generic rows: `_id = docId#version`). Throws on any item error so the event source mapping retries
 * (bisecting the batch) and finally routes the batch to the DLQ.
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<{ indexed: number; deleted: number }> => {
  if (!ENDPOINT) throw new Error("COLLECTION_ENDPOINT env var missing");
  const routed = (await Promise.all(event.Records.map(toOps))).flat();
  for (const [index, body] of new Map(routed.map((r) => [r.op.index ?? INDEX, r.body]))) await ensureIndex(index, body);
  const ops = await guardDeletes(routed.map((r) => r.op));
  const counts = { indexed: ops.filter((o) => o.action === "index").length, deleted: ops.filter((o) => o.action === "delete").length };
  if (ops.length === 0) return counts;

  const res = await client.bulk({ body: toBulkBody(ops, INDEX) as unknown as API.Bulk_RequestBody });
  const body = res.body as { errors: boolean; items: Array<Record<string, { status: number; error?: unknown }>> };
  if (body.errors) {
    const failed = body.items
      .map((it) => Object.values(it)[0])
      // a delete of a missing doc is 404 without `error` (result: not_found), so it never lands here;
      // a 404 *with* `error` (index_not_found_exception) is a real failure and must not checkpoint the stream
      .filter((r) => r.error)
      .slice(0, 3);
    if (failed.length) throw new Error(`bulk errors: ${JSON.stringify(failed)}`);
  }
  console.log(JSON.stringify({ msg: "bulk ok", ...counts }));
  return counts;
};

async function ensureIndex(index: string, body: unknown): Promise<void> {
  if (readyIndexes.has(index)) return;
  const exists = await client.indices.exists({ index });
  if (!exists.body) {
    try {
      await client.indices.create({ index, body: body as API.Indices_Create_RequestBody });
    } catch (e) {
      // two cold containers can race here; the second one loses harmlessly
      if (!String(e).includes("resource_already_exists_exception")) throw e;
    }
  }
  readyIndexes.add(index);
}
