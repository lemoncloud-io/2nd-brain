import type { S3Event } from "aws-lambda";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isCreateEvent, parseJsonBody, recordToItem, shouldInlineJson, type DocItem } from "./transform.js";

const TABLE_NAME = process.env.TABLE_NAME ?? "";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

/**
 * S3 ObjectCreated → one DynamoDB row per (docId, version).
 * Idempotent: the Put is conditional on the key not existing, so a retry of an already-written
 * object version is a no-op (counted as skipped) and never bumps ingestedAt or emits a MODIFY.
 * Throws on any other failure so Lambda retries and, after that, routes the event to the DLQ.
 */
export const handler = async (event: S3Event): Promise<{ written: number; skipped: number }> => {
  if (!TABLE_NAME) throw new Error("TABLE_NAME env var missing");
  let written = 0;
  let skipped = 0;
  for (const record of event.Records) {
    if (!isCreateEvent(record)) {
      skipped++;
      continue;
    }
    const item = recordToItem(record);
    await enrich(item);
    try {
      await ddb.send(
        new PutCommand({ TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(docId)" }),
      );
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      skipped++;
      console.log(JSON.stringify({ msg: "already-ingested", docId: item.docId, version: item.version }));
      continue;
    }
    written++;
    console.log(JSON.stringify({ msg: "ingested", docId: item.docId, version: item.version, size: item.size }));
  }
  return { written, skipped };
};

async function enrich(item: DocItem): Promise<void> {
  const versionId = item.version === "null" ? undefined : item.version;
  const head = await s3.send(new HeadObjectCommand({ Bucket: item.bucket, Key: item.docId, VersionId: versionId }));
  if (!shouldInlineJson(item.size, head.ContentType)) return;
  const obj = await s3.send(new GetObjectCommand({ Bucket: item.bucket, Key: item.docId, VersionId: versionId }));
  const body = await obj.Body?.transformToString("utf-8");
  if (body === undefined) return;
  const data = parseJsonBody(body);
  if (data) item.data = data;
};
