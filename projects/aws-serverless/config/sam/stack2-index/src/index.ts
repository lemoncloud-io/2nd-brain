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
 * DynamoDB Stream batch → one `_bulk` call. INSERT/MODIFY index the document, REMOVE deletes it
 * (generic rows: `_id = docId#version`). Throws on any item error so the event source mapping retries
 * (bisecting the batch) and finally routes the batch to the DLQ.
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<{ indexed: number; deleted: number }> => {
  if (!ENDPOINT) throw new Error("COLLECTION_ENDPOINT env var missing");
  const routed = (await Promise.all(event.Records.map(toOp))).filter((r): r is { op: BulkOp; body: unknown } => r.op !== undefined);
  const ops = routed.map((r) => r.op);
  const counts = { indexed: ops.filter((o) => o.action === "index").length, deleted: ops.filter((o) => o.action === "delete").length };
  if (ops.length === 0) return counts;

  for (const [index, body] of new Map(routed.map((r) => [r.op.index ?? INDEX, r.body]))) await ensureIndex(index, body);
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
