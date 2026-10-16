import type { DynamoDBRecord } from "aws-lambda";

/** A format's index mapping (src/mappings/<name>.ts, same name as stack 1's transformer). */
export interface Mapping {
  INDEX_BODY: { mappings: { properties: Record<string, unknown> } };
  /** Row field used as `_id`; unset = the row key. */
  ID_FIELD?: string;
}

/** Same rule as stack 1's transformer names: lowercase words joined by `-`. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The `transformer` stack 1 put on the row (old image for a REMOVE); undefined for a generic row. */
export const transformerOf = (record: DynamoDBRecord): string | undefined => {
  const image = record.eventName === "REMOVE" ? record.dynamodb?.OldImage : record.dynamodb?.NewImage;
  const name = image?.transformer?.S;
  return name && NAME.test(name) ? name : undefined;
};

// "No such file", as each runtime says it: the esbuild bundle (Lambda), vitest, node/tsx.
const MISSING = /Module not found in bundle|Unknown variable dynamic import|ERR_MODULE_NOT_FOUND|Cannot find module/;

const loaded = new Map<string, Promise<Mapping | undefined>>();

/**
 * The mapping in src/mappings/<name>.ts, or undefined when there is none (the row is then indexed the generic
 * way). esbuild bundles every file the glob matches, so adding a file is enough. A file that exists but fails
 * to load throws — the batch retries and lands in the DLQ.
 */
export const loadMapping = (name: string): Promise<Mapping | undefined> => {
  if (!NAME.test(name)) return Promise.resolve(undefined);
  const cached = loaded.get(name);
  if (cached) return cached;
  // wrapped: in the esbuild bundle a missing name throws synchronously instead of rejecting (measured 2026-10-12)
  const p = Promise.resolve()
    .then(() => import(`./mappings/${name}.ts`))
    .then(
      (m: Partial<Mapping>) => {
        if (!m.INDEX_BODY?.mappings?.properties) throw new Error(`mappings/${name}.ts does not export INDEX_BODY`);
        return m as Mapping;
      },
      (err: unknown) => {
        if (MISSING.test(`${(err as { code?: string }).code ?? ""} ${String((err as Error).message ?? err)}`)) return undefined;
        throw err;
      },
    );
  loaded.set(name, p);
  p.catch(() => loaded.delete(name)); // a failed load is not cached, so the retry tries again
  return p;
};
