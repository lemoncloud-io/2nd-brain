import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { S3Event, S3EventRecord } from "aws-lambda";

// No AWS: both SDK clients are replaced. One stack, three uploads: two formats chosen by path, one generic.
const { s3Send, ddbSend } = vi.hoisted(() => {
  process.env.TABLE_NAME = "sls-test-docs";
  process.env.TTL_DAYS = "30";
  return { s3Send: vi.fn(), ddbSend: vi.fn() };
});
vi.mock("@aws-sdk/client-s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    send = s3Send;
  },
}));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>()),
  DynamoDBDocumentClient: { from: () => ({ send: ddbSend }) },
}));

import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { handler } from "../src/ingest.js";
import { loadTransformer, transformerName } from "../src/route.js";
import { rowKey } from "../src/transform.js";

// Synthetic bodies — no customer values.
const LLM_BODY = JSON.stringify({
  source: { gateway: "example-gateway-a" },
  records: [{ created_at: "2026-01-01T00:00:00Z", model: "model-alias-a", response: { id: "resp_1" }, request: { input: "free text" } }],
});
const LIST_BODY = JSON.stringify({ items: [{ id: "a", time: "2026-01-02T00:00:00Z", value: 1, note: "dropped" }, { id: "b", value: 2 }] });

const s3Record = (key: string, body: string): S3EventRecord =>
  ({
    eventVersion: "2.1",
    eventSource: "aws:s3",
    awsRegion: "ap-northeast-2",
    eventTime: "2026-10-02T00:00:00.000Z",
    eventName: "ObjectCreated:Put",
    s3: { bucket: { name: "sls-test-data" }, object: { key, size: Buffer.byteLength(body), eTag: "e", versionId: "v1" } },
  }) as unknown as S3EventRecord;

describe("transformerName — raw/<name>/<date>/<file>", () => {
  it.each([
    ["raw/llm-gateway-log/2026-10-12/a.json", "llm-gateway-log"],
    ["raw/example-list/2026-10-12/sub/a.json", "example-list"],
    ["raw/llm-gateway-log", undefined], // no file under the name
    ["raw/2026-10-12/a.json", "2026-10-12"], // a name-shaped segment; no such file → generic (below)
    ["in/llm-gateway-log/a.json", undefined],
    ["raw/LLM/a.json", undefined],
    ["raw/../a.json", undefined],
    ["raw/a_b/x.json", undefined],
  ])("%s → %s", (key, expected) => expect(transformerName(key)).toBe(expected));
});

describe("loadTransformer — any file in src/transformers/, no list", () => {
  it("loads both transformers by name; a missing name or a non-name is undefined", async () => {
    expect(await loadTransformer("llm-gateway-log")).toBeTypeOf("function");
    expect(await loadTransformer("example-list")).toBeTypeOf("function");
    expect(await loadTransformer("2026-10-12")).toBeUndefined();
    expect(await loadTransformer("../route")).toBeUndefined();
  });
});

describe("handler — one stack, the path picks the transformer", () => {
  const items = (): Record<string, unknown>[] => ddbSend.mock.calls.map((c) => (c[0] as PutCommand).input.Item as Record<string, unknown>);
  const bodies: Record<string, string> = {
    "raw/llm-gateway-log/2026-01-01/a.json": LLM_BODY,
    "raw/example-list/2026-01-02/a.json": LIST_BODY,
    "raw/2026-01-03/a.json": LIST_BODY, // same body, no transformer segment → generic
    "raw/llm-gateway-log/2026-01-04/b.json": LIST_BODY, // not a Gateway export → generic
  };

  beforeEach(() => {
    s3Send.mockReset().mockImplementation(async (cmd: { input: { Key: string } }) => {
      if (cmd instanceof HeadObjectCommand) return { ContentType: "application/json" };
      if (cmd instanceof GetObjectCommand) return { Body: { transformToString: async () => bodies[cmd.input.Key] } };
      throw new Error("unexpected S3 command");
    });
    ddbSend.mockReset().mockResolvedValue({});
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("each format gets its own rows (common key, raw$ref, ttl, transformer); other keys stay generic", async () => {
    await handler({ Records: Object.entries(bodies).map(([k, b]) => s3Record(k, b)) } as S3Event);
    const byDoc = Object.fromEntries(items().map((i) => [i.docId as string, i]));

    const llm = byDoc[rowKey("raw/llm-gateway-log/2026-01-01/a.json", 0)];
    expect(llm).toMatchObject({ transformer: "llm-gateway-log", data: { responseId: "resp_1", model: "model-alias-a" } });
    expect(llm.data).not.toHaveProperty("request");
    expect(byDoc["raw/llm-gateway-log/2026-01-01/a.json"]).toMatchObject({ count: 1, transformer: "llm-gateway-log" });

    const [a, b] = [0, 1].map((i) => byDoc[rowKey("raw/example-list/2026-01-02/a.json", i)]);
    expect(a).toMatchObject({ transformer: "example-list", data: { id: "a", value: 1, "raw$ref": { pointer: "/items/0" } } });
    expect(a.data).not.toHaveProperty("note");
    expect(a.ttl).toBe(Date.UTC(2026, 0, 2) / 1000 + 30 * 86400); // record time + TtlDays
    expect(b).toMatchObject({ transformer: "example-list", data: { id: "b", value: 2 } });
    expect(b.ttl).toBe(Math.floor(Date.parse(b.ingestedAt as string) / 1000) + 30 * 86400); // no record time → from ingestion
    expect(byDoc["raw/example-list/2026-01-02/a.json"]).toMatchObject({ count: 2, transformer: "example-list" });

    for (const key of ["raw/2026-01-03/a.json", "raw/llm-gateway-log/2026-01-04/b.json"]) {
      expect(byDoc[key]).toMatchObject({ docId: key, data: { items: [{ id: "a" }, { id: "b" }] } });
      expect(byDoc[key]).not.toHaveProperty("transformer");
      expect(byDoc[key]).not.toHaveProperty("ttl");
    }
    expect(items()).toHaveLength(1 + 1 + 2 + 1 + 1 + 1);
  });

  it("under a transformer path any content type is read (the mts decides); a body it rejects is the generic row", async () => {
    const types: Record<string, string> = { "raw/example-list/2026-01-02/a.txt": "text/plain", "raw/example-list/2026-01-02/b.csv": "text/csv", "raw/2026-01-03/c.txt": "text/plain" };
    Object.assign(bodies, { "raw/example-list/2026-01-02/a.txt": LIST_BODY, "raw/example-list/2026-01-02/b.csv": "id,value\na,1\n", "raw/2026-01-03/c.txt": LIST_BODY });
    s3Send.mockImplementation(async (cmd: { input: { Key: string } }) =>
      cmd instanceof HeadObjectCommand ? { ContentType: types[cmd.input.Key] } : { Body: { transformToString: async () => bodies[cmd.input.Key] } },
    );
    await handler({ Records: Object.keys(types).map((k) => s3Record(k, bodies[k])) } as S3Event);
    const byDoc = Object.fromEntries(items().map((i) => [i.docId as string, i]));
    expect(byDoc[rowKey("raw/example-list/2026-01-02/a.txt", 0)]).toMatchObject({ transformer: "example-list", data: { id: "a" } });
    for (const key of ["raw/example-list/2026-01-02/b.csv", "raw/2026-01-03/c.txt"]) {
      expect(byDoc[key]).toMatchObject({ docId: key });
      expect(byDoc[key]).not.toHaveProperty("data"); // not JSON-typed → metadata only, as before
      expect(byDoc[key]).not.toHaveProperty("transformer");
    }
  });
});
