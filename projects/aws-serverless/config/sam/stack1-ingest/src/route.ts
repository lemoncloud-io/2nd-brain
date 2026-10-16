import type { Transformed } from "./transform.js";

/** A transformer module (src/transformers/<name>.mts): file body → one JSON per record, undefined when the body is not its format. */
export type Transform = (body: string) => Transformed[] | undefined;
/** Transformer names are data formats (`llm-gateway-log`), never company names: lowercase words joined by `-`. */
export const TRANSFORMER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `raw/<name>/<date>/<file>` → `<name>`; any other key (or a segment that is not a name) → undefined. */
export const transformerName = (s3Key: string): string | undefined => {
  const [root, name, ...rest] = s3Key.split("/");
  return root === "raw" && rest.length > 0 && TRANSFORMER_NAME.test(name) ? name : undefined;
};

// "No such file", as each runtime says it: the esbuild bundle (Lambda), vitest, node/tsx (scripts/run-transform.mts).
const MISSING = /Module not found in bundle|Unknown variable dynamic import|ERR_MODULE_NOT_FOUND|Cannot find module/;

const loaded = new Map<string, Promise<Transform | undefined>>();

/**
 * The transformer in src/transformers/<name>.mts, or undefined when there is no such file. No list to edit:
 * esbuild bundles every file this glob matches (checked in the `sam build` output, 2026-10-12). A file that
 * exists but fails to load throws — the event then retries and lands in the DLQ instead of silently going generic.
 */
export const loadTransformer = (name: string): Promise<Transform | undefined> => {
  if (!TRANSFORMER_NAME.test(name)) return Promise.resolve(undefined);
  const cached = loaded.get(name);
  if (cached) return cached;
  // wrapped: in the esbuild bundle a missing name throws synchronously instead of rejecting (measured 2026-10-12)
  const p = Promise.resolve()
    .then(() => import(`./transformers/${name}.mts`))
    .then(
      (m: { transform?: unknown }) => {
        if (typeof m.transform !== "function") throw new Error(`transformers/${name}.mts does not export transform`);
        return m.transform as Transform;
      },
      (err: unknown) => {
        if (MISSING.test(`${(err as { code?: string }).code ?? ""} ${String((err as Error).message ?? err)}`)) return undefined;
        throw err;
      },
    );
  loaded.set(name, p);
  p.catch(() => loaded.delete(name)); // a failed load is not cached, so the Lambda retry tries again
  return p;
};
