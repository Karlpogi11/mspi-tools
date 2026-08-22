(function () {
  if (window.__wpLoaded) return;
  window.__wpLoaded = true;

  const H = window.__wpH;
  const { norm, textOf, sleep, waitFor } = H;
  let cancelRequested = false;

  function checkCancelled() {
    if (cancelRequested) throw new Error('Fill cancelled by user');
  }

  function progress(label, state) {
    try { chrome.runtime.sendMessage({ type: 'wp-progress', label, state }); } catch {}
  }

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
    cancelRequested = false;
    H.setCancellationCheck?.(() => cancelRequested);
    (window.__wpDiag || []).splice(0);
    const found = locateForm();
    if (!found) {
      H.setCancellationCheck?.(null);
      return { ok: false, message: 'Work Permit form not detected on this page. Open the form (General Information or Work Details tab) and try again.' };
    }
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
    } finally {
      H.setCancellationCheck?.(null);
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
    '.lazy-dropdown-search__item', '.lazy-dropdown-search .needsclick',
    '.lazy-dropdown-search__list a', '.lazy-dropdown-search__list div',
    '[class*=lazy-dropdown-search] [class*=item]', '[class*=lazy-dropdown-search] .needsclick',
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
    checkCancelled();
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

    // Area Type is a native select on the permit page. When the Mall Details
    // section contains several selects, use the one nearest to this label.
    const labelRect = holder.getBoundingClientRect();
    const nativeSelects = Array.from((container || holder.parentElement || document).querySelectorAll('select'))
      .filter((select) => H.isVisible(select));
    nativeSelects.sort((a, b) => {
      const distance = (el) => {
        const rect = el.getBoundingClientRect();
        return Math.abs(rect.top - labelRect.top) + Math.abs(rect.left - labelRect.left);
      };
      return distance(a) - distance(b);
    });
    const nativeSelect = nativeSelects[0];
    if (nativeSelect && H.setSelect(nativeSelect, value)) {
      return 'ok';
    }

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
    // Mall Details renders two controls beside each field: "View All" and the
    // actual compact selector ("Select", "-", or the current value). Prefer
    // the selector so the lookup dialog cannot be mistaken for the dropdown.
    candidates.sort((a, b) => {
      const rank = (el) => {
        const t = norm(textOf(el));
        const isClickable = /^(A|BUTTON)$/.test(el.tagName) || el.getAttribute('role') === 'button';
        if (t === 'select' || t === '-' || t === 'none') return isClickable ? 0 : 1;
        if (t.includes('select') && !t.includes('view all')) return isClickable ? 2 : 3;
        if (t.includes('view all')) return 4;
        return 5;
      };
      const labelRect = holder.getBoundingClientRect();
      const distance = (el) => {
        const rect = el.getBoundingClientRect();
        return Math.abs(rect.top - labelRect.top) + Math.abs(rect.left - labelRect.left);
      };
      return rank(a) - rank(b) || distance(a) - distance(b);
    });
    if (!candidates.length) {
      window.__wpDiag.push({ kind: 'combo', text: `${label}: no trigger candidates in container`, detail: container ? container.tagName + '#' + (container.id || '') : 'none' });
      return 'notfound';
    }

    for (let ci = 0; ci < Math.min(candidates.length, 4); ci++) {
      checkCancelled();
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
    const exactLazyItem = () => {
      const roots = Array.from(document.querySelectorAll(
        '[class*=lazy-dropdown-search__list], [role=listbox], [role=dialog], [class*=dropdown-menu], [class*=popup]'
      )).filter(H.isVisible);
      const matches = [];
      for (const root of roots) {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          if (!H.isVisible(el) || norm(textOf(el)) !== want) continue;
          const row = el.closest(
            '[role=option], [role=menuitem], .needsclick, .lazy-dropdown-search__item, li, a, button, [class*=item], [class*=row]'
          ) || el;
          matches.push({ el: row, text: norm(textOf(row)) });
        }
      }
      return matches.sort((a, b) => a.text.length - b.text.length)[0]?.el || null;
    };
    const res = () => {
      const matches = [];
      const seen = new Set();
      for (const o of Array.from(document.querySelectorAll(ITEM_SEL))) {
        if (!H.isVisible(o)) continue;
        const t = norm(textOf(o));
        if (!t || seen.has(o) || !(t === want || t.includes(want) || want.includes(t))) continue;
        seen.add(o);
        const selectable =
          /^(A|BUTTON)$/.test(o.tagName) ||
          ['option', 'menuitem'].includes(o.getAttribute('role')) ||
          /needsclick|option|item|selectable|clickable/i.test(String(o.className || ''));
        matches.push({ el: o, text: t, selectable });
      }
      return matches
        .sort((a, b) => Number(b.text === want) - Number(a.text === want) || Number(b.selectable) - Number(a.selectable) || a.text.length - b.text.length)[0]?.el || null;
    };
    node = res();
    if (!node) {
      await sleep(1400);
      node = res();
    }
    if (!node) node = exactLazyItem();
    if (node) {
      try {
        node.scrollIntoView({ block: 'center' });
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
          node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        node.click();
      } catch {}
      await sleep(900);
      // If the result list is still open, the first match was a wrapper. Try
      // the exact lazy-list row before falling back to keyboard selection.
      if (findFirstField()) {
        const retry = exactLazyItem();
        if (retry && retry !== node) {
          try {
            retry.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            retry.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            retry.click();
          } catch {}
          await sleep(900);
        }
        const search = findFirstField();
        if (search) {
          try {
            search.focus();
            search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
            search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
            search.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
          } catch {}
          await sleep(900);
        }
      }
      return true;
    }
    const search = findFirstField();
    if (search) {
      try {
        search.focus();
        search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
        search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
        search.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
      } catch {}
      await sleep(900);
      return true;
    }
    return false;
  }

  async function fillPage1(doc, cfg, logs) {
    checkCancelled();
    const mall = cfg.mall || {};
    const requestor = cfg.requestor || {};
    const contacts = cfg.contacts || [];

    const mallSec = H.sectionByHeading(doc, ['mall details'], ['trade name']);
    const mRoot = mallSec || doc;
    const doCombos = !!cfg.mallCombos;
    if (doCombos) {
      const tr = await p1Combo(mRoot, 'Trade Name', mall.tradeName);
      logEntry(logs, `Trade Name = ${mall.tradeName || '(default)'} (${tr})`, tr === 'ok');

      // Classification is populated by the site after Trade Name changes.
      // Give that dependent field time to settle before opening the next list.
      if (tr === 'ok') {
        await sleep(1400);
        logEntry(logs, `Classification auto-filled from Trade Name`, true);

        const br = await p1Combo(mRoot, 'Branch', mall.branch);
        logEntry(logs, `Branch = ${mall.branch || '(default)'} (${br})`, br === 'ok');
        await sleep(900);
        const at = await p1Combo(mRoot, 'Area Type', mall.areaType);
        logEntry(logs, `Area Type = ${mall.areaType || '(default)'} (${at})`, at === 'ok');
      } else {
        logEntry(logs, 'Skipped dependent dropdowns because Trade Name was not selected', false);
      }
    } else {
      logEntry(logs, 'Mall dropdowns skipped — pick them manually', true);
    }
    if (mall.location) {
      await H.fillInput(mallSec || doc, ['Location'], mall.location);
      logEntry(logs, `Location = ${mall.location}`, true);
    }

    let requestorSec = H.sectionByHeading(doc, ['requestor details'], ['contact number']);
    if (!requestorSec) {
      const requestorHeading = H.findHeading(doc, ['requestor details']);
      for (let parent = requestorHeading?.parentElement, depth = 0; parent && depth < 8; parent = parent.parentElement, depth++) {
        if (parent.querySelector('input, select, textarea') && norm(textOf(parent)).includes('contact number')) {
          requestorSec = parent;
          break;
        }
      }
    }
    if (requestorSec) {
      const requestorFields = [
        ['Contact Number', requestor.contact],
      ];
      for (const [label, value] of requestorFields) {
        const field = H.findField(requestorSec, [label]);
        if (field && value) await H.setValueOn(field.el, value);
      }
      logEntry(logs, `Requestor contact = ${requestor.contact || '(blank)'}`, !!H.findField(requestorSec, ['Contact Number']));
    } else {
      logEntry(logs, 'Requestor Details section not found', false);
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
    checkCancelled();
    const work = cfg.work || {};
    const personnel = cfg.personnel || [];
    const typeOfWorkLimit = cfg.testFirstType ? 1 : Number.POSITIVE_INFINITY;
    const testLabel = cfg.testFirstType ? ' (first row test)' : '';
    const itemValueFromConfig = cfg.work?.items ?? cfg.work?.itemsToPullOut ?? cfg.work?.itemsToPullout ?? '';
    window.__wpDiag.push({
      kind: 'input',
      text: 'Items template data',
      detail: JSON.stringify({ path: 'work.items', value: String(itemValueFromConfig), permitType: cfg.permitType || '' }),
    });

    const ts = await combo(doc, ['Tenant Status'], work.tenantStatus);
    logEntry(logs, `Tenant Status = ${work.tenantStatus || 'Operating'} (${ts})`, ts !== 'notfound');

    const target = cfg.testFirstType ? 1 : (work.numWork ?? 5);
    let additions = 0;
    const countCards = () => H.findFields(doc, ['General Scope']).length;
    let cards = countCards();
    while (!cfg.testFirstType && cards < target && additions < 12) {
      const btn = H.findButtonByText(doc, 'Add Type of Work');
      if (!btn) break;
      btn.click();
      await sleep(900);
      cards = countCards();
      additions++;
    }
    logEntry(logs, `Type of Work entries: ${target} (${cards} found${additions ? `, added ${additions}` : ''})`, true);

    const skipEquip = (s) => !/tool|equip/.test(norm(s.label));
    const isCombo = (el) => el && (
      el.tagName === 'SELECT' ||
      el.getAttribute('role') === 'combobox' ||
      el.readOnly ||
      el.getAttribute('aria-haspopup')
    );
    const selectOrFill = async (field, value, forceCombo = false) => {
      if (!field || value === undefined || value === null || value === '') return false;
      if (forceCombo || isCombo(field.el)) {
        if (/specific scope/i.test(field.label || '') && H.setComboValue) {
          const label = field.el.closest?.('label');
          const rowRoot = label?.parentElement || field.el.parentElement?.parentElement || doc;
          const result = await H.setComboValue(rowRoot, [field.label], value);
          if (result === 'ok' || result === 'typed') return true;
        }
        if (H.setComboElement) {
          const picked = await H.setComboElement(field.el, value);
          if (!picked) {
            window.__wpDiag.push({
              kind: 'combo',
              text: `${field.label}: option not committed`,
              detail: H.collectVisibleItems ? JSON.stringify(H.collectVisibleItems().slice(0, 15)) : 'visible items unavailable',
            });
          }
          return picked;
        }
        await H.openCombo(field.el);
        let picked = await H.pickOption(doc, value, 5000);
        if (!picked && field.label) {
          // General Scope and Specific Scope are searchable custom combos on
          // some versions of the permit page.
          picked = await H.typeInCombo(doc, [field.label], value);
        }
        if (!picked) await H.closeLists?.();
        return picked;
      }
      return H.setValueOn(field.el, value);
    };

    const generalScope = work.generalScope ?? work.scope;
    const specificScope = work.specificScope ?? work.specific;
    const detailsOfWork = work.detailsOfWork ?? work.scopeOfWork ?? '';
    const scopes = H.findFields(doc, ['General Scope']).filter(skipEquip).slice(0, typeOfWorkLimit);
    // The site uses "Pullout" as the parent choice. Selecting the long
    // description directly does not render the dependent Specific Scope field.
    const scopeOption = /pullout/i.test(generalScope || '') ? 'Pullout' : generalScope;
    progress('General Scope', 'working');
    let scopeOk = true;
    for (let i = 0; i < scopes.length; i++) {
      progress(`General Scope ${i + 1}`, 'working');
      let ok = await selectOrFill(scopes[i], scopeOption, true);
      const waitForRowSpecificScope = () => {
        const fields = H.findFields(doc, ['Specific Scope']).filter(skipEquip);
        const field = fields[i];
        return field && (field.el.tagName !== 'SELECT' || field.el.options.length > 1) ? field : null;
      };
      if (ok && !await waitFor(waitForRowSpecificScope, 6000, 250)) {
        window.__wpDiag.push({ kind: 'combo', text: `General Scope ${i + 1}: Specific Scope options delayed; retrying parent selection` });
        ok = await selectOrFill(scopes[i], scopeOption, true);
        if (ok) await waitFor(waitForRowSpecificScope, 6000, 250);
      }
      scopeOk = ok && scopeOk;
      progress(`General Scope ${i + 1}`, ok ? 'done' : 'failed');
      if (ok) await sleep(500);
    }
    await sleep(900);
    progress('General Scope', scopeOk && scopes.length > 0 ? 'done' : 'failed');
    logEntry(logs, `General Scope${testLabel} = ${scopeOption || 'Pullout'}`, scopeOk && scopes.length > 0);

    const expectedSpecificScopes = Math.min(scopes.length, typeOfWorkLimit);

    // The portal renders "Items to pullout" after General Scope is selected.
    // It is independent of the Specific Scope dropdown, so fill it before
    // selecting Specific Scope. Running this phase afterward can miss the
    // text inputs or accidentally target the Specific Scope selects.
    if (!scopeOk || !scopes.length) {
      progress('Specific Scope', 'failed');
      logEntry(logs, 'Specific Scope skipped because General Scope was not selected', false);
      progress('Items to Pull Out', 'failed');
      logEntry(logs, 'Items skipped because General Scope was not selected', false);
      return;
    }

    const itemLabels = [
      'Items to pullout', 'Items to pull out', 'Item to pull out',
      'Items to be pulled out', 'Items Delivered', 'Indicate the items to pull out',
    ];
    const fieldMetadata = (el) => {
      const parts = [
        el.id,
        el.getAttribute('name'),
        el.getAttribute('aria-label'),
        el.getAttribute('data-label'),
        el.getAttribute('placeholder'),
        H.labelFor(el),
      ];
      for (let parent = el.parentElement, depth = 0; parent && depth < 8; parent = parent.parentElement, depth++) {
        const directText = Array.from(parent.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || '')
          .join(' ');
        if (directText.trim()) parts.push(directText);
        if (depth >= 4) {
          const containerText = String(parent.textContent || '').replace(/\s+/g, ' ').trim();
          if (containerText.length <= 220) parts.push(containerText);
        }
      }
      return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    };
    const isSpecificScopeControl = (el) => {
      if (el.tagName === 'SELECT') return true;
      const id = norm(el.id || '');
      const metadata = norm(fieldMetadata(el));
      return /specific\s*scope|dropdown5/.test(id) || /specific\s*scope/.test(metadata);
    };
    const findVisibleItems = () => {
      const candidates = [];
      const seen = new Set();
      for (const el of Array.from(doc.querySelectorAll('input, textarea, select, [role=textbox], [role=combobox], [contenteditable=true], [data-input], [class*=OSInput]'))) {
        if (seen.has(el) || !H.isVisible(el) || !H.isEditable(el) || isSpecificScopeControl(el)) continue;
        seen.add(el);
        const metadata = fieldMetadata(el);
        const idOrName = norm(`${el.id || ''} ${el.getAttribute('name') || ''}`);
        const text = norm(metadata);
        const explicitIdMatch = /item.*(pull|out)|((pull|out).*item)/.test(idOrName);
        const fieldTextMatch = /item/.test(text) && /(pull|deliver|stock|merchandise)/.test(text);
        if (explicitIdMatch || fieldTextMatch) {
          candidates.push({
            el,
            label: metadata,
            score: (explicitIdMatch ? 10 : 0) + (idOrName.includes('input_') ? 3 : 0),
          });
        }
      }

      // Keep the label helper as a compatibility fallback, but only after
      // stable-control matching and never allow a scope dropdown through.
      for (const field of H.findFields(doc, itemLabels)) {
        if (seen.has(field.el) || !H.isVisible(field.el) || !H.isEditable(field.el) || isSpecificScopeControl(field.el)) continue;
        seen.add(field.el);
        candidates.push({ el: field.el, label: fieldMetadata(field.el), score: 1 });
      }
      return candidates.sort((a, b) => b.score - a.score);
    };
    const itemValue = String(itemValueFromConfig || '').trim();
    const fillItems = async (phase) => {
      const items = await waitFor(() => {
        const found = findVisibleItems();
        return found.length >= expectedSpecificScopes ? found : null;
      }, 4000, 250) || findVisibleItems();
      window.__wpDiag.push({
        kind: 'field',
        text: `Items controls found ${phase}: ${items.length}/${expectedSpecificScopes}`,
        detail: JSON.stringify({
          url: doc.location?.href || location.href,
          controls: items.map((field) => ({
            id: field.el.id || '',
            name: field.el.getAttribute('name') || '',
            tag: field.el.tagName,
            label: field.label,
          })),
          availableControls: items.length ? undefined : Array.from(doc.querySelectorAll('input, textarea, select, [role=textbox], [role=combobox], [contenteditable=true], [data-input], [class*=OSInput]'))
            .filter((el) => H.isVisible(el))
            .slice(0, 80)
            .map((el) => ({
              id: el.id || '',
              name: el.getAttribute('name') || '',
              tag: el.tagName,
              role: el.getAttribute('role') || '',
              label: fieldMetadata(el).slice(0, 220),
            })),
        }),
      });
      if (!items.length) return items;
      progress('Items to Pull Out', 'working');
      window.__wpDiag.push({ kind: 'field', text: 'Temporary Items fill trace', detail: JSON.stringify({ requested: itemValue, count: items.length, phase }) });
      for (let i = 0; i < items.length; i++) {
        checkCancelled();
        const field = items[i].el;
        const before = String(field.value || '');
        let ok = itemValue ? await H.setValueOn(field, itemValue) : true;
        await sleep(150);
        let after = String(field.value || '');
        if (itemValue && after !== itemValue) {
          // Some portal controls only commit their framework state on blur.
          field.dispatchEvent(new Event('blur', { bubbles: true }));
          await sleep(150);
          after = String(field.value || '');
        }
        ok = ok && (!itemValue || after === itemValue);
        window.__wpDiag.push({ kind: 'field', text: `Temporary Items row ${i + 1} trace`, detail: JSON.stringify({ url: doc.location?.href || location.href, label: items[i].label, tag: field.tagName, id: field.id || '', name: field.getAttribute('name') || '', before, after, requested: itemValue, committed: !itemValue || after === itemValue, phase }) });
        progress(`Items to Pull Out ${i + 1}`, ok ? 'done' : 'failed');
      }
      return items;
    };

    let items = await fillItems('after General Scope');

    // --- Specific Scope ---

    const specificValue = /pullout/i.test(scopeOption || '') && /delivery\s*\/\s*pullout|apple products/i.test(specificScope || '')
      ? 'Pullout of merchandise/goods/items/products/stocks'
      : specificScope || '';
    const specificScopes = await waitFor(() => {
      const found = H.findFields(doc, ['Specific Scope']).filter(skipEquip);
      const populated = found.filter((field) => field.el.tagName !== 'SELECT' || field.el.options.length > 1);
      return found.length >= expectedSpecificScopes && populated.length >= expectedSpecificScopes ? found : null;
    }, 8000, 250) || H.findFields(doc, ['Specific Scope']).filter(skipEquip);
    window.__wpDiag.push({
      kind: 'field',
      text: `Specific Scope controls found: ${specificScopes.length}/${expectedSpecificScopes}`,
      detail: specificScopes.map((field) => `${field.label}${field.el.tagName === 'SELECT' ? ` [${field.el.options.length} options]` : ''}`).join(' | '),
    });
    progress('Specific Scope', 'working');
    let specificOk = true;
    for (let i = 0; i < specificScopes.length; i++) {
      checkCancelled();
      progress(`Specific Scope ${i + 1}`, 'working');
      const ok = await selectOrFill(specificScopes[i], specificValue, true);
      specificOk = ok && specificOk;
      progress(`Specific Scope ${i + 1}`, ok ? 'done' : 'failed');
    }
    const specificRequired = Boolean(specificValue);
    const specificSelected = !specificRequired || (specificOk && specificScopes.length > 0);
    progress('Specific Scope', specificSelected ? 'done' : 'failed');
    logEntry(logs, `Specific Scope${testLabel} = ${specificValue || '(not set)'}`, specificSelected);

    if (!items.length && specificSelected) items = await fillItems('after Specific Scope');
    progress('Items to Pull Out', !itemValue || items.length > 0 ? 'done' : 'failed');
    logEntry(logs, `Items${testLabel} = ${itemValue || '(left blank)'}`, !itemValue || items.length > 0);

    if (!specificSelected) return;

    const details = H.findFields(doc, ['Indicate the details of work']).filter(skipEquip).slice(0, typeOfWorkLimit);
    progress('Details of Work', 'working');
    for (let i = 0; i < details.length; i++) {
      checkCancelled();
      progress(`Details of Work ${i + 1}`, 'working');
      const detailValue = detailsOfWork;
      const ok = await H.setValueOn(details[i].el, detailValue);
      progress(`Details of Work ${i + 1}`, ok ? 'done' : 'failed');
    }
    progress('Details of Work', details.length > 0 ? 'done' : 'failed');
    logEntry(logs, `Indicate the details of work = ${detailsOfWork || '(blank)'}`, details.length > 0);

    if (!work.leaveScheduleBlank) {
      const fromFields = H.findFields(doc, ['From']);
      for (const f of fromFields) await H.setTime(f.el.parentElement, ['From'], work.fromTime || '11:00 AM');
      const toFields = H.findFields(doc, ['To']);
      for (const f of toFields) await H.setTime(f.el.parentElement, ['To'], work.toTime || '05:00 PM');
      logEntry(logs, `Times From ${work.fromTime || '11:00 AM'} / To ${work.toTime || '05:00 PM'}`, true);
    } else {
      logEntry(logs, `Dates and times left blank${cfg.testFirstType ? ' for first-row test' : ''}`, true);
    }

    const provider = work.serviceProvider ? H.findFields(doc, ['Service Provider']).filter(skipEquip) : [];
    for (const field of provider) await H.setValueOn(field.el, work.serviceProvider);
    if (work.serviceProvider) logEntry(logs, `Service Provider = ${work.serviceProvider}`, provider.length > 0);

    const equipment = work.equipment || cfg.equipment || [];

    if (work.urgent) {
      const cb = H.findCheckbox(doc, ['This is an urgent request']);
      if (cb && !cb.checked) {
        cb.click();
        logEntry(logs, 'Marked as urgent', true);
      }
    }

    await fillPersonnel(doc, personnel, logs);
    await fillEquipment(doc, equipment, logs);
  }

  async function fillEquipment(doc, list, logs) {
    if (!list || !list.length) return;
    const heading = H.findHeading(doc, ['equipment', 'tools']);
    const section = heading
      ? H.sectionByHeading(doc, ['equipment details', 'equipment', 'tools'], ['Add Equipment']) || heading.parentElement
      : doc;
    const findEquipmentFields = () => H.findFields(section || doc, [
      'Equipment', 'Equipment Description', 'Tool', 'Tool Description', 'Description',
    ]).filter((field) => !/scope|item to pull|specific/i.test(field.label));
    let fields = findEquipmentFields();
    if (!fields.length) {
      fields = H.findFields(doc, [
        'Equipment', 'Equipment Description', 'Tool', 'Tool Description', 'Description',
      ]).filter((field) => !/scope|item to pull|specific|work details/i.test(field.label));
    }
    let additions = 0;
    while (fields.length < list.length && additions < list.length + 2) {
      const add = H.findButtonByText(doc, 'Add Equipment') || H.findButtonByText(doc, 'Add Tool');
      if (!add) break;
      add.click();
      await sleep(700);
      fields = findEquipmentFields();
      if (!fields.length) {
        fields = H.findFields(doc, ['Equipment', 'Equipment Description', 'Tool', 'Tool Description', 'Description'])
          .filter((field) => !/scope|item to pull|specific|work details/i.test(field.label));
      }
      additions++;
    }
    for (let i = 0; i < Math.min(fields.length, list.length); i++) {
      checkCancelled();
      progress(`Equipment ${i + 1}`, 'working');
      const ok = await H.setValueOn(fields[i].el, list[i]);
      progress(`Equipment ${i + 1}`, ok ? 'done' : 'failed');
    }
    logEntry(logs, `Equipment: ${Math.min(fields.length, list.length)}/${list.length} filled`, fields.length >= list.length);
  }

  async function fillPersonnel(doc, list, logs) {
    if (!list || !list.length) return;
    const btn = H.findButtonByText(doc, 'Add Personnel');
    let sec = btn
      ? H.longestContainerOf(btn, ['First Name', 'Last Name'])
      : H.sectionByHeading(doc, ['Personnel Details'], ['Add Personnel']);
    if (!sec) sec = doc;
    const target = list.length;
    let safety = 0;
    const getFields = (root, keys) => {
      const local = H.findFields(root, keys);
      const global = root === doc ? local : H.findFields(doc, keys);
      return global.length > local.length ? global : local;
    };
    let firsts = getFields(sec, ['First Name']);
    while (firsts.length < target && safety < target + 4) {
      const add = H.findButtonByText(doc, 'Add Personnel') ||
        Array.from(doc.querySelectorAll('button, [role=button], [class*=button]'))
          .find((el) => H.isVisible(el) && /add personnel/i.test(H.textOf(el)));
      if (!add) break;
      add.click();
      await sleep(700);
      safety++;
      firsts = getFields(sec, ['First Name']);
    }
    if (!firsts.length && sec !== doc) {
      sec = doc;
      firsts = H.findFields(sec, ['First Name']);
    }
    const lasts = getFields(sec, ['Last Name']);
    const mis = getFields(sec, ['M.I', 'MI', 'Middle Initial']);
    if (!firsts.length) {
      logEntry(logs, 'Personnel fields not found', false);
      return;
    }
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
    if (msg.type === 'wp-cancel') {
      cancelRequested = true;
      sendResponse({ ok: true });
      return false;
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
