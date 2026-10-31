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
  if(cards.length!==20||!input)return {pass:false,why:'missing cards/search',count:cards.length};
  input.value='RFP';input.dispatchEvent(new Event('input',{bubbles:true}));
  const matched=cards.filter(x=>!x.hidden).length;
  input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
  const filter=document.querySelector('[data-pe-topic="발주·견적"]');filter.click();
  const filtered=cards.filter(x=>!x.hidden).length;
  document.querySelector('[data-pe-topic="전체"]').click();
  return {pass:matched>=1&&matched<20&&filtered===6&&cards.every(x=>!x.hidden),searched:matched,filtered,all:cards.length};
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
 console.log('PASS three critical existing-page interactions');
} finally {
 if(socket)socket.close();
 chrome.kill('SIGKILL');server.kill('SIGKILL');
 await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
