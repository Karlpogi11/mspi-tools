(function () {
  if (window.__wpLoaded) return;
  window.__wpLoaded = true;

  const H = window.__wpH;
  const { norm, textOf, sleep, waitFor } = H;

  function pageKind(doc) {
    const body = doc.body || doc.documentElement;
    const t = norm(textOf(body));
    if (t.includes('trade name') && t.includes('requestor details')) return 1;
    if (t.includes('tenant status') && t.includes('specific scope')) return 2;
    return 0;
  }

  function locateForm() {
    for (const d of H.allDocs(document)) {
      const p = pageKind(d);
      if (p) return { doc: d, page: p };
    }
    return null;
  }

  function logEntry(logs, label, ok) {
    logs.push({ label, ok: !!ok });
  }

  async function runFill(cfg) {
    (window.__wpDiag || []).splice(0);
    const found = locateForm();
    if (!found) return { ok: false, message: 'Work Permit form not detected on this page. Open the form (General Information or Work Details tab) and try again.' };
    const logs = [];
    try {
      if (found.page === 1) {
        await fillPage1(found.doc, cfg, logs);
        logs.push(...diagLogs());
        return { ok: true, page: 1, logs };
      }
      await fillPage2(found.doc, cfg, logs);
      logs.push(...diagLogs());
      return { ok: true, page: 2, logs };
    } catch (e) {
      logs.push(...diagLogs());
      return { ok: false, error: String((e && e.message) || e), logs };
    }
  }

  function diagLogs() {
    return (window.__wpDiag || []).map((d) => ({
      label: `[diag] ${d.text}${d.detail ? ' — ' + d.detail : ''}`,
      ok: d.kind === 'input',
    }));
  }

  async function combo(root, labels, value) {
    if (!value) return 'skipped';
    return H.setComboValue(root, labels, value);
  }

  const ITEM_SEL = [
    '[role=option]', '[class*=option]', 'li', '.dropdown-item', '.mat-option', '.k-option',
    '.el-select-dropdown__item', '[role=menuitem]', '[class*=suggestion]',
    '[class*=result] a', '[class*=result] span', '[class*=lookup] td[class*=select]', '[class*=lookup] [class*=list] [class*=row]',
    '[class*=ComboboxItem]', '[class*=combobox-item]', '[class*=ComboBoxItem]', '[class*=item-container]', '[class*=list-item]', '[class*=dialog] [class*=row]',
  ].join(', ');

  function firstOwnText(el) {
    if (!el) return '';
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent || '').trim())
      .filter(Boolean)
      .join(' ');
    return own || textOf(el);
  }

  function pressEscape() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape' }));
      document.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Escape', code: 'Escape' }));
      const ae = document.activeElement;
      if (ae && ae.blur) ae.blur();
    } catch {}
  }

  async function p1Combo(root, label, value) {
    if (!value) return 'skipped';
    const key = norm(label);
    const holder = findHolderLabel(key);
    if (!holder) {
      window.__wpDiag.push({ kind: 'combo', text: `${label}: label text not found` });
      return 'notfound';
    }
    let container = holder.parentElement;
    for (let i = 0; container && i < 6 && container !== document.body; i++, container = container.parentElement) {
      if (container.querySelector('select, [role=combobox], [class*=dropdown], [class*=picker], [class*=combo], [class*=lookup], [class*=search]')) break;
    }
    window.__wpDiag.push({ kind: 'combo', text: `${label}: label el ${holder.tagName}#${holder.id || ''} container=${container ? container.tagName + '#' + (container.id || '') : 'none'}` });

    const candidates = [];
    for (const c of Array.from((container || document).querySelectorAll('a, button, [role=button], td, [class*=picker], [class*=dropdown], [class*=combo], [class*=select], [class*=search], [class*=lookup], [class*=ViewAll], [class*=viewall], [class*=dropIndex], [class*=suffix], [class*=arrow], [class*=chevron]'))) {
      if (!H.isVisible(c)) continue;
      if (c.tagName === 'SELECT' || c.tagName === 'INPUT') continue;
      if (c.closest('select')) continue;
      const t = norm(textOf(c));
      if (!t) continue;
      if (t.length > 16) continue;
      if (/^none$/.test(t) || /all/i.test(t) || /select/i.test(t) || /search/i.test(t) || /^-$/.test(t) || c.closest('[class*=search-field]')) candidates.push(c);
    }
    if (!candidates.length) {
      window.__wpDiag.push({ kind: 'combo', text: `${label}: no trigger candidates in container`, detail: container ? container.tagName + '#' + (container.id || '') : 'none' });
      return 'notfound';
    }

    for (let ci = 0; ci < Math.min(candidates.length, 4); ci++) {
      const c = candidates[ci];
      try {
        c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        c.click();
      } catch {}
      await sleep(1600);
      const search = findFirstField();
      if (search) {
        await searchItem(search, value);
        await sleep(1600);
        const picked = await clickItem(value);
        if (picked) return 'ok';
        continue;
      }
      const picked = await clickItem(value);
      if (picked) return 'ok';
      pressEscape();
    }
    window.__wpDiag.push({ kind: 'combo', text: `${label}: could not pick «${value}» after ${candidates.length} triggers`, detail: 'visible items: ' + (H.collectVisibleItems ? JSON.stringify(H.collectVisibleItems().slice(0, 12)) : '') });
    return 'notfound';
  }

  function findHolderLabel(key) {
    for (const el of Array.from(document.querySelectorAll('label, td, th, div, span, dt, legend, h1, h2, h3, h4, h5, h6'))) {
      if (!H.isVisible(el)) continue;
      const t = norm(firstOwnText(el));
      if (t === key || t.startsWith(key)) return el;
    }
    return null;
  }

  function findFirstField() {
    for (const i of Array.from(document.querySelectorAll('input.dropdown-search-field, [class*=search] input, [role=listbox] input, [role=dialog] input, [class*=popup] input, [class*=option] input'))) {
      if (H.isVisible(i)) return i;
    }
    return null;
  }

  async function searchItem(search, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') && Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    try {
      search.focus();
      if (setter) setter.call(search, value);
      else search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('keyup', { bubbles: true }));
      search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
    } catch {}
  }

  async function clickItem(value) {
    const want = norm(value);
    let node = null;
    const res = () => {
      for (const o of Array.from(document.querySelectorAll(ITEM_SEL))) {
        if (!H.isVisible(o)) continue;
        const t = norm(textOf(o));
        if (t && (norm(t) === want || norm(t).includes(want) || want.includes(norm(t)))) return o;
      }
      return null;
    };
    node = res();
    if (!node) {
      await sleep(1400);
      node = res();
    }
    if (node) {
      node.click();
      await sleep(900);
      return true;
    }
    return false;
  }

  async function fillPage1(doc, cfg, logs) {
    const mall = cfg.mall || {};
    const requestor = cfg.requestor || {};
    const contacts = cfg.contacts || [];

    const mallSec = H.sectionByHeading(doc, ['mall details'], ['trade name']);
    const mRoot = mallSec || doc;
    const doCombos = !!cfg.mallCombos;
    if (doCombos) {
      const tr = await p1Combo(mRoot, 'Trade Name', mall.tradeName);
      logEntry(logs, `Trade Name = ${mall.tradeName || '(default)'} (${tr})`, tr !== 'notfound');
      const cl = await p1Combo(mRoot, 'Classification', mall.classification);
      logEntry(logs, `Classification = ${mall.classification || '(default)'} (${cl})`, cl !== 'notfound');
      const br = await p1Combo(mRoot, 'Branch', mall.branch);
      logEntry(logs, `Branch = ${mall.branch || '(default)'} (${br})`, br !== 'notfound');
      const at = await p1Combo(mRoot, 'Area Type', mall.areaType);
      logEntry(logs, `Area Type = ${mall.areaType || '(default)'} (${at})`, at !== 'notfound');
    } else {
      logEntry(logs, 'Mall dropdowns skipped — pick them manually', true);
    }
    if (mall.location) {
      await H.fillInput(mallSec || doc, ['Location'], mall.location);
      logEntry(logs, `Location = ${mall.location}`, true);
    }

    if (cfg.sameAsRequestor) {
      const cb = H.findCheckbox(doc, ['Same as the Requestor Details']);
      if (cb && !cb.checked) {
        cb.click();
        logEntry(logs, 'Checked "Same as Requestor"', true);
      }
      return;
    }

    const heading = H.findHeading(doc, ['Contact Details', 'Contact Person']);
    const pool = [];
    if (heading) {
      for (const c of doc.querySelectorAll('input, select, textarea, [role=combobox]')) {
        if (!H.isVisible(c)) continue;
        if (heading.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) {
          const lb = norm(H.labelFor(c) + '|' + (c.getAttribute && c.getAttribute('aria-label') || ''));
          if (!lb) continue;
          const isPersonField =
            lb.includes('name') || lb.includes('position') || lb.includes('contact') ||
            lb.includes('phone') || lb.includes('telephone') || lb.includes('number');
          if (isPersonField) pool.push({ el: c, label: lb });
        }
      }
    }
    if (!pool.length) {
      logEntry(logs, 'Contact fields not found', false);
      const afterHeading = heading
        ? Array.from(doc.querySelectorAll('input, select, textarea, [role=combobox]'))
            .filter((c) => H.isVisible(c) && (heading.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING))
            .slice(0, 8)
            .map((c) => `${c.tagName}:${H.labelFor(c) || (c.id || '')}`)
        : [];
      window.__wpDiag.push({ kind: 'contact', text: 'No contact-person fields after heading', detail: `${heading ? 'heading=' + (heading.tagName + ':' + (heading.id || heading.className || '')).slice(0, 80) : 'heading NOT found'} | controls after: ${JSON.stringify(afterHeading)}` });
      return;
    }
    const names = pool.filter((p) => p.label.includes('name')).map((p) => p.el);
    const pos = pool.filter((p) => p.label.includes('position')).map((p) => p.el);
    const tels = pool.filter((p) => p.label.includes('contact') || p.label.includes('phone') || p.label.includes('telephone') || p.label.includes('number')).filter((p) => !p.label.includes('name')).map((p) => p.el);
    for (let i = 0; i < contacts.length && i < 2; i++) {
      const c = contacts[i];
      if (!c) break;
      if (names[i]) await H.setValueOn(names[i], c.name || '');
      if (pos[i]) await H.setValueOn(pos[i], c.position || '');
      if (tels[i]) await H.setValueOn(tels[i], c.contact || '');
    }
if (window.__wpDiag && names.length < 2) {
      window.__wpDiag.push({ kind: 'contact', text: `Contact fields found: names=${names.length}, positions=${pos.length}, numbers=${tels.length}`, detail: JSON.stringify(pool.map((p) => p.label).slice(0, 12)) });
    }
    logEntry(logs, `Filled ${Math.min(contacts.length, 2)} contact persons`, names.length >= 2);
  }

  async function fillPage2(doc, cfg, logs) {
    const work = cfg.work || {};
    const personnel = cfg.personnel || [];

    const ts = await combo(doc, ['Tenant Status'], work.tenantStatus);
    logEntry(logs, `Tenant Status = ${work.tenantStatus || 'Operating'} (${ts})`, ts !== 'notfound');

    const target = work.numWork ?? 5;
    let additions = 0;
    const countCards = () => H.findFields(doc, ['General Scope']).length;
    let cards = countCards();
    while (cards < target && additions < 12) {
      const btn = H.findButtonByText(doc, 'Add Type of Work');
      if (!btn) break;
      btn.click();
      await sleep(900);
      cards = countCards();
      additions++;
    }
    logEntry(logs, `Type of Work entries: ${target} (${cards} found${additions ? `, added ${additions}` : ''})`, true);

    const skipEquip = (s) => !/tool|equip/.test(norm(s.label));

    const scopes = H.findFields(doc, ['General Scope']).filter(skipEquip);
    for (const s of scopes) {
      await H.setValueOn(s.el, work.scope);
    }
    logEntry(logs, `Scope = ${work.scope || 'Pullout of merchandise/goods/items/products/stocks'}`, true);

    const items = H.findFields(doc, ['Items to pull out', 'Items to be pulled out', 'Items Delivered', 'Item']).filter(skipEquip);
    for (const it of items) {
      await H.setValueOn(it.el, work.items || 'DELIVERY/PULLOUT OF APPLE PRODUCTS');
    }
    logEntry(logs, `Items = ${work.items || 'DELIVERY/PULLOUT OF APPLE PRODUCTS'}`, true);

    const specs = H.findFields(doc, ['Specific Scope', 'Indicate the details of work', 'details of work']).filter(skipEquip);
    for (const sp of specs) {
      await H.setValueOn(sp.el, work.specific || 'DELIVERY/PULLOUT OF APPLE PRODUCTS');
    }
    logEntry(logs, `Details of work = ${work.specific || 'DELIVERY/PULLOUT OF APPLE PRODUCTS'}`, true);

    const fromFields = H.findFields(doc, ['From']);
    for (const f of fromFields) await H.setTime(f.el.parentElement, ['From'], work.fromTime || '11:00 AM');
    const toFields = H.findFields(doc, ['To']);
    for (const f of toFields) await H.setTime(f.el.parentElement, ['To'], work.toTime || '05:00 PM');
    logEntry(logs, `Times From ${work.fromTime || '11:00 AM'} / To ${work.toTime || '05:00 PM'}`, true);

    if (work.urgent) {
      const cb = H.findCheckbox(doc, ['This is an urgent request']);
      if (cb && !cb.checked) {
        cb.click();
        logEntry(logs, 'Marked as urgent', true);
      }
    }

    await fillPersonnel(doc, personnel, logs);
  }

  async function fillPersonnel(doc, list, logs) {
    if (!list || !list.length) return;
    const btn = H.findButtonByText(doc, 'Add Personnel');
    const sec = btn
      ? H.longestContainerOf(btn, ['First Name', 'Last Name'])
      : H.sectionByHeading(doc, ['Personnel Details'], ['Add Personnel']);
    if (!sec) {
      logEntry(logs, 'Personnel section not found', false);
      return;
    }
    const target = list.length;
    let safety = 0;
    while (H.findFields(sec, ['First Name']).length < target && safety < target + 4) {
      const add = H.findButtonByText(doc, 'Add Personnel');
      if (!add) break;
      add.click();
      await sleep(700);
      safety++;
    }
    const firsts = H.findFields(sec, ['First Name']);
    const lasts = H.findFields(sec, ['Last Name']);
    const mis = H.findFields(sec, ['M.I']);
    const n = Math.min(firsts.length, list.length);
    for (let i = 0; i < n; i++) {
      await H.setValueOn(firsts[i].el, list[i].first || '');
      if (lasts[i]) await H.setValueOn(lasts[i].el, list[i].last || '');
      if (mis[i] && list[i].mi) await H.setValueOn(mis[i].el, list[i].mi);
    }
    logEntry(logs, `Personnel: ${n}/${list.length} filled`, n >= list.length);
    logEntry(logs, 'Dates left blank for manual input', true);
  }

  async function readDebugMap() {
    const found = locateForm();
    const doc = (found && found.doc) || document;
    const rows = [];
    for (const c of Array.from(doc.querySelectorAll('input, select, textarea'))) {
      const label = H.labelFor(c);
      if (!label) continue;
      const r = c.getBoundingClientRect();
      rows.push({
        tag: c.tagName,
        type: (c.type || '').toUpperCase(),
        label,
        placeholder: c.placeholder || '',
        id: c.id || '',
        value: c.value ? String(c.value).slice(0, 60) : '',
        visible: H.isVisible(c),
        x: Math.round(r.x),
        y: Math.round(r.y),
      });
    }
    rows.sort((a, b) => a.y - b.y || a.x - b.x);
    return rows;
  }

  async function runProbe() {
    const found = locateForm();
    const doc = (found && found.doc) || document;
    const steps = [];
    const push = (label, detail) => steps.push({ label, detail: String(detail) });
    const f = H.findField(doc, ['Tenant Status']);
    if (!f) {
      push('Tenant Status field', 'NOT FOUND');
      push('All fields', JSON.stringify(Array.from(doc.querySelectorAll('input, select, textarea')).slice(0, 12).map((c) => `${c.tagName}#${c.id} ${H.labelFor(c)}`)));
      return { ok: false, steps };
    }
    const el = f.el;
    push('Field found', `${el.tagName} id=${el.id || '-'} cls=${(el.className || '').toString().slice(0, 60)} label="${f.label}"`);
    if (el.tagName === 'SELECT') {
      push('CheckboxLazy', `options before click: ${el.options.length} [${Array.from(el.options).map((o) => o.textContent).join(', ')}]`);
      try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.click();
      } catch {}
      await sleep(1600);
      push('After click', `options: ${el.options.length} [${Array.from(el.options).map((o) => o.textContent).join(', ')}]`);
      push('Visible list', H.collectVisibleItems().join(' | ') || '(empty)');
      const before = el.value;
      const res = await H.setComboValue(doc, ['Tenant Status'], 'Operating');
      await sleep(300);
      push('Pick attempt', `setComboValue=${res} value=${JSON.stringify(el.value)} before=${before} text=${el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent : '-'}`);
    } else {
      push('Untargeted element', el.outerHTML.slice(0, 220));
      await H.openCombo(el);
      await sleep(1200);
      push('Visible list items', H.collectVisibleItems().join(' | ') || '(empty)');
      const res = await H.setComboValue(doc, ['Tenant Status'], 'Operating');
      push('Pick attempt', `setComboValue=${res} value=${JSON.stringify(el.value || '')}`);
    }
    return { ok: true, steps };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'wp-fill') {
      runFill(msg.cfg || {})
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    }
    if (msg.type === 'wp-map') {
      readDebugMap()
        .then((map) => sendResponse({ ok: true, map }))
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    }
    if (msg.type === 'wp-probe') {
      runProbe()
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    }
    if (msg.type === 'wp-dump') {
      try {
        const found = locateForm();
        const doc = (found && found.doc) || document;
        const rows = H.dumpFields ? H.dumpFields(120) : [];
        sendResponse({ ok: true, rows });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
      return true;
    }
  });
})();