import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { S3Event, S3EventRecord } from "aws-lambda";

// No AWS: both SDK clients are replaced. SidecarEnabled=true here; with it off (every other test file) any
// PutObject would hit "unexpected S3 command" in those mocks.
const { calls, s3Send, ddbSend } = vi.hoisted(() => {
  process.env.TABLE_NAME = "sls-test-docs";
  process.env.SIDECAR_ENABLED = "true";
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

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { handler } from "../src/ingest.js";
import { sidecarKey } from "../src/transform.js";

const LIST_BODY = JSON.stringify({ items: [{ id: "a", time: "2026-01-02T00:00:00Z", value: 1 }, { id: "b", value: 2 }] });
const s3Record = (key: string, body: string): S3EventRecord =>
  ({
    eventVersion: "2.1",
    eventSource: "aws:s3",
    awsRegion: "ap-northeast-2",
    eventTime: "2026-10-02T00:00:00.000Z",
    eventName: "ObjectCreated:Put",
    s3: { bucket: { name: "sls-test-data" }, object: { key, size: Buffer.byteLength(body), eTag: "e", versionId: "v1" } },
  }) as unknown as S3EventRecord;

describe("sidecarKey — raw/<format>/<date>/<file> → sidecar/<format>/<date>/<file>.jsonl (whole name kept)", () => {
  it.each([
    ["raw/llm-gateway-log/2026-10-12/export.json", "sidecar/llm-gateway-log/2026-10-12/export.json.jsonl"],
    ["raw/example-list/2026-10-12/a.b.csv", "sidecar/example-list/2026-10-12/a.b.csv.jsonl"],
    ["raw/example-list/2026-10-12/noext", "sidecar/example-list/2026-10-12/noext.jsonl"],
    ["raw/example-list/2026-10-12/dir.v2/noext", "sidecar/example-list/2026-10-12/dir.v2/noext.jsonl"],
  ])("%s", (raw, expected) => expect(sidecarKey(raw)).toBe(expected));
  it("a.csv and a.json in one folder get two sidecars", () => {
    expect(sidecarKey("raw/example-list/2026-01-02/a.csv")).not.toBe(sidecarKey("raw/example-list/2026-01-02/a.json"));
  });
});

describe("handler — SidecarEnabled=true", () => {
  const bodies: Record<string, string> = { "raw/example-list/2026-01-02/a.json": LIST_BODY, "in/plain.json": LIST_BODY };
  let latest = "v1"; // the key's current version, as a HEAD without VersionId reports it
  const sidecarPuts = (): PutObjectCommand[] => s3Send.mock.calls.map((c) => c[0]).filter((c): c is PutObjectCommand => c instanceof PutObjectCommand);

  beforeEach(() => {
    calls.length = 0;
    latest = "v1";
    s3Send.mockReset().mockImplementation(async (cmd: { input: { Key: string } }) => {
      if (cmd instanceof HeadObjectCommand) {
        if (!cmd.input.VersionId && latest === "deleted") throw Object.assign(new Error("Not Found"), { name: "NotFound" });
        return { ContentType: "application/json", VersionId: latest };
      }
      if (cmd instanceof GetObjectCommand) return { Body: { transformToString: async () => bodies[cmd.input.Key] } };
      if (cmd instanceof PutObjectCommand) return calls.push(`SIDECAR ${cmd.input.Key}`), {};
      throw new Error("unexpected S3 command");
    });
    ddbSend.mockReset().mockImplementation(async (cmd: PutCommand) => (calls.push(`PUT ${cmd.input.Item?.docId as string}`), {}));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("a transformed file → one NDJSON object (record fields, ingestedAt, raw$ref + $-free raw keys), written before the file row", async () => {
    await handler({ Records: [s3Record("raw/example-list/2026-01-02/a.json", LIST_BODY)] } as S3Event);
    expect(calls.slice(-2)).toEqual(["SIDECAR sidecar/example-list/2026-01-02/a.json.jsonl", "PUT raw/example-list/2026-01-02/a.json"]);
    const [put] = sidecarPuts();
    expect(put.input).toMatchObject({ Bucket: "sls-test-data", ContentType: "application/x-ndjson" });
    expect(put.input).not.toHaveProperty("ACL"); // the Lambda boundary denies s3:PutObjectAcl
    const lines = (put.input.Body as string).trimEnd().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      id: "a", time: "2026-01-02T00:00:00.000Z", value: 1,
      rawKey: "raw/example-list/2026-01-02/a.json", rawVersionId: "v1", rawPointer: "/items/0",
      "raw$ref": { key: "raw/example-list/2026-01-02/a.json", versionId: "v1", pointer: "/items/0" },
    });
    expect(lines[0].ingestedAt).toBeTypeOf("string");
  });

  it("generic files get no sidecar; the sidecar's own ObjectCreated event makes no row and no call", async () => {
    expect(await handler({ Records: [s3Record("in/plain.json", LIST_BODY), s3Record("sidecar/example-list/2026-01-02/a.json.jsonl", "{}\n")] } as S3Event)).toEqual({ written: 1, skipped: 1 });
    expect(sidecarPuts()).toHaveLength(0);
    expect(calls).toEqual(["PUT in/plain.json"]);
  });

  it("a failed sidecar write fails the invocation before the file row, so the retry writes it again", async () => {
    s3Send.mockImplementation(async (cmd: { input: { Key: string } }) => {
      if (cmd instanceof PutObjectCommand) throw Object.assign(new Error("slow down"), { name: "SlowDown" });
      return cmd instanceof HeadObjectCommand ? { ContentType: "application/json", VersionId: "v1" } : { Body: { transformToString: async () => LIST_BODY } };
    });
    await expect(handler({ Records: [s3Record("raw/example-list/2026-01-02/a.json", LIST_BODY)] } as S3Event)).rejects.toThrow("slow down");
    expect(calls).not.toContain("PUT raw/example-list/2026-01-02/a.json");
  });

  it("an older version's event (late or redelivered) writes no sidecar — the latest version's records stay — but still makes its rows", async () => {
    latest = "v2";
    await handler({ Records: [s3Record("raw/example-list/2026-01-02/a.json", LIST_BODY)] } as S3Event);
    expect(sidecarPuts()).toHaveLength(0);
    expect(calls).toContain("PUT raw/example-list/2026-01-02/a.json");
  });

  it("a key deleted before its event is processed (latest = delete marker, HEAD 404) writes no sidecar and does not fail", async () => {
    latest = "deleted";
    await handler({ Records: [s3Record("raw/example-list/2026-01-02/a.json", LIST_BODY)] } as S3Event);
    expect(sidecarPuts()).toHaveLength(0);
    expect(calls).toContain("PUT raw/example-list/2026-01-02/a.json");
  });
});
