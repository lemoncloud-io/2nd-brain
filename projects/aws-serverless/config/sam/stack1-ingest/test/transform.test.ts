import { describe, expect, it } from "vitest";
import type { S3EventRecord } from "aws-lambda";
import { isCreateEvent, NO_VERSION, parseJsonBody, recordToItem, shouldInlineJson } from "../src/transform.js";

function rec(over: Partial<S3EventRecord["s3"]["object"]> & { eventName?: string } = {}): S3EventRecord {
  const { eventName = "ObjectCreated:Put", ...obj } = over;
  return {
    eventVersion: "2.1",
    eventSource: "aws:s3",
    awsRegion: "ap-northeast-2",
    eventTime: "2026-09-23T05:00:00.000Z",
    eventName,
    userIdentity: { principalId: "x" },
    requestParameters: { sourceIPAddress: "1.2.3.4" },
    responseElements: { "x-amz-request-id": "r", "x-amz-id-2": "i" },
    s3: {
      s3SchemaVersion: "1.0",
      configurationId: "c",
      bucket: { name: "sls-test-bucket", ownerIdentity: { principalId: "o" }, arn: "arn:aws:s3:::sls-test-bucket" },
      object: { key: "sample.json", size: 12, eTag: "abc", sequencer: "s", ...obj },
    },
  } as S3EventRecord;
}

describe("recordToItem", () => {
  it("maps a plain upload with no versioning", () => {
    const item = recordToItem(rec(), new Date("2026-09-23T05:00:01Z"));
    expect(item).toEqual({
      docId: "sample.json",
      version: NO_VERSION,
      bucket: "sls-test-bucket",
      size: 12,
      etag: "abc",
      eventTime: "2026-09-23T05:00:00.000Z",
      eventName: "ObjectCreated:Put",
      ingestedAt: "2026-09-23T05:00:01.000Z",
    });
  });

  it("keeps the S3 versionId as the sort key when present", () => {
    expect(recordToItem(rec({ versionId: "v1" })).version).toBe("v1");
  });

  it("URL-decodes Korean and space characters in keys", () => {
    const key = encodeURIComponent("자료/설비 로그 2026.csv").replace(/%20/g, "+");
    expect(recordToItem(rec({ key })).docId).toBe("자료/설비 로그 2026.csv");
  });

  it("treats a zero-byte object as size 0", () => {
    expect(recordToItem(rec({ size: 0 })).size).toBe(0);
    expect(recordToItem(rec({ size: undefined })).size).toBe(0);
  });
});

describe("isCreateEvent", () => {
  it("accepts every ObjectCreated variant and rejects removals", () => {
    expect(isCreateEvent(rec({ eventName: "ObjectCreated:Put" }))).toBe(true);
    expect(isCreateEvent(rec({ eventName: "ObjectCreated:CompleteMultipartUpload" }))).toBe(true);
    expect(isCreateEvent(rec({ eventName: "ObjectRemoved:Delete" }))).toBe(false);
  });
});

describe("shouldInlineJson", () => {
  it("only inlines small JSON-typed objects", () => {
    expect(shouldInlineJson(100, "application/json")).toBe(true);
    expect(shouldInlineJson(100, "application/ld+json; charset=utf-8")).toBe(true);
    expect(shouldInlineJson(100, "text/csv")).toBe(false);
    expect(shouldInlineJson(0, "application/json")).toBe(false);
    expect(shouldInlineJson(256 * 1024 + 1, "application/json")).toBe(false);
    expect(shouldInlineJson(100, undefined)).toBe(false);
  });
});

describe("parseJsonBody", () => {
  it("returns objects as-is, wraps scalars/arrays, and rejects invalid JSON", () => {
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonBody("[1,2]")).toEqual({ value: [1, 2] });
    expect(parseJsonBody("not json")).toBeUndefined();
  });
});
