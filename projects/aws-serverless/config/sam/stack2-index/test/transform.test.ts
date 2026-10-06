import { describe, expect, it } from "vitest";
import type { DynamoDBRecord } from "aws-lambda";
import { INDEX_BODY, docIdOf, recordToOp, timestampOf, toBulkBody } from "../src/transform.js";

const keys = { docId: { S: "sample.json" }, version: { S: "v1" } };
const image = { ...keys, size: { N: "40" }, eventTime: { S: "2026-09-23T04:59:00.000Z" }, ingestedAt: { S: "2026-09-23T05:00:01.000Z" }, data: { M: { line: { S: "A1" }, ts: { S: "2026-01-15T00:00:00Z" } } } };

function rec(eventName: DynamoDBRecord["eventName"], withImage = true): DynamoDBRecord {
  return { eventID: "1", eventName, dynamodb: { Keys: keys, ...(withImage ? { NewImage: image } : {}) } } as DynamoDBRecord;
}

describe("recordToOp", () => {
  it("INSERT → index op with unmarshalled row and @timestamp = eventTime by default", () => {
    expect(recordToOp(rec("INSERT"))).toEqual({
      action: "index",
      id: "sample.json#v1",
      doc: {
        docId: "sample.json", version: "v1", size: 40,
        eventTime: "2026-09-23T04:59:00.000Z", ingestedAt: "2026-09-23T05:00:01.000Z",
        data: { line: "A1", ts: "2026-01-15T00:00:00Z" }, "@timestamp": "2026-09-23T04:59:00.000Z",
      },
    });
  });
  it("@timestamp follows a dotted TIMESTAMP_FIELD inside data", () => {
    const op = recordToOp(rec("INSERT"), "data.ts");
    expect(op?.action === "index" && op.doc["@timestamp"]).toBe("2026-01-15T00:00:00.000Z");
  });
  it("MODIFY → index op (same _id, overwrites)", () => {
    expect(recordToOp(rec("MODIFY"))?.action).toBe("index");
  });
  it("REMOVE → delete op", () => {
    expect(recordToOp(rec("REMOVE", false))).toEqual({ action: "delete", id: "sample.json#v1" });
  });
  it("record without keys or image is skipped", () => {
    expect(recordToOp({ eventID: "x", eventName: "INSERT" } as DynamoDBRecord)).toBeUndefined();
    expect(recordToOp(rec("INSERT", false))).toBeUndefined();
  });
});

describe("timestampOf", () => {
  it("falls back to ingestedAt when the field is missing or not a date", () => {
    expect(timestampOf({ ingestedAt: "2026-09-23T05:00:01.000Z" }, "data.ts")).toBe("2026-09-23T05:00:01.000Z");
    expect(timestampOf({ eventTime: "not a date", ingestedAt: "2026-09-23T05:00:01.000Z" }, "eventTime")).toBe("2026-09-23T05:00:01.000Z");
  });
  it("accepts epoch milliseconds and epoch seconds", () => {
    expect(timestampOf({ data: { ts: 1737000000000 } }, "data.ts")).toBe("2025-01-16T04:00:00.000Z");
    expect(timestampOf({ data: { ts: 1737000000 } }, "data.ts")).toBe("2025-01-16T04:00:00.000Z");
  });
  it("normalises any parseable string to ISO-8601", () => {
    expect(timestampOf({ eventTime: "Thu, 16 Jan 2025 04:00:00 GMT" }, "eventTime")).toBe("2025-01-16T04:00:00.000Z");
    expect(timestampOf({ eventTime: "2025-01-16T13:00:00+09:00" }, "eventTime")).toBe("2025-01-16T04:00:00.000Z");
  });
  it("skips out-of-range numbers instead of throwing", () => {
    expect(timestampOf({ data: { ts: 1e20 }, ingestedAt: "2026-09-23T05:00:01.000Z" }, "data.ts")).toBe("2026-09-23T05:00:01.000Z");
  });
  it("returns an ISO string even with nothing usable", () => {
    expect(Number.isNaN(Date.parse(timestampOf({}, "x")))).toBe(false);
  });
});

describe("INDEX_BODY", () => {
  it("has date detection off and explicit date fields", () => {
    expect(INDEX_BODY.mappings.date_detection).toBe(false);
    expect(INDEX_BODY.mappings.properties["@timestamp"].type).toBe("date");
  });
});

describe("toBulkBody", () => {
  it("emits NDJSON with one action line per delete and two per index, trailing newline", () => {
    const body = toBulkBody(
      [
        { action: "index", id: docIdOf("a", "1"), doc: { docId: "a", version: "1", "@timestamp": "t" } },
        { action: "delete", id: docIdOf("b", "2") },
      ],
      "docs",
    );
    expect(body.split("\n")).toEqual([
      '{"index":{"_index":"docs","_id":"a#1"}}',
      '{"docId":"a","version":"1","@timestamp":"t"}',
      '{"delete":{"_index":"docs","_id":"b#2"}}',
      "",
    ]);
  });
  it("empty ops → empty body", () => {
    expect(toBulkBody([], "docs")).toBe("");
  });
});
