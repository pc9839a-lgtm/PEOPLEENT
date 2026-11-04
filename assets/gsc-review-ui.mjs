import {
  STATUSES, BASE, extractSitemap, parseIndexExamples, parsePerformance,
  getSummary, exportCsv
} from './gsc-review-core.mjs';

// Local-only workspace: user files never leave this browser.
const $ = id => document.getElementById(id);
const state = { urls: [], urlSet: new Set(), indexing: new Map(), performance: new Map() };
const MAX_FILE = 5_000_000;

function message(text, level = 'info') {
  $('notice-status').textContent = text;
  $('notice-status').dataset.level = level;
}

function isExcluded(row) {
  return ['crawled','discovered','alternate','blocked'].includes(row.status);
}

function filterRows(rows) {
  const filter = $('report-filter').value;
  if (filter === 'all') return rows;
  if (filter === 'excluded') return rows.filter(isExcluded);
  return rows.filter(r => r.status === filter);
}

function draw() {
  const summary = getSummary(state.urls, state.indexing, state.performance);
  const { counts, rows, withPerformance } = summary;
  $('stat-total').textContent = String(state.urls.length);
  $('stat-indexed').textContent = String(counts.indexed);
  $('stat-excluded').textContent = String(counts.crawled + counts.discovered + counts.alternate + counts.blocked);
  $('stat-unknown').textContent = String(counts.unknown + counts.conflict);
  $('stat-performance').textContent = String(withPerformance);
  $('export-button').disabled = state.urls.length === 0;
  $('index-import').disabled = state.urls.length === 0;
  $('performance-import').disabled = state.urls.length === 0;

  const tbody = $('report-body');
  tbody.replaceChildren();
  const filtered = filterRows(rows);
  if (!filtered.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = '현재 필터에 해당하는 URL이 없습니다.';
    tr.append(td); tbody.append(tr); return;
  }

  for (const row of filtered) {
    const tr = document.createElement('tr');
    const urlTd = document.createElement('td'), link = document.createElement('a');
    urlTd.className = 'url'; link.href = row.url; link.textContent = row.url.slice(BASE.length);
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.title = row.url;
    urlTd.append(link); tr.append(urlTd);

    const status = document.createElement('td');
    status.className = 'status';
    status.textContent = row.label;
    tr.append(status);

    for (const value of [row.clicks, row.impressions]) {
      const td = document.createElement('td');
      td.className = 'numeric'; td.textContent = value === null ? '—' : value.toLocaleString('ko-KR');
      tr.append(td);
    }

    const action = document.createElement('td');
    action.className = 'action'; action.textContent = row.action;
    tr.append(action);
    tbody.append(tr);
  }
}

async function readFile(input) {
  const file = input.files?.[0];
  if (!file) throw new Error('CSV 파일을 선택하세요.');
  if (file.size > MAX_FILE) throw new Error('CSV 파일은 5MB 이하만 지원합니다.');
  return file.text();
}

$('index-import').addEventListener('click', async () => {
  try {
    const raw = await readFile($('index-file'));
    const status = $('index-status').value;
    const data = parseIndexExamples(raw, status, state.urlSet);
    for (const [url, key] of data.records) {
      const set = state.indexing.get(url) || new Set();
      set.add(key);
      state.indexing.set(url, set);
    }
    draw();
    message(STATUSES[status].label + ': 사이트맵 URL ' + data.count
      + '개 반영했습니다. 다른 도메인·미등록 ' + data.outside
      + '개, 주소 오류 ' + data.ignored + '개는 제외했습니다.', 'success');
    $('index-file').value = '';
  } catch (error) {
    message(error.message || '파일을 읽지 못했습니다.', 'error');
  }
});

$('performance-import').addEventListener('click', async () => {
  try {
    const raw = await readFile($('performance-file'));
    const parsed = parsePerformance(raw, state.urlSet);
    state.performance = parsed.records;
    draw();
    message('검색 실적 URL ' + parsed.count
      + '개를 적용했습니다. 다른 도메인·미등록 ' + parsed.outside
      + '개, 잘못된 행 ' + parsed.ignored
      + '개는 제외했습니다. 색인 상태와는 별개입니다.', 'success');
    $('performance-file').value = '';
  } catch (error) {
    message(error.message || '검색 실적 CSV를 읽지 못했습니다.', 'error');
  }
});

$('report-filter').addEventListener('change', draw);

$('clear-button').addEventListener('click', () => {
  if (!window.confirm('가져온 CSV 데이터와 비교 결과를 현재 브라우저에서 초기화할까요?')) return;
  state.indexing.clear();
  state.performance = new Map();
  $('index-file').value = '';
  $('performance-file').value = '';
  $('report-filter').value = 'all';
  draw();
  message('가져온 데이터를 초기화했습니다. 사이트맵 목록은 유지됩니다.', 'success');
});

$('export-button').addEventListener('click', () => {
  if (!state.urls.length) return;
  const rows = filterRows(getSummary(state.urls, state.indexing, state.performance).rows);
  const blob = new Blob([exportCsv(rows)], {type:'text/csv;charset=utf-8'});
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = 'PEOPLEENT_GSC_URL_대조_결과.csv';
  a.style.display = 'none'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  message('현재 필터의 URL ' + rows.length + '개를 CSV로 내보냈습니다.', 'success');
});

(async () => {
  try {
    const response = await fetch('/sitemap.xml', {cache:'no-store'});
    if (!response.ok) throw new Error('사이트맵 HTTP ' + response.status + ' 오류');
    const urls = extractSitemap(await response.text());
    state.urls = urls;
    state.urlSet = new Set(urls);
    draw();
    message('운영 사이트맵 ' + urls.length
      + '개 URL을 불러왔습니다. Search Console CSV를 가져오면 상태별로 대조합니다.', 'success');
  } catch (error) {
    message('사이트맵을 불러오지 못했습니다. 페이지를 새로고침하거나 운영 도메인 접속 상태를 확인하세요. ('
      + error.message + ')', 'error');
  }
})();
