/**
 * Run a transformer on a local file and print one JSON per line — what the ingest will store as rows.
^ * Usage: npx tsx scripts/run-transform.mts <transformer> <file>   (e.g. llm-gateway-log sample.json)
 * <transformer> = any src/transformers/<name>.mts; in S3 the same file goes to raw/<name>/<date>/<file>.
 */
import { readdirSync, readFileSync } from "node:fs";
import { loadTransformer } from "../src/route.js";

const [name, file] = process.argv.slice(2);
if (!name || !file) {
  console.error("usage: npx tsx scripts/run-transform.mts <transformer> <file>");
  process.exit(64);
}
const transform = await loadTransformer(name);
if (!transform) {
  const names = readdirSync(new URL("../src/transformers/", import.meta.url)).filter((f) => f.endsWith(".mts")).map((f) => f.slice(0, -4));
  console.error(`no transformer ${name} — src/transformers/ has: ${names.join(", ")}`);
  process.exit(64);
}
const items = transform(readFileSync(file, "utf8"));
if (!items) {
  console.error(`${name}: not a file this transformer reads`);
  process.exit(65);
}
for (const { data } of items) console.log(JSON.stringify(data));
console.error(`${name}: ${items.length} records`);
