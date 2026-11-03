// Local Cloudflare Pages middleware regression tests; no network required.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../functions/_middleware.js',import.meta.url),'utf8');
const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const html='<!doctype html><html lang="ko"><head><title>PEOPLEENT</title></head><body>Event</body></html>';
async function run(host,path='/',method='GET',contentType='text/html',status=200){
 const req=new Request('https://'+host+path,{method});
 const res=await onRequest({request:req,next:async()=>new Response(method==='HEAD'?null:html,{status,headers:{'content-type':contentType}})});
 return {body:method==='HEAD'?'':await res.text(),headers:res.headers,status:res.status};
}
const production=await run('peopleent.pagero.kr');
assert.equal(production.status,200);
assert.equal(production.headers.has('x-robots-tag'),false,'Production HTML must remain indexable');
assert.ok(production.body.includes('data-pagero-portfolio-ga4'),'Production tag must remain present');
const preview=await run('12345.peopleent.pages.dev');
assert.equal(preview.status,200);
assert.equal(preview.headers.get('x-robots-tag'),'noindex, nofollow','Preview HTML must not be indexed');
assert.ok(!preview.body.includes('data-pagero-portfolio-ga4'),'Preview must not have production tracking');
const previewHead=await run('12345.peopleent.pages.dev','/','HEAD');
assert.equal(previewHead.headers.get('x-robots-tag'),'noindex, nofollow');
const css=await run('12345.peopleent.pages.dev','/assets/site.css','GET','text/css');
assert.equal(css.headers.has('x-robots-tag'),false,'Assets should not gain an HTML noindex header');
const blocked=await run('peopleent.pagero.kr','/admin/');
assert.ok(!blocked.body.includes('data-pagero-portfolio-ga4'),'Restricted paths should not get tracking');
const missing=await run('12345.peopleent.pages.dev','/missing/','GET','text/html',404);
assert.equal(missing.headers.has('x-robots-tag'),false,'Non-200 responses are untouched');
console.log('PASS: production SEO header, preview noindex, HEAD, assets, tracking restriction and 404');
