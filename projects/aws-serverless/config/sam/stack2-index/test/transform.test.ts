import { describe, expect, it } from "vitest";
import type { DynamoDBRecord } from "aws-lambda";
import { INDEX_BODY, MAX_ID_BYTES, boundedId, docIdOf, recordToOp, timestampOf, toBulkBody } from "../src/transform.js";

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
  it("gives the explicit docId keyword its .text sub-field (the dynamic string template does not reach it)", () => {
    expect(INDEX_BODY.mappings.properties.docId).toMatchObject({ type: "keyword", fields: { text: { type: "text" } } });
  });
  it("maps stack 1's <field>$ref objects as stored-not-indexed, ahead of the string template", () => {
    expect(INDEX_BODY.mappings.dynamic_templates[0]).toEqual({
      s3_refs_not_indexed: { match_mapping_type: "object", match: "*$ref", mapping: { type: "object", enabled: false } },
    });
  });
});

describe("recordToOp with offloaded fields", () => {
  it("passes a <field>$ref object through under its own key — the original field name never changes type", () => {
    const ref = { M: { key: { S: "sample.json" }, versionId: { S: "v1" }, pointer: { S: "/body" }, bytes: { N: "307202" } } };
    const op = recordToOp({ eventID: "1", eventName: "INSERT", dynamodb: { Keys: keys, NewImage: { ...image, data: { M: { id: { S: "req-1" }, body$ref: ref } } } } } as DynamoDBRecord);
    expect(op?.action === "index" && op.doc.data).toEqual({ id: "req-1", body$ref: { key: "sample.json", versionId: "v1", pointer: "/body", bytes: 307202 } });
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

describe("boundedId / docIdOf", () => {
  it("keeps an id up to 512 bytes as is — existing documents keep their _id", () => {
    expect(docIdOf("in/sample.json", "v1")).toBe("in/sample.json#v1");
    const edge = "a".repeat(MAX_ID_BYTES);
    expect(boundedId(edge)).toBe(edge);
  });
  it("hashes a longer id (S3 keys reach 1,024 bytes) to 64 hex chars, the same every time", () => {
    const key = "가".repeat(340) + ".json"; // 1,025 UTF-8 bytes
    const id = docIdOf(key, "3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(docIdOf(key, "3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY")).toBe(id);
    expect(docIdOf(key, "other-version")).not.toBe(id);
  });
});
