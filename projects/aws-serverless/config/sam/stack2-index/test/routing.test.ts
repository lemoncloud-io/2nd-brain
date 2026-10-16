import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { marshall } from "@aws-sdk/util-dynamodb";

// No AWS: the OpenSearch client is replaced; bulk bodies and created indexes are recorded.
const { bulk, exists, create } = vi.hoisted(() => {
  process.env.COLLECTION_ENDPOINT = "https://example.aoss.test";
  process.env.INDEX_NAME = "docs";
  return { bulk: vi.fn(), exists: vi.fn(), create: vi.fn() };
});
vi.mock("@opensearch-project/opensearch", () => ({
  Client: class {
    bulk = bulk;
    indices = { exists, create };
  },
}));
vi.mock("@opensearch-project/opensearch/aws", () => ({ AwsSigv4Signer: () => ({}) }));

import { handler } from "../src/index.js";
import { loadMapping, transformerOf } from "../src/route.js";
import { INDEX_BODY as GENERIC_BODY } from "../src/transform.js";
import { INDEX_BODY as LLM_BODY } from "../src/mappings/llm-gateway-log.js";
import { INDEX_BODY as LIST_BODY } from "../src/mappings/example-list.js";

// Rows as stack 1 writes them (synthetic values).
const ingestedAt = "2026-10-12T07:59:58.000Z";
const ROWS = {
  llm: { docId: "0123456789abcdef.000.json", version: "v1", size: 10, ingestedAt, transformer: "llm-gateway-log", data: { responseId: "resp_1", model: "model-alias-a", "raw$ref": { pointer: "/records/0" } } },
  list: { docId: "fedcba9876543210.000.json", version: "v1", size: 10, ingestedAt, transformer: "example-list", data: { id: "a", time: "2026-01-02T00:00:00.000Z", value: 1 } },
  noMapping: { docId: "1111111111111111.000.json", version: "v1", size: 10, ingestedAt, transformer: "no-mapping-yet", data: { x: 1 } },
  generic: { docId: "in/sample.json", version: "v1", size: 10, ingestedAt, eventTime: ingestedAt, data: { line: "A1" } },
  listFile: { docId: "raw/example-list/2026-01-02/a.json", version: "v1", size: 10, ingestedAt, transformer: "example-list", count: 1 },
};
const rec = (eventName: DynamoDBRecord["eventName"], row: { docId: string; version: string; [k: string]: unknown }): DynamoDBRecord =>
  ({
    eventID: "1",
    eventName,
    dynamodb: { Keys: marshall({ docId: row.docId, version: row.version }), [eventName === "REMOVE" ? "OldImage" : "NewImage"]: marshall(row) },
  }) as DynamoDBRecord;

describe("transformerOf / loadMapping", () => {
  it("reads the row's transformer (old image for REMOVE); generic rows have none", () => {
    expect(transformerOf(rec("INSERT", ROWS.llm))).toBe("llm-gateway-log");
    expect(transformerOf(rec("REMOVE", ROWS.list))).toBe("example-list");
    expect(transformerOf(rec("INSERT", ROWS.generic))).toBeUndefined();
    expect(transformerOf(rec("INSERT", { ...ROWS.llm, transformer: "../x" }))).toBeUndefined();
  });

  it("loads any file in src/mappings/ by name; a missing one is undefined", async () => {
    expect((await loadMapping("llm-gateway-log"))?.ID_FIELD).toBe("responseId");
    expect((await loadMapping("example-list"))?.ID_FIELD).toBe("id");
    expect(await loadMapping("no-mapping-yet")).toBeUndefined();
  });
});

describe("handler — each format into its own strict index, the rest generic", () => {
  const bulkLines = (): Array<Record<string, unknown>> =>
    (bulk.mock.calls[0][0].body as string).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeEach(() => {
    bulk.mockReset().mockResolvedValue({ body: { errors: false, items: [] } });
    exists.mockReset().mockResolvedValue({ body: false });
    create.mockReset().mockResolvedValue({});
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("routes one batch to docs-llm-gateway-log, docs-example-list and docs, creating each index with its mapping", async () => {
    const event = { Records: [rec("INSERT", ROWS.llm), rec("INSERT", ROWS.list), rec("INSERT", ROWS.noMapping), rec("INSERT", ROWS.generic), rec("INSERT", ROWS.listFile)] } as DynamoDBStreamEvent;
    expect(await handler(event)).toEqual({ indexed: 4, deleted: 0 }); // the file row (count) is not indexed

    const lines = bulkLines();
    const actions = lines.filter((_, i) => i % 2 === 0).map((l) => l.index as { _index: string; _id: string });
    const docs = lines.filter((_, i) => i % 2 === 1);
    expect(actions).toEqual([
      { _index: "docs-llm-gateway-log", _id: "resp_1" },
      { _index: "docs-example-list", _id: "a" },
      { _index: "docs", _id: "1111111111111111.000.json#v1" }, // transformer without a mapping → generic
      { _index: "docs", _id: "in/sample.json#v1" },
    ]);
    expect(Object.keys(docs[0]).every((k) => k in LLM_BODY.mappings.properties)).toBe(true);
    expect(Object.keys(docs[1]).sort()).toEqual(["id", "indexedAt", "ingestedAt", "time", "value"]);
    expect(docs[2]).toMatchObject({ transformer: "no-mapping-yet", data: { x: 1 } });

    const created = Object.fromEntries(create.mock.calls.map((c) => [c[0].index as string, c[0].body]));
    expect(created).toEqual({ "docs-llm-gateway-log": LLM_BODY, "docs-example-list": LIST_BODY, docs: GENERIC_BODY });
  });

  it("REMOVE (TTL expiry) deletes from the format's index by the id in the old image", async () => {
    expect(await handler({ Records: [rec("REMOVE", ROWS.list), rec("REMOVE", ROWS.generic)] } as DynamoDBStreamEvent)).toEqual({ indexed: 0, deleted: 2 });
    expect(bulkLines()).toEqual([{ delete: { _index: "docs-example-list", _id: "a" } }, { delete: { _index: "docs", _id: "in/sample.json#v1" } }]);
  });
});
