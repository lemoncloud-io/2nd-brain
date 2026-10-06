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
  /** Parsed JSON body for small application/json objects; absent otherwise. */
  data?: Record<string, unknown>;
  ingestedAt: string;
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

export const MAX_INLINE_JSON_BYTES = 256 * 1024;

/** Objects small enough and typed as JSON get their body merged into `data`. */
export function shouldInlineJson(size: number, contentType: string | undefined): boolean {
  if (size <= 0 || size > MAX_INLINE_JSON_BYTES) return false;
  return /^application\/(json|.+\+json)\b/i.test(contentType ?? "");
}

export function parseJsonBody(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return undefined;
  }
}
