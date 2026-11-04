import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASE, STATUSES, canonicalize, parseCsv, parseIndexExamples,
  parsePerformance, getSummary, exportCsv, extractSitemap
} from '../assets/gsc-review-core.mjs';

const sitemapXml = readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8');
const URLs = extractSitemap(sitemapXml);
assert.equal(URLs.length, 35, 'Site has 35 canonical URLs');
const target = new Set(URLs);
assert.equal(new Set(URLs).size, 35);
assert.ok(URLs.includes(BASE + '/insight/event-agency-cost/'));
assert.equal(canonicalize(BASE+'/insight/event-agency-cost/?name=PRIVATE#fragment'),
             BASE+'/insight/event-agency-cost/');
assert.equal(canonicalize(BASE+'/insight/event-agency-cost'),BASE+'/insight/event-agency-cost/');
assert.equal(canonicalize(BASE+'/insight/event-agency-cost/index.html'),BASE+'/insight/event-agency-cost/');
assert.equal(canonicalize('https://other.example/insight/event-agency-cost/'),null);
assert.equal(canonicalize('http://peopleent.pagero.kr/insight/'),null);
assert.equal(canonicalize('https://peopleent.pagero.kr.evil.org/'),null);

assert.deepEqual(parseCsv('\uFEFF"URL","메모"\r\n"https://example.com","쉼표, 줄바꿈\n""큰따옴표"""\r\n'),[
  ['URL','메모'],['https://example.com','쉼표, 줄바꿈\n"큰따옴표"']
]);
assert.throws(()=>parseCsv('URL\n"unclosed'),/따옴표/);
assert.throws(()=>parseCsv(''),/비어/);

const url1=BASE+'/insight/event-agency-cost/';
const url2=BASE+'/insight/event-rfp-writing/';
const examples='\uFEFFURL,메모\r\n'
  +'"'+url1+'?utm_source=PRIVATE","test"\r\n'
  +'"'+url2+'","other"\r\n'
  +'"https://outside.example/",ignore\r\n'
  +'"'+url1+'",dup\r\n'
  +'"'+BASE+'/unpublished/",extra\r\n';
const parsed=parseIndexExamples(examples,'crawled',target);
assert.equal(parsed.count,2);
assert.equal(parsed.outside,1);
assert.equal(parsed.ignored,1);
assert.equal(parsed.duplicates,1);
assert.equal(parsed.records.get(url1),'crawled');
assert.throws(()=>parseIndexExamples('Reason,Pages\nCrawled,4','blocked',target),/URL 목록/);
assert.throws(()=>parseIndexExamples('Top pages,Clicks,Impressions\n'+url1+',1,2','indexed',target),/검색 성과 CSV/);
assert.throws(()=>parseIndexExamples(examples,'unknown',target),/상태/);

const performance=parsePerformance('\uFEFF상위 페이지,클릭수,노출수,CTR,평균 게재순위\r\n'
  +'"'+url1+'?private=SECRET",12,90,13.3%,8.4\r\n'
  +'"'+url2+'",0,4,0%,23.7\r\n'
  +'"https://outside.example/",40,80,50%,1\r\n',target);
assert.equal(performance.count,2);
assert.equal(performance.ignored,1);
assert.equal(performance.records.get(url1).clicks,12);
assert.equal(performance.records.get(url1).impressions,90);
assert.equal(performance.records.get(url1).position,8.4);
assert.equal(performance.records.get(url2).impressions,4);
assert.throws(()=>parsePerformance('URL,사유\n'+url1+',not-indexed',target),/검색 성과 CSV/);

const indexing=new Map([
  [url1,new Set(['crawled'])],
  [url2,new Set(['indexed','discovered'])]
]);
let report=getSummary(URLs,indexing,performance.records);
assert.equal(report.rows.length,35);
assert.equal(report.counts.crawled,1);
assert.equal(report.counts.conflict,1);
assert.equal(report.counts.unknown,33);
assert.equal(report.withPerformance,2);
assert.equal(report.rows[0].url,url2,'Conflicting statuses come first');
assert.equal(report.rows[1].url,url1);
assert.equal(report.rows.find(x=>x.url===url1).impressions,90);
assert.equal(report.rows.find(x=>x.url===url1).status,'crawled');
assert.equal(report.rows.find(x=>x.url===BASE+'/').status,'unknown');
assert.equal(report.rows.find(x=>x.url===BASE+'/').impressions,null,'No performance row is unknown, not zero');

const exported=exportCsv(report.rows);
assert.equal(exported.charCodeAt(0),0xFEFF);
assert.ok(exported.includes('가져온 색인 상태'));
assert.ok(!exported.includes('PRIVATE'));
assert.ok(!exported.includes('SECRET'));
assert.ok(exported.includes('"' + url1 + '"'));
const attack=exportCsv([{url:'=HYPERLINK("bad","x")',label:'@SUM(1)',clicks:0,impressions:0,position:null,action:'-CMD'}]);
assert.ok(attack.includes("'=HYPERLINK"));
assert.ok(attack.includes("'@SUM(1)"));
assert.ok(attack.includes("'-CMD"));
assert.equal(Object.keys(STATUSES).length,7);

console.log('PASS: 35 sitemap URLs, index exclusions, conflicting evidence, performance-vs-index safety, CSV parsing and injection defense');
