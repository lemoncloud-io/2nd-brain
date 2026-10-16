/**
 * Index mapping for stack 1's `llm-gateway-log` rows (index `<IndexName>-llm-gateway-log`): one document per
 * LLM call with a fixed set of 25 fields (the ones the transformer keeps). The S3 ref,
 * ttl and row keys stay in DynamoDB. `dynamic: strict` keeps the field count fixed — the 1,000-field limit hit
 * on 2026-10-06 came from dynamic mapping of whole records.
 */

/** `_id` = this row field, so the same call arriving in two files is one document (survey Q21). */
export const ID_FIELD = "responseId";

export const INDEX_BODY = {
  settings: { index: { number_of_shards: 1 } },
  mappings: {
    dynamic: "strict",
    properties: {
      responseId: { type: "keyword" },
      createdAt: { type: "date" },
      dayKst: { type: "keyword" },
      ingestedAt: { type: "date" },
      indexedAt: { type: "date" },
      gateway: { type: "keyword" },
      provider: { type: "keyword" },
      model: { type: "keyword" },
      statusCode: { type: "short" },
      success: { type: "boolean" },
      responseStatus: { type: "keyword" },
      errorCode: { type: "keyword" },
      incompleteReason: { type: "keyword" },
      durationMs: { type: "long" },
      cached: { type: "boolean" },
      tokensIn: { type: "long" },
      cachedTokens: { type: "long" },
      cacheWriteTokens: { type: "long" },
      tokensOut: { type: "long" },
      reasoningTokens: { type: "long" },
      totalTokens: { type: "long" },
      webSearchRequests: { type: "short" },
      imageGenTokens: { type: "long" },
      reasoningEffort: { type: "keyword" },
      maxOutputTokens: { type: "integer" },
    },
  },
} as const;
