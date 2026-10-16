import { describe, expect, it } from "vitest";
import type { S3EventRecord } from "aws-lambda";
import { childRows, isCreateEvent, jsonBytes, MAX_CHILD_ROWS, MAX_PARSE_JSON_BYTES, NO_VERSION, parseJson, recordToItem, shouldInlineJson } from "../src/transform.js";

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
  it("reads JSON-typed objects up to the parse cap (large fields are offloaded, not dropped)", () => {
    expect(shouldInlineJson(100, "application/json")).toBe(true);
    expect(shouldInlineJson(100, "application/ld+json; charset=utf-8")).toBe(true);
    expect(shouldInlineJson(256 * 1024 + 1, "application/json")).toBe(true);
    expect(shouldInlineJson(MAX_PARSE_JSON_BYTES, "application/json")).toBe(true);
    expect(shouldInlineJson(MAX_PARSE_JSON_BYTES + 1, "application/json")).toBe(false);
    expect(shouldInlineJson(100, "text/csv")).toBe(false);
    expect(shouldInlineJson(0, "application/json")).toBe(false);
    expect(shouldInlineJson(100, undefined)).toBe(false);
  });
});

describe("parseJson", () => {
  it("returns any JSON value and rejects invalid JSON", () => {
    expect(parseJson('{"a":1}')).toEqual({ doc: { a: 1 } });
    expect(parseJson("null")).toEqual({ doc: null });
    expect(parseJson("not json")).toBeUndefined();
  });
});

describe("childRows", () => {
  const file = recordToItem(rec({ key: "logs/batch.json", versionId: "v1", size: 999 }), new Date("2026-10-06T00:00:00Z"));

  it("one row per element: docId <key>#<i>, same version, linked by parent + index, size = the record's JSON bytes", () => {
    const records = [{ model: "a", tokens: 1 }, { model: "b", tokens: 2 }];
    expect(childRows(file, records)).toEqual(
      records.map((r, i) => ({
        ...file,
        docId: `logs/batch.json#${i}`,
        size: jsonBytes(r),
        parent: { docId: "logs/batch.json", version: "v1" },
        index: i,
        data: r,
      })),
    );
  });

  it("a big field inside a record is offloaded with a pointer that starts at the record's index", () => {
    const records = [{ id: "a" }, { id: "b", body: "x".repeat(300 * 1024) }];
    const second = childRows(file, records)?.[1].data as Record<string, unknown>;
    expect(second).toEqual({ id: "b", body$ref: { key: "logs/batch.json", versionId: "v1", pointer: "/1/body", bytes: jsonBytes(records[1].body) } });
  });

  it("scalars are wrapped as { value }; an empty array has no children", () => {
    expect(childRows(file, [5])?.[0].data).toEqual({ value: 5 });
    expect(childRows(file, [])).toEqual([]);
  });

  it("not an array, or more than MAX_CHILD_ROWS elements → no children (the file stays one row)", () => {
    expect(childRows(file, { a: 1 })).toBeUndefined();
    expect(childRows(file, Array.from({ length: MAX_CHILD_ROWS + 1 }, () => 0))).toBeUndefined();
    expect(childRows(file, Array.from({ length: MAX_CHILD_ROWS }, () => 0))).toHaveLength(MAX_CHILD_ROWS);
  });
});
