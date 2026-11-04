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
  if(cards.length!==27||!input)return {pass:false,why:'missing cards/search',count:cards.length};
  input.value='RFP';input.dispatchEvent(new Event('input',{bubbles:true}));
  const matched=cards.filter(x=>!x.hidden).length;
  input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
  const filter=document.querySelector('[data-pe-topic="발주·견적"]');filter.click();
  const filtered=cards.filter(x=>!x.hidden).length;
  document.querySelector('[data-pe-topic="전체"]').click();
  return {pass:matched>=1&&matched<cards.length&&filtered===cards.filter(x=>x.dataset.topic==='발주·견적').length&&cards.every(x=>!x.hidden),searched:matched,filtered,all:cards.length};
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
   return {pass:h1.textContent.trim()===${JSON.stringify(guide.heading)}&&initial.length>350&&area.value.endsWith('[TEST_EDIT]')&&copied&&document.querySelectorAll('#faq details').length===4,templateLength:initial.length,status:status.textContent,sections:ids.length};
  })()`);
  if(!detail?.pass)throw Error('New guide browser validation failed '+guide.route+' '+JSON.stringify(detail));
  console.log('PASS new practical guide template and FAQ',guide.route,JSON.stringify(detail));
 }


 const finalGuides=[
  ['/insight/event-satisfaction-survey-questions/','행사 만족도 설문 문항 예시와 결과 분석법',['purpose','questions','open','timing','analysis','template']],
  ['/insight/event-vendor-purchase-order-change-control/','행사 협력업체 발주서와 추가 비용 변경관리',['scope','fields','workflow','handoff','reconcile','template']]
 ];
 for(const [route,heading,sections] of finalGuides){
  await open(route);
  const result=await run(`(async()=>{
    const input=document.getElementById('pe-guide-draft'),button=document.getElementById('pe-guide-copy'),
          status=document.getElementById('pe-guide-copy-status');
    const title=document.querySelector('h1')?.textContent.trim();
    const faq=document.querySelectorAll('#faq details');
    const ids=[...document.querySelectorAll('article section[id]')].map(x=>x.id);
    if(!input||!button||!status)return {pass:false,reason:'Missing copy controls'};
    const initial=input.value;
    input.value=initial+' [TEST]';
    button.click();
    await new Promise(resolve=>setTimeout(resolve,100));
    return {pass:initial.length>500&&input.value.endsWith('[TEST]')&&(status.textContent.includes('복사')||status.textContent.includes('선택'))&&faq.length===4,initialLength:initial.length,title,sections:ids,faq:faq.length,status:status.textContent};
  })()`);
  if(!result?.pass||result.title!==heading||sections.some(x=>!result.sections.includes(x))){
    throw Error('New guide render/copy QA failed '+route+' '+JSON.stringify(result));
  }
  console.log('PASS new guide content + copy controls',route,JSON.stringify(result));
 }


 await open('/insight/');
 const readingStages=await run(`(()=>{
   const rows=[...document.querySelectorAll('.pe-pathway')];
   const readLinks=[...document.querySelectorAll('.pe-pathway-links a')];
   const serviceLinks=[...document.querySelectorAll('.pe-pathway-service')];
   const routes=readLinks.concat(serviceLinks);
   return {pass:rows.length===4&&readLinks.length===12&&serviceLinks.length===4&&
     routes.every(link=>link.pathname.startsWith('/')&&!link.pathname.includes('#'))&&
     document.querySelectorAll('#pe-articles .card').length===27,
     rows:rows.length,resources:readLinks.length,services:serviceLinks.length};
 })()`);
 if(!readingStages?.pass)throw Error('Insight four-stage path failure '+JSON.stringify(readingStages));
 console.log('PASS 4 reading stages + 12 articles + 4 services',JSON.stringify(readingStages));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await open('/insight/');
 const mobileStage=await run(`(()=>{
   const row=document.querySelector('.pe-pathway');
   const columns=row?getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean):[];
   const within=document.querySelector('.pe-pathways').getBoundingClientRect();
   return {pass:columns.length===1&&within.left>=0&&within.right<=innerWidth+2,
     columns:columns.length,left:within.left,right:within.right,width:innerWidth};
 })()`);
 if(!mobileStage?.pass)throw Error('Mobile reading stages failure '+JSON.stringify(mobileStage));
 console.log('PASS mobile one-column editorial journey',JSON.stringify(mobileStage));
 await send('Emulation.clearDeviceMetricsOverride');
 const nextSamples=[
   ['/insight/event-agency-cost/','/corporate-event/',['/insight/event-rfp-writing/','/insight/event-vendor-purchase-order-change-control/']],
   ['/insight/event-speaker-presentation-management/','/conference/',['/insight/event-cue-sheet-guide/','/insight/conference-operation-checklist/']],
   ['/insight/pco-vs-event-agency/','/academic-event/',['/insight/conference-operation-checklist/','/insight/conference-registration-operations/']],
   ['/insight/exhibition-booth-operations/','/public-event/',['/insight/event-print-production-guide/','/insight/event-staffing-plan/']]
 ];
 for(const [route,service,recs] of nextSamples){
   await open(route);
   const detail=await run(`(()=>{
     const section=document.querySelector('article .pe-next-step');
     const articles=section?[...section.querySelectorAll('.pe-next-links a')].map(x=>x.pathname):[];
     const target=section?.querySelector('.pe-next-service a')?.pathname;
     const border=section?getComputedStyle(section).borderTopStyle:'';
     return {articleLinks:articles,service:target,border,stepCount:document.querySelectorAll('.pe-next-step').length};
   })()`);
   if(detail?.stepCount!==1||detail.service!==service||
       JSON.stringify(detail.articleLinks)!==JSON.stringify(recs)||detail.border!=='solid'){
     throw Error('Article next-step and service mismatch '+route+' '+JSON.stringify(detail));
   }
   console.log('PASS contextual guide/service navigation',route,JSON.stringify(detail));
 }

 await open('/tools/gsc-review.html');
 const review=await run(`(async()=>{
   const ready=()=>document.getElementById('stat-total')?.textContent==='35'
     &&document.querySelectorAll('#report-body tr').length===35;
   for(let i=0;i<18&&!ready();i++)await new Promise(done=>setTimeout(done,100));
   if(!ready())return {pass:false,reason:'Sitemap not loaded',body:document.getElementById('notice-status')?.textContent};
   const URL1='https://peopleent.pagero.kr/insight/event-agency-cost/';
   const URL2='https://peopleent.pagero.kr/insight/event-rfp-writing/';
   const nl=String.fromCharCode(10);
   const input=document.getElementById('index-file');
   const setFile=(node,csv)=>{const data=new DataTransfer();data.items.add(new File([csv],'example.csv',{type:'text/csv'}));node.files=data.files;};
   setFile(input,['URL',URL1,URL2].join(nl));
   document.getElementById('index-status').value='crawled';
   document.getElementById('index-import').click();
   await new Promise(done=>setTimeout(done,150));
   const imported=document.getElementById('stat-excluded').textContent==='2'&&document.getElementById('stat-unknown').textContent==='33';
   const perf=document.getElementById('performance-file');
   setFile(perf,['Top pages,Clicks,Impressions',URL1+',2,14',URL2+',0,3'].join(nl));
   document.getElementById('performance-import').click();
   await new Promise(done=>setTimeout(done,150));
   const perfLoaded=document.getElementById('stat-performance').textContent==='2';
   setFile(input,['URL',URL1].join(nl));
   document.getElementById('index-status').value='indexed';
   document.getElementById('index-import').click();
   await new Promise(done=>setTimeout(done,150));
   const filter=document.getElementById('report-filter');
   filter.value='conflict';filter.dispatchEvent(new Event('change',{bubbles:true}));
   const conflict=document.querySelectorAll('#report-body tr').length===1&&
     document.getElementById('report-body').textContent.includes('자료 간 상태 충돌');
   filter.value='all';filter.dispatchEvent(new Event('change',{bubbles:true}));
   window.confirm=()=>true;document.getElementById('clear-button').click();
   const reset=document.getElementById('stat-unknown').textContent==='35'&&
     document.getElementById('stat-performance').textContent==='0';
   return {pass:imported&&perfLoaded&&conflict&&reset&&
      document.querySelector('meta[name=robots]')?.content.includes('noindex'),
      imported,perfLoaded,conflict,reset};
 })()`);
 if(!review?.pass)throw Error('Local GSC CSV tool browser check failed '+JSON.stringify(review));
 console.log('PASS GSC CSV workspace: import, conflict, performance, filter, reset',JSON.stringify(review));
  console.log('PASS three critical existing-page interactions');
} finally {
 if(socket)socket.close();
 chrome.kill('SIGKILL');server.kill('SIGKILL');
 await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
