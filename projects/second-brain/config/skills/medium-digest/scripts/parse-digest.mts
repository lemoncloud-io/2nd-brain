// Medium Daily Digest(html) → 아티클 목록 JSON. 의존성 0, erasable TS — `node parse-digest.mts <digest.html> [out.json]`
// 입력: workspace-mcp get_gmail_message_content(body_format=html, full=true)가 저장한 파일(헤더 + "--- BODY ---" + html) 또는 순수 html.
// origin: lemoncloud-io/knowledge@8480503:projects/second-brain/config/skills/medium-digest/scripts/parse-digest.mts
import { readFileSync, writeFileSync } from "node:fs";

type Article = {
  n: number; title: string; subtitle: string; url: string; slug: string;
  author: string | null; handle: string | null; publication: string | null;
  member_only: boolean; read_min: number | null; claps: number | null; responses: number;
};

const unescape = (s: string): string =>
  s.replace(/<[^>]+>/g, "")
   .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();

const [, , inPath, outPath] = process.argv;
if (!inPath) { console.error("usage: node parse-digest.mts <digest.html> [out.json]"); process.exit(2); }
const src = readFileSync(inPath, "utf8");
const body = src.includes("--- BODY ---") ? src.split("--- BODY ---")[1] : src;

const card = /<a href="(https:\/\/medium\.com\/[^"]+?)\?source=[^"]*" style="[^"]*display: block;"><h2[^>]*>(.*?)<\/h2>(?:<div[^>]*><h3[^>]*>(.*?)<\/h3>)?/gs;
const items: Article[] = [];
for (const m of body.matchAll(card)) {
  const url = m[1];
  const pre = body.slice(Math.max(0, m.index! - 3000), m.index!);
  const post = body.slice(m.index! + m[0].length, m.index! + m[0].length + 2500);
  const authors = [...pre.matchAll(/<a href="https:\/\/medium\.com\/(@[^/?"]+)\?[^"]*" style="color: inherit; text-decoration: none;">([^<]+)<\/a><\/span>/g)];
  const pubs = [...pre.matchAll(/>in<\/span>.*?<a href="https:\/\/medium\.com\/([^@/?"]+)\?[^"]*"[^>]*>([^<]+)<\/a>/gs)];
  const alt = pre.slice(-800).match(/<img alt="([^"]+)" src="https:\/\/miro\.medium\.com\/fit\/c\/320\/214/);
  const rt = post.match(/(\d+) min read/);
  const nums = [...post.matchAll(/line-height: 20px;">(\d+)<\/span>/g)].map(x => Number(x[1]));
  const last = authors.at(-1), pub = pubs.at(-1);
  const slugFull = url.split("/").pop() ?? "";
  items.push({
    n: items.length + 1,
    title: alt ? unescape(alt[1]) : unescape(m[2]),
    subtitle: unescape(m[3] ?? ""),
    url, slug: ((s: string) => s.length <= 48 ? s : s.slice(0, 48).replace(/-[^-]*$/, ""))(slugFull.replace(/-[0-9a-f]{8,}$/, "")),
    author: last ? unescape(last[2]) : null, handle: last ? last[1] : null,
    publication: pub ? unescape(pub[2]) : null,
    member_only: post.includes("Member-only content"),
    read_min: rt ? Number(rt[1]) : null,
    claps: nums[0] ?? null, responses: nums[1] ?? 0,
  });
}
if (items.length === 0) { console.error("no articles parsed — html 구조 변경 여부 확인"); process.exit(1); }
const out = JSON.stringify({ source: inPath, parsed_at: new Date().toISOString(), count: items.length, articles: items }, null, 1);
if (outPath) writeFileSync(outPath, out); else process.stdout.write(out);
console.error(`${items.length} articles (member-only ${items.filter(a => a.member_only).length})`);
