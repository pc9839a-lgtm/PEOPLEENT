import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 8745;
const debugPort = 9368;
const profile = await mkdtemp(path.join(tmpdir(), 'peopleent-insight-'));
const server = spawn('python3', ['-m','http.server', String(port),'--bind','127.0.0.1'],{stdio:'ignore'});
const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', [
 '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
 '--no-first-run','--remote-allow-origins=*','--remote-debugging-port='+debugPort,
 '--user-data-dir='+profile,'about:blank'
],{stdio:'ignore'});
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try {
 let tab;
 for(let i=0;i<90;i++){
  try{const r=await fetch('http://127.0.0.1:'+debugPort+'/json/list');const a=await r.json();tab=a.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);if(tab)break}catch{}
  await sleep(200);
 }
 if(!tab)throw Error('Chrome debugger unavailable');
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 const pending=new Map();let id=1;
 socket.addEventListener('message',event=>{
  const p=JSON.parse(String(event.data));if(p.id&&pending.has(p.id)){const cb=pending.get(p.id);pending.delete(p.id);cb(p)}
 });
 await new Promise((res,rej)=>{socket.addEventListener('open',res,{once:true});socket.addEventListener('error',rej,{once:true})});
 function send(method,params={}){
  const n=id++;const wait=new Promise(res=>pending.set(n,res));
  socket.send(JSON.stringify({id:n,method,params}));
  return wait.then(p=>{if(p.error)throw Error(JSON.stringify(p.error));return p.result||{}});
 }
 async function open(route){
  const url='http://127.0.0.1:'+port+route;
  await send('Page.navigate',{url});
  await sleep(1600);
 }
 async function run(expr){
  const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'browser exception');
  return r.result?.value;
 }
 await send('Page.enable');await send('Runtime.enable');
 await open('/insight/');
 const hub=await run(`(()=>{
  const cards=[...document.querySelectorAll('#pe-articles .card')];
  const input=document.getElementById('pe-guide-search');
  if(cards.length!==25||!input)return {pass:false,why:'missing cards/search',count:cards.length};
  input.value='RFP';input.dispatchEvent(new Event('input',{bubbles:true}));
  const matched=cards.filter(x=>!x.hidden).length;
  input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
  const filter=document.querySelector('[data-pe-topic="발주·견적"]');filter.click();
  const filtered=cards.filter(x=>!x.hidden).length;
  document.querySelector('[data-pe-topic="전체"]').click();
  return {pass:matched>=1&&matched<cards.length&&filtered===6&&cards.every(x=>!x.hidden),searched:matched,filtered,all:cards.length};
 })()`);
 if(!hub?.pass)throw Error('Hub search/topic filter failure '+JSON.stringify(hub));
 console.log('PASS hub search/topic',JSON.stringify(hub));
 await open('/insight/event-rfp-writing/');
 const rfp=await run(`(()=>{
  const area=document.getElementById('rfp-draft');
  const button=document.querySelector('[data-pe-copy-template="rfp-draft"]');
  if(!area||!button)return {pass:false};
  const original=area.value;
  area.value+='\\n[테스트 문구]';
  return {pass:original.includes('[행사명]')&&area.value.endsWith('[테스트 문구]'),length:area.value.length};
 })()`);
 if(!rfp?.pass)throw Error('RFP template failure '+JSON.stringify(rfp));
 console.log('PASS RFP editable template',JSON.stringify(rfp));
 await open('/insight/event-agency-cost/');
 const cost=await run(`(()=>{
  const tool=document.querySelector('[data-pe-vendor-comparison]');
  const cells=[...tool.querySelectorAll('select[data-vendor]')];
  const input=cells.find(x=>x.dataset.vendor==='A');
  input.value='extra';input.dispatchEvent(new Event('change',{bubbles:true}));
  const label=tool.querySelector('[data-pe-comparison-summary]').textContent;
  return {pass:cells.length===36&&label.includes('A사: 확인 필요 11개 / 별도 비용 1개'),count:cells.length,summary:label.slice(0,110)};
 })()`);
 if(!cost?.pass)throw Error('Cost comparison failure '+JSON.stringify(cost));
 console.log('PASS cost comparison tool',JSON.stringify(cost));

 await open('/insight/event-venue-site-inspection/');
 const venue=await run(`(()=>{
  const selectors=[...document.querySelectorAll('select[data-venue]')];
  const a=selectors.find(x=>x.id==='venue-A-0');
  const b=selectors.find(x=>x.id==='venue-B-5');
  const summary=document.getElementById('audit-a');
  const warning=document.getElementById('audit-b-alert');
  const button=document.getElementById('copy-venue-audit');
  if(selectors.length!==16||!a||!b||!summary||!warning||!button)return {pass:false,why:'missing venue inputs'};
  a.value='확인 완료';a.dispatchEvent(new Event('change',{bubbles:true}));
  b.value='진행 불가';b.dispatchEvent(new Event('change',{bubbles:true}));
  return {pass:summary.textContent.includes('확인 완료 1건')&&warning.textContent.includes('안전·접근성 등 추가 확인 2건')&&button.type==='button',summary:summary.textContent,warn:warning.textContent};
 })()`);
 if(!venue?.pass)throw Error('Venue comparison tool failure '+JSON.stringify(venue));
 console.log('PASS venue A/B evidence tracker',JSON.stringify(venue));
 await open('/insight/event-photo-video-shot-list/');
 const shot=await run(`(()=>{
  const statuses=[...document.querySelectorAll('select[data-shot-status]')];
  const notes=[...document.querySelectorAll('input[data-shot-note]')];
  const summary=document.getElementById('shot-summary');
  const priority=document.getElementById('shot-priority');
  const button=document.getElementById('copy-shot-tracker');
  if(statuses.length!==12||notes.length!==12||!summary||!priority||!button)return {pass:false,why:'missing shot tracker'};
  statuses[0].value='확보';statuses[0].dispatchEvent(new Event('change',{bubbles:true}));
  statuses[1].value='제외 승인';statuses[1].dispatchEvent(new Event('change',{bubbles:true}));
  notes[0].value='CAM-A / 0001';notes[0].dispatchEvent(new Event('input',{bubbles:true}));
  return {pass:summary.textContent.includes('확보 1건')&&summary.textContent.includes('제외 승인 1건')&&priority.textContent.includes('필수 장면 미완료 5건')&&button.type==='button',summary:summary.textContent,priority:priority.textContent};
 })()`);
 if(!shot?.pass)throw Error('Photo shot tracker failure '+JSON.stringify(shot));
 console.log('PASS 12-shot live capture tracker',JSON.stringify(shot));

 // A/B location comparison: draft persists ONLY after explicit Save.
 await open('/insight/event-venue-site-inspection/');
 const venueSaved=await run(`(()=>{
  const a=document.getElementById('venue-A-0');
  const n=document.getElementById('venue-note-A-0');
  const template=document.getElementById('guide-template');
  a.value='확인 완료';a.dispatchEvent(new Event('change',{bubbles:true}));
  n.value='=HYPERLINK("bad","link")';n.dispatchEvent(new Event('input',{bubbles:true}));
  template.value+='\\nQA_VENUE_DRAFT';
  document.querySelector('[data-guide-action="save"]').click();
  const saved=JSON.parse(localStorage.getItem('peopleent:insight:venue:draft:v1')||'null');
  return {pass:saved?.version===1&&saved.controls['venue-A-0']==='확인 완료'&&saved.controls['venue-note-A-0']===n.value&&saved.controls['guide-template'].includes('QA_VENUE_DRAFT')};
 })()`);
 if(!venueSaved?.pass)throw Error('Venue draft saving failed '+JSON.stringify(venueSaved));
 await open('/insight/event-venue-site-inspection/');
 const venueLoaded=await run(`(async()=>{
  const a=document.getElementById('venue-A-0');
  const n=document.getElementById('venue-note-A-0');
  const status=document.querySelector('[data-guide-storage-status]');
  const ok=a.value==='확인 완료'&&n.value.startsWith('=HYPERLINK')&&document.getElementById('guide-template').value.includes('QA_VENUE_DRAFT')&&status.textContent.includes('복원');
  const oldCreate=URL.createObjectURL;
  const oldClick=HTMLAnchorElement.prototype.click;
  let blob,filename;
  URL.createObjectURL=b=>{blob=b;return 'blob:test-venue'};
  HTMLAnchorElement.prototype.click=function(){filename=this.download};
  document.querySelector('[data-guide-action="csv"]').click();
  const csv=blob?await blob.text():'';
  const csvBytes=blob?new Uint8Array(await blob.arrayBuffer()):new Uint8Array();
  const bomOk=csvBytes[0]===239&&csvBytes[1]===187&&csvBytes[2]===191;
  URL.createObjectURL=oldCreate;HTMLAnchorElement.prototype.click=oldClick;
  const csvOk=bomOk&&csv.includes("'=HYPERLINK")&&filename.endsWith('.csv')&&csv.split(String.fromCharCode(13,10)).filter(Boolean).length===9;
  window.confirm=()=>true;
  document.querySelector('[data-guide-action="clear"]').click();
  const clear=localStorage.getItem('peopleent:insight:venue:draft:v1')===null&&a.value==='미확인'&&n.value===''&&!document.getElementById('guide-template').value.includes('QA_VENUE_DRAFT');
  return {pass:ok&&csvOk&&clear,restored:ok,csv:csvOk,reset:clear,csvDebug:{bomBytes:[...csvBytes.slice(0,3)],safe:csv.includes("'=1+2")||csv.includes("'=HYPERLINK"),filename:filename||null,rows:csv.split(String.fromCharCode(13,10)).filter(Boolean).length,preview:csv.slice(0,180),status:document.querySelector('[data-guide-storage-status]')?.textContent}};
 })()`);
 if(!venueLoaded?.pass)throw Error('Venue restore, CSV or clear failure '+JSON.stringify(venueLoaded));
 console.log('PASS venue save-restore, escaped CSV and clear',JSON.stringify(venueLoaded));

 await open('/insight/event-photo-video-shot-list/');
 const shotSaved=await run(`(()=>{
  const a=document.getElementById('shot-status-0');
  const n=document.getElementById('shot-note-0');
  a.value='확보';a.dispatchEvent(new Event('change',{bubbles:true}));
  n.value='=1+2';n.dispatchEvent(new Event('input',{bubbles:true}));
  const template=document.getElementById('guide-template');
  template.value+='\\nQA_SHOT_DRAFT';
  document.querySelector('[data-guide-action="save"]').click();
  const saved=JSON.parse(localStorage.getItem('peopleent:insight:shot:draft:v1')||'null');
  return {pass:saved?.version===1&&saved.controls['shot-status-0']==='확보'&&saved.controls['shot-note-0']==='=1+2'&&saved.controls['guide-template'].includes('QA_SHOT_DRAFT')};
 })()`);
 if(!shotSaved?.pass)throw Error('Shot draft saving failed '+JSON.stringify(shotSaved));
 await open('/insight/event-photo-video-shot-list/');
 const shotLoaded=await run(`(async()=>{
  const a=document.getElementById('shot-status-0');
  const n=document.getElementById('shot-note-0');
  const status=document.querySelector('[data-guide-storage-status]');
  const ok=a.value==='확보'&&n.value==='=1+2'&&document.getElementById('guide-template').value.includes('QA_SHOT_DRAFT')&&status.textContent.includes('복원');
  const oldCreate=URL.createObjectURL;
  const oldClick=HTMLAnchorElement.prototype.click;
  let blob,filename;
  URL.createObjectURL=b=>{blob=b;return 'blob:test-shot'};
  HTMLAnchorElement.prototype.click=function(){filename=this.download};
  document.querySelector('[data-guide-action="csv"]').click();
  const csv=blob?await blob.text():'';
  const csvBytes=blob?new Uint8Array(await blob.arrayBuffer()):new Uint8Array();
  const bomOk=csvBytes[0]===239&&csvBytes[1]===187&&csvBytes[2]===191;
  URL.createObjectURL=oldCreate;HTMLAnchorElement.prototype.click=oldClick;
  const csvOk=bomOk&&csv.includes("'=1+2")&&filename.endsWith('.csv')&&csv.split(String.fromCharCode(13,10)).filter(Boolean).length===13;
  window.confirm=()=>true;
  document.querySelector('[data-guide-action="clear"]').click();
  const clear=localStorage.getItem('peopleent:insight:shot:draft:v1')===null&&a.value==='미확인'&&n.value===''&&!document.getElementById('guide-template').value.includes('QA_SHOT_DRAFT');
  return {pass:ok&&csvOk&&clear,restored:ok,csv:csvOk,reset:clear,csvDebug:{bomBytes:[...csvBytes.slice(0,3)],safe:csv.includes("'=1+2")||csv.includes("'=HYPERLINK"),filename:filename||null,rows:csv.split(String.fromCharCode(13,10)).filter(Boolean).length,preview:csv.slice(0,180),status:document.querySelector('[data-guide-storage-status]')?.textContent}};
 })()`);
 if(!shotLoaded?.pass)throw Error('Shot restore, CSV or clear failure '+JSON.stringify(shotLoaded));
 console.log('PASS shot save-restore, escaped CSV and clear',JSON.stringify(shotLoaded));



 const newGuides=[
  {route:'/insight/event-attendee-notice-message-templates/',heading:'기업행사 참가자 안내문·리마인드 문자 작성법',sections:['role','data','schedule','examples','change','template']},
  {route:'/insight/event-speaker-presentation-management/',heading:'행사 연사·발표자료 제출 관리 체크리스트',sections:['roles','master','files','rehearsal','changes','template']}
 ];
 for(const guide of newGuides){
  await open(guide.route);
  const detail=await run(`(async()=>{
   const area=document.getElementById('pe-guide-draft');
   const button=document.getElementById('pe-guide-copy');
   const status=document.getElementById('pe-guide-copy-status');
   const h1=document.querySelector('h1');
   const ids=${JSON.stringify(guide.sections)};
   if(!area||!button||!status||!h1||!ids.every(id=>document.getElementById(id)))return {pass:false,why:'missing article controls or sections'};
   const initial=area.value;
   area.value=initial+' [TEST_EDIT]';
   button.click();
   await new Promise(resolve=>setTimeout(resolve,40));
   const copied=status.textContent.includes('복사')||status.textContent.includes('선택');
   return {pass:h1.textContent.trim()===${JSON.stringify(guide.heading)}&&initial.length>450&&area.value.endsWith('[TEST_EDIT]')&&copied&&document.querySelectorAll('#faq details').length===4,templateLength:initial.length,status:status.textContent,sections:ids.length};
  })()`);
  if(!detail?.pass)throw Error('New guide browser validation failed '+guide.route+' '+JSON.stringify(detail));
  console.log('PASS new practical guide template and FAQ',guide.route,JSON.stringify(detail));
 }

 console.log('PASS three critical existing-page interactions');
} finally {
 if(socket)socket.close();
 chrome.kill('SIGKILL');server.kill('SIGKILL');
 await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
