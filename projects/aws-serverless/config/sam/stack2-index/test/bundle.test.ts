import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

// The Lambda runs an esbuild bundle (template: cjs, minified), where the dynamic-import glob behaves differently
// from vitest — a missing name throws synchronously. Bundle route.ts the same way and load names from it.
describe("loadMapping in the esbuild bundle", () => {
  it("bundles every src/mappings/*.ts; a missing name is undefined, not a crash", async () => {
    const out = await build({ entryPoints: ["src/route.ts"], bundle: true, format: "cjs", platform: "node", target: "es2022", minify: true, write: false, logLevel: "silent" });
    const file = join(mkdtempSync(join(tmpdir(), "route-")), "route.cjs");
    writeFileSync(file, out.outputFiles[0].text);
    const { loadMapping } = createRequire(import.meta.url)(file) as typeof import("../src/route.js");
    expect((await loadMapping("llm-gateway-log"))?.ID_FIELD).toBe("responseId");
    expect((await loadMapping("example-list"))?.ID_FIELD).toBe("id");
    expect(await loadMapping("no-such-format")).toBeUndefined();
  });
});
