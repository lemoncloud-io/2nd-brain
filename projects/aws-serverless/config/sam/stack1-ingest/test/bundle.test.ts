import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

// The Lambda runs an esbuild bundle (template: cjs, minified), where the dynamic-import glob behaves differently
// from vitest — a missing name throws synchronously. Bundle route.ts the same way and load names from it.
describe("loadTransformer in the esbuild bundle", () => {
  it("bundles every src/transformers/*.mts; a missing name is undefined, not a crash", async () => {
    const out = await build({ entryPoints: ["src/route.ts"], bundle: true, format: "cjs", platform: "node", target: "es2022", minify: true, write: false, logLevel: "silent" });
    const file = join(mkdtempSync(join(tmpdir(), "route-")), "route.cjs");
    writeFileSync(file, out.outputFiles[0].text);
    const { loadTransformer } = createRequire(import.meta.url)(file) as typeof import("../src/route.js");
    expect(await loadTransformer("llm-gateway-log")).toBeTypeOf("function");
    expect(await loadTransformer("example-list")).toBeTypeOf("function");
    expect(await loadTransformer("no-such-format")).toBeUndefined();
  });
});
