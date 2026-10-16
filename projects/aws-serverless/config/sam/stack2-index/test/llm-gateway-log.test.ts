import { describe, expect, it } from "vitest";
import type { DynamoDBRecord } from "aws-lambda";
import { marshall } from "@aws-sdk/util-dynamodb";
import { ID_FIELD, INDEX_BODY } from "../src/mappings/llm-gateway-log.js";
import { mappedRecordToOp } from "../src/transform.js";

const NOW = new Date("2026-10-12T08:00:00.000Z");
const FIELDS = Object.keys(INDEX_BODY.mappings.properties);
const llmRecordToOp = (r: DynamoDBRecord, idField: string | undefined = ID_FIELD, now = NOW) => mappedRecordToOp(r, FIELDS, idField, now);
/** A stack 1 llm-gateway-log row (synthetic values). */
const row = {
  docId: "0123456789abcdef.000.json",
  version: "v1",
  size: 7000,
  ingestedAt: "2026-10-12T07:59:58.000Z",
  ttl: 1798000000,
  data: {
    responseId: "resp_1", createdAt: "2026-10-12T07:59:50.000Z", dayKst: "2026-10-12", gateway: "example-gateway-a",
    provider: "custom-example-provider", model: "model-alias-a", statusCode: 200, success: true, responseStatus: "completed",
    durationMs: 8721, cached: false, tokensIn: 9000, cachedTokens: 8000, cacheWriteTokens: 900, tokensOut: 600,
    reasoningTokens: 200, totalTokens: 9600, webSearchRequests: 0, imageGenTokens: 0, reasoningEffort: "low", maxOutputTokens: 4000,
    "raw$ref": { key: "raw/x.json", versionId: "v1", pointer: "/records/0", bytes: 7000 },
  },
};
const rec = (eventName: DynamoDBRecord["eventName"], image?: Record<string, unknown>): DynamoDBRecord =>
  ({
    eventID: "1",
    eventName,
    dynamodb: { Keys: marshall({ docId: row.docId, version: "v1" }), ...(image ? { [eventName === "REMOVE" ? "OldImage" : "NewImage"]: marshall(image) } : {}) },
  }) as DynamoDBRecord;

describe("mappedRecordToOp with mappings/llm-gateway-log", () => {
  it("INSERT → one document of mapped fields only, _id = responseId, + ingestedAt/indexedAt", () => {
    const op = llmRecordToOp(rec("INSERT", row), "responseId", NOW);
    expect(op?.action).toBe("index");
    if (op?.action !== "index") return;
    expect(op.id).toBe("resp_1");
    expect(op.doc).toMatchObject({ model: "model-alias-a", tokensIn: 9000, ingestedAt: row.ingestedAt, indexedAt: NOW.toISOString() });
    expect(Object.keys(op.doc).every((k) => k in INDEX_BODY.mappings.properties)).toBe(true);
    expect(op.doc).not.toHaveProperty("raw$ref");
    expect(op.doc).not.toHaveProperty("ttl");
  });

  it("an unmapped field in the row is not copied (stays in DynamoDB)", () => {
    const op = llmRecordToOp(rec("INSERT", { ...row, data: { ...row.data, serviceName: "new" } }), "responseId", NOW);
    expect(op?.action === "index" && op.doc).not.toHaveProperty("serviceName");
  });

  it("the same call in two files (two row keys) → the same _id, so one document", () => {
    const other = { ...row, docId: "fedcba9876543210.041.json" };
    const ids = [row, other].map((r) => {
      const op = llmRecordToOp({ ...rec("INSERT", r), dynamodb: { Keys: marshall({ docId: r.docId, version: "v1" }), NewImage: marshall(r) } } as DynamoDBRecord);
      return op?.id;
    });
    expect(ids).toEqual(["resp_1", "resp_1"]);
  });

  it("idField docId (masked samples) or a row without the id field → _id = row key", () => {
    expect(llmRecordToOp(rec("INSERT", row), "docId")?.id).toBe(row.docId);
    expect(llmRecordToOp(rec("INSERT", { ...row, data: { model: "m" } }))?.id).toBe(row.docId);
  });

  it("REMOVE (TTL expiry) → delete the id read from the old image; file rows (count) are not indexed", () => {
    expect(llmRecordToOp(rec("REMOVE", row))).toEqual({ action: "delete", id: "resp_1" });
    expect(llmRecordToOp(rec("INSERT", { docId: "raw/x.json", version: "v1", count: 100, ingestedAt: row.ingestedAt }))).toBeUndefined();
  });

  it("the mapping is strict with exactly 25 fields", () => {
    expect(INDEX_BODY.mappings.dynamic).toBe("strict");
    expect(Object.keys(INDEX_BODY.mappings.properties)).toHaveLength(25);
  });
});
