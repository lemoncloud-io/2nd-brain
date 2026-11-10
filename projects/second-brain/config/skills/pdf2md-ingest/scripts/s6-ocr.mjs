// S6: PDF -> pdftoppm 150dpi -> ppu-paddle-ocr -> 페이지 마커 MD (pdf2md-ingest)
//
// bare import가 런타임 node_modules를 보도록, 반드시 런타임 디렉토리로 복사 후 실행:
//   RUNTIME=~/.cache/ppu-paddle-ocr-runtime
//   cp scripts/s6-ocr.mjs "$RUNTIME/" && node "$RUNTIME/s6-ocr.mjs" <pdf> <out.md> [--model v6-tiny]
//
// 기본 모델 v5-korean-mobile (v6 tiny/small은 한글을 한자로 오인식 — wiki/pp-ocrv6.md 실측)
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PaddleOcrService, V5_KOREAN_MOBILE_MODEL, V6_TINY_MODEL } from "ppu-paddle-ocr";

const args = process.argv.slice(2);
let model = V5_KOREAN_MOBILE_MODEL;
const mi = args.indexOf("--model");
if (mi !== -1) {
  const name = args[mi + 1];
  if (name === "v6-tiny") model = V6_TINY_MODEL;
  else if (name !== "v5-korean-mobile") {
    console.error(`unknown model: ${name} (v5-korean-mobile | v6-tiny)`);
    process.exit(2);
  }
  args.splice(mi, 2);
}
const [pdf, out] = args;
if (!pdf || !out) {
  console.error("usage: node s6-ocr.mjs <pdf> <out.md> [--model v6-tiny]");
  process.exit(2);
}

const pagesDir = await mkdtemp(join(tmpdir(), "s6-pages-"));
try {
  execFileSync("pdftoppm", ["-png", "-r", "150", pdf, join(pagesDir, "p")]);
  const files = (await readdir(pagesDir)).filter((f) => f.endsWith(".png")).sort();
  if (files.length === 0) throw new Error("pdftoppm produced no pages");

  const service = new PaddleOcrService({ model });
  await service.initialize();
  const t0 = performance.now();
  const parts = [];
  for (const [i, f] of files.entries()) {
    const buf = await readFile(join(pagesDir, f));
    // v6.3.0 Node API는 문자열 경로 미지원 — ArrayBuffer로 전달 (wiki/pp-ocrv6.md 실측)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const result = await service.recognize(ab);
    parts.push(`<!-- page ${i + 1} -->\n\n${result.text.trim()}\n`);
    console.error(`page ${i + 1}/${files.length} (${result.text.length} chars)`);
  }
  await writeFile(out, parts.join("\n"));
  console.error(`--- ${files.length} pages, ${((performance.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
  await service.destroy();
} finally {
  await rm(pagesDir, { recursive: true, force: true });
}
