(function () {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const textOf = (el) => (el && (el.textContent || '')).replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 8000, interval = 250) {
    const start = Date.now();
    for (;;) {
      const v = await Promise.resolve(fn());
      if (v) return v;
      if (Date.now() - start > timeout) return null;
      await sleep(interval);
    }
  }

  const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0;
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.disabled) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'SELECT') return true;
    if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'file'].includes((el.type || '').toLowerCase());
    if (el.getAttribute && el.getAttribute('role') === 'combobox') return true;
    return false;
  }

  function setText(el, value) {
    el.focus();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const setter = el.tagName === 'TEXTAREA' ? textareaSetter : inputSetter;
      if (setter) setter.call(el, value);
      else el.value = value;
    } else {
      el.textContent = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
  }

  function setSelect(el, value) {
    for (const opt of Array.from(el.options)) {
      if (norm(opt.textContent) === norm(value) || opt.value === value) {
        el.value = opt.value;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    const direct = Array.from(el.options).find((o) => o.value === value);
    if (direct) {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  function splitCamel(s) {
    return String(s)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .trim();
  }

  function labelFor(el) {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.getAttribute('data-label')) return el.getAttribute('data-label');
    if (el.id) {
      for (const l of Array.from(document.querySelectorAll('label[for]'))) {
        if (l.htmlFor === el.id && textOf(l)) return textOf(l);
      }
      const m = /Input[-_]([A-Za-z0-9_]+)$/.exec(el.id) || /Dropdown[-_]([A-Za-z0-9_]+)$/.exec(el.id) || /field[-_]([A-Za-z0-9_]+)$/.exec(el.id);
      if (m) return splitCamel(m[1].replace(/_/g, ' '));
    }
    if (el.placeholder) return el.placeholder;
    let n = el;
    for (let i = 0; n && i < 4; i++, n = n.parentElement) {
      const own = Array.from(n.childNodes)
        .filter((c) => c.nodeType === Node.TEXT_NODE)
        .map((c) => (c.textContent || '').trim())
        .filter((c) => c.length > 1);
      if (own.length) return own[own.length - 1];
      const prev = n.previousElementSibling;
      if (prev && textOf(prev)) return textOf(prev);
    }
    return '';
  }

  function findFields(root, labelKeys) {
    root = root || document;
    const out = [];
    const seen = new Set();
    const allControls = () => root.querySelectorAll('input, select, textarea, [role=combobox]');

    for (const l of Array.from(root.querySelectorAll('label'))) {
      const txt = textOf(l);
      if (!txt || !labelKeys.some((k) => norm(txt).includes(norm(k)))) continue;
      let ctrl = null;
      if (l.htmlFor) {
        try {
          ctrl = root.querySelector('#' + CSS.escape(l.htmlFor));
        } catch {}
      }
      if (!ctrl) ctrl = l.querySelector('input, select, textarea');
      if (!ctrl) {
        let n = l.parentElement;
        for (let i = 0; n && i < 4 && !ctrl; i++, n = n.parentElement) {
          ctrl = n.querySelector(':scope > input, :scope > select, :scope > textarea');
        }
      }
      if (ctrl && ctrl !== l && (isVisible(ctrl) || ctrl.type === 'hidden') && (isEditable(ctrl) || ctrl.getAttribute('role') === 'combobox') && !seen.has(ctrl)) {
        seen.add(ctrl);
        out.push({ el: ctrl, label: txt });
      }
    }

    for (const c of allControls()) {
      if ((!isVisible(c) && c.type !== 'hidden') || !(isEditable(c) || c.getAttribute('role') === 'combobox') || seen.has(c)) continue;
      const txt = labelFor(c);
      if (txt && labelKeys.some((k) => norm(txt).includes(norm(k)))) {
        seen.add(c);
        out.push({ el: c, label: txt });
      }
    }
    return out;
  }

  function findField(root, labelKeys) {
    const all = findFields(root, labelKeys);
    return all[0] || null;
  }

  function findCheckbox(root, labelKeys) {
    root = root || document;
    for (const c of Array.from(root.querySelectorAll('input[type=checkbox]'))) {
      const lbl = c.id ? Array.from(root.querySelectorAll('label[for]')).find((l) => l.htmlFor === c.id && textOf(l)) : null;
      const lbl2 = c.closest('label');
      const txt = lbl ? textOf(lbl) : lbl2 ? textOf(lbl2) : '';
      if (txt && labelKeys.some((k) => norm(txt).includes(norm(k)))) return c;
    }
    for (const l of Array.from(root.querySelectorAll('label'))) {
      const txt = textOf(l);
      if (!txt || !labelKeys.some((k) => norm(txt).includes(norm(k)))) continue;
      const c = l.querySelector('input[type=checkbox]');
      if (c) return c;
      if (l.htmlFor) {
        const t = document.querySelector('#' + CSS.escape(l.htmlFor));
        if (t && t.type === 'checkbox') return t;
      }
    }
    return null;
  }

  function findButtonByText(root, key) {
    root = root || document;
    const keyN = norm(key);
    const sel = 'button, [role=button], input[type=button], input[type=submit], [class*=btn], [class*=button]';
    for (const el of Array.from(root.querySelectorAll(sel))) {
      if (!isVisible(el)) continue;
      const cands = [textOf(el), el.getAttribute('title') || '', el.getAttribute('aria-label') || ''];
      if (cands.some((c) => norm(c).includes(keyN))) return el;
    }
    return null;
  }

  function findHeading(root, keys) {
    root = root || document;
    const tags = 'h1,h2,h3,h4,h5,h6,legend,dt,[role=heading],label,span,p,div,strong,b,td';
    for (const h of root.querySelectorAll(tags)) {
      const direct = Array.from(h.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || '').trim())
        .filter(Boolean)
        .join(' ');
      const tt = norm(direct || textOf(h));
      if (!tt || tt.length > 60) continue;
      if (h.querySelector('input,select,textarea')) continue;
      if (keys.some((k) => tt.includes(norm(k)))) return h;
    }
    return null;
  }

  function sectionByHeading(root, headingKeys, markerKeys) {
    root = root || document;
    const heads = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,dt,[role=heading]')).filter((h) =>
      headingKeys.some((k) => norm(textOf(h)).includes(norm(k)))
    );
    if (!heads.length) return null;
    const head = heads[0];
    const mk = (Array.isArray(markerKeys) ? markerKeys : [markerKeys]).map(norm).join(' ');
    let n = head.parentElement;
    for (let i = 0; n && i < 12; i++, n = n.parentElement) {
      const hasControls = n.querySelector('input, select, textarea') !== null;
      const hasMarker = mk ? norm(textOf(n)).includes(mk) : true;
      if (hasControls && hasMarker && n !== root && n !== document.body) return n;
    }
    return head.parentElement || null;
  }

  function longestContainer(el, keys) {
    let best = null;
    let n = el;
    for (let i = 0; n && i < 20; i++, n = n.parentElement) {
      if (n === document || n === document.body) break;
      const hasIt = n.querySelector('input, select, textarea') !== null;
      if (hasIt && keys.some((k) => norm(textOf(n)).includes(norm(k)))) best = n;
    }
    return best;
  }

  function collectAllDocs(doc) {
    const docs = [doc];
    for (const f of Array.from(doc.querySelectorAll('iframe, frame'))) {
      try {
        const fd = f.contentDocument;
        if (fd && fd !== doc) docs.push(fd);
      } catch {}
    }
    return docs;
  }

  async function ensureInView(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {}
    await sleep(120);
  }

  async function openCombo(el) {
    await ensureInView(el);
    try {
      const a = el.closest(
        '[role=combobox], .ant-select-selector, .ant-select, .mat-form-field, .vs__selected-actions, [class*=select-selector], [class*=dropdown-trigger], [class*=combobox]'
      );
      el.focus();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.click();
      if (a && a !== el) {
        a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        a.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        a.click();
      }
    } catch {}
    await sleep(350);
  }

  function findPopupSearch(doc) {    const sel = [
      '[role=listbox] input', '[role=dialog] input', '[role=combobox] input',
      '.ant-select-dropdown input', '.ant-select-popover input', '.dropdown input',
      '[class*=dropdown] input', '[class*=popover] input', 'input[type=search]',
      '[class*=search] input', '.mat-autocomplete-panel input',
    ];
    for (const s of sel) {
      for (const i of Array.from(doc.querySelectorAll(s))) {
        if (isVisible(i) && i !== undefined) return i;
      }
    }
    return null;
  }

  async function pickOption(root, value, timeout = 5000) {
    root = root || document;
    const valueN = norm(value);
    const opt = await waitFor(() => {
      const pool = root.querySelectorAll(
        '[role=option], [class*=option], [data-value], li, .dropdown-item, .mat-option, .k-option, .el-select-dropdown__item, [role=menuitem], option, [class*=suggestion], tr[data-id], tr[data-recordid], [class*=select] tr[class*=select], [class*=lookup] td[class*=select], [class*=result] [class*=clickable-list-option]'
      );
      const list = [];
      const seen = new Set();
      for (const o of Array.from(pool)) {
        if (!isVisible(o)) continue;
        const txt = norm(textOf(o));
        if (!txt || txt.length > 80) continue;
        if (txt === valueN || txt.includes(valueN) || valueN.includes(txt)) {
          const item = o.closest('[role=option], .dropdown-item, .mat-option, .k-option, .el-select-dropdown__item, [role=menuitem], li') || o;
          if (!seen.has(item)) {
            seen.add(item);
            list.push({ el: item, txt: norm(textOf(item)) });
          }
        }
      }
      const exact = list.find((x) => x.txt === valueN);
      return exact ? exact.el : list.sort((a, b) => a.txt.length - b.txt.length)[0]?.el || null;
    }, timeout, 150);
    if (!opt) return false;
    opt.scrollIntoView({ block: 'center' });
    try {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        opt.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      opt.click();
    } catch {}
    await sleep(350);
    return true;
  }

  function viewAllTrigger(el) {
    const sel = '[class*=button], button, span, a, [role=button], [class*=icon]';
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const items = Array.from(n.querySelectorAll(sel)).filter((v) => isVisible(v) && v !== el);
      const candidates = items.map((v) => {
        const txt = norm(textOf(v) + ' ' + (v.getAttribute('title') || '') + ' ' + (v.getAttribute('aria-label') || ''));
        const isInfo = /tooltip-content|info-circle|fa-info-circle/i.test(String(v.className || '') + ' ' + (v.id || '') + ' ' + (v.getAttribute('data-icon') || ''));
        const rank = txt === 'select' ? 0 : txt.includes('view all') ? 1 : txt.includes('search') ? 2 : (v.querySelector && v.querySelector('svg, i[class*=icon], [class*=icon]')) ? 3 : 4;
        return { v, rank: isInfo ? 4 : rank, txt };
      }).filter((item) => item.rank < 4);
      candidates.sort((a, b) => a.rank - b.rank);
      if (candidates[0]) return candidates[0].v;
      const own = n.children.length <= 3;
      if (!own) break;
    }
    return null;
  }

  async function clearValue(el) {
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
    const setter = el.tagName === 'TEXTAREA' ? textareaSetter : inputSetter;
    if (setter) setter.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  async function closeLists() {
    const act = document.activeElement;
    if (act) act.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(150);
  }

  async function pickFromOpened(root, value, timeout) {
    const picked = await pickOption(root, value, timeout || 4000);
    if (picked) {
      const act = document.activeElement;
      if (act) act.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return picked;
  }

  async function typeInCombo(root, labelKeys, value) {
    const f = findField(root, labelKeys);
    if (!f) return false;
    if (f.el.tagName === 'SELECT') return setSelect(f.el, value);
    await ensureInView(f.el);
    await openCombo(f.el);

    let picked = await pickFromOpened(document, value);
    let usedSearch = false;
    let search = null;

    if (!picked) {
      search = findPopupSearch(document);
      if (search) {
        usedSearch = true;
        setText(search, value);
        await sleep(600);
        picked = await pickFromOpened(document, value);
      }
    }
    if (!picked) {
      const trigger = viewAllTrigger(f.el);
      if (trigger) {
        trigger.click();
        await sleep(700);
        picked = await pickFromOpened(document, value);
        if (!picked) {
          search = findPopupSearch(document);
          if (search) {
            usedSearch = true;
            setText(search, value);
            await sleep(600);
            picked = await pickFromOpened(document, value);
          }
        }
      }
    }
    if (!picked) {
      const innerInput = f.el.tagName !== 'INPUT' ? f.el.querySelector('input[type=text], input:not([type]), input[type=search]') : null;
      const realInput = f.el.tagName === 'INPUT' && (f.el.type === 'text' || f.el.type === 'search' || !f.el.readOnly);
      if (realInput && !search) {
        await clearValue(f.el);
        setText(f.el, value);
        await sleep(600);
        picked = await pickFromOpened(document, value);
        if (!picked) await clearValue(f.el);
      } else if (innerInput && !search) {
        await clearValue(innerInput);
        setText(innerInput, value);
        await sleep(600);
        picked = await pickFromOpened(document, value);
        if (!picked) await clearValue(innerInput);
      }
    }
    if (!picked) await closeLists();
    if (usedSearch && search) await closeLists();
    return picked;
  }

  function collectVisibleItems() {
    const seen = new Set();
    const out = [];
    const pool = '[role=option], [class*=option], [class*=item], [data-value], li, .dropdown-item, .mat-option, .k-option, .el-select-dropdown__item, [role=menuitem], option, [class*=suggestion]';
    for (const o of document.querySelectorAll(pool)) {
      const txt = norm(textOf(o));
      if (!txt || txt.length > 60 || seen.has(txt)) continue;
      if (!isVisible(o)) continue;
      seen.add(txt);
      out.push(txt);
    }
    return out.slice(0, 30);
  }

  window.__wpDiag = [];

  function elInfo(el) {
    if (!el) return 'none';
    return {
      tag: el.tagName,
      type: el.type || '',
      readonly: !!el.readOnly,
      id: el.id || '',
      cls: String(el.className || '').slice(0, 120),
      html: el.outerHTML.slice(0, 320),
    };
  }

  function diag(kind, text, details) {
    window.__wpDiag.push({ kind, text, detail: details || '' });
  }

  function collectSamples() {
    const seen = new Set();
    const out = [];
    for (const o of Array.from(document.querySelectorAll('[role=option], [class*=option], .dropdown-item, .mat-option, .k-option, option, li'))) {
      const txt = norm(textOf(o));
      if (!txt || txt.length > 60 || seen.has(txt)) continue;
      seen.add(txt);
      out.push(txt);
      if (out.length >= 20) break;
    }
    return out;
  }

  function nearMiss(labelKeys) {
    const hits = [];
    for (const c of document.querySelectorAll('input, select, textarea, [role=combobox], [class*=combo], [class*=lookup], [data-input]')) {
      if (!isVisible(c)) continue;
      const txt = norm(labelFor(c) + '|' + (c.getAttribute && c.getAttribute('aria-label') || '') + '|' + (c.value || ''));
      if (txt && labelKeys.some((k) => txt.includes(norm(k)))) {
        hits.push(elInfo(c));
        if (hits.length >= 4) break;
      }
    }
    return JSON.stringify(hits);
  }

  function dumpFields(max = 80) {
    const out = [];
    const seenEls = new Set();
    const sel = 'input, select, textarea, [role=combobox], [class*=dropdown-display], [class*=OSCombobox], [class*=combobox]';
    for (const c of document.querySelectorAll(sel)) {
      const tag = c.tagName;
      const isControl = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      const hidden = !isVisible(c);
      const type = c.type || '';
      if (type === 'hidden' && !c.id && !c.className) continue;
      const label = labelFor(c);
      const info = {
        n: out.length,
        tag,
        type,
        id: c.id || '',
        cls: String((c.className && c.className.baseVal !== undefined ? c.className.baseVal : c.className) || '').slice(0, 60),
        vis: hidden ? 0 : 1,
        label: label.slice(0, 40),
        val: String(c.value || '').slice(0, 24),
        ro: isControl && c.readOnly ? 1 : 0,
      };
      if (tag === 'SELECT') info.opts = Array.from(c.options).map((o) => o.textContent).slice(0, 12);
      out.push(info);
      seenEls.add(c);
      if (out.length >= max) break;
    }
    const widgetSel = 'a, div, span, td, li, button, [role=button]';
    const widgetRe = /dropdown|combo|lookup|search|OSInput|viewall|select/i;
    for (const w of document.querySelectorAll(widgetSel)) {
      if (seenEls.has(w)) continue;
      const cls = String((w.className && w.className.baseVal !== undefined ? w.className.baseVal : w.className) || '');
      const id = w.id || '';
      if (!widgetRe.test(cls + ' ' + id)) continue;
      if (!w.querySelector('input, select, textarea')) continue;
      if (w.querySelector('input, select, textarea') && seenEls.has(w.querySelector('input, select, textarea'))) continue;
      const info = {
        n: out.length,
        tag: w.tagName + '.widget',
        type: '-',
        id: id.slice(0, 50),
        cls: cls.slice(0, 60),
        vis: isVisible(w) ? 1 : 0,
        label: textOf(w).slice(0, 40),
        val: '',
        ro: 0,
      };
      out.push(info);
      if (out.length >= max) break;
    }
    return out;
  }

  async function setComboValue(root, labelKeys, value) {
    if (value === undefined || value === null || value === '') return 'skipped';
    const f = findField(root, labelKeys);
    if (!f) {
      diag('combo', `"${labelKeys[0]}" → "«${value}»"`, 'field not found — near-miss fields + labels: ' + nearMiss(labelKeys));
      return 'notfound';
    }
    const elDetail = JSON.stringify(elInfo(f.el));
    const isComboish =
      f.el.getAttribute('role') === 'combobox' ||
      !!f.el.readOnly ||
      !!f.el.getAttribute('aria-haspopup') ||
      (f.el.parentElement && f.el.parentElement.querySelector('[class*=picker], [class*=combobox], [class*=combo]')) || false;
    if (f.el.tagName !== 'SELECT' && !isComboish) {
      await ensureInView(f.el);
      await setValueOn(f.el, value);
      return 'typed';
    }
    if (f.el.tagName === 'SELECT') {
      let ok = setSelect(f.el, value);
      if (!ok && !isVisible(f.el)) {
        diag('combo', `"${labelKeys[0]}" select is hidden — «${value}» not among preloaded options`, JSON.stringify(Array.from(f.el.options).map((o) => o.textContent).slice(0, 25)));
        return 'hiddenselect';
      }
      if (!ok) {
        try {
          f.el.click();
          await sleep(1000);
        } catch {}
        ok = setSelect(f.el, value);
        if (!ok && Array.from(f.el.options).length <= 1) {
          try {
            f.el.click();
            await sleep(1200);
          } catch {}
          ok = setSelect(f.el, value);
        }
      }
      if (!ok) {
        // Some portal selects contain only the placeholder and load the real
        // choices through a sibling lookup button.
        const trigger = viewAllTrigger(f.el);
        diag('combo-debug', `Temporary ${labelKeys[0]} lookup trace`, JSON.stringify({
          select: elInfo(f.el),
          selectOptions: Array.from(f.el.options).map((o) => ({ text: textOf(o), value: o.value })).slice(0, 10),
          trigger: elInfo(trigger),
          parent: f.el.parentElement ? f.el.parentElement.outerHTML.slice(0, 700) : '',
        }));
        if (trigger) {
          trigger.click();
          await sleep(800);
          const search = findPopupSearch(f.el.ownerDocument || document);
          if (search) {
            setText(search, value);
            await sleep(650);
          }
          ok = await pickFromOpened(f.el.ownerDocument || document, value, 5000);
          diag('combo-debug', `Temporary ${labelKeys[0]} lookup result`, JSON.stringify({
            selectOptions: Array.from(f.el.options).map((o) => ({ text: textOf(o), value: o.value })).slice(0, 10),
            search: elInfo(search),
            visibleItems: collectSamples(),
          }));
        }
      }
      if (!ok) {
        ok = await pickFromOpened(document, value, 4000);
      }
      if (!ok) {
        const search = findPopupSearch(document);
        if (search) {
          setText(search, value);
          await sleep(600);
          ok = await pickFromOpened(document, value, 4000);
          await closeLists();
        }
      }
      if (ok) await closeLists();
      if (!ok) diag('combo', `"${labelKeys[0]}" select — «${value}» not among options`, JSON.stringify(Array.from(f.el.options).map((o) => o.textContent).slice(0, 25)));
      return ok ? 'ok' : 'notmatched';
    }
    const ok = await typeInCombo(root, labelKeys, value);
    if (!ok) {
      diag('combo', `"${labelKeys[0]}" could not pick «${value}» — visible list:`, JSON.stringify(collectSamples()));
    }
    return ok ? 'ok' : 'notmatched';
  }

  async function setComboElement(el, value) {
    if (!el || value === undefined || value === null || value === '') return false;
    if (el.tagName === 'SELECT') return setSelect(el, value);
    await openCombo(el);

    // Some Type of Work controls are editable autocomplete inputs. Use the
    // input only to filter the list, then commit an actual option below.
    const input = el.matches?.('input')
      ? el
      : el.querySelector?.('input[type=text], input:not([type]), input[type=search]');
    if (input && !input.readOnly) {
      await clearValue(input);
      setText(input, value);
      await sleep(650);
    }

    const ownerDoc = el.ownerDocument || document;
    let picked = await pickFromOpened(ownerDoc, value, 3500);
    if (!picked) {
      const search = findPopupSearch(ownerDoc);
      if (search) {
        setText(search, value);
        await sleep(650);
        picked = await pickFromOpened(ownerDoc, value, 4500);
      }
    }
    if (!picked) {
      const inner = el.querySelector?.('input[type=text], input:not([type]), input[type=search]');
      if (inner) {
        await clearValue(inner);
        setText(inner, value);
        await sleep(650);
        picked = await pickFromOpened(ownerDoc, value, 4500);
      }
    }
    if (!picked) {
      // Lookup-backed controls such as Specific Scope need the adjacent
      // View All/search trigger before their options exist in the DOM.
      const trigger = viewAllTrigger(el);
      if (trigger) {
        trigger.click();
        await sleep(700);
        const search = findPopupSearch(ownerDoc);
        if (search) {
          setText(search, value);
          await sleep(650);
        }
        picked = await pickFromOpened(ownerDoc, value, 4500);
      }
    }
    if (!picked && input) {
      try {
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown' }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }));
        picked = true;
      } catch {}
    }
    await closeLists();
    return !!picked;
  }

  async function setValueOn(el, value) {
    if (!el) return false;
    if (el.tagName === 'SELECT') return setSelect(el, value);
    await ensureInView(el);
    setText(el, value);
    await sleep(150);
    return true;
  }

  async function setTime(root, labelKeys, value) {
    const f = findField(root, labelKeys);
    if (!f) return false;
    if (f.el.type === 'time') {
      const m = /(\d{1,2})\s*[:.]\s*(\d{2})/.exec(value);
      let h = m ? +m[1] : 11;
      const min = m ? m[2] : '00';
      if (/pm/i.test(value) && h < 12) h += 12;
      if (/am/i.test(value) && h === 12) h = 0;
      setText(f.el, `${String(h).padStart(2, '0')}:${min}`);
      return true;
    }
    if (f.el.tagName === 'SELECT') return setSelect(f.el, value);
    await openCombo(f.el);
    return pickOption(root, value);
  }

  async function fillInput(root, labelKeys, value) {
    const f = findField(root, labelKeys);
    if (!f) return false;
    await ensureInView(f.el);
    await setValueOn(f.el, value);
    return true;
  }

  function allDocs(doc) {
    return collectAllDocs(doc);
  }

  window.__wpH = {
    norm, textOf, sleep, waitFor, isVisible, isEditable, setText, setSelect,
    findField, findFields, findCheckbox, findButtonByText, findHeading, sectionByHeading, longestContainerOf: longestContainer,
    collectAllDocs, allDocs, openCombo, typeInCombo, pickOption, setComboValue, setComboElement,
    setValueOn, setTime, fillInput, labelFor, collectVisibleItems, pickFromOpened,
    dumpFields,
  };
})();
