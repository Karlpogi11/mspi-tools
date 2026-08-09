const DEFAULT_PROFILE = {
  _v: 2,
  mall: {
    tradeName: 'MOBILE CARE BY POWER MAC CENTER',
    classification: 'NON-FOOD',
    branch: 'THE PODIUM',
    areaType: 'MALL',
    location: '4L',
  },
  mallCombos: true,
  requestor: {
    name: 'MOBILECARE SERVICES PHILS INC (SMKL)',
    position: 'Tenant',
    contact: '09690120395',
  },
  sameAsRequestor: false,
  contacts: [
    { name: 'PAUL ANGELO REVILLA', position: 'ASST.SUPERVISOR', contact: '09690120395' },
    { name: 'JOHN RAY ABLAZA', position: 'CSO', contact: '09102865531' },
  ],
  work: {
    tenantStatus: 'Operating',
    numWork: 5,
    scope: 'Pullout of merchandise/goods/items/products/stocks',
    items: 'DELIVERY/PULLOUT OF APPLE PRODUCTS',
    specific: 'DELIVERY/PULLOUT OF APPLE PRODUCTS',
    fromTime: '11:00 AM',
    toTime: '05:00 PM',
    urgent: false,
  },
  personnel: [
    'JIMSON SALAS', 'LEOMAR BLANCO', 'DAVID JOHN DICHOSO', 'REAGAN ROBLES',
    'BENEDICT FANGON', 'MARLON SUBIA', 'EDISON BELLEZA', 'MARK JOSEPH CATILCONG',
    'RYAN PAT', 'RAFFY MAGALLANO', 'CHRISTOPHER ISIP', 'JOHN REAL ESPAÑOL',
    'MARLON CEBUANO', 'MAC AERON OLIVEROS', 'SILVERIO MAGALLANES',
    'FRANCIS MON FRANCISCO', 'CARL MABANAN', 'JAYSON BONAOBRA',
    'MARK LESTER JOEL', 'CLAUDETH OLIVAR',
  ].map((line) => {
    const [first, ...rest] = line.split(/\s+/);
    return { first, last: rest.join(' ') || '', mi: '' };
  }),
};

const $ = (id) => document.getElementById(id);
const state = { profile: structuredClone(DEFAULT_PROFILE), saveTimer: null };

function deepMerge(base, patch) {
  if (Array.isArray(base)) return patch;
  if (patch && typeof patch === 'object' && base && typeof base === 'object') {
    const out = { ...base };
    for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k]);
    return out;
  }
  return patch === undefined ? base : patch;
}

async function loadProfile() {
  const stored = (await chrome.storage.local.get('wpProfile')).wpProfile;
  if (stored && stored._v === DEFAULT_PROFILE._v) {
    state.profile = deepMerge(structuredClone(DEFAULT_PROFILE), stored);
  } else {
    delete stored?.mallCombos;
    state.profile = deepMerge(structuredClone(DEFAULT_PROFILE), stored || {});
  }
}

async function persist() {
  await chrome.storage.local.set({ wpProfile: state.profile });
}

function setAll(update) {
  state.profile = deepMerge(state.profile, update || {});
  render();
  persist();
}

function render() {
  const p = state.profile;
  document.querySelectorAll('[data-field]').forEach((el) => {
    const path = el.dataset.field.split('.');
    let v = p;
    for (const k of path) v = v && v[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'number') el.value = v ?? 5;
    else el.value = v ?? '';
  });

  const wrap = $('contacts');
  wrap.innerHTML = '';
  p.contacts.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'contact-card';
    card.innerHTML = `
      <span style="grid-column:1/-1;font-weight:700;color:#3a3a43">Contact ${i + 1}</span>
      <label>Name<input class="c-name" value="${esc(c.name || '')}" /></label>
      <label>Position<input class="c-pos" value="${esc(c.position || '')}" /></label>
      <label>Contact Number<input class="c-tel" value="${esc(c.contact || '')}" /></label>
    `;
    wrap.appendChild(card);
  });
  $('f_people').value = p.personnel.map((x) => `${x.first}${x.mi ? ' ' + x.mi : ''} ${x.last}`.trim()).join('\n');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function collect() {
  const p = state.profile;
  const contactsWrap = $('contacts');
  const cards = contactsWrap.querySelectorAll('.contact-card');
  const nextContacts = Array.from(cards).map((c) => ({
    name: c.querySelector('.c-name').value.trim(),
    position: c.querySelector('.c-pos').value.trim(),
    contact: c.querySelector('.c-tel').value.trim(),
  }));
  p.contacts = nextContacts;
  const peopleLines = $('f_people').value.split('\n').map((l) => l.trim()).filter(Boolean);
  p.personnel = peopleLines.map((l) => {
    const t = l.includes(',') ? l.split(',') : l.split(/\s+/);
    const first = (t[0] || '').trim();
    const rest = (t.slice(1).join(' ') || '').trim();
    const m = /^(\S+)\s+(.+)$/.exec(rest);
    return { first, mi: '', last: rest };
  });
  return p;
}

function bindFields() {
  document.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('input', () => {
      const path = el.dataset.field.split('.');
      let node = state.profile;
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
      const key = path[path.length - 1];
      if (el.type === 'checkbox') node[key] = el.checked;
      else if (el.type === 'number') node[key] = parseInt(el.value, 10) || 1;
      else node[key] = el.value;
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(persist, 400);
    });
  });
}

function setStatus(msg, kind) {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status ' + (kind || '');
}

function appendLog(line, ok) {
  const logEl = $('log');
  logEl.style.display = 'block';
  const mark = ok === undefined ? '·' : ok ? '✓' : '✗';
  logEl.innerHTML += `<span class="${ok === undefined ? '' : ok ? 'tick' : 'cross'}">${mark}</span> ${esc(line)}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  const l = $('log');
  l.innerHTML = '';
  l.style.display = 'none';
}

async function sendToTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) throw new Error('No active tab');
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/helpers.js', 'content/fill.js'],
    });
    await new Promise((r) => setTimeout(r, 250));
    return await chrome.tabs.sendMessage(tab.id, msg);
  }
}

async function onFill() {
  clearLog();
  const cfg = collect();
  setStatus('Filling…');
  try {
    const res = await sendToTab({ type: 'wp-fill', cfg });
    if (!res || !res.ok) {
      setStatus(res?.message || res?.error || 'Fill failed', 'err');
      appendLog({ text: (res?.message || res?.error || 'Unhandled error'), ok: false });
      return;
    }
    (res.logs || []).forEach((l) => appendLog((l && (l.label || l.text)) || JSON.stringify(l), l.ok));
    setStatus(res.ok ? `Done — page ${res.page} filled` : 'Done with warnings', 'ok');
  } catch (e) {
    setStatus('Could not reach the tab. Reload the page and retry.', 'err');
    appendLog({ text: String(e.message || e), ok: false });
  }
}

const PROBE_FN = async () => {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const textOf = (el) => { try { return (el.textContent || '').replace(/\s+/g, ' ').trim(); } catch { return ''; } };
  const camel = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
  const vis = (el) => {
    if (!el) return false;
    try { if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.tagName !== 'OPTION') return false; } catch { return false; }
    try { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; } catch { return false; }
  };
  const labelFor = (el) => {
    if (el.getAttribute && el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const id = el.id || '';
    if (id) {
      const m = /Input[-_]([A-Za-z0-9_]+)$/.exec(id) || /Dropdown[-_]([A-Za-z0-9_]+)$/.exec(id);
      if (m) return camel(m[1].replace(/_/g, ' '));
    }
    if (el.placeholder) return el.placeholder;
    let n = el;
    for (let i = 0; n && i < 5; i++, n = n.parentElement) {
      const p = n.previousElementSibling;
      if (p && textOf(p)) return textOf(p);
    }
    return '';
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const steps = [];
  const push = (l, d) => steps.push(l + ' — ' + String(d));
  const ctrls = Array.from(document.querySelectorAll('input, select, textarea, [role=combobox]')).filter(vis);

  let target = null;
  for (const c of ctrls) {
    const lb = norm(labelFor(c));
    if (lb.includes('tenant') && lb.includes('status')) { target = c; break; }
  }
  if (!target) {
    push('Tenant Status', 'NOT FOUND among ' + ctrls.length + ' controls');
    push('Sample controls', JSON.stringify(ctrls.slice(0, 10).map((c) => c.tagName + '#' + (c.id || '') + ' "' + labelFor(c) + '"')));
    return steps;
  }
  push('Field', target.tagName + ' id=' + (target.id || '-') + ' class=' + String(target.className || '').slice(0, 60) + ' label="' + labelFor(target) + '"');

  const itemTexts = () => {
    const seen = new Set();
    const out = [];
    for (const o of document.querySelectorAll('[role=option], [class*=option], [class*=item], li, .dropdown-item, .mat-option, .k-option, .el-select-dropdown__item, [role=menuitem], option, [class*=suggestion]')) {
      const txt = norm(textOf(o));
      if (!txt || txt.length > 60 || seen.has(txt)) continue;
      if (!vis(o)) continue;
      seen.add(txt);
      out.push(txt);
    }
    return out.slice(0, 25);
  };

  if (target.tagName === 'SELECT') {
    push('Options before click', target.options.length + ' [' + Array.from(target.options).map((o) => o.textContent).join(' | ') + ']');
    try { target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); target.click(); } catch {}
    await sleep(1600);
    push('Options after click', target.options.length + ' [' + Array.from(target.options).map((o) => o.textContent).join(' | ') + ']');
    push('Visible list', itemTexts().join(' | ') || '(none)');
    let done = false;
    for (const o of Array.from(target.options)) {
      if (norm(o.textContent) === norm('Operating') || o.value === 'Operating') {
        target.value = o.value;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.dispatchEvent(new Event('input', { bubbles: true }));
        done = true;
        break;
      }
    }
    if (!done) {
      for (const o of document.querySelectorAll('[role=option], [class*=option], li, .dropdown-item, .mat-option, .k-option, [role=menuitem], option, [class*=suggestion]')) {
        if (!vis(o)) continue;
        if (norm(textOf(o)).includes('operating')) { o.click(); await sleep(300); done = true; break; }
      }
    }
    push('Pick attempt', done ? 'PICKED ✓' : 'NOT PICKED');
    push('Final', 'value=' + JSON.stringify(target.value) + ' selectedText=' + (target.selectedOptions && target.selectedOptions[0] ? target.selectedOptions[0].textContent : '-'));
  } else {
    push('Element HTML', target.outerHTML.slice(0, 240));
    try { target.focus(); target.click(); } catch {}
    await sleep(1400);
    push('Visible list', itemTexts().join(' | ') || '(none)');
    let done = false;
    for (const o of document.querySelectorAll('[role=option], [class*=option], li, .dropdown-item, .mat-option, .k-option, [role=menuitem], option, [class*=suggestion]')) {
      if (!vis(o)) continue;
      if (norm(textOf(o)).includes('operating')) { o.click(); await sleep(300); done = true; break; }
    }
    push('Pick attempt', done ? 'PICKED ✓' : 'NOT PICKED (no item containing "operating")');
    push('Final value', JSON.stringify(target.value || ''));
  }
  return steps;
};

const PROBE1_FN = async () => {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const textOf = (el) => { try { return (el.textContent || '').replace(/\s+/g, ' ').trim(); } catch { return ''; } };
  const vis = (el) => {
    if (!el) return false;
    try { if (el.offsetWidth === 0 && el.offsetHeight === 0) return false; } catch { return false; }
    try { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; } catch { return false; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const steps = [];
  const push = (l, d) => steps.push(l + ' — ' + String(d));
  const outer = (el, n = 220) => { try { return el.outerHTML.replace(/\s+/g, ' ').slice(0, n); } catch { return ''; } };
  const itemTexts = () => {
    const seen = new Set();
    const out = [];
    for (const o of document.querySelectorAll('[role=option], [class*=option], li, .dropdown-item, .mat-option, .k-option, .el-select-dropdown__item, [role=menuitem], [class*=suggestion], [class*=result] a, [class*=result] span, [class*=lazy-dropdown-search__item], [class*=lazy-dropdown-search__list] a, [class*=lazy-dropdown-search__list] div, .needsclick')) {
      if (!vis(o)) continue;
      const txt = norm(textOf(o));
      if (!txt || txt.length > 60 || seen.has(txt)) continue;
      seen.add(txt);
      out.push(txt);
    }
    return out.slice(0, 30);
  };

  const TARGETS = [
    ['Trade Name', 'MOBILE CARE BY POWER MAC CENTER'],
  ];

  for (const [label, want] of TARGETS) {
    const key = norm(label);
    let holder = null;
    for (const el of document.querySelectorAll('label, td, th, div, span, dt, legend, h1, h2, h3, h4, h5, h6')) {
      if (!vis(el)) continue;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || '').trim())
        .filter(Boolean)
        .join(' ');
      const t = norm(own || textOf(el));
      if (t === key || t.startsWith(key)) { holder = el; break; }
    }
    if (!holder) { push(label, 'no visible label found'); continue; }
    push(label, 'label el: ' + holder.tagName + '#' + (holder.id || '') + ' ' + outer(holder, 140));

    let container = holder.parentElement;
    for (let i = 0; container && i < 5; i++, container = container.parentElement) {
      if (container === document.body) break;
      if (container.querySelector('select, [role=combobox], [class*=dropdown], [class*=combo], [class*=picker], [class*=lookup], [class*=search]')) break;
    }
    if (container) push(label, 'container: ' + container.tagName + '#' + (container.id || '') + ' cls=' + String(container.className || '').slice(0, 70));

    const cands = [];
    for (const c of Array.from((container || document).querySelectorAll('a, button, [role=button], td, [class*=picker], [class*=dropdown], [class*=combo], [class*=select], [class*=search], [class*=lookup], [class*=ViewAll], [class*=viewall], [class*=dropIndex]'))) {
      if (!vis(c)) continue;
      if (c.tagName === 'SELECT' || c.tagName === 'INPUT') continue;
      if (c.closest('select')) continue;
      const t = norm(textOf(c));
      if (!t) continue;
      if (t.length > 16) continue;
      if (/^none$/.test(t) || /all/i.test(t) || /select/i.test(t) || /search/i.test(t) || c.closest('[class*=search-field]')) {
        cands.push(c);
      }
    }
    if (!cands.length) { push(label, 'no trigger candidates found'); continue; }

    for (let ci = 0; ci < Math.min(cands.length, 4); ci++) {
      const c = cands[ci];
      const which = ci + 1;
      const t = textOf(c);
      push(label, `trigger#${which}: <${c.tagName} id="${c.id || ''}" cls="${String(c.className || '').slice(0, 50)}"> "${t}"`);
      try {
        c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        c.click();
      } catch {}
      await sleep(1500);
      const items = itemTexts();
      const listEls = Array.from(document.querySelectorAll('[class*=lazy-dropdown-search__list]')).filter(vis);
      push(label, `after click: items=${items.length} ${items.join(' | ') || '(none)'} lists=${listEls.length}`);
      const idx = document.querySelector('#b6-b20-Input_SearchTerm, .lazy-dropdown-search input, [class*=lazy-dropdown-search] input.dropdown-search-field');
      if (idx) push(label, 'search input exists: #' + (idx.id || '') + ' cls=' + String(idx.className || '').slice(0, 50) + ' visible=' + (vis(idx) ? 1 : 0));
      if (c.id === '' && /lazy-dropdown-search__inner/i.test(String(c.className || ''))) {
        try {
          c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          c.dispatchEvent(new Event('click', { bubbles: true }));
        } catch {}
        await sleep(900);
      }
      const search = document.querySelector('#b6-b20-Input_SearchTerm, .lazy-dropdown-search input.dropdown-search-field') && vis(document.querySelector('#b6-b20-Input_SearchTerm, .lazy-dropdown-search input.dropdown-search-field'))
        ? document.querySelector('#b6-b20-Input_SearchTerm, .lazy-dropdown-search input.dropdown-search-field')
        : null;
      if (search) {
        push(label, `search input: ${search.tagName}#${search.id} val="${search.value}" visible=${vis(search) ? 1 : 0}`);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') && Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        try {
          search.focus();
          if (setter) setter.call(search, want);
          else search.value = want;
          search.dispatchEvent(new Event('input', { bubbles: true }));
          search.dispatchEvent(new Event('keyup', { bubbles: true }));
          search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
          search.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
        } catch {}
        await sleep(1500);
        const items2 = itemTexts();
        const items3 = Array.from(document.querySelectorAll('.lazy-dropdown-search__item, .lazy-dropdown-search .needsclick, .lazy-dropdown-search__list [class*="item"]')).filter(vis);
        push(label, `after search "${want}": items=${items2.length} ${items2.join(' | ') || '(none)'} lazyItems=${items3.length}`);
        for (const o of items3) {
          const t = norm(textOf(o));
          if (t && (t.includes(norm(want)) || norm(want).includes(t))) {
            o.click();
            await sleep(900);
            push(label, `PICKED via search "${textOf(o)}"`);
            break;
          }
        }
      }
      const items4 = itemTexts();
      if (items4.length) push(label, `after pick: items=${items4.length} ${items4.join(' | ') || '(none)'}`);
      try { document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })); } catch {}
      await sleep(400);
    }
    push(label, 'done');
  }
  return steps;
};

async function probeTenant() {
  clearLog();
  setStatus('Probing…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) throw new Error('No active tab');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: PROBE_FN,
    });
    const all = [];
    for (const r of results || []) {
      if (r && Array.isArray(r.result)) all.push(...r.result);
    }
    if (!all.length) {
      appendLog('No frame responded — is the work permit page open?', false);
      setStatus('Probe empty', 'err');
      return;
    }
    all.forEach((line) => appendLog(line, !line.includes('NOT') || line.includes('NOT FOUND')));
    setStatus('Probe done', 'ok');
  } catch (e) {
    setStatus('Probe failed: ' + ((e && e.message) || e), 'err');
    appendLog(String((e && e.message) || e), false);
  }
}

async function probePage1() {
  clearLog();
  setStatus('Probing page 1 dropdowns…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) throw new Error('No active tab');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: PROBE1_FN,
    });
    const all = [];
    for (const r of results || []) {
      if (r && Array.isArray(r.result)) all.push(...r.result);
    }
    if (!all.length) {
      appendLog('No frame responded — is the work permit page open?', false);
      setStatus('Probe empty', 'err');
      return;
    }
    all.forEach((line) => appendLog(line, !line.includes('NOT') || line.includes('done')));
    setStatus('Probe done', 'ok');
  } catch (e) {
    setStatus('Probe failed: ' + ((e && e.message) || e), 'err');
    appendLog(String((e && e.message) || e), false);
  }
}

async function onMap() {
  try {
    const res = await sendToTab({ type: 'wp-map' });
    if (!res || !res.ok) throw new Error(res?.error || 'No response');
    const json = JSON.stringify(res.map, null, 2);
    await navigator.clipboard.writeText(json);
    setStatus('Field map copied to clipboard', 'ok');
  } catch (e) {
    setStatus('No field map (is the work permit page open?)', 'err');
  }
}

async function onDump() {
  clearLog();
  setStatus('Dumping fields…');
  try {
    const res = await sendToTab({ type: 'wp-dump' });
    if (!res || !res.ok) throw new Error(res?.error || 'No response');
    const rows = res.rows || [];
    appendLog(`Dump: ${rows.length} fields`, true);
    for (const f of rows) {
      const opts = f.opts ? ` opts=[${f.opts.join(' | ')}]` : '';
      appendLog(
        `[${String(f.n).padStart(2, '0')}] ${f.tag}#${f.id || '-'} type=${f.type || '-'} vis=${f.vis} ro=${f.ro} cls=${f.cls || '-'} label="${f.label || '-'}" val="${f.val}"${opts}`,
        true
      );
    }
    setStatus('Dump done', 'ok');
  } catch (e) {
    setStatus('Dump failed: ' + ((e && e.message) || e), 'err');
    appendLog(String((e && e.message) || e), false);
  }
}

function onExport() {
  const cfg = collect();
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'work-permit-profile.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Profile exported', 'ok');
}

function onImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      state.profile = deepMerge(structuredClone(DEFAULT_PROFILE), parsed);
      persist();
      render();
      setStatus('Profile imported', 'ok');
    } catch {
      setStatus('Invalid JSON file', 'err');
    }
  };
  input.click();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadProfile();
  render();
  bindFields();
  $('btnFill').addEventListener('click', onFill);
  $('btnProbe').addEventListener('click', probeTenant);
  $('btnProbe1').addEventListener('click', probePage1);
  $('btnDump').addEventListener('click', onDump);
  $('btnMap').addEventListener('click', onMap);
  $('btnSave').addEventListener('click', () => {
    collect();
    persist();
    setStatus('Saved', 'ok');
  });
  $('btnExport').addEventListener('click', onExport);
  $('btnImport').addEventListener('click', onImport);
  $('btnCopyLog').addEventListener('click', async () => {
    const txt = $('log').innerText;
    if (!txt) { setStatus('Nothing to copy yet', 'err'); return; }
    await navigator.clipboard.writeText(txt);
    setStatus('Log copied', 'ok');
  });
});