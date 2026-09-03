// digest.html의 원격 이미지를 data URI로 인라인 임베딩해 자체 완결 문서로 만든다. 트래킹 픽셀은 제거.
// `node embed-images.mts <date-dir>` — <date-dir>/digest.src.html(원본 보존) → <date-dir>/digest.html(임베딩판)
// origin: lemoncloud-io/knowledge@8480503:projects/second-brain/config/skills/medium-digest/scripts/embed-images.mts
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node embed-images.mts <date-dir>"); process.exit(2); }
const src = join(dir, "digest.src.html"), out = join(dir, "digest.html");
if (!existsSync(src)) {
  if (!existsSync(out)) { console.error(`missing ${out} (expected a Gmail export copied to digest.html)`); process.exit(2); }
  copyFileSync(out, src);           // 첫 실행: 현재 digest.html을 원본으로 보존
}
let html = readFileSync(src, "utf8");
if (html.includes("--- BODY ---")) html = html.split("--- BODY ---")[1].trimStart();  // Gmail export 헤더 제거

// 트래킹 픽셀 제거 (Medium open-stat, SendGrid open)
const before = html.length;
html = html.replace(/<img [^>]*src="https:\/\/(?:medium\.com\/_\/stat|[^"]*\.sendgrid\.net\/wf\/open)[^"]*"[^>]*>/g, "");
const pixels = before !== html.length;

const urls = [...new Set([...html.matchAll(/<img [^>]*src="(https:\/\/[^"]+)"/g)].map(m => m[1]))];
const cache = new Map<string, string>();
let ok = 0, fail = 0;
await Promise.all(urls.map(async (u) => {
  try {
    const r = await fetch(u, { redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    cache.set(u, `data:${type};base64,${b64}`); ok++;
  } catch (e) { fail++; console.error(`skip ${u.slice(0, 80)} — ${(e as Error).message}`); }
}));
html = html.replace(/(<img [^>]*src=")(https:\/\/[^"]+)(")/g, (_, a, u, c) => a + (cache.get(u) ?? u) + c);
// 외부 CSS(glyph.medium.com)는 폰트만 — 오프라인 렌더에 불필요, 제거
html = html.replace(/<link [^>]*glyph\.medium\.com[^>]*>/g, "");
writeFileSync(out, html);
console.error(`embedded ${ok}/${urls.length} images (fail ${fail}), pixels removed: ${pixels}, ${(html.length / 1024).toFixed(0)} KB → ${out}`);
