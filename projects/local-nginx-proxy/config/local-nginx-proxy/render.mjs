#!/usr/bin/env node
// Local names for local services — `http://<name>.<suffix>` (e.g. 3d.local) → nginx on loopback port 80 → 127.0.0.1:<port>.
// Generates reviewable files only. It never installs a service, edits /etc/hosts or runs sudo: the generated apply.sh does
// that, and the owner runs it with sudo after reading it.
//
//   node render.mjs [render] [--services <services.json>] [--prefix <dir>]   writes the files below, then `nginx -t`
//   node render.mjs check    [--services <services.json>] [--prefix <dir>]   daemon · hosts block · resolve · HTTP per name
//   node render.mjs url --app <id> [--path </p?q#a>] [--fallback <url>] [--services <file>]
//        one JSON line {url, via: name|fallback, reason}: the person's own name for that app when it answers 2xx, else the
//        fallback. Skills call this to open a viewer at the person's address; with no personal setup it is the fallback.
//        Several names for the app add candidates: every answering name's url, in list order (url is the first).
//
// services.json (machine-local, never committed; default ~/.config/local-nginx-proxy/services.json):
//   {"suffix":"local","services":[{"name":"3d","port":4318,"app":"agent-task-viewer","title":"…","open":"/viewer","health":"/"}]}
//   app = the viewer id a skill asks for (skill frontmatter viewer.id); title · open (path the landing page links) · health
//   (path that must answer 2xx for "up") are optional. Names are unique; an app and a port may appear on several names.
// Output (default ~/.local/state/local-nginx-proxy/):
//   nginx/nginx.conf (+ nginx.conf.prev, logs/, temp/)   the whole config of a dedicated nginx instance
//   nginx/landing/index.html · services.json               http://localhost/ — every name, its link and whether it answers
//   hosts.block · hosts-update.sh                          the managed /etc/hosts block and the script that swaps it in
//   local.nginx-proxy.nginx.plist · apply.sh                the root LaunchDaemon and the one script run with sudo
// Why root: a non-root process may bind port 80 only on all addresses (macOS); the daemon binds 127.0.0.1 and ::1 only.
// Why /etc/hosts: `.local` is the mDNS suffix, so the OS does not map it to loopback the way it maps `*.localhost`.
// Old name: this tool was called local-name-proxy. apply.sh takes down a daemon of the old label and drops a hosts block of
// the old markers; render stops when only the old services file exists; check reports what is left of an old install.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const LABEL=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const DAEMON='local.nginx-proxy.nginx';
export const BEGIN='# >>> local-nginx-proxy >>>',END='# <<< local-nginx-proxy <<<';
export const DEFAULT_SERVICES=path.join(os.homedir(),'.config','local-nginx-proxy','services.json');
export const DEFAULT_PREFIX=path.join(os.homedir(),'.local','state','local-nginx-proxy');
// The old name's install (before the rename). Read only to move away from it.
export const LEGACY_DAEMON='local.name-proxy.nginx';
export const LEGACY_BEGIN='# >>> local-name-proxy >>>',LEGACY_END='# <<< local-name-proxy <<<';
export const LEGACY_SERVICES=path.join(os.homedir(),'.config','local-name-proxy','services.json');
export const LEGACY_PREFIX=path.join(os.homedir(),'.local','state','local-name-proxy');

/** Pure: checks the services file. Throws a one-line reason. */
export function parseServices(o){
 if(!o||typeof o!=='object'||Array.isArray(o))throw new Error('services file must be an object {suffix, services:[{name, port}]}');
 const suffix=o.suffix??'local';
 if(typeof suffix!=='string'||!suffix.split('.').every(l=>LABEL.test(l)))throw new Error(`suffix "${suffix}" must be lowercase DNS labels`);
 if(!Array.isArray(o.services)||!o.services.length)throw new Error('services must be a non-empty list');
 const seen=new Set();
 const services=o.services.map((s,i)=>{
  if(!s||typeof s.name!=='string'||!LABEL.test(s.name))throw new Error(`services[${i}].name must be one lowercase DNS label`);
  if(!Number.isInteger(s.port)||s.port<1024||s.port>65535)throw new Error(`services[${i}].port must be 1024..65535`);
  if(seen.has(s.name))throw new Error(`services[${i}].name "${s.name}" is listed twice`);
  if(s.app!==undefined&&(typeof s.app!=='string'||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(s.app)))throw new Error(`services[${i}].app must be a viewer id (lowercase, digits, -)`);
  if(s.title!==undefined&&(typeof s.title!=='string'||!s.title.trim()||s.title.length>60||/[\u0000-\u001f<>]/.test(s.title)))throw new Error(`services[${i}].title must be 1..60 plain characters`);
  for(const k of ['open','health'])if(s[k]!==undefined&&(typeof s[k]!=='string'||!PATH.test(s[k])))throw new Error(`services[${i}].${k} must be a path like /viewer`);
  seen.add(s.name);
  return {name:s.name,port:s.port,app:s.app??null,title:s.title?.trim()??null,open:s.open??'/',health:s.health??'/'};
 });
 return {suffix,services};
}
const PATH=/^\/[A-Za-z0-9._~\/-]*$/;
const hostOf=(s,suffix)=>`${s.name}.${suffix}`;

/** Pure: the whole nginx.conf. Paths are relative to the -p prefix. Unknown Host → 404. Streams pass unbuffered. */
export function renderNginx({services,suffix},{user,group='staff'}){
 if(!user||!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(user))throw new Error('user must be a plain account name');
 const listen='        listen 127.0.0.1:80;\n        listen [::1]:80;\n';
 const site=s=>`    server {\n${listen}        server_name ${hostOf(s,suffix)};\n        location / {\n            proxy_pass http://127.0.0.1:${s.port};\n            proxy_http_version 1.1;\n            proxy_set_header Host $host;\n            proxy_set_header X-Forwarded-For $remote_addr;\n            proxy_set_header X-Forwarded-Proto $scheme;\n            proxy_set_header Upgrade $http_upgrade;\n            proxy_set_header Connection $connection_upgrade;\n            proxy_buffering off;\n            proxy_cache off;\n            proxy_read_timeout 1h;\n            proxy_send_timeout 1h;\n        }\n    }\n`;
 return `# Generated by local-nginx-proxy render.mjs — edit services.json and render again instead of editing this file.
# Dedicated instance: started by the root LaunchDaemon ${DAEMON}; workers run as ${user}.
user ${user} ${group};
worker_processes 1;
pid nginx.pid;
error_log logs/error.log warn;
events {
    worker_connections 256;
}
http {
    access_log logs/access.log;
    client_body_temp_path temp/client;
    proxy_temp_path temp/proxy;
    fastcgi_temp_path temp/fastcgi;
    uwsgi_temp_path temp/uwsgi;
    scgi_temp_path temp/scgi;
    # An Upgrade request keeps "upgrade"; anything else sends an empty Connection so the upstream keeps streams open.
    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' '';
    }
    server {
        listen 127.0.0.1:80 default_server;
        listen [::1]:80 default_server;
        server_name _;
        return 404;
    }
${renderLandingServer({services,suffix},listen)}${services.map(site).join('')}}
`;
}
// http://localhost/ — the landing page, its name list, and /_up/<name>: the service's health path through this proxy (any
// 2xx = up; 502/504 = nothing listens). Short timeouts so a hung service cannot hold the page.
function renderLandingServer({services,suffix},listen){
 const up=s=>`        location = /_up/${s.name} {\n            proxy_pass http://127.0.0.1:${s.port}${s.health};\n            proxy_http_version 1.1;\n            proxy_set_header Host ${hostOf(s,suffix)};\n            proxy_set_header Connection '';\n            proxy_connect_timeout 1s;\n            proxy_read_timeout 3s;\n            add_header Cache-Control no-store always;\n        }\n`;
 return `    server {\n${listen}        server_name localhost;\n        root landing;\n        location = / {\n            try_files /index.html =404;\n            add_header Cache-Control no-store;\n        }\n        location = /services.json {\n            default_type application/json;\n            add_header Cache-Control no-store;\n        }\n${services.map(up).join('')}        location / {\n            return 404;\n        }\n    }\n`;
}

/** Pure: the landing page's list — no ports, only what the page links. */
export function renderPublicServices({services,suffix}){
 return JSON.stringify({suffix,services:services.map(s=>({name:s.name,host:hostOf(s,suffix),url:`http://${hostOf(s,suffix)}${s.open}`,title:s.title,app:s.app}))},null,1)+'\n';
}

/** Pure: the landing page. Static; it reads services.json and asks /_up/<name> for each, every 15 s. */
export function renderLanding(){
 return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>로컬 이름</title>
<style>
:root{color-scheme:dark;--bg:#101d28;--card:#162833;--line:#7892a140;--text:#e0e9ed;--muted:#99aebd;--up:#6fd08f;--down:#e07a6f;--wait:#99aebd;--accent:#c9e7a4}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f4f7f8;--card:#fff;--line:#c9d6dc;--text:#14232c;--muted:#5d7280;--up:#2f9e55;--down:#c2453a;--wait:#7d8f99;--accent:#3f7a2a}}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px}
h1{font-size:20px;margin:0 0 4px}p.hint{color:var(--muted);font-size:12px;margin:0 0 20px}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
li{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px}
li i{width:9px;height:9px;border-radius:50%;background:var(--wait);flex:none}li[data-state=up] i{background:var(--up)}li[data-state=down] i{background:var(--down)}
li a{color:var(--accent);font-weight:600;text-decoration:none}li a:hover{text-decoration:underline}
li span{color:var(--muted);font-size:12px}li small{margin-left:auto;color:var(--muted);font-size:11px;white-space:nowrap}
</style>
</head>
<body>
<main>
<h1>로컬 이름</h1>
<p class="hint">이 기기의 local-nginx-proxy 가 여는 이름이다. 목록은 각자의 services.json 에서 나온다. 15초마다 응답을 다시 본다.</p>
<ul id="list"><li><small>목록을 읽는 중</small></li></ul>
</main>
<script>
const list=document.getElementById('list');
const label={up:'응답함',down:'응답 없음',wait:'확인 중'};
async function state(name){
 try{const r=await fetch('/_up/'+name,{cache:'no-store',redirect:'manual'});
  if(r.status>=200&&r.status<300)return['up',label.up];
  if(r.status===502||r.status===504||r.status===0)return['down',r.status===0?'다른 주소로 넘김':label.down];
  return['down','HTTP '+r.status];}catch{return['down',label.down];}
}
async function load(){
 let data;try{data=await (await fetch('/services.json',{cache:'no-store'})).json();}catch{list.innerHTML='<li><small>services.json 을 읽지 못했다</small></li>';return;}
 list.replaceChildren(...data.services.map(s=>{const li=document.createElement('li');li.dataset.name=s.name;li.dataset.state='wait';
  const a=document.createElement('a');a.href=s.url;a.textContent=s.host;const i=document.createElement('i');const t=document.createElement('span');t.textContent=s.title??s.app??'';
  const st=document.createElement('small');st.textContent=label.wait;li.append(i,a,t,st);return li;}));
 await refresh();
}
async function refresh(){for(const li of list.querySelectorAll('li[data-name]')){const [k,text]=await state(li.dataset.name);li.dataset.state=k;li.lastChild.textContent=text;}}
load();setInterval(refresh,15000);
</script>
</body>
</html>
`;
}

/**
 * Pure: the address to open for a viewer app. services = parseServices() or null (no personal setup); isUp(host) says
 * whether that name answered 2xx on its health path. → {url, via:'name'|'fallback', reason}. A path keeps its ?query#hash.
 * Several names for one app (e.g. one vault viewer per vault on this machine): url is the first name that answers, and
 * candidates lists every answering name's url in list order — the caller picks the one that serves its own data.
 */
export function resolveUrl({services,app,path:p='/',fallback=null,isUp}){
 const fb=reason=>({url:fallback?fallback.replace(/\/+$/,'')+p:null,via:'fallback',reason});
 if(!services)return fb('no personal setup');
 const all=services.services.filter(x=>x.app===app);
 if(!all.length)return fb(`no name for app ${app}`);
 // one name: the same answer, byte for byte, as before several names were allowed
 if(all.length===1){
  const host=hostOf(all[0],services.suffix);
  if(!isUp(host))return fb(`${host} is not answering`);
  return {url:`http://${host}${p}`,via:'name',reason:`${host} answers`};
 }
 // several names: ask each in list order, keep the ones that answer
 const hosts=all.map(s=>hostOf(s,services.suffix)),up=hosts.filter(h=>isUp(h));
 if(!up.length)return fb(`${hosts.join(', ')} are not answering`);
 return {url:`http://${up[0]}${p}`,via:'name',reason:`${up[0]} answers`,candidates:up.map(h=>`http://${h}${p}`)};
}

/** Pure: the managed /etc/hosts block — both loopback addresses, so a ::1 lookup does not wait for a timeout. */
export function renderHostsBlock({services,suffix}){
 return [BEGIN,'# Managed by local-nginx-proxy (apply.sh). Edit services.json and render again.',...services.flatMap(s=>[`127.0.0.1\t${hostOf(s,suffix)}`,`::1\t${hostOf(s,suffix)}`]),END,''].join('\n');
}

/** Pure: the hosts swap script — drops the old managed block, appends the new one. `hosts-update.sh <hosts> <block>`. */
export function renderHostsUpdate(){
 return `#!/bin/sh
# Generated by local-nginx-proxy render.mjs. Replaces the managed block in a hosts file; other lines stay as they are.
# A block with the old name's markers is dropped too.
set -eu
hosts="$1"; block="$2"
tmp="$hosts.local-nginx-proxy.$$"
awk -v b='${BEGIN}' -v e='${END}' -v ob='${LEGACY_BEGIN}' -v oe='${LEGACY_END}' '$0==b||$0==ob{skip=1;next} $0==e||$0==oe{skip=0;next} !skip' "$hosts" > "$tmp"
cat "$block" >> "$tmp"
cat "$tmp" > "$hosts"
rm -f "$tmp"
`;
}

const xml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
/** Pure: the root LaunchDaemon that keeps nginx in the foreground (launchd owns the process). */
export function renderDaemonPlist({nginx,prefix}){
 const args=[nginx,'-p',path.join(prefix,'nginx')+'/','-c','nginx.conf','-g','daemon off;'];
 return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
 <key>Label</key><string>${DAEMON}</string>
 <key>ProgramArguments</key>
 <array>
${args.map(a=>`  <string>${xml(a)}</string>`).join('\n')}
 </array>
 <key>RunAtLoad</key><true/>
 <key>KeepAlive</key><true/>
 <key>ThrottleInterval</key><integer>10</integer>
 <key>StandardErrorPath</key><string>${xml(path.join(prefix,'nginx','logs','launchd.log'))}</string>
</dict>
</plist>
`;
}

const sq=s=>`'${String(s).replace(/'/g,`'\\''`)}'`;
/** Pure: the one script the owner runs with sudo — config test, daemon install, hosts block, (re)start. */
export function renderApply({nginx,prefix}){
 const n=path.join(prefix,'nginx')+'/',plist=path.join(prefix,`${DAEMON}.plist`);
 return `#!/bin/sh
# Generated by local-nginx-proxy render.mjs. Read it, then run: sudo sh ${sq(path.join(prefix,'apply.sh'))}
# 1) nginx -t  2) take down the old name's daemon, if any  3) install the LaunchDaemon  4) swap the /etc/hosts block
# (backup beside it; the old name's block goes too)  5) (re)start nginx.
set -eu
[ "$(id -u)" = 0 ] || { echo 'run with sudo' >&2; exit 2; }
${sq(nginx)} -t -p ${sq(n)} -c nginx.conf
# Old name (local-name-proxy): stop its daemon before the new one binds port 80. Nothing happens on a machine without it.
if launchctl print system/${LEGACY_DAEMON} >/dev/null 2>&1; then
 launchctl bootout system/${LEGACY_DAEMON} 2>/dev/null || true
 i=0; while launchctl print system/${LEGACY_DAEMON} >/dev/null 2>&1 && [ "$i" -lt 40 ]; do sleep 0.25; i=$((i+1)); done
fi
rm -f /Library/LaunchDaemons/${LEGACY_DAEMON}.plist
install -m 644 -o root -g wheel ${sq(plist)} /Library/LaunchDaemons/${DAEMON}.plist
cp -p /etc/hosts "/etc/hosts.bak-local-nginx-proxy-$(date +%Y%m%d%H%M%S)"
sh ${sq(path.join(prefix,'hosts-update.sh'))} /etc/hosts ${sq(path.join(prefix,'hosts.block'))}
dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true
# bootout returns before the job is gone; a bootstrap right after it fails with "5: Input/output error" (2026-10-28 실측).
launchctl bootout system/${DAEMON} 2>/dev/null || true
i=0; while launchctl print system/${DAEMON} >/dev/null 2>&1 && [ "$i" -lt 40 ]; do sleep 0.25; i=$((i+1)); done
n=0; until launchctl bootstrap system /Library/LaunchDaemons/${DAEMON}.plist; do n=$((n+1)); [ "$n" -lt 5 ] || { echo 'bootstrap failed 5 times' >&2; exit 1; }; sleep 1; done
echo 'local-nginx-proxy: applied'
`;
}

/** Pure: every generated file, keyed by its path under the prefix. */
export function renderAll(services,{prefix,nginx,user,group}){
 return {'nginx/nginx.conf':renderNginx(services,{user,group}),'nginx/landing/index.html':renderLanding(),'nginx/landing/services.json':renderPublicServices(services),
  'hosts.block':renderHostsBlock(services),'hosts-update.sh':renderHostsUpdate(),
  [`${DAEMON}.plist`]:renderDaemonPlist({nginx,prefix}),'apply.sh':renderApply({nginx,prefix})};
}

function nginxBin(){const p=spawnSync('sh',['-c','command -v nginx'],{encoding:'utf8'}).stdout.trim();if(!p)throw new Error('nginx not found — brew install nginx');return p;}
/** Pure: the one-line move for an old-name services file, or null. Only for the default path — an explicit --services is used as is. */
export function legacyServicesHint(file,{exists=fs.existsSync,defaultFile=DEFAULT_SERVICES,legacyFile=LEGACY_SERVICES}={}){
 if(file!==defaultFile||exists(file)||!exists(legacyFile))return null;
 return `found the old name's services file ${legacyFile} — move it first: mkdir -p ${path.dirname(file)} && cp ${legacyFile} ${file}`;
}
function readServices(file){
 const hint=legacyServicesHint(file);if(hint)throw new Error(hint);
 if(!fs.existsSync(file))throw new Error(`no services file at ${file} — copy services.example.json there and edit it`);
 return parseServices(JSON.parse(fs.readFileSync(file,'utf8')));
}
function render(o){
 const services=readServices(o.services),nginx=nginxBin(),files=renderAll(services,{prefix:o.prefix,nginx,user:os.userInfo().username});
 for(const d of ['nginx/logs','nginx/temp','nginx/landing'])fs.mkdirSync(path.join(o.prefix,d),{recursive:true,mode:0o755});
 const changed=[];
 for(const [rel,text] of Object.entries(files)){
  const f=path.join(o.prefix,rel),old=fs.existsSync(f)?fs.readFileSync(f,'utf8'):null;
  if(old===text)continue;
  if(old!==null&&rel==='nginx/nginx.conf')fs.writeFileSync(f+'.prev',old);
  fs.writeFileSync(f,text,{mode:rel.endsWith('.sh')?0o755:0o644});changed.push(rel);
 }
 // -t as the owner checks syntax and paths, then tries to bind port 80, which only root may (apply.sh tests again as root).
 // So "syntax is ok" plus a bind permission error is the expected result here; the `user` directive warning too.
 const t=spawnSync(nginx,['-t','-p',path.join(o.prefix,'nginx')+'/','-c','nginx.conf'],{encoding:'utf8'});
 const syntax=/syntax is ok/.test(t.stderr),passed=/test is successful/.test(t.stderr),bindOnly=/bind\(\) to .*:80 failed \(13: Permission denied\)/.test(t.stderr);
 return {services:services.services.map(s=>`http://${hostOf(s,services.suffix)} → 127.0.0.1:${s.port}`),prefix:o.prefix,changed,
  nginx_test:passed?'ok':syntax&&bindOnly?'syntax ok · port 80 needs root (apply.sh tests again as root)':t.stderr.trim().split('\n').filter(l=>!/"user" directive/.test(l)).join(' | '),
  next:changed.length?`read ${path.join(o.prefix,'apply.sh')}, then: sudo sh ${path.join(o.prefix,'apply.sh')}`:'nothing changed'};
}
/** Pure: what is left of an old-name install → one line, or null. Root-owned leftovers need apply.sh; the owner's files are only deleted. */
export function legacyNotice({hostsText='',daemonLoaded=false,plistExists=false,servicesExists=false,stateExists=false,servicesMoved=true}){
 // root-owned pieces: only apply.sh (sudo) removes them
 const system=[daemonLoaded&&`daemon ${LEGACY_DAEMON}`,plistExists&&`/Library/LaunchDaemons/${LEGACY_DAEMON}.plist`,
  hostsText.includes(LEGACY_BEGIN)&&'/etc/hosts block'].filter(Boolean);
 // the owner's files: nothing reads them once the new list is in place
 const files=[servicesExists&&servicesMoved&&'the old services file',stateExists&&'the old state folder'].filter(Boolean);
 const parts=[];
 if(servicesExists&&!servicesMoved)parts.push('the old services file — copy it to the new place first');
 if(system.length)parts.push(`${system.join(', ')} — render, then run apply.sh again`);
 if(files.length)parts.push(`${files.join(' and ')} can be deleted${system.length?' once the new daemon runs':''}`);
 return parts.length?`an install of the old name (local-name-proxy) is left: ${parts.join('; ')}`:null;
}
function check(o){
 const hosts=fs.readFileSync('/etc/hosts','utf8');
 const daemon=spawnSync('launchctl',['print',`system/${DAEMON}`],{encoding:'utf8'});
 const legacy=legacyNotice({hostsText:hosts,daemonLoaded:spawnSync('launchctl',['print',`system/${LEGACY_DAEMON}`]).status===0,
  plistExists:fs.existsSync(`/Library/LaunchDaemons/${LEGACY_DAEMON}.plist`),servicesExists:fs.existsSync(LEGACY_SERVICES),stateExists:fs.existsSync(LEGACY_PREFIX),servicesMoved:fs.existsSync(DEFAULT_SERVICES)});
 const head={daemon:daemon.status===0?(daemon.stdout.match(/state = (\w+)/)?.[1]??'loaded'):'not loaded',hosts_block:hosts.includes(BEGIN)};
 let services;
 try{services=readServices(o.services);}catch(e){return {...head,services:e.message,...(legacy?{legacy}:{})};}
 const rows=services.services.map(s=>{
  const host=hostOf(s,services.suffix),r=spawnSync('dscacheutil',['-q','host','-a','name',host],{encoding:'utf8'});
  const c=spawnSync('curl',['-s','-o','/dev/null','-m','5','-w','%{http_code} %{time_total}',`http://${host}/`],{encoding:'utf8'});
  const [code,time]=c.stdout.trim().split(' ');
  return {host,port:s.port,in_hosts:hosts.includes(`127.0.0.1\t${host}`),resolves:/127\.0\.0\.1|::1/.test(r.stdout),http:code||'—',seconds:Number(time)||null};
 });
 const landing=spawnSync('curl',['-s','-o','/dev/null','-m','5','-w','%{http_code}','http://localhost/'],{encoding:'utf8'}).stdout.trim();
 return {...head,landing:landing||'—',names:rows,...(legacy?{legacy}:{})};
}
// 2xx on the health path, no redirect followed, within 2 s.
const answers2xx=(host,health)=>{const r=spawnSync('curl',['-s','-o','/dev/null','-m','2','-w','%{http_code}',`http://${host}${health}`],{encoding:'utf8'});return /^2\d\d$/.test(r.stdout.trim());};
function url(o){
 if(!o.app)throw new Error('url needs --app <viewer id>');
 const services=fs.existsSync(o.services)?parseServices(JSON.parse(fs.readFileSync(o.services,'utf8'))):null;
 const health=host=>services.services.find(s=>hostOf(s,services.suffix)===host).health;
 const r=resolveUrl({services,app:o.app,path:o.path,fallback:o.fallback,isUp:host=>answers2xx(host,health(host))});
 // Only the old name's file exists: still the fallback, but say why.
 const hint=services?null:legacyServicesHint(o.services);
 return hint?{...r,reason:hint}:r;
}

export function main(argv){
 const o={cmd:'render',services:DEFAULT_SERVICES,prefix:DEFAULT_PREFIX,app:null,path:'/',fallback:null};
 let i=0;if(['render','check','url'].includes(argv[0]))o.cmd=argv[i++];
 const flags={'--services':'services','--prefix':'prefix','--app':'app','--path':'path','--fallback':'fallback'};
 for(;i<argv.length;i++){const k=flags[argv[i]];if(!k||argv[i+1]===undefined)throw new Error('usage: render.mjs [render|check] [--services <file>] [--prefix <dir>] · render.mjs url --app <id> [--path <p>] [--fallback <url>]');o[k]=argv[++i];}
 if(o.cmd==='url'&&!o.path.startsWith('/'))throw new Error('--path must start with /');
 return o.cmd==='check'?check(o):o.cmd==='url'?url(o):render(o);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const r=main(process.argv.slice(2));process.stdout.write((process.argv[2]==='url'?JSON.stringify(r):JSON.stringify(r,null,1))+'\n');}
 catch(e){process.stderr.write(`local-nginx-proxy: ${e.message}\n`);process.exit(2);}
}
