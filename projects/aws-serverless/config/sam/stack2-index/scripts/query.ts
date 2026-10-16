/**
 * Three example queries against the collection, signed with the current AWS profile.
 *   COLLECTION_ENDPOINT=https://xxx.ap-northeast-2.aoss.amazonaws.com npx tsx scripts/query.ts [index]
 * The caller's IAM principal must be in the collection's data access policy (QueryPrincipalArn).
 */
import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

const node = process.env.COLLECTION_ENDPOINT;
if (!node) throw new Error("COLLECTION_ENDPOINT required");
const index = process.argv[2] ?? "docs";
const region = process.env.AWS_REGION ?? "ap-northeast-2";
const client = new Client({ ...AwsSigv4Signer({ region, service: "aoss", getCredentials: () => defaultProvider()() }), node });

const show = (title: string, v: unknown) => console.log(`\n== ${title}\n${JSON.stringify(v, null, 2)}`);

// 1. search: exact key match + full-text on the .text sub-field
const search = await client.search({
  index,
  body: { size: 5, query: { bool: { should: [{ term: { docId: "sample.json" } }, { match: { "docId.text": "로그" } }] } }, _source: ["docId", "version", "size", "@timestamp"] },
});
show("search hits", (search.body.hits.hits as unknown as Array<{ _id: string; _source: unknown }>).map((h) => ({ _id: h._id, ...(h._source as object) })));

// 2. aggregation: documents per docId, total bytes
const agg = await client.search({
  index,
  body: { size: 0, aggs: { by_doc: { terms: { field: "docId", size: 10 }, aggs: { bytes: { sum: { field: "size" } } } } } },
});
show("agg by docId", agg.body.aggregations);

// 3. time-series: count per hour over the last day
const ts = await client.search({
  index,
  body: {
    size: 0,
    query: { range: { "@timestamp": { gte: "now-1d" } } },
    aggs: { per_hour: { date_histogram: { field: "@timestamp", fixed_interval: "1h", min_doc_count: 1 } } },
  },
});
show("per hour (last 24h)", ts.body.aggregations);

const count = await client.count({ index });
show("total", count.body.count);
