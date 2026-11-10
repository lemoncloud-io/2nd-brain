import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseServices,renderNginx,renderHostsBlock,renderHostsUpdate,renderDaemonPlist,renderApply,renderAll,renderPublicServices,renderLanding,resolveUrl,main,BEGIN,END,DAEMON,LEGACY_BEGIN,LEGACY_END,LEGACY_DAEMON,legacyServicesHint,legacyNotice} from '../render.mjs';
import {fileURLToPath} from 'node:url';

// Synthetic values only — no real account, path or port of any machine.
const SERVICES={suffix:'local',services:[{name:'3d',port:4318},{name:'docs',port:8765}]};
const OPTS={prefix:'/p/state',nginx:'/opt/bin/nginx',user:'alice'};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'local-nginx-proxy-'));

test('services: suffix defaults to local, names are single DNS labels, ports 1024..65535, no duplicate names',()=>{
 assert.deepEqual(parseServices({services:[{name:'3d',port:4318}]}),{suffix:'local',services:[{name:'3d',port:4318,app:null,title:null,open:'/',health:'/'}]});
 assert.deepEqual(parseServices({services:[{name:'docs',port:8765,app:'doc-viewer',title:' 문서 ',open:'/v/',health:'/api/ping'}]}).services[0],
  {name:'docs',port:8765,app:'doc-viewer',title:'문서',open:'/v/',health:'/api/ping'});
 for(const bad of [{app:'Doc'},{app:''},{title:''},{title:'<b>x</b>'},{title:'x'.repeat(61)},{open:'v'},{open:'/v?x=1'},{health:'//x y'}])
  assert.throws(()=>parseServices({services:[{name:'a',port:4318,...bad}]}),JSON.stringify(bad));
 assert.equal(parseServices({suffix:'home.arpa',services:[{name:'a',port:2000}]}).suffix,'home.arpa');
 for(const bad of [null,[],{services:[]},{services:[{name:'Bad',port:4318}]},{services:[{name:'a.b',port:4318}]},{services:[{name:'a',port:80}]},
  {services:[{name:'a',port:'4318'}]},{services:[{name:'a',port:4318},{name:'a',port:4319}]},{suffix:'lo cal',services:[{name:'a',port:4318}]}])
  assert.throws(()=>parseServices(bad));
});

test('nginx.conf: loopback only on both families, one site per name, unknown Host 404, streams unbuffered',()=>{
 const conf=renderNginx(parseServices(SERVICES),{user:'alice'});
 assert.match(conf,/^user alice staff;$/m);
 // default · landing · one per name
 assert.equal((conf.match(/listen 127\.0\.0\.1:80/g)??[]).length,4);
 assert.equal((conf.match(/listen \[::1\]:80/g)??[]).length,4);
 assert.doesNotMatch(conf,/listen (?:0\.0\.0\.0:)?80\b|listen \[::\]:80|listen \*:80/,'never all addresses');
 assert.match(conf,/server_name _;\n\s+return 404;/);
 assert.match(conf,/server_name 3d\.local;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:4318;/);
 assert.match(conf,/server_name docs\.local;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8765;/);
 for(const d of ['proxy_set_header Host $host;','proxy_buffering off;','proxy_read_timeout 1h;','proxy_http_version 1.1;'])assert.ok(conf.includes(d),d);
 assert.throws(()=>renderNginx(parseServices(SERVICES),{user:'a b'}));
});

test('hosts block: both loopback addresses per name, inside the markers',()=>{
 const b=renderHostsBlock(parseServices(SERVICES)).split('\n');
 assert.equal(b[0],BEGIN);assert.equal(b.at(-2),END);
 assert.deepEqual(b.filter(l=>/\t/.test(l)),['127.0.0.1\t3d.local','::1\t3d.local','127.0.0.1\tdocs.local','::1\tdocs.local']);
});

test('hosts-update.sh: appends the block once, replaces it on the next run, keeps every other line',()=>{
 const d=tmp();
 try{
  const script=path.join(d,'u.sh'),hosts=path.join(d,'hosts'),block=path.join(d,'block');
  fs.writeFileSync(script,renderHostsUpdate());
  fs.writeFileSync(hosts,'127.0.0.1\tlocalhost\n::1\tlocalhost\n');
  fs.writeFileSync(block,renderHostsBlock(parseServices({services:[{name:'3d',port:4318}]})));
  const run=()=>assert.equal(spawnSync('sh',[script,hosts,block]).status,0);
  run();const once=fs.readFileSync(hosts,'utf8');
  assert.ok(once.startsWith('127.0.0.1\tlocalhost\n::1\tlocalhost\n'));
  assert.ok(once.includes('127.0.0.1\t3d.local'));
  run();assert.equal(fs.readFileSync(hosts,'utf8'),once,'second run gives the same file');
  // A line after the block (added by someone else) survives a later swap; the old name leaves.
  fs.appendFileSync(hosts,'10.0.0.1\tprinter\n');
  fs.writeFileSync(block,renderHostsBlock(parseServices({services:[{name:'docs',port:8765}]})));
  run();const swapped=fs.readFileSync(hosts,'utf8');
  assert.ok(swapped.includes('10.0.0.1\tprinter\n'));assert.ok(swapped.includes('127.0.0.1\tdocs.local'));assert.ok(!swapped.includes('3d.local'));
  assert.equal(swapped.split(BEGIN).length,2,'one managed block');
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('daemon plist and apply.sh: nginx in the foreground under launchd, apply refuses without root, scripts parse',()=>{
 const plist=renderDaemonPlist(OPTS),apply=renderApply(OPTS);
 assert.ok(plist.includes(`<string>${DAEMON}</string>`));
 assert.ok(plist.includes('<string>/opt/bin/nginx</string>')&&plist.includes('<string>/p/state/nginx/</string>')&&plist.includes('<string>daemon off;</string>'));
 assert.match(apply,/\[ "\$\(id -u\)" = 0 \] \|\| \{ echo 'run with sudo'/);
 assert.match(apply,/'\/opt\/bin\/nginx' -t -p '\/p\/state\/nginx\/' -c nginx\.conf/);
 assert.ok(apply.indexOf('-t -p')<apply.indexOf('install -m 644'),'config test before install');
 // Reload: wait until the old job is gone, then retry bootstrap (bootout is asynchronous).
 const after=apply.slice(apply.indexOf(`launchctl bootout system/${DAEMON}`));
 assert.match(after,/while launchctl print system\/local\.nginx-proxy\.nginx[^\n]*\n\s*n=0; until launchctl bootstrap system/);
 const d=tmp();
 try{
  for(const [n,t] of [['apply.sh',apply],['u.sh',renderHostsUpdate()]]){const f=path.join(d,n);fs.writeFileSync(f,t);assert.equal(spawnSync('sh',['-n',f]).status,0,n);}
  assert.notEqual(spawnSync('sh',[path.join(d,'apply.sh')]).status,0,'non-root run stops at the guard');
  if(process.platform==='darwin'){const f=path.join(d,'x.plist');fs.writeFileSync(f,plist);assert.equal(spawnSync('plutil',['-lint',f]).status,0);}
 }finally{fs.rmSync(d,{recursive:true,force:true});}
 assert.deepEqual(Object.keys(renderAll(parseServices(SERVICES),OPTS)).sort(),['apply.sh','hosts-update.sh','hosts.block',`${DAEMON}.plist`,'nginx/landing/index.html','nginx/landing/services.json','nginx/nginx.conf']);
});

test('landing: localhost serves the page and its list; /_up/<name> asks the health path with the name as Host, short timeouts',()=>{
 const s=parseServices({services:[{name:'3d',port:4318,app:'agent-task-viewer',title:'에이전트',open:'/viewer'},{name:'docs',port:8765,health:'/ping'}]});
 const conf=renderNginx(s,{user:'alice'});
 const landing=conf.slice(conf.indexOf('server_name localhost;'),conf.indexOf('server_name 3d.local;'));
 assert.ok(landing.includes('root landing;')&&landing.includes('try_files /index.html =404;')&&landing.includes('location = /services.json'));
 assert.match(landing,/location = \/_up\/3d \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:4318\/;[\s\S]*?proxy_set_header Host 3d\.local;[\s\S]*?proxy_read_timeout 3s;/);
 assert.match(landing,/location = \/_up\/docs \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:8765\/ping;/);
 assert.match(landing,/location \/ \{\n\s+return 404;/,'nothing else on localhost');
 const pub=JSON.parse(renderPublicServices(s));
 assert.deepEqual(pub.services[0],{name:'3d',host:'3d.local',url:'http://3d.local/viewer',title:'에이전트',app:'agent-task-viewer'});
 assert.ok(!JSON.stringify(pub).includes('4318'),'no ports in the public list');
 const html=renderLanding();
 assert.ok(html.includes("fetch('/services.json'")&&html.includes("fetch('/_up/'+name")&&html.includes("redirect:'manual'"));
 assert.doesNotMatch(html,/https?:\/\/(?!www\.w3)/,'no external resource');
});

test('url: the personal name only when it answers, else the fallback; no setup or no app → fallback',()=>{
 const s=parseServices({services:[{name:'3d',port:4318,app:'agent-task-viewer'}]});
 const up=()=>true,down=()=>false;
 assert.deepEqual(resolveUrl({services:s,app:'agent-task-viewer',path:'/viewer#mode=sessions',fallback:'http://127.0.0.1:4318/',isUp:up}),
  {url:'http://3d.local/viewer#mode=sessions',via:'name',reason:'3d.local answers'});
 assert.equal(resolveUrl({services:s,app:'agent-task-viewer',path:'/viewer',fallback:'http://127.0.0.1:4318/',isUp:down}).url,'http://127.0.0.1:4318/viewer');
 assert.equal(resolveUrl({services:s,app:'other',path:'/x',fallback:'http://127.0.0.1:8778',isUp:up}).reason,'no name for app other');
 assert.deepEqual(resolveUrl({services:null,app:'agent-task-viewer',path:'/v/a.md?src=local#h',fallback:'http://127.0.0.1:8778',isUp:up}),
  {url:'http://127.0.0.1:8778/v/a.md?src=local#h',via:'fallback',reason:'no personal setup'});
 assert.equal(resolveUrl({services:null,app:'x',isUp:up}).url,null,'no fallback given');
 // CLI with a services file that does not exist = no personal setup.
 assert.deepEqual(main(['url','--app','agent-task-viewer','--path','/viewer','--fallback','http://127.0.0.1:4318','--services','/nonexistent/services.json']),
  {url:'http://127.0.0.1:4318/viewer',via:'fallback',reason:'no personal setup'});
 assert.throws(()=>main(['url','--app','x','--path','viewer']));
});

// Several names for one app — one vault viewer per vault on this machine, each on its own port.
const TWO={suffix:'local',services:[{name:'va',port:8780,app:'knowledge-viewer'},{name:'vb',port:8782,app:'knowledge-viewer'}]};

test('services: one app on several names is allowed; a port on several names too (an alias); a name only once',()=>{
 assert.deepEqual(parseServices(TWO).services.map(s=>[s.name,s.port,s.app]),[['va',8780,'knowledge-viewer'],['vb',8782,'knowledge-viewer']]);
 // two names, one port: both proxy to it — nothing checks ports
 assert.deepEqual(parseServices({services:[{name:'a',port:8780},{name:'b',port:8780}]}).services.map(s=>s.port),[8780,8780]);
 assert.throws(()=>parseServices({services:[{name:'va',port:8780,app:'knowledge-viewer'},{name:'va',port:8782,app:'knowledge-viewer'}]}),/listed twice/);
});

test('generated files: one app on two names gives two sites, two health checks, two landing rows and four hosts lines',()=>{
 const s=parseServices(TWO),conf=renderNginx(s,{user:'alice'});
 assert.match(conf,/server_name va\.local;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8780;/);
 assert.match(conf,/server_name vb\.local;[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8782;/);
 assert.equal((conf.match(/server_name v[ab]\.local;/g)??[]).length,2);
 assert.ok(conf.includes('location = /_up/va {')&&conf.includes('location = /_up/vb {'));
 assert.deepEqual(renderHostsBlock(s).split('\n').filter(l=>/\t/.test(l)),['127.0.0.1\tva.local','::1\tva.local','127.0.0.1\tvb.local','::1\tvb.local']);
 assert.deepEqual(JSON.parse(renderPublicServices(s)).services.map(x=>[x.host,x.app]),[['va.local','knowledge-viewer'],['vb.local','knowledge-viewer']]);
});

test('url: one name keeps the old output byte for byte; several names add candidates of the answering ones in list order',()=>{
 const P='/v/wiki/INDEX.md?src=local#h',FB='http://127.0.0.1:8778';
 const one=parseServices({services:[{name:'va',port:8780,app:'knowledge-viewer'},{name:'x',port:4318,app:'other'}]});
 const r=(services,up)=>JSON.stringify(resolveUrl({services,app:'knowledge-viewer',path:P,fallback:FB,isUp:h=>up.includes(h)}));
 // one name for the app — exactly the earlier line, no candidates key
 assert.equal(r(one,['va.local']),'{"url":"http://va.local/v/wiki/INDEX.md?src=local#h","via":"name","reason":"va.local answers"}');
 assert.equal(r(one,[]),'{"url":"http://127.0.0.1:8778/v/wiki/INDEX.md?src=local#h","via":"fallback","reason":"va.local is not answering"}');
 const two=parseServices(TWO);
 assert.equal(r(two,['va.local','vb.local']),'{"url":"http://va.local/v/wiki/INDEX.md?src=local#h","via":"name","reason":"va.local answers","candidates":["http://va.local/v/wiki/INDEX.md?src=local#h","http://vb.local/v/wiki/INDEX.md?src=local#h"]}');
 assert.equal(r(two,['va.local']),'{"url":"http://va.local/v/wiki/INDEX.md?src=local#h","via":"name","reason":"va.local answers","candidates":["http://va.local/v/wiki/INDEX.md?src=local#h"]}');
 assert.equal(r(two,['vb.local']),'{"url":"http://vb.local/v/wiki/INDEX.md?src=local#h","via":"name","reason":"vb.local answers","candidates":["http://vb.local/v/wiki/INDEX.md?src=local#h"]}');
 assert.equal(r(two,[]),'{"url":"http://127.0.0.1:8778/v/wiki/INDEX.md?src=local#h","via":"fallback","reason":"va.local, vb.local are not answering"}');
 // every name is asked, in list order
 const asked=[];resolveUrl({services:two,app:'knowledge-viewer',isUp:h=>{asked.push(h);return true;}});
 assert.deepEqual(asked,['va.local','vb.local']);
});

// Moving from the old name (local-name-proxy).
test('hosts-update.sh: old block only / new only / both / none → exactly one new block, other lines kept',()=>{
 const d=tmp();
 try{
  const script=path.join(d,'u.sh'),hosts=path.join(d,'hosts'),block=path.join(d,'block');
  fs.writeFileSync(script,renderHostsUpdate());
  fs.writeFileSync(block,renderHostsBlock(parseServices({services:[{name:'docs',port:8765}]})));
  const head='127.0.0.1\tlocalhost\n::1\tlocalhost\n',tail='10.0.0.1\tprinter\n';
  const oldBlock=[LEGACY_BEGIN,'127.0.0.1\told.local',LEGACY_END,''].join('\n'),newBlock=[BEGIN,'127.0.0.1\tstale.local',END,''].join('\n');
  for(const [label,mid] of [['old only',oldBlock],['new only',newBlock],['both',oldBlock+newBlock],['none','']]){
   fs.writeFileSync(hosts,head+mid+tail);
   assert.equal(spawnSync('sh',[script,hosts,block]).status,0,label);
   const out=fs.readFileSync(hosts,'utf8');
   assert.equal(out,head+tail+fs.readFileSync(block,'utf8'),label);
   assert.equal(out.split(BEGIN).length,2,`${label}: one new block`);
   assert.ok(!out.includes(LEGACY_BEGIN)&&!out.includes('old.local')&&!out.includes('stale.local'),label);
  }
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('apply.sh: takes down the old daemon before the new one, only when it is there',()=>{
 const apply=renderApply(OPTS);
 const old=apply.indexOf(`if launchctl print system/${LEGACY_DAEMON}`),rm=apply.indexOf(`rm -f /Library/LaunchDaemons/${LEGACY_DAEMON}.plist`);
 assert.ok(old>0&&rm>old,'guarded bootout, then the plist goes');
 assert.ok(apply.indexOf('-t -p')<old,'config test first');
 assert.ok(rm<apply.indexOf(`launchctl bootstrap system /Library/LaunchDaemons/${DAEMON}.plist`),'old down before new up');
 assert.match(apply,/hosts\.bak-local-nginx-proxy-/);
 // The old name appears only in the migration lines.
 assert.deepEqual(apply.split('\n').filter(l=>l.includes('name-proxy')).length,5);
 const upd=renderHostsUpdate().split('\n').filter(l=>l.includes('name-proxy'));
 assert.equal(upd.length,1);assert.ok(upd[0].startsWith('awk '));
});

test('old services file: render stops with the move command; check names what is left; explicit --services is untouched',()=>{
 const e=f=>f==='/h/.config/local-name-proxy/services.json';
 const o={exists:e,defaultFile:'/h/.config/local-nginx-proxy/services.json',legacyFile:'/h/.config/local-name-proxy/services.json'};
 assert.equal(legacyServicesHint('/h/.config/local-nginx-proxy/services.json',o),
  "found the old name's services file /h/.config/local-name-proxy/services.json — move it first: mkdir -p /h/.config/local-nginx-proxy && cp /h/.config/local-name-proxy/services.json /h/.config/local-nginx-proxy/services.json");
 assert.equal(legacyServicesHint('/x/services.json',o),null,'explicit file');
 assert.equal(legacyServicesHint(o.defaultFile,{...o,exists:()=>true}),null,'new file already there');
 assert.equal(legacyServicesHint(o.defaultFile,{...o,exists:()=>false}),null,'no setup at all');
 assert.equal(legacyNotice({hostsText:'127.0.0.1\tlocalhost\n'}),null);
 assert.match(legacyNotice({hostsText:LEGACY_BEGIN+'\n',daemonLoaded:true}),/old name.*daemon local\.name-proxy\.nginx, \/etc\/hosts block — render, then run apply\.sh again$/);
 // after apply.sh only the owner's files are left: the line says delete, not apply again
 assert.match(legacyNotice({servicesExists:true,stateExists:true}),/is left: the old services file and the old state folder can be deleted$/);
 assert.match(legacyNotice({stateExists:true}),/is left: the old state folder can be deleted$/);
 assert.match(legacyNotice({servicesExists:true,servicesMoved:false,daemonLoaded:true,stateExists:true}),/copy it to the new place first; daemon .* apply\.sh again; the old state folder can be deleted once the new daemon runs$/);
 // CLI under a throwaway HOME holding only the old file: render exits 2 with the hint and creates nothing new.
 const home=tmp();
 try{
  fs.mkdirSync(path.join(home,'.config','local-name-proxy'),{recursive:true});
  fs.writeFileSync(path.join(home,'.config','local-name-proxy','services.json'),JSON.stringify(SERVICES));
  const cli=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','render.mjs');
  const r=spawnSync(process.execPath,[cli,'render'],{encoding:'utf8',env:{...process.env,HOME:home}});
  assert.equal(r.status,2);assert.match(r.stderr,/^local-nginx-proxy: found the old name's services file .* mkdir -p .*local-nginx-proxy && cp /);
  assert.ok(!fs.existsSync(path.join(home,'.config','local-nginx-proxy'))&&!fs.existsSync(path.join(home,'.local')),'nothing written');
  const u=JSON.parse(spawnSync(process.execPath,[cli,'url','--app','x','--fallback','http://127.0.0.1:1'],{encoding:'utf8',env:{...process.env,HOME:home}}).stdout);
  assert.equal(u.via,'fallback');assert.match(u.reason,/old name's services file/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
