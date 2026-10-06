/**
 * Full re-index: scan the DynamoDB table and replay every row through the index
 * function as synthetic INSERT stream records, 100 per invoke (same batch size as
 * the event source mapping). Use after a mapping change (new IndexName) or when the
 * stream retention (24 h) was exceeded.
 *
 *   AWS_PROFILE=sls-deployer npx tsx scripts/reindex.ts <table-name> <index-function-name> [--dry-run]
 *
 * Uses the AWS CLI (already required for the pipeline), so it needs no extra SDK
 * packages. The caller's key only needs dynamodb:Scan and lambda:InvokeFunction —
 * both inside the deployer allowlist. Pages of 1,000 rows: `--max-items` makes the
 * CLI stop and return NextToken (without it CLI v2 auto-paginates the whole table into
 * one response). Idempotent: the index _id is docId#version, so replaying an existing
 * row overwrites it. Stops at the first failing batch (the payload file is kept) — fix
 * the offending rows first; see aws-dynamodb-stream.md § DLQ.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [table, fn] = args.filter((a) => a !== "--dry-run");
if (!table || !fn) {
  console.error("usage: reindex.ts <table-name> <index-function-name> [--dry-run]");
  process.exit(64);
}
const region = process.env.AWS_REGION ?? "ap-northeast-2";
const BATCH = 100;

type AttrMap = Record<string, unknown>;
const aws = (args: string[]): string =>
  execFileSync("aws", [...args, "--region", region, "--output", "json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function* scanAll(): Generator<AttrMap> {
  let token: string | undefined;
  do {
    const cmd = ["dynamodb", "scan", "--table-name", table, "--max-items", "1000"];
    if (token) cmd.push("--starting-token", token);
    const page = JSON.parse(aws(cmd)) as { Items: AttrMap[]; NextToken?: string };
    for (const item of page.Items) yield item;
    token = page.NextToken;
  } while (token);
}

// Lambda's synchronous invoke payload limit is 6 MB; 1 MB headroom covers the stream-record envelope.
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

const dir = mkdtempSync(join(tmpdir(), "reindex-"));
let batch: AttrMap[] = [];
let batchBytes = 0;
let total = 0;
let invokes = 0;

function flush(): void {
  if (batch.length === 0) return;
  const records = batch.map((item) => ({
    eventName: "INSERT",
    eventSource: "aws:dynamodb",
    awsRegion: region,
    dynamodb: { Keys: { docId: item.docId, version: item.version }, NewImage: item, StreamViewType: "NEW_AND_OLD_IMAGES" },
  }));
  const file = join(dir, `batch-${invokes}.json`);
  writeFileSync(file, JSON.stringify({ Records: records }));
  if (!dryRun) {
    const out = aws(["lambda", "invoke", "--function-name", fn, "--cli-binary-format", "raw-in-base64-out", "--payload", `file://${file}`, join(dir, `out-${invokes}.json`)]);
    const meta = JSON.parse(out) as { StatusCode: number; FunctionError?: string };
    if (meta.StatusCode !== 200 || meta.FunctionError) throw new Error(`invoke failed on batch ${invokes}: ${JSON.stringify(meta)} (payload kept at ${file})`);
  }
  invokes += 1;
  total += batch.length;
  console.log(`${dryRun ? "[dry-run] " : ""}batch ${invokes}: ${batch.length} rows (total ${total})`);
  batch = [];
  batchBytes = 0;
}

for (const item of scanAll()) {
  const size = Buffer.byteLength(JSON.stringify(item));
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(`row ${JSON.stringify({ docId: item.docId, version: item.version })} is ${size} bytes, over the ${MAX_PAYLOAD_BYTES}-byte invoke limit — reindex it on its own`);
  }
  if (batch.length === BATCH || batchBytes + size > MAX_PAYLOAD_BYTES) flush();
  batch.push(item);
  batchBytes += size;
}
flush();
console.log(`done: ${total} rows in ${invokes} invokes. Verify with scripts/query.ts, then delete the old index if this was a mapping change.`);
