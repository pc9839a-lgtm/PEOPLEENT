// Privacy and routing regression tests for production-only GA4 click events.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/peopleent-engagement.js', import.meta.url), 'utf8');

function page(pathname, hostname='peopleent.pagero.kr', withAnalytics=true) {
  const listeners = new Map();
  const calls = [];
  const win = {
    location: {hostname, pathname, href:'https://'+hostname+pathname+'?private=secret'},
    ...(withAnalytics ? {gtag: (...args)=>calls.push(args)} : {})
  };
  const doc = {
    addEventListener: (name, cb) => listeners.set(name, [...(listeners.get(name)||[]), cb])
  };
  vm.runInNewContext(source, {window:win, document:doc, URL}, {timeout:1500});

  function dispatch(type, target) {
    for (const handler of listeners.get(type)||[]) handler({target});
  }
  function a(href, container='body') {
    const link = {
      getAttribute: name => name==='href'?href:null,
      closest: selector => {
        if (selector.includes('.pe-sticky-cta') && container==='sticky') return {};
        if (selector.includes('.pe-next-service') && container==='related_service') return {};
        if (selector.includes('.pe-next-links') && container==='reading_path') return {};
        if (selector.includes('#pe-articles') && container==='article_card') return {};
        if (selector.includes('.hero-actions') && container==='hero') return {};
        if (selector.includes('.pe-inline-cta') && container==='inline_cta') return {};
        return null;
      }
    };
    dispatch('click', {closest: selector => selector==='a[href]'?link:null});
  }
  function topic(value) {
    const button = {getAttribute: n => n==='data-pe-topic'?value:null};
    dispatch('click', {closest: selector => selector==='button[data-pe-topic]'?button:null});
  }
  function search(value) {dispatch('input',{id:'pe-guide-search',value});}
  return {calls, a, topic, search, listeners};
}

let p=page('/insight/');
p.a('/insight/event-agency-cost/?email=private%40example.com','article_card');
p.a('/conference/?token=private','related_service');
p.a('https://peopleent.com/contact?name=private','sticky');
p.a('https://untrusted.example/contact?name=private');
p.a('mailto:info@example.com');
p.a('#section');
p.search('고객명 010-1234-5678');
p.search('another personal message');
p.topic('발주·견적');
p.topic('unknown external filter');
assert.deepEqual(p.calls.map(x=>x[1]),[
  'pe_article_click','pe_service_click','pe_contact_click','pe_search_used','pe_topic_filter'
]);
assert.equal(p.calls[0][2].source_type,'insight_hub');
assert.equal(p.calls[0][2].source_path,'/insight/');
assert.equal(p.calls[0][2].destination_path,'/insight/event-agency-cost/');
assert.equal(p.calls[0][2].link_position,'article_card');
assert.equal(p.calls[1][2].destination_path,'/conference/');
assert.equal(p.calls[1][2].link_position,'related_service');
assert.equal(p.calls[2][2].link_position,'sticky');
assert.equal(p.calls[3][2].source_path,'/insight/');
assert.equal(p.calls[4][2].topic_group,'발주·견적');
assert.equal(JSON.stringify(p.calls).includes('private'),false);
assert.equal(JSON.stringify(p.calls).includes('010-1234'),false);
assert.equal(JSON.stringify(p.calls).includes('고객명'),false);

p=page('/insight/event-agency-cost/');
p.a('/insight/event-rfp-writing/?ref=sensitive','reading_path');
p.a('/corporate-event/?lead=sensitive','related_service');
p.a('https://peopleent.com/contact','inline_cta');
p.search('private');
p.topic('발주·견적');
assert.deepEqual(p.calls.map(x=>x[1]),['pe_article_click','pe_service_click','pe_contact_click']);
assert.ok(p.calls.every(x=>x[2].source_type==='article'));
assert.ok(p.calls.every(x=>x[2].source_path==='/insight/event-agency-cost/'));

p=page('/');
p.a('https://peopleent.com/contact','hero');
assert.deepEqual(p.calls.map(x=>x[1]),['pe_contact_click']);
assert.equal(p.calls[0][2].source_type,'home');

p=page('/conference/');
p.a('https://peopleent.com/contact','sticky');
assert.deepEqual(p.calls.map(x=>x[1]),['pe_contact_click']);
assert.equal(p.calls[0][2].source_type,'service');

p=page('/insight/', 'branch.peopleent.pages.dev');
p.a('https://peopleent.com/contact');
p.search('private');
p.topic('전체');
assert.equal(p.calls.length,0);
assert.equal(p.listeners.size,0,'No listeners on preview domains');

p=page('/insight/', 'peopleent.pagero.kr', false);
p.a('https://peopleent.com/contact');
p.search('some query');
assert.equal(p.calls.length,0,'No crash without GA4 on production');

console.log('PASS: five event types, safe paths, no search/PII, production-only, no analytics fallback');
