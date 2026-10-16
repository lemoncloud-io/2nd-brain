/**
 * Delete one index from the collection — the last step of a mapping change, after the
 * new index is re-indexed, checked with query.ts and the query target has moved.
 *   COLLECTION_ENDPOINT=https://xxx.ap-northeast-2.aoss.amazonaws.com npx tsx scripts/delete-index.ts <index> --yes
 * Refuses to run without --yes, and refuses LIVE_INDEX when set (pass the IndexName the function now writes to).
 */
import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

const node = process.env.COLLECTION_ENDPOINT;
const [index, confirm] = process.argv.slice(2);
if (!node || !index || confirm !== "--yes") {
  console.error("usage: COLLECTION_ENDPOINT=... delete-index.ts <index> --yes");
  process.exit(64);
}
if (process.env.LIVE_INDEX && process.env.LIVE_INDEX === index) {
  console.error(`refusing: ${index} is LIVE_INDEX`);
  process.exit(64);
}
const region = process.env.AWS_REGION ?? "ap-northeast-2";
const client = new Client({ ...AwsSigv4Signer({ region, service: "aoss", getCredentials: () => defaultProvider()() }), node });
const before = await client.count({ index });
await client.indices.delete({ index });
console.log(`deleted ${index} (${before.body.count} docs)`);
