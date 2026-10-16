import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { S3Event, S3EventRecord } from "aws-lambda";

// No AWS: both SDK clients are replaced. Keys under raw/llm-gateway-log/ go through that transformer.
const { s3Send, ddbSend } = vi.hoisted(() => {
  process.env.TABLE_NAME = "sls-test-docs";
  process.env.TTL_DAYS = "90";
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
import { exportRecords, projectRecord, transform } from "../src/transformers/llm-gateway-log.mjs";
import { ddbSize, MAX_CHILD_ROWS, MAX_PARSE_JSON_BYTES, MAX_TRANSFORM_BYTES, MAX_TRANSFORMED_ROWS, recordToItem, rowKey, transformedRows, type DocItem } from "../src/transform.js";

/** A synthetic Gateway log record in the export's shape (OpenAI Responses API body) — no customer values. */
const logRecord = (i: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  sample_id: `sample-${i}`,
  created_at: new Date(Date.UTC(2026, 0, 1, 14, 59, 0) + i * 60_000).toISOString(),
  updated_at: "2026-01-01 00:00:00",
  provider: "custom-example-provider",
  model: i % 4 === 0 ? "model-alias-b" : "model-alias-a",
  status_code: 200,
  success: true,
  cached: false,
  duration_ms: 8000 + i,
  tokens_in: 9000 + i,
  tokens_out: 600,
  cost: 0,
  request: {
    model: "model-alias-a",
    instructions: "x".repeat(4000),
    input: "y".repeat(3000),
    max_output_tokens: 4000,
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", schema: { type: "object", properties: { field_1: { type: "string", description: "z".repeat(1200) } } } } },
  },
  response: {
    id: `resp_${String(i).padStart(46, "0")}`,
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [{ type: "message", content: [{ type: "output_text", text: "w".repeat(900) }] }],
    usage: {
      input_tokens: 9000 + i,
      input_tokens_details: { cached_tokens: 8000, cache_write_tokens: 900 },
      output_tokens: 600,
      output_tokens_details: { reasoning_tokens: 200 },
      total_tokens: 9600 + i,
    },
    tool_usage: { web_search: { num_requests: 0 }, image_gen: { total_tokens: 0 } },
  },
  ...over,
});

const exportFile = (n: number, records = Array.from({ length: n }, (_, i) => logRecord(i))) => ({
  contract_version: "example-gateway-masked-sample.v1",
  source: { platform: "Cloudflare AI Gateway", gateway: "example-gateway-a" },
  record_count: records.length,
  records,
});

// An 80-character S3 key, as the field spec assumed when sizing rows.
const PREFIX = "raw/llm-gateway-log/2026-01-01/example-gateway-a/";
const KEY = `${PREFIX}${"k".repeat(80 - PREFIX.length - 5)}.json`;
const s3Record = (body: string): S3EventRecord =>
  ({
    eventVersion: "2.1",
    eventSource: "aws:s3",
    awsRegion: "ap-northeast-2",
    eventTime: "2026-10-02T00:00:00.000Z",
    eventName: "ObjectCreated:Put",
    s3: { bucket: { name: "sls-test-data" }, object: { key: KEY, size: Buffer.byteLength(body), eTag: "e", versionId: "3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY" } },
  }) as unknown as S3EventRecord;
const file = (body: string): DocItem => recordToItem(s3Record(body), new Date("2026-10-02T00:00:01.000Z"));

describe("projectRecord — field spec § 3.2", () => {
  it("a successful call keeps its 21 chosen fields (errorCode/incompleteReason only when set) and no free text", () => {
    const row = projectRecord(logRecord(1), "example-gateway-a");
    expect(Object.keys(row).sort()).toEqual(
      [
        "responseId", "createdAt", "dayKst", "gateway", "provider", "model", "statusCode", "success", "responseStatus",
        "durationMs", "cached", "tokensIn", "cachedTokens", "cacheWriteTokens", "tokensOut", "reasoningTokens", "totalTokens",
        "webSearchRequests", "imageGenTokens", "reasoningEffort", "maxOutputTokens",
      ].sort(),
    );
    expect(JSON.stringify(row)).not.toMatch(/xxxx|yyyy|zzzz|wwww/);
    expect(row).toMatchObject({ cachedTokens: 8000, cacheWriteTokens: 900, reasoningTokens: 200, maxOutputTokens: 4000 });
  });

  it("dayKst is the Korean date (UTC 15:00 = next day KST)", () => {
    expect(projectRecord(logRecord(0), undefined).dayKst).toBe("2026-01-01"); // 14:59Z = 23:59 KST
    expect(projectRecord(logRecord(1), undefined).dayKst).toBe("2026-01-02"); // 15:00Z = 00:00 KST
  });

  it("error and incomplete records carry their code and reason", () => {
    const r = logRecord(2, {
      status_code: 429,
      success: false,
      response: { id: "resp_e", status: "incomplete", error: { code: "rate_limit_exceeded", message: "m" }, incomplete_details: { reason: "max_output_tokens" } },
    });
    expect(projectRecord(r, undefined)).toMatchObject({ statusCode: 429, success: false, errorCode: "rate_limit_exceeded", incompleteReason: "max_output_tokens" });
  });
});

describe("transform (mts) — file body → one JSON per record", () => {
  const body = JSON.stringify(exportFile(100));
  const items = transform(body)!;

  it("one item per record, in file order, with pointer, original bytes and the record's time", () => {
    expect(items).toHaveLength(100);
    const original = JSON.parse(body) as { records: unknown[] };
    expect(items[7]).toMatchObject({ pointer: "/records/7", bytes: Buffer.byteLength(JSON.stringify(original.records[7])), time: logRecord(7).created_at });
  });

  it("not a Gateway export, or not JSON → undefined (the ingest falls back to generic)", () => {
    expect(transform("[1,2]")).toBeUndefined();
    expect(transform('{"records":"no"}')).toBeUndefined();
    expect(transform("not json")).toBeUndefined();
    expect(exportRecords({ records: [] })).toEqual({ gateway: undefined, records: [] });
  });
});

describe("rowKey + transformedRows — the ingest's common storage rule", () => {
  const body = JSON.stringify(exportFile(100));
  const rows = transformedRows(file(body), transform(body)!, 90, "llm-gateway-log")!;

  it("key = <hash(S3 key) 16 hex>.<NNN>.json, same for the same file, different for another file", () => {
    expect(rows[3].docId).toMatch(/^[0-9a-f]{16}\.003\.json$/);
    expect(rowKey(KEY, 3)).toBe(rows[3].docId);
    expect(rowKey(KEY + "x", 3)).not.toBe(rows[3].docId);
    expect(new Set(rows.map((r) => r.docId)).size).toBe(100);
  });

  it("sort key = S3 version; raw$ref points at the record inside that version", () => {
    expect(rows[7].version).toBe("3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY");
    expect(rows[7].data["raw$ref"]).toMatchObject({ key: KEY, versionId: "3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY", pointer: "/records/7" });
  });

  it("ttl = record time + ttlDays (epoch seconds); none when ttlDays is 0", () => {
    expect(rows[0].ttl).toBe(Date.UTC(2026, 0, 1, 14, 59, 0) / 1000 + 90 * 86400);
    expect(transformedRows(file(body), transform(body)!, 0, "llm-gateway-log")![0]).not.toHaveProperty("ttl");
  });

  it("a row is under 1 KB (one DynamoDB write unit) with an 80-character S3 key", () => {
    expect(Math.max(...rows.map((r) => ddbSize(r)))).toBeLessThan(1024);
  });

  it("the generic MAX_CHILD_ROWS does not apply (keys stay unique past 999); over MAX_TRANSFORMED_ROWS it throws, never a silent generic row", () => {
    const many = (n: number) => Array.from({ length: n }, () => ({ data: {}, pointer: "", bytes: 0 }));
    const rows = transformedRows(file("{}"), many(MAX_CHILD_ROWS + 1), 0, "llm-gateway-log");
    expect(new Set(rows.map((r) => r.docId)).size).toBe(MAX_CHILD_ROWS + 1);
    expect(() => transformedRows(file("{}"), many(MAX_TRANSFORMED_ROWS + 1), 0, "llm-gateway-log")).toThrow(/MAX_TRANSFORMED_ROWS/);
  });
});

describe("handler — raw/llm-gateway-log/ key", () => {
  const items = (): Record<string, unknown>[] => ddbSend.mock.calls.map((c) => (c[0] as PutCommand).input.Item as Record<string, unknown>);
  const invoke = (body: string) => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) return { ContentType: "application/json" };
      if (cmd instanceof GetObjectCommand) return { Body: { transformToString: async () => body } };
      throw new Error("unexpected S3 command");
    });
    return handler({ Records: [s3Record(body)] } as S3Event);
  };

  beforeEach(() => {
    s3Send.mockReset();
    ddbSend.mockReset().mockResolvedValue({});
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes the record rows (conditional), then the file row with count", async () => {
    expect(await invoke(JSON.stringify(exportFile(2)))).toEqual({ written: 3, skipped: 0 });
    const [a, , fileRow] = items();
    expect(a).toMatchObject({ docId: rowKey(KEY, 0), version: "3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY", transformer: "llm-gateway-log", data: { model: "model-alias-b", gateway: "example-gateway-a", responseId: "resp_" + "0".repeat(46) } });
    expect(a.ttl).toBeTypeOf("number");
    expect(a.data).not.toHaveProperty("request");
    expect(fileRow).toMatchObject({ docId: KEY, count: 2, transformer: "llm-gateway-log" });
    expect(fileRow.data).toBeUndefined();
    expect(ddbSend.mock.calls.every((c) => (c[0] as PutCommand).input.ConditionExpression === "attribute_not_exists(docId)")).toBe(true);
  });

  it("a retried event skips rows already written (same file → same keys)", async () => {
    ddbSend.mockRejectedValueOnce(Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" }));
    ddbSend.mockRejectedValueOnce(Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" }));
    expect(await invoke(JSON.stringify(exportFile(2)))).toEqual({ written: 1, skipped: 2 });
  });

  it("more records than the generic MAX_CHILD_ROWS → one row each, then the file row", async () => {
    const small = Array.from({ length: MAX_CHILD_ROWS + 1 }, (_, i) => ({ created_at: "2026-01-01T00:00:00Z", response: { id: `resp_${i}` } }));
    expect(await invoke(JSON.stringify(exportFile(0, small)))).toEqual({ written: MAX_CHILD_ROWS + 2, skipped: 0 });
    expect(items().at(-1)).toMatchObject({ docId: KEY, count: MAX_CHILD_ROWS + 1, transformer: "llm-gateway-log" });
  });

  it("over MAX_TRANSFORMED_ROWS → the event fails (retry → DLQ) and nothing is written", async () => {
    const tooMany = Array.from({ length: MAX_TRANSFORMED_ROWS + 1 }, () => ({}));
    await expect(invoke(JSON.stringify(exportFile(0, tooMany)))).rejects.toThrow(/MAX_TRANSFORMED_ROWS/);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it("a file over MAX_TRANSFORM_BYTES → the event fails before any S3 read, nothing written", async () => {
    const big = s3Record("{}");
    big.s3.object.size = MAX_TRANSFORM_BYTES + 1;
    await expect(handler({ Records: [big] } as S3Event)).rejects.toThrow(/MAX_TRANSFORM_BYTES/);
    expect(s3Send).not.toHaveBeenCalled();
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it("a file over the generic parse cap, with a non-JSON content type, is still read by the transformer", async () => {
    const body = JSON.stringify({ ...exportFile(2), padding: "x".repeat(MAX_PARSE_JSON_BYTES) });
    s3Send.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) return { ContentType: "binary/octet-stream" };
      if (cmd instanceof GetObjectCommand) return { Body: { transformToString: async () => body } };
      throw new Error("unexpected S3 command");
    });
    expect(await handler({ Records: [s3Record(body)] } as S3Event)).toEqual({ written: 3, skipped: 0 });
    expect(items().at(-1)).toMatchObject({ docId: KEY, count: 2, transformer: "llm-gateway-log" });
  });

  it("a JSON file that is not a Gateway export falls back to the generic row", async () => {
    expect(await invoke('{"line":"A1"}')).toEqual({ written: 1, skipped: 0 });
    expect(items()[0]).toMatchObject({ docId: KEY, data: { line: "A1" } });
    expect(items()[0]).not.toHaveProperty("transformer");
  });
});
