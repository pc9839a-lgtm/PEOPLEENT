// Browser + Node shared logic. No network or storage, and no analytics calls.
// Search Console exports have several formats: only URL-level examples establish an
// indexing observation. Search-performance rows NEVER establish indexed status.
export const BASE = 'https://peopleent.pagero.kr';
export const STATUSES = Object.freeze({
  indexed: { label: '색인됨(가져온 자료)', order: 5, action: '색인 상태를 유지하고 검색 성과를 확인' },
  crawled: { label: '크롤링됨 - 현재 색인 생성 안 됨', order: 1, action: '해당 URL의 콘텐츠 고유성·검색 의도·중복 여부 점검' },
  discovered: { label: '발견됨 - 현재 색인 생성 안 됨', order: 2, action: '내부 링크·사이트맵·크롤링 접근 및 대기 기간 확인' },
  alternate: { label: '중복·다른 canonical 선택', order: 3, action: 'Google 선택 canonical과 사이트 정식 URL 비교' },
  blocked: { label: '차단·오류·기타 색인 제외', order: 1, action: '해당 URL의 차단 사유와 Search Console 세부 항목 확인' },
  unknown: { label: '색인 상태 자료 없음', order: 4, action: 'Search Console URL 검사로 실제 상태 확인' },
  conflict: { label: '자료 간 상태 충돌', order: 0, action: '업로드 파일의 날짜·대상과 최신 URL 검사 결과 대조' }
});

export function canonicalize(input) {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'peopleent.pagero.kr'
        || url.port || url.username || url.password) return null;
    let path = url.pathname;
    if (path.endsWith('/index.html')) path = path.slice(0, -10);
    if (path === '') path = '/';
    if (path !== '/' && !path.endsWith('/') && !/\.[a-z\d]{1,8}$/i.test(path)) path += '/';
    return BASE + path;
  } catch {
    return null;
  }
}

export function parseCsv(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('비어 있는 CSV 파일입니다.');
  const input = raw.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, startedQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; }
      else cell += ch;
    } else if (ch === '"') {
      if (cell !== '' || startedQuote) throw new Error('CSV 따옴표 구문이 잘못됐습니다.');
      quoted = true; startedQuote = true;
    } else if (ch === ',') {
      row.push(cell); cell = ''; startedQuote = false;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = []; cell = ''; startedQuote = false;
    } else if (startedQuote && ch !== ' ' && ch !== '\t') {
      throw new Error('CSV 닫는 따옴표 이후에 잘못된 문자가 있습니다.');
    } else if (!startedQuote) cell += ch;
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

function norm(value) {
  return String(value || '').replace(/[\uFEFF_\s\-\(\)]/g, '').toLowerCase();
}
const URL_HEADERS = new Set(['url','page','pages','toppages','페이지','상위페이지','주소','검사url','페이지url']);
const CLICK_HEADERS = new Set(['clicks','click','클릭수','클릭']);
const IMP_HEADERS = new Set(['impressions','impression','노출수','노출']);
const CTR_HEADERS = new Set(['ctr','클릭률']);
const POSITION_HEADERS = new Set(['position','averageposition','평균게재순위','평균순위','순위']);

function headerInfo(rows, requiredMetrics = false) {
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const names = rows[i].map(norm);
    const url = names.findIndex(x => URL_HEADERS.has(x));
    const clicks = names.findIndex(x => CLICK_HEADERS.has(x));
    const impressions = names.findIndex(x => IMP_HEADERS.has(x));
    if (url < 0 || (requiredMetrics && (clicks < 0 || impressions < 0))) continue;
    return {
      i, url, clicks, impressions,
      ctr: names.findIndex(x => CTR_HEADERS.has(x)),
      position: names.findIndex(x => POSITION_HEADERS.has(x))
    };
  }
  if (requiredMetrics) throw new Error('검색 성과 CSV에 페이지 URL·클릭·노출 열이 없습니다. Search Console의 검색 실적 → 페이지 CSV를 사용하세요.');
  throw new Error('URL 목록 열을 찾지 못했습니다. 페이지 색인 보고서의 전체 집계표가 아닌, 특정 사유의 예시 URL 목록 CSV가 필요합니다.');
}

export function parseIndexExamples(raw, status, sitemapSet) {
  if (!STATUSES[status] || status === 'unknown' || status === 'conflict') {
    throw new Error('색인 상태를 선택하세요.');
  }
  const rows = parseCsv(raw), header = headerInfo(rows);
  if (header.clicks >= 0 && header.impressions >= 0) {
    throw new Error('검색 성과 CSV는 색인 상태를 입증하지 않습니다. 아래 검색 성과 가져오기 영역을 이용하세요.');
  }
  const records = new Map();
  let ignored = 0, outside = 0, duplicates = 0;
  for (const row of rows.slice(header.i + 1)) {
    const url = canonicalize(row[header.url]);
    if (!url) { ignored++; continue; }
    if (!sitemapSet.has(url)) { outside++; continue; }
    if (records.has(url)) duplicates++;
    records.set(url, status);
  }
  if (!records.size) throw new Error('사이트맵 35개 URL과 일치하는 항목이 없습니다. 페이지 주소와 파일을 확인하세요.');
  return {records, ignored, outside, duplicates, count: records.size};
}

function numeric(value) {
  const v = String(value || '').trim().replace(/,/g, '');
  const n = Number(v.replace(/%$/, ''));
  return v && Number.isFinite(n) && n >= 0 ? n : null;
}

export function parsePerformance(raw, sitemapSet) {
  const rows = parseCsv(raw), h = headerInfo(rows, true);
  const records = new Map();
  let ignored = 0, outside = 0, duplicates = 0;
  for (const row of rows.slice(h.i + 1)) {
    const url = canonicalize(row[h.url]);
    if (!url) { ignored++; continue; }
    if (!sitemapSet.has(url)) { outside++; continue; }
    const clicks = numeric(row[h.clicks]), impressions = numeric(row[h.impressions]);
    if (clicks === null || impressions === null) { ignored++; continue; }
    const prev = records.get(url);
    if (prev) duplicates++;
    const avg = h.position < 0 ? null : numeric(row[h.position]);
    const totalImpressions = impressions + (prev?.impressions || 0);
    const position = avg === null && (!prev || prev.position === null) ? null
      : (impressions * (avg || 0) + (prev?.impressions || 0) * (prev?.position || 0))
        / Math.max(totalImpressions, 1);
    records.set(url, {
      clicks: clicks + (prev?.clicks || 0),
      impressions: totalImpressions,
      position
    });
  }
  if (!records.size) throw new Error('사이트맵과 일치하는 검색 성과 URL이 없습니다.');
  return {records, ignored, outside, duplicates, count: records.size};
}

export function getSummary(sitemapUrls, indexing, performance) {
  const rows = sitemapUrls.map(url => {
    const statuses = [...(indexing.get(url) || new Set())];
    const status = statuses.length === 0 ? 'unknown' : statuses.length > 1 ? 'conflict' : statuses[0];
    const perf = performance.get(url) || null;
    return {
      url, status, label: STATUSES[status].label, action: STATUSES[status].action,
      clicks: perf ? perf.clicks : null,
      impressions: perf ? perf.impressions : null,
      position: perf ? perf.position : null,
      sourceStatuses: statuses
    };
  }).sort((a,b) => STATUSES[a.status].order - STATUSES[b.status].order
                  || (b.impressions ?? -1) - (a.impressions ?? -1)
                  || a.url.localeCompare(b.url));
  const counts = Object.fromEntries(Object.keys(STATUSES).map(key =>
    [key, rows.filter(x => x.status === key).length]));
  return {rows, counts, withPerformance: rows.filter(x => x.impressions !== null).length};
}

export function exportCsv(rows) {
  function cell(x) {
    const raw = x === null || x === undefined ? '' : String(x);
    // Spreadsheet formula guard: apply even when whitespace precedes the payload.
    const safe = /^[\s\uFEFF]*[=+\-@]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replace(/"/g, '""') + '"';
  }
  const data = [
    ['URL','가져온 색인 상태','검색 클릭','검색 노출','평균 순위','우선 확인 작업'],
    ...rows.map(x => [x.url,x.label,x.clicks,x.impressions,
      x.position === null ? null : Math.round(x.position * 100) / 100,x.action])
  ];
  return '\uFEFF' + data.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function extractSitemap(xml) {
  if (!/<urlset\b/i.test(xml)) throw new Error('올바른 사이트맵 XML이 아닙니다.');
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)];
  const urls = matches.map(x => canonicalize(x[1].replace(/&amp;/g, '&')));
  if (!urls.length || urls.some(x => !x) || new Set(urls).size !== urls.length) {
    throw new Error('사이트맵 URL이 비어 있거나 중복·다른 도메인이 있습니다.');
  }
  return urls;
}
