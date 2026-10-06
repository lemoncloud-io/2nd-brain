import type { DynamoDBStreamEvent } from "aws-lambda";
import { Client, type API } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { INDEX_BODY, recordToOp, toBulkBody, type BulkOp } from "./transform.js";

const ENDPOINT = process.env.COLLECTION_ENDPOINT ?? "";
const INDEX = process.env.INDEX_NAME ?? "docs";
const TIMESTAMP_FIELD = process.env.TIMESTAMP_FIELD ?? "eventTime";
const REGION = process.env.AWS_REGION ?? "ap-northeast-2";

const client = new Client({
  ...AwsSigv4Signer({ region: REGION, service: "aoss", getCredentials: () => defaultProvider()() }),
  node: ENDPOINT,
});

let indexReady = false;

/**
 * DynamoDB Stream batch → one `_bulk` call. INSERT/MODIFY index `_id = docId#version`,
 * REMOVE deletes it. Throws on any item error so the event source mapping retries
 * (bisecting the batch) and finally routes the batch to the DLQ.
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<{ indexed: number; deleted: number }> => {
  if (!ENDPOINT) throw new Error("COLLECTION_ENDPOINT env var missing");
  const ops = event.Records.map((r) => recordToOp(r, TIMESTAMP_FIELD)).filter((op): op is BulkOp => op !== undefined);
  const counts = { indexed: ops.filter((o) => o.action === "index").length, deleted: ops.filter((o) => o.action === "delete").length };
  if (ops.length === 0) return counts;

  await ensureIndex();
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

async function ensureIndex(): Promise<void> {
  if (indexReady) return;
  const exists = await client.indices.exists({ index: INDEX });
  if (!exists.body) {
    try {
      await client.indices.create({ index: INDEX, body: INDEX_BODY as unknown as API.Indices_Create_RequestBody });
    } catch (e) {
      // two cold containers can race here; the second one loses harmlessly
      if (!String(e).includes("resource_already_exists_exception")) throw e;
    }
  }
  indexReady = true;
}
