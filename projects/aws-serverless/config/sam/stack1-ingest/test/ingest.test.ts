import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { S3Event, S3EventRecord } from "aws-lambda";

// No AWS: both SDK clients are replaced; every call is recorded in `calls`.
const { calls, s3Send, ddbSend } = vi.hoisted(() => {
  process.env.TABLE_NAME = "sls-test-docs";
  return { calls: [] as string[], s3Send: vi.fn(), ddbSend: vi.fn() };
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
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { handler } from "../src/ingest.js";
import { MAX_PARSE_JSON_BYTES, recordToItem } from "../src/transform.js";
import { JSON_FIXTURES, KiB, NOT_JSON, jsonFile, utf8 } from "./fixtures.js";

const NOW = new Date("2026-10-02T00:00:01.000Z");
const JSON_TYPE = "application/json";

const record = (body: string, eventName = "ObjectCreated:Put"): S3EventRecord =>
  ({
    eventVersion: "2.1",
    eventSource: "aws:s3",
    awsRegion: "ap-northeast-2",
    eventTime: "2026-10-02T00:00:00.000Z",
    eventName,
    s3: { bucket: { name: "sls-test-data" }, object: { key: "in/sample.json", size: utf8(body), eTag: "e", versionId: "v1" } },
  }) as unknown as S3EventRecord;

const invoke = (body: string, contentType: string | undefined, eventName?: string) => {
  s3Send.mockImplementation(async (cmd: unknown) => {
    if (cmd instanceof HeadObjectCommand) {
      calls.push("HEAD");
      return { ContentType: contentType };
    }
    if (cmd instanceof GetObjectCommand) {
      calls.push("GET");
      return { Body: { transformToString: async () => body } };
    }
    throw new Error("unexpected S3 command");
  });
  return handler({ Records: [record(body, eventName)] } as S3Event);
};

const putItem = (): Record<string, unknown> => {
  const cmd = ddbSend.mock.calls[0][0] as PutCommand;
  return cmd.input.Item as Record<string, unknown>;
};

/** Frozen copy of the row logic before this change: ≤256KiB JSON inlined whole, anything else metadata only. */
const legacyRow = (body: string, contentType: string | undefined): Record<string, unknown> => {
  const item: Record<string, unknown> = { ...recordToItem(record(body), NOW) };
  const size = item.size as number;
  if (size <= 0 || size > 256 * KiB || !/^application\/(json|.+\+json)\b/i.test(contentType ?? "")) return item;
  try {
    const parsed: unknown = JSON.parse(body);
    item.data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    // not JSON → metadata only
  }
  return item;
};

beforeEach(() => {
  calls.length = 0;
  s3Send.mockReset();
  ddbSend.mockReset().mockImplementation(async (cmd: unknown) => {
    if (!(cmd instanceof PutCommand)) throw new Error("unexpected DynamoDB command");
    calls.push("PUT");
    return {};
  });
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("handler — S3 calls", () => {
  it.each([
    ["small JSON → HEAD, GET, PUT", '{"line":"A1","temp":72.5}', JSON_TYPE, ["HEAD", "GET", "PUT"]],
    ["256KiB+1 byte JSON → HEAD, GET, PUT (before: HEAD, PUT)", jsonFile(256 * KiB + 1), JSON_TYPE, ["HEAD", "GET", "PUT"]],
    ["JSON over the parse cap → HEAD, PUT", jsonFile(MAX_PARSE_JSON_BYTES + 1), JSON_TYPE, ["HEAD", "PUT"]],
    ["CSV → HEAD, PUT", NOT_JSON.csv, "text/csv", ["HEAD", "PUT"]],
    ["zero-byte JSON → HEAD, PUT", "", JSON_TYPE, ["HEAD", "PUT"]],
  ])("%s", async (_, body, contentType, expected) => {
    await invoke(body, contentType);
    expect(calls).toEqual(expected);
  });

  it("GET only for JSON within the parse cap; over the cap the row is metadata only", async () => {
    await invoke(jsonFile(MAX_PARSE_JSON_BYTES + 1), JSON_TYPE);
    expect(putItem().data).toBeUndefined();
  });

  it("Put stays conditional (idempotent retry) and a big field lands as a ref", async () => {
    await invoke(JSON_FIXTURES["one big field + small fields"], "application/json; charset=utf-8");
    const cmd = ddbSend.mock.calls[0][0] as PutCommand;
    expect(cmd.input).toMatchObject({ TableName: "sls-test-docs", ConditionExpression: "attribute_not_exists(docId)" });
    expect(putItem().data).toMatchObject({ id: "req-1", body$ref: { key: "in/sample.json", versionId: "v1", pointer: "/body" } });
  });

  it("ObjectRemoved makes no calls; a conditional-check failure counts as skipped", async () => {
    expect(await invoke("{}", JSON_TYPE, "ObjectRemoved:Delete")).toEqual({ written: 0, skipped: 1 });
    expect(calls).toEqual([]);
    ddbSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ message: "exists", $metadata: {} }));
    expect(await invoke("{}", JSON_TYPE)).toEqual({ written: 0, skipped: 1 });
  });
});

describe("handler — JSON array file", () => {
  it("writes one child row per record first, then the file row with count and no data", async () => {
    await invoke('[{"model":"a"},{"model":"b"}]', JSON_TYPE);
    expect(calls).toEqual(["HEAD", "GET", "PUT", "PUT", "PUT"]);
    const items = ddbSend.mock.calls.map((c) => (c[0] as PutCommand).input.Item as Record<string, unknown>);
    expect(items.map((i) => i.docId)).toEqual(["in/sample.json#0", "in/sample.json#1", "in/sample.json"]);
    expect(items[0]).toMatchObject({ version: "v1", parent: { docId: "in/sample.json", version: "v1" }, index: 0, data: { model: "a" } });
    expect(items[2]).toMatchObject({ docId: "in/sample.json", version: "v1", count: 2 });
    expect(items[2].data).toBeUndefined();
  });

  it("only ConditionalCheckFailedException means 'already there' — matched by name, any other error (throttling) fails the invocation", async () => {
    ddbSend.mockRejectedValueOnce(Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" }));
    expect(await invoke("[{}]", JSON_TYPE)).toEqual({ written: 1, skipped: 1 });
    ddbSend.mockRejectedValueOnce(Object.assign(new Error("slow down"), { name: "ProvisionedThroughputExceededException" }));
    await expect(invoke("[{}]", JSON_TYPE)).rejects.toThrow("slow down");
  });

  it("a retry skips children already written and still writes the file row", async () => {
    ddbSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ message: "exists", $metadata: {} }));
    expect(await invoke('[{"model":"a"},{"model":"b"}]', JSON_TYPE)).toEqual({ written: 2, skipped: 1 });
  });
});

describe("handler — regression: rows for ≤256KiB JSON (not arrays) and non-JSON are byte-identical to before", () => {
  it.each([
    ["small JSON object", '{"line":"A1","temp":72.5}', JSON_TYPE],
    ["255KiB JSON", JSON_FIXTURES["255KiB file"], JSON_TYPE],
    ["exactly 256KiB JSON", JSON_FIXTURES["exactly 256KiB file"], JSON_TYPE],
    ["CSV", NOT_JSON.csv, "text/csv"],
    ["invalid JSON", NOT_JSON.invalid, JSON_TYPE],
    ["JSON body without a content type", '{"a":1}', undefined],
  ])("%s", async (_, body, contentType) => {
    await invoke(body, contentType);
    expect(JSON.stringify(putItem())).toBe(JSON.stringify(legacyRow(body, contentType)));
  });
});
