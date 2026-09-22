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
    generalScope: 'Pullout',
    items: 'DELIVERY/PULLOUT OF APPLE PRODUCTS',
    specificScope: 'Pullout of merchandise/goods/items/products/stocks',
    detailsOfWork: 'DELIVERY/PULLOUT OF APPLE PRODUCTS',
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
const state = {
  profiles: {},
  activeProfileId: '',
  profile: structuredClone(DEFAULT_PROFILE),
  saveTimer: null,
  dialogMode: 'create',
  templateChoice: '',
  builtinLabels: { pullout: 'Pullout', 'pest-control': 'Pest Control' },
};

const PEST_CONTROL_PRESET = {
  permitType: 'pest-control',
  work: {
    tenantStatus: 'Operating', numWork: 1, generalScope: 'Maintenance',
    items: '', specificScope: 'Pest control/proofing/baiting/misting',
    serviceProvider: 'HOMEFIX PEST CONTROL SERVICES', detailsOfWork: 'Disinfection',
    fromTime: '', toTime: '', leaveScheduleBlank: true, urgent: false,
  },
  personnel: [
    'Jimmy Rillen Jr', 'Luis Martin Jr.', 'Alfie Lacsa', 'Jhon Peter Tuscano',
    'Lemuel German', 'Eufronio Aboquin', 'Christian Aldea', 'Angelica Lacia',
    'Dominico Auxtero Jr.', 'Weniel Mationg', 'Marvin Candar',
  ].map((line) => { const [first, ...rest] = line.replace(/\.$/, '').split(/\s+/); return { first, last: rest.join(' '), mi: '' }; }),
  equipment: ['1pc Misting machine', '1pc spray can', 'asstd. chem', 'PPE'],
};

const PULL_OUT_PRESET = {
  permitType: 'pullout',
  work: structuredClone(DEFAULT_PROFILE.work),
  personnel: structuredClone(DEFAULT_PROFILE.personnel),
  equipment: [],
};

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
  const stored = await chrome.storage.local.get(['wpProfiles', 'wpProfile', 'wpBuiltinLabels']);
  if (stored.wpBuiltinLabels && typeof stored.wpBuiltinLabels === 'object') {
    state.builtinLabels = { ...state.builtinLabels, ...stored.wpBuiltinLabels };
  }
  const savedProfiles = stored.wpProfiles;
  if (savedProfiles && typeof savedProfiles === 'object' && Object.keys(savedProfiles).length) {
    state.profiles = Object.fromEntries(Object.entries(savedProfiles).map(([id, item]) => [id, {
      name: String(item?.name || 'Current permit').replace(/^Default permit$/, 'Current permit').replace(/^Permit profile$/, 'Current permit'),
      profile: normalizeProfile(item?.profile || item),
    }]));
  } else {
    const id = makeProfileId();
    state.profiles = { [id]: { name: 'Current permit', profile: normalizeProfile(stored.wpProfile || {}) } };
  }
  state.activeProfileId = Object.keys(state.profiles)[0];
  state.profile = structuredClone(state.profiles[state.activeProfileId].profile);
  state.templateChoice = state.profile.permitType && !state.profile.permitType.startsWith('saved:')
    ? (state.profile.permitType === 'pest-control' ? 'pest-control' : 'pullout')
    : `saved:${state.activeProfileId}`;
  const hiddenInput = $('f_permitType');
  if (hiddenInput) hiddenInput.value = state.templateChoice;
  await persist();
}

async function persist() {
  if (!state.activeProfileId) return;
  state.profiles[state.activeProfileId] = {
    ...state.profiles[state.activeProfileId],
    profile: structuredClone(state.profile),
  };
  await chrome.storage.local.set({
    wpProfiles: state.profiles,
    wpProfile: state.profile,
  });
}

async function persistBuiltinLabels() {
  await chrome.storage.local.set({ wpBuiltinLabels: state.builtinLabels });
}

function makeProfileId() {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeProfile(stored) {
  const source = stored && typeof stored === 'object' ? { ...stored } : {};
  delete source.name;
  delete source.profile;
  const work = { ...(source.work || {}) };
  if (work.generalScope === undefined && work.scope !== undefined) work.generalScope = work.scope;
  if (work.specificScope === undefined && work.specific !== undefined) work.specificScope = work.specific;
  if (work.detailsOfWork === undefined && work.scopeOfWork !== undefined) work.detailsOfWork = work.scopeOfWork;
  if (work.items === undefined) {
    work.items = work.itemsToPullOut ?? work.itemsToPullout ?? work.itemToPullOut ?? '';
  }
  delete work.scope;
  delete work.specific;
  delete work.scopeOfWork;
  delete work.itemsToPullOut;
  delete work.itemsToPullout;
  delete work.itemToPullOut;
  if (/pullout/i.test(work.generalScope || '') && /delivery\s*\/\s*pullout|apple products/i.test(work.specificScope || '')) {
    work.specificScope = 'Pullout of merchandise/goods/items/products/stocks';
  }
  if (source.permitType === 'pullout') {
    if (/^disinfection$/i.test(work.detailsOfWork || '')) work.detailsOfWork = 'DELIVERY/PULLOUT OF APPLE PRODUCTS';
    if (/^homefix pest control services$/i.test(work.serviceProvider || '')) delete work.serviceProvider;
  }
  if (/^pullout$/i.test(work.generalScope || '')) {
    if (work.leaveScheduleBlank === true) work.leaveScheduleBlank = false;
  }
  source.work = work;
  return deepMerge(structuredClone(DEFAULT_PROFILE), source);
}

function getSavedProfiles() {
  return Object.entries(state.profiles).filter(([, item]) => item?.name);
}

function getBuiltinOptions() {
  return [
    { value: 'pullout', label: state.builtinLabels.pullout || 'Pullout' },
    { value: 'pest-control', label: state.builtinLabels['pest-control'] || 'Pest Control' },
  ];
}

function getBuiltinOption() {
  const labels = {
    pullout: state.builtinLabels.pullout || 'Pullout',
    'pest-control': state.builtinLabels['pest-control'] || 'Pest Control',
  };
  if (state.templateChoice === 'pest-control') return { value: 'pest-control', label: labels['pest-control'], builtIn: true };
  if (state.templateChoice === 'pullout') return { value: 'pullout', label: labels.pullout, builtIn: true };
  const type = state.profile.permitType === 'pest-control' ? 'pest-control' : 'pullout';
  return { value: type, label: labels[type], builtIn: true };
}

function templateNameExists(name, excludeKey) {
  const lower = name.toLowerCase();
  for (const b of getBuiltinOptions()) {
    const key = `builtin:${b.value}`;
    if (key === excludeKey) continue;
    if (b.label.toLowerCase() === lower) return true;
  }
  for (const [pid, p] of Object.entries(state.profiles)) {
    const key = `profile:${pid}`;
    if (key === excludeKey) continue;
    if (p?.name && p.name.toLowerCase() === lower) return true;
  }
  return false;
}

function renderTemplates(opts = {}) {
  const container = $('templateDropdown');
  if (!container) return;
  container.innerHTML = '';
  const trigger = document.createElement('div');
  trigger.className = 'dd-trigger';
  trigger.tabIndex = 0;
  trigger.setAttribute('role', 'button');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const selectedItem = getSelectedItem();
  trigger.innerHTML = `<span class="dd-label">${esc(selectedItem ? selectedItem.label : 'Choose template')}</span><span class="dd-arrow">▼</span>`;

  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  menu.hidden = !opts.open;
  menu.dataset.menuId = 'templateMenu';
  trigger.setAttribute('aria-expanded', String(!menu.hidden));

  const setOpen = (open) => {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };

  getBuiltinOptions().forEach((builtin) => {
    const isActive = state.templateChoice === builtin.value;
    const builtinItem = document.createElement('div');
    builtinItem.className = `dd-item built-in${isActive ? ' active' : ''}`;
    builtinItem.dataset.builtinValue = builtin.value;
    const labelSpan = document.createElement('span');
    labelSpan.className = 'dd-item-label';
    labelSpan.textContent = builtin.label;
    builtinItem.appendChild(labelSpan);

    const actions = document.createElement('div');
    actions.className = 'dd-item-actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'rename-btn';
    renameBtn.type = 'button';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✎';
    actions.appendChild(renameBtn);
    builtinItem.appendChild(actions);

    const builtinSelect = document.createElement('button');
    builtinSelect.className = 'select-btn';
    builtinSelect.type = 'button';
    builtinSelect.textContent = isActive ? '✓' : 'Select';
    builtinItem.appendChild(builtinSelect);

    builtinItem.addEventListener('click', (event) => {
      if (builtinItem.classList.contains('editing')) return;
      event.stopPropagation();
      if (event.target.closest('.rename-btn')) {
        startInlineRename(builtinItem, { kind: 'builtin', value: builtin.value });
        return;
      }
      if (event.target.closest('.select-btn') || !event.target.closest('button')) {
        if (isActive) {
          setOpen(false);
          return;
        }
        applyPermitPreset(builtin.value);
        setOpen(false);
      }
    });
    menu.appendChild(builtinItem);
  });

  const savedProfiles = getSavedProfiles();
  savedProfiles.forEach(([id, item]) => {
    const isActive = state.templateChoice === `saved:${id}`;
    const row = document.createElement('div');
    row.className = `dd-item${isActive ? ' active' : ''}`;
    row.dataset.profileId = id;
    const labelSpan = document.createElement('span');
    labelSpan.className = 'dd-item-label';
    labelSpan.textContent = item.name;
    row.appendChild(labelSpan);
    const actions = document.createElement('div');
    actions.className = 'dd-item-actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'rename-btn';
    renameBtn.type = 'button';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✎';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '✕';
    if (savedProfiles.length <= 1) deleteBtn.disabled = true;
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(actions);

    row.addEventListener('click', (event) => {
      if (row.classList.contains('editing')) return;
      event.stopPropagation();
      if (event.target.closest('.rename-btn')) {
        startInlineRename(row, { kind: 'profile', id });
        return;
      }
      if (event.target.closest('.delete-btn')) {
        deleteProfileById(id);
        return;
      }
      if (event.target.closest('.select-btn') || !event.target.closest('button')) {
        selectProfile(id);
        setOpen(false);
      }
    });
    menu.appendChild(row);
  });

  if (!savedProfiles.length) {
    const empty = document.createElement('div');
    empty.className = 'dd-empty';
    empty.textContent = 'No saved templates yet';
    menu.appendChild(empty);
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target.closest('button')) return;
    const willOpen = menu.hidden;
    if (willOpen) closeAllDropdownMenus();
    setOpen(willOpen);
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = menu.hidden;
      if (willOpen) closeAllDropdownMenus();
      setOpen(willOpen);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  });

  container.appendChild(trigger);
  container.appendChild(menu);
}

function closeAllDropdownMenus() {
  document.querySelectorAll('.dd-menu').forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll('.dd-trigger[aria-expanded="true"]').forEach((t) => {
    t.setAttribute('aria-expanded', 'false');
  });
}

function getSelectedItem() {
  if (state.templateChoice === 'pullout' || state.templateChoice === 'pest-control') return getBuiltinOption();
  if (state.templateChoice.startsWith('saved:')) {
    const id = state.templateChoice.slice('saved:'.length);
    const item = state.profiles[id];
    if (item?.name) return { label: item.name };
  }
  const active = state.profiles[state.activeProfileId];
  if (active?.name) return { label: active.name };
  return getBuiltinOption();
}

function selectProfile(profileId) {
  state.activeProfileId = profileId;
  state.profile = structuredClone(state.profiles[profileId].profile);
  state.templateChoice = `saved:${profileId}`;
  const hiddenInput = $('f_permitType');
  if (hiddenInput) hiddenInput.value = `saved:${profileId}`;
  persist();
  render();
  setStatus('Permit selected', 'ok');
}

function startInlineRename(row, target) {
  const labelSpan = row.querySelector('.dd-item-label');
  if (!labelSpan || row.classList.contains('editing')) return;
  const excludeKey = target.kind === 'builtin' ? `builtin:${target.value}` : `profile:${target.id}`;
  const currentName = target.kind === 'builtin'
    ? (state.builtinLabels[target.value] || (target.value === 'pest-control' ? 'Pest Control' : 'Pullout'))
    : (state.profiles[target.id]?.name || '');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.maxLength = 60;
  row.classList.add('editing');
  labelSpan.textContent = '';
  labelSpan.appendChild(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    if (!name) {
      setStatus('Template name cannot be empty', 'err');
      renderTemplates({ open: true });
      return;
    }
    if (templateNameExists(name, excludeKey)) {
      setStatus('A template with that name already exists', 'err');
      renderTemplates({ open: true });
      return;
    }
    if (name !== currentName) {
      if (target.kind === 'builtin') {
        state.builtinLabels[target.value] = name;
        persistBuiltinLabels();
      } else {
        state.profiles[target.id].name = name;
        persist();
      }
      setStatus('Template renamed', 'ok');
    }
    renderTemplates({ open: true });
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); input.value = currentName; input.blur(); }
  });
  input.addEventListener('click', (event) => event.stopPropagation());
}

async function switchProfile(id) {
  if (!state.profiles[id] || id === state.activeProfileId) return;
  collect();
  await persist();
  state.activeProfileId = id;
  state.profile = structuredClone(state.profiles[id].profile);
  state.templateChoice = `saved:${id}`;
  render();
  setStatus('Permit selected', 'ok');
}

function openProfileDialog(mode) {
  state.dialogMode = mode;
  $('profileDialogTitle').textContent = mode === 'rename' ? 'Rename permit template' : 'New permit template';
  $('profileNameInput').value = mode === 'rename' ? state.profiles[state.activeProfileId].name : '';
  $('profileDialog').hidden = false;
  $('profileNameInput').focus();
}

function closeProfileDialog() { $('profileDialog').hidden = true; }

async function confirmProfileDialog() {
  const name = $('profileNameInput').value.trim();
  if (!name) { $('profileNameInput').focus(); return; }
  const excludeKey = state.dialogMode === 'rename' ? `profile:${state.activeProfileId}` : null;
  if (templateNameExists(name, excludeKey)) {
    setStatus('A template with that name already exists', 'err');
    $('profileNameInput').focus();
    return;
  }
  if (state.dialogMode === 'rename') {
    state.profiles[state.activeProfileId].name = name;
  } else {
    collect();
    await persist();
    const id = makeProfileId();
    state.profiles[id] = { name, profile: structuredClone(state.profile) };
    state.activeProfileId = id;
    state.templateChoice = `saved:${id}`;
  }
  state.profile = structuredClone(state.profiles[state.activeProfileId].profile);
  await persist();
  const hiddenInput = $('f_permitType');
  if (hiddenInput) hiddenInput.value = state.activeProfileId ? `saved:${state.activeProfileId}` : '';
  render();
  closeProfileDialog();
  setStatus(state.dialogMode === 'rename' ? 'Permit renamed' : 'New permit created', 'ok');
}

async function deleteProfile() {
  if (Object.keys(state.profiles).length < 2) return;
  const name = state.profiles[state.activeProfileId].name;
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  deleteProfileById(state.activeProfileId);
}

async function deleteProfileById(profileId) {
  if (Object.keys(state.profiles).length <= 1) return;
  const name = state.profiles[profileId]?.name;
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  delete state.profiles[profileId];
  state.activeProfileId = Object.keys(state.profiles)[0];
  state.profile = structuredClone(state.profiles[state.activeProfileId].profile);
  state.templateChoice = `saved:${state.activeProfileId}`;
  const hiddenInput = $('f_permitType');
  if (hiddenInput) hiddenInput.value = state.activeProfileId ? `saved:${state.activeProfileId}` : '';
  await persist();
  render();
  setStatus('Permit deleted', 'ok');
}

function setAll(update) {
  state.profile = deepMerge(state.profile, update || {});
  render();
  persist();
}

function render() {
  const p = state.profile;
  renderTemplates();
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
      <h3>Contact ${i + 1}</h3>
      <label>Name<input class="c-name" value="${esc(c.name || '')}" /></label>
      <label>Position<input class="c-pos" value="${esc(c.position || '')}" /></label>
      <label>Contact Number<input class="c-tel" value="${esc(c.contact || '')}" /></label>
    `;
    wrap.appendChild(card);
  });
  $('f_people').value = p.personnel.map((x) => `${x.first}${x.mi ? ' ' + x.mi : ''} ${x.last}`.trim()).join('\n');
  $('f_equipment').value = (p.equipment || []).join('\n');
  syncChoice('f_tradeChoice', 'f_trade');
  syncChoice('f_branchChoice', 'f_branch');
  bindAutoSaveCollections();
}

function syncChoice(selectId, inputId) {
  const select = $(selectId);
  const input = $(inputId);
  if (!select || !input) return;
  const value = input.value.trim();
  const existing = Array.from(select.options).find((option) => option.value === value);
  if (value && !existing) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.insertBefore(option, select.lastElementChild);
  }
  select.value = value && Array.from(select.options).some((option) => option.value === value) ? value : (value ? '__manual__' : '');
}

function bindChoice(selectId, inputId) {
  const select = $(selectId);
  const input = $(inputId);
  if (!select || !input) return;
  select.addEventListener('change', () => {
    if (select.value === '__manual__') {
      input.focus();
      input.select();
      return;
    }
    input.value = select.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  input.addEventListener('input', () => {
    if (!Array.from(select.options).some((option) => option.value === input.value.trim())) select.value = '__manual__';
  });
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
  p.equipment = $('f_equipment').value.split('\n').map((l) => l.trim()).filter(Boolean);
  return p;
}

function applyPermitPreset(type) {
  const current = collect();
  const preset = type === 'pest-control' ? PEST_CONTROL_PRESET : PULL_OUT_PRESET;
  state.profile = deepMerge(current, structuredClone(preset));
  state.profile.work = structuredClone(preset.work);
  state.profile.permitType = type;
  state.templateChoice = type;
  const hiddenInput = $('f_permitType');
  if (hiddenInput) hiddenInput.value = type;
  render();
  persist();
  setStatus(type === 'pest-control' ? 'Pest Control template loaded' : 'Pullout template loaded', 'ok');
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
      schedulePersist();
  });
  });
}

function schedulePersist() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    collect();
    await persist();
    setStatus('Saved automatically', 'ok');
  }, 400);
}

function bindAutoSaveCollections() {
  document.querySelectorAll('#f_people, #f_equipment, #contacts input').forEach((el) => {
    if (el.dataset.autoSaveBound) return;
    el.dataset.autoSaveBound = '1';
    el.addEventListener('input', schedulePersist);
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

function setProgress(label, state) {
  const wrap = $('progress');
  if (!wrap) return;
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let row = wrap.querySelector(`[data-progress-key="${key}"]`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'progress-row';
    row.dataset.progressKey = key;
    row.innerHTML = '<span class="progress-icon"></span><span class="progress-label"></span>';
    row.querySelector('.progress-label').textContent = label;
    wrap.appendChild(row);
  }
  row.className = `progress-row ${state}`;
  row.querySelector('.progress-icon').textContent = state === 'done' ? '✓' : state === 'failed' ? '!' : '◌';
}

async function sendToTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) throw new Error('No active tab');
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content/helpers.js', 'content/fill.js'],
    });
    await new Promise((r) => setTimeout(r, 250));
    return await chrome.tabs.sendMessage(tab.id, msg);
  }
}

async function onFill() {
  clearLog();
  $('progress').innerHTML = '';
  const cfg = collect();
  appendLog(`Template selected: ${state.templateChoice || state.profile.permitType || 'current'}`, true);
  $('btnFill').disabled = true;
  $('btnFill').textContent = 'Working…';
  $('btnCancel').hidden = false;
  setStatus('Filling…');
  try {
    const res = await sendToTab({ type: 'wp-fill', cfg });
    if (!res || !res.ok) {
      setStatus(res?.message || res?.error || 'Fill failed', 'err');
      appendLog(res?.message || res?.error || 'Unhandled fill error', false);
      return;
    }
    (res.logs || []).forEach((l) => appendLog((l && (l.label || l.text)) || JSON.stringify(l), l.ok));
    const hasWarnings = (res.logs || []).some((l) => l && l.ok === false);
    setStatus(hasWarnings ? `Done with warnings — page ${res.page}` : `Done — page ${res.page} filled`, hasWarnings ? 'err' : 'ok');
  } catch (e) {
    const message = String(e?.message || e || 'Unknown error');
    setStatus(/cancelled/i.test(message) ? 'Fill cancelled' : 'Could not reach the tab. Reload the page and retry.', 'err');
    appendLog(message, false);
  } finally {
    $('btnFill').disabled = false;
    $('btnFill').textContent = 'Fill current page';
    $('btnCancel').disabled = false;
    $('btnCancel').hidden = true;
  }
}

async function onCancel() {
  $('btnCancel').disabled = true;
  setStatus('Cancelling…');
  try {
    await sendToTab({ type: 'wp-cancel' });
  } catch {}
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
  const exportData = { name: state.profiles[state.activeProfileId]?.name || 'Permit profile', profile: cfg };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(exportData.name || 'work-permit-profile').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Permit exported', 'ok');
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
      const imported = parsed?.profile || parsed;
      state.profile = normalizeProfile(imported);
      await persist();
      render();
      setStatus('Permit imported', 'ok');
    } catch {
      setStatus('Invalid JSON file', 'err');
    }
  };
  input.click();
}

document.addEventListener('DOMContentLoaded', async () => {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'wp-progress') setProgress(msg.label, msg.state);
  });
  await loadProfile();
  render();
  bindFields();
  bindChoice('f_tradeChoice', 'f_trade');
  bindChoice('f_branchChoice', 'f_branch');
  $('btnFill').addEventListener('click', onFill);
  $('btnCancel').addEventListener('click', onCancel);
  $('btnNewTemplate').addEventListener('click', () => {
    openProfileDialog('create');
  });
  $('btnProfileCancel').addEventListener('click', closeProfileDialog);
  $('btnProfileConfirm').addEventListener('click', confirmProfileDialog);
  $('profileNameInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') confirmProfileDialog();
    if (event.key === 'Escape') closeProfileDialog();
  });
  $('profileDialog').addEventListener('click', (event) => {
    if (event.target === $('profileDialog')) closeProfileDialog();
  });
  document.addEventListener('click', (event) => {
    if (event.target === $('f_permitType')) return;
    if (!event.target.closest('.custom-dropdown')) closeAllDropdownMenus();
  });
});
