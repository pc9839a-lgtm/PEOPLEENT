/* PEOPLEENT event-guide tools: explicit, on-device draft save; never contacts a server. */
(function () {
  'use strict';

  const root = document.querySelector('main[data-guide-draft-key]');
  if (!root) return;

  const variant = root.dataset.guideVariant;
  const key = root.dataset.guideDraftKey;
  const save = root.querySelector('[data-guide-action="save"]');
  const reset = root.querySelector('[data-guide-action="clear"]');
  const csv = root.querySelector('[data-guide-action="csv"]');
  const message = root.querySelector('[data-guide-storage-status]');
  const template = root.querySelector('#guide-template');
  if (!key || !['venue', 'shot'].includes(variant) || !save || !reset || !csv || !message || !template) return;

  const controls = variant === 'venue'
    ? [...root.querySelectorAll('select[data-venue], input[data-venue-note]'), template]
    : [...root.querySelectorAll('select[data-shot-status], input[data-shot-note]'), template];
  const expected = variant === 'venue' ? 33 : 25;
  if (controls.length !== expected || controls.some(el => !el.id)) return;

  function announce(text) {
    message.textContent = text;
  }

  function refresh() {
    // The existing page calculators listen to select change and note input events.
    const first = controls.find(el => el.matches('select'));
    if (first) first.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function formatSaved(iso) {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return '임시저장을 복원했습니다.';
    return '이 브라우저의 임시저장을 복원했습니다. (' + when.toLocaleString('ko-KR') + ')';
  }

  function restore() {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        announce('저장된 기록이 없습니다. 저장 버튼을 누를 때만 이 기기에 보관됩니다.');
        return;
      }
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !data.controls || typeof data.controls !== 'object' || Array.isArray(data.controls)) {
        announce('이전 임시저장 형식이 달라 복원하지 않았습니다.');
        return;
      }
      for (const el of controls) {
        if (!Object.prototype.hasOwnProperty.call(data.controls, el.id)) continue;
        const value = data.controls[el.id];
        if (typeof value !== 'string') continue;
        if (el.tagName === 'SELECT') {
          if ([...el.options].some(option => option.value === value)) el.value = value;
        } else {
          el.value = value.slice(0, el.maxLength > 0 ? el.maxLength : 30000);
        }
      }
      refresh();
      announce(formatSaved(data.savedAt));
    } catch (_) {
      announce('브라우저 저장소에 접근할 수 없습니다. 복사·CSV 내보내기를 사용하세요.');
    }
  }

  save.addEventListener('click', () => {
    try {
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        controls: Object.fromEntries(controls.map(el => [el.id, el.value]))
      };
      localStorage.setItem(key, JSON.stringify(data));
      announce('이 브라우저에 임시저장했습니다. 다른 기기에는 동기화되지 않습니다.');
    } catch (_) {
      announce('저장하지 못했습니다. 브라우저 저장 공간을 확인하거나 CSV로 내보내세요.');
    }
  });

  reset.addEventListener('click', () => {
    if (!window.confirm('이 브라우저에 저장한 기록과 현재 입력 내용을 모두 초기화할까요?')) return;
    try {
      localStorage.removeItem(key);
    } catch (_) {
      announce('저장소에서 기록을 삭제하지 못했습니다. 브라우저 설정에서 저장 데이터를 삭제하세요.');
      return;
    }
    for (const el of controls) {
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = el.defaultValue;
    }
    refresh();
    announce('임시저장 기록과 현재 입력값을 초기화했습니다.');
  });

  function safeCell(value) {
    let s = String(value == null ? '' : value);
    // Prevent spreadsheet formula injection if a note begins with = + - @.
    if (/^[\t\r\n ]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function rowsForCsv() {
    if (variant === 'venue') {
      const a = [...root.querySelectorAll('select[data-venue="A"]')];
      const b = [...root.querySelectorAll('select[data-venue="B"]')];
      return [
        ['검사항목', '후보 A 상태', '후보 A 확인 메모', '후보 B 상태', '후보 B 확인 메모'],
        ...a.map((field, i) => [
          field.dataset.topic, field.value,
          root.querySelector('#venue-note-A-' + i)?.value || '',
          b[i]?.value || '',
          root.querySelector('#venue-note-B-' + i)?.value || ''
        ])
      ];
    }
    const shots = [...root.querySelectorAll('select[data-shot-status]')];
    return [
      ['촬영 장면', '우선순위', '확보 상태', '담당자·파일·메모'],
      ...shots.map((field, i) => [
        field.dataset.shotName, field.dataset.priority, field.value,
        root.querySelector('#shot-note-' + i)?.value || ''
      ])
    ];
  }

  csv.addEventListener('click', () => {
    try {
      const rows = rowsForCsv();
      if (rows.length !== (variant === 'venue' ? 9 : 13)) throw Error('invalid rows');
      const content = '\uFEFF' + rows.map(row => row.map(safeCell).join(',')).join('\r\n') + '\r\n';
      const file = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = variant === 'venue' ? 'PEOPLEENT_행사장_A-B_비교.csv' : 'PEOPLEENT_촬영_샷리스트.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      announce('현재 입력 상태를 CSV 파일로 내보냈습니다. 파일에는 템플릿 본문이 아닌 표 데이터만 포함됩니다.');
    } catch (_) {
      announce('CSV 파일을 만들지 못했습니다. 비교·촬영 결과 복사 버튼을 이용하세요.');
    }
  });

  controls.forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    announce('변경 내용은 아직 저장되지 않았습니다. 임시저장 또는 CSV 내보내기를 이용하세요.');
  }));

  restore();
})();