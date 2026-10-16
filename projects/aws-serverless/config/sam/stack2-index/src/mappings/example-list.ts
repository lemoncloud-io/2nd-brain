/**
 * Index mapping for stack 1's example transformer `example-list` (synthetic format) — copy this file with the
 * transformer's name to give a new format its own strict index `<IndexName>-<name>`. Only the fields listed
 * here are indexed; `ingestedAt`/`indexedAt` come from the row. A format with no file here is indexed the
 * generic way (whole row, index `<IndexName>`).
 */

/** Row field used as the document `_id` (rows without it use their key). */
export const ID_FIELD = "id";

export const INDEX_BODY = {
  settings: { index: { number_of_shards: 1 } },
  mappings: {
    dynamic: "strict",
    properties: {
      id: { type: "keyword" },
      time: { type: "date" },
      value: { type: "double" },
      ingestedAt: { type: "date" },
      indexedAt: { type: "date" },
    },
  },
} as const;
