import { describe, expect, it } from "vitest";
import { ddbSize, jsonBytes, MAX_INLINE_JSON_BYTES, MAX_NESTING_DEPTH, offloadLargeFields, REF_SUFFIX, type S3Ref } from "../src/transform.js";
import { JSON_FIXTURES, KiB, nested, utf8 } from "./fixtures.js";

const SRC = { key: "logs/2026/10/02/batch-0001.json", versionId: "3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY" };
const DDB_ITEM_MAX = 400 * 1024; // DynamoDB item size limit, 400 KB = 409,600 bytes

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** DynamoDB item size = Σ (attribute name bytes + value size), values sized by the AWS rules in ddbSize. */
const itemSize = (item: Obj): number =>
  Object.entries(item).reduce((n, [k, v]) => (v === undefined ? n : n + utf8(k) + ddbSize(v)), 0);

/** The row ingest writes: S3 metadata + data. */
const rowOf = (data: Obj): Obj => ({
  docId: SRC.key,
  version: SRC.versionId,
  bucket: "sls-test-ingest-data-000000000000",
  size: 9_999_999,
  etag: "0123456789abcdef0123456789abcdef",
  eventTime: "2026-10-02T00:00:00.000Z",
  eventName: "ObjectCreated:CompleteMultipartUpload",
  ingestedAt: "2026-10-02T00:00:01.000Z",
  data,
});

/** Nesting levels counted strictly (see MAX_NESTING_DEPTH): a scalar or empty map/list is 1, a map/list 1 + its deepest value. */
const depth = (v: unknown): number =>
  typeof v !== "object" || v === null ? 1 : 1 + (Array.isArray(v) ? v : Object.values(v)).reduce((m: number, x) => Math.max(m, depth(x)), 0);

/** Deepest top-level attribute of the row — `data` is level 1. */
const rowDepth = (data: Obj): number => Math.max(...Object.values(rowOf(data)).map(depth));

/** RFC 6901 JSON Pointer lookup. */
const resolve = (doc: unknown, pointer: string): unknown =>
  pointer === ""
    ? doc
    : pointer
        .slice(1)
        .split("/")
        .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
        .reduce((cur: unknown, t) => (cur as Obj)[t], doc);

/** All refs in data (they only ever sit at object keys, never inside arrays). */
const refsIn = (v: unknown): S3Ref[] =>
  isObj(v) ? Object.entries(v).flatMap(([k, x]) => (k.endsWith(REF_SUFFIX) ? [x as S3Ref] : refsIn(x))) : [];

/** Put every offloaded value back from the original body. Lossless offloading ⇒ this equals the original. */
const rehydrate = (data: unknown, original: unknown): unknown => {
  if (!isObj(data)) return data;
  const only = Object.keys(data);
  if (only.length === 1 && only[0] === REF_SUFFIX) return resolve(original, (data[REF_SUFFIX] as S3Ref).pointer);
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) =>
      k.endsWith(REF_SUFFIX) ? [k.slice(0, -REF_SUFFIX.length), resolve(original, (v as S3Ref).pointer)] : [k, rehydrate(v, original)],
    ),
  );
};

/** Row data shape: objects as-is, anything else as { value }. */
const asData = (doc: unknown): Obj => (isObj(doc) ? doc : { value: doc });

const run = (name: string): { doc: unknown; data: Obj } => {
  const doc: unknown = JSON.parse(JSON_FIXTURES[name]);
  return { doc, data: offloadLargeFields(doc, SRC) };
};

describe("ddbSize — DynamoDB item-size rules (AWS developer guide, 'Item sizes and formats')", () => {
  it("strings are UTF-8 bytes", () => {
    expect(ddbSize("abc")).toBe(3);
    expect(ddbSize("가")).toBe(3);
  });
  it("numbers: AWS's 'approximately 1 + 1 per two significant digits', digits untrimmed, +1 byte margin", () => {
    expect(ddbSize(1)).toBe(3);
    expect(ddbSize(12)).toBe(3);
    expect(ddbSize(123)).toBe(4);
    expect(ddbSize(0.5)).toBe(3);
  });
  it("boolean and null are 1 byte", () => {
    expect(ddbSize(true)).toBe(1);
    expect(ddbSize(null)).toBe(1);
  });
  it("list/map: 3 bytes + 1 byte per element (+ key bytes for a map)", () => {
    expect(ddbSize([])).toBe(3);
    expect(ddbSize({})).toBe(3);
    expect(ddbSize(["a"])).toBe(3 + 1 + 1);
    expect(ddbSize({ a: "b" })).toBe(3 + 1 + 1 + 1);
    expect(ddbSize({ a: [1] })).toBe(3 + 1 + 1 + (3 + 1 + 3));
  });
  it("item = Σ attribute name + value, no element overhead at the top level", () => {
    expect(itemSize({ docId: "k", n: 1 })).toBe(5 + 1 + (1 + 3));
  });
});

describe.each(Object.keys(JSON_FIXTURES))("invariants: %s", (name) => {
  const { doc, data } = run(name);

  it("row ≤ 400KB (DynamoDB limit) and data ≤ 256KiB (design target)", () => {
    expect(itemSize(rowOf(data))).toBeLessThanOrEqual(DDB_ITEM_MAX);
    expect(ddbSize(data)).toBeLessThanOrEqual(MAX_INLINE_JSON_BYTES);
  });

  it("row nesting ≤ 32 levels (DynamoDB limit, counted strictly)", () => {
    expect(rowDepth(data)).toBeLessThanOrEqual(MAX_NESTING_DEPTH);
  });

  it("round trip: every ref's pointer resolves in the original body to a value of exactly ref.bytes", () => {
    for (const ref of refsIn(data)) {
      expect(ref.key).toBe(SRC.key);
      expect(ref.versionId).toBe(SRC.versionId);
      expect(jsonBytes(resolve(doc, ref.pointer))).toBe(ref.bytes);
    }
  });

  it("lossless: putting every ref's value back reproduces the original document", () => {
    expect(rehydrate(data, doc)).toEqual(asData(doc));
  });

  it("deterministic and does not mutate its input", () => {
    const before = JSON.stringify(doc);
    expect(JSON.stringify(offloadLargeFields(doc, SRC))).toBe(JSON.stringify(data));
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("offloadLargeFields — cut rules", () => {
  it.each(["255KiB file", "exactly 256KiB file", "256KiB+1 byte file"])("%s fits whole: data is the parsed body, byte for byte", (name) => {
    const { doc, data } = run(name);
    expect(JSON.stringify(data)).toBe(JSON.stringify(doc));
  });

  it("a field over 256KiB becomes <field>$ref; small siblings stay", () => {
    const { doc, data } = run("one big field + small fields");
    const { body, ...small } = doc as Obj;
    expect(data).toEqual({ ...small, [`body${REF_SUFFIX}`]: { ...SRC, pointer: "/body", bytes: jsonBytes(body) } });
  });

  it("objects are descended, arrays are cut whole: request.messages goes, request.model stays", () => {
    const { doc, data } = run("nested big value");
    const { request, response } = doc as { request: Obj; response: Obj };
    expect(data.response).toEqual(response);
    expect(data.request).toEqual({
      model: "model-a",
      temperature: 0.2,
      [`messages${REF_SUFFIX}`]: { ...SRC, pointer: "/request/messages", bytes: jsonBytes(request.messages) },
    });
  });

  it("an object still over 256KiB after descending (all small values) is cut whole", () => {
    const { data } = run("object of small values over 256KiB");
    expect(Object.keys(data)).toEqual(["id", `headers${REF_SUFFIX}`]);
  });

  it("guard: three 200KiB fields → the largest are cut until data ≤ 256KiB, ties in pointer order; the last stays inline", () => {
    const { doc, data } = run("three 200KiB fields (guard)");
    expect(Object.keys(data).sort()).toEqual(["a$ref", "b$ref", "c", "id"]);
    expect(data.c).toBe((doc as Obj).c);
  });

  it("a big array is cut whole; its sibling stays", () => {
    const { doc, data } = run("big array");
    expect(data.meta).toEqual((doc as Obj).meta);
    expect((data[`items${REF_SUFFIX}`] as S3Ref).pointer).toBe("/items");
  });

  it("Korean keys and '/', '~' are escaped per RFC 6901", () => {
    const { data } = run("multibyte (Korean) strings");
    expect(refsIn(data).map((r) => r.pointer).sort()).toEqual(["/a~1b~0c", "/본문"]);
    expect(data.제목).toBe("합성 한글 문서");
    expect(data.요약).toBe("짧은 값");
  });

  it("a non-object root is wrapped as { value } and its ref points at the whole document (\"\")", () => {
    const { data } = run("root array over 256KiB");
    expect(Object.keys(data)).toEqual([`value${REF_SUFFIX}`]);
    expect((data[`value${REF_SUFFIX}`] as S3Ref).pointer).toBe("");
  });

  it("nothing worth cutting (all values tiny) → the whole document becomes one ref", () => {
    const { data } = run("flat object of tiny values over 256KiB");
    expect(data).toEqual({ [REF_SUFFIX]: { ...SRC, pointer: "", bytes: utf8(JSON_FIXTURES["flat object of tiny values over 256KiB"]) } });
  });

  it("guard also covers files under 256KiB whose DynamoDB encoding would exceed 400KB", () => {
    const { doc, data } = run("under 256KiB file, DynamoDB encoding over 400KB");
    expect(utf8(JSON_FIXTURES["under 256KiB file, DynamoDB encoding over 400KB"])).toBeLessThanOrEqual(256 * KiB);
    expect(itemSize(rowOf(asData(doc)))).toBeGreaterThan(DDB_ITEM_MAX); // inlined whole, the Put would be rejected
    expect(Object.keys(data)).toEqual([`value${REF_SUFFIX}`]);
  });

  it("depth: exactly 32 levels fits whole; one more object and it is cut", () => {
    const { doc, data } = run("nested exactly 32 levels");
    expect(depth(data)).toBe(MAX_NESTING_DEPTH);
    expect(data).toEqual(doc);
    expect(refsIn(offloadLargeFields(JSON.parse(nested(32, "1")), SRC))).toHaveLength(1);
  });

  it("depth: objects are descended while a ref (2 levels) still fits; the object at level 31 is cut whole", () => {
    const { doc, data } = run("object nesting past 32 levels");
    const pointer = "/deep" + "/a".repeat(29);
    expect(data.id).toBe("deep-1");
    expect(refsIn(data)).toEqual([{ ...SRC, pointer, bytes: jsonBytes(resolve(doc, pointer)) }]);
    expect(rowDepth(data)).toBe(MAX_NESTING_DEPTH); // cut no higher than needed
  });

  it("depth: an array too deep to fit is cut whole at its field", () => {
    const { data } = run("array nesting past 32 levels");
    expect(Object.keys(data)).toEqual(["id", `matrix${REF_SUFFIX}`]);
    expect((data[`matrix${REF_SUFFIX}`] as S3Ref).pointer).toBe("/matrix");
  });

  it("depth: a size cut whose ref would land one level too deep folds into its parent (second depth pass)", () => {
    const { doc, data } = run("300KiB value at level 31");
    const pointer = "/deep" + "/a".repeat(29);
    expect(depth(doc)).toBe(MAX_NESTING_DEPTH); // fits as uploaded; only the field rule's ref would not
    expect(refsIn(data)).toEqual([{ ...SRC, pointer, bytes: jsonBytes(resolve(doc, pointer)) }]);
  });

  it("src.pointer prefixes every ref — for record-level parsers that pass one record of a larger file", () => {
    const doc = JSON.parse(JSON_FIXTURES["one big field + small fields"]);
    const data = offloadLargeFields(doc, { ...SRC, pointer: "/records/3" });
    expect((data[`body${REF_SUFFIX}`] as S3Ref).pointer).toBe("/records/3/body");
  });
});
