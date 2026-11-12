/* CANssm UI base: helpers, state, settings, undo, file I/O, shell */
(function () {
  'use strict';
  const C = window.CANssmCore, F = window.CANssmFormats;
  const App = window.App = {};

  // ---------- DOM helper ----------
  const h = App.h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  App.svg = (tag, attrs, ...kids) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), attrs[k]); else el.setAttribute(k, attrs[k]);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  App.esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  App.fmtNum = (v, p) => { const n = +v; if (!Number.isFinite(n)) return ''; return String(+n.toPrecision(p || 10)); };
  App.sigColor = (i, a) => `hsl(${(i * 137.508 + 205) % 360} 68% 52% / ${a == null ? 1 : a})`;

  // ---------- settings ----------
  const LS = { get(k, d) { try { const v = localStorage.getItem('canssm.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('canssm.' + k, JSON.stringify(v)); } catch (e) { } } };
  App.LS = LS;
  const defSettings = () => ({ conv: 'MSB', amber: 50, red: 70, defBitrate: 500000, defDataBitrate: 2000000, simSpeed: 1, theme: 'auto', loadMode: 'worst',
    profiles: [F.defaultProfile('Default – EN')], activeProfile: null });
  App.settings = Object.assign(defSettings(), LS.get('settings', {}));
  if (!App.settings.profiles || !App.settings.profiles.length) App.settings.profiles = [F.defaultProfile('Default – EN')];
  if (!App.settings.activeProfile || !App.settings.profiles.find(p => p.id === App.settings.activeProfile)) App.settings.activeProfile = App.settings.profiles[0].id;
  App.saveSettings = () => LS.set('settings', App.settings);
  App.profile = () => App.settings.profiles.find(p => p.id === App.settings.activeProfile) || App.settings.profiles[0];
  App.applyTheme = () => {
    const t = App.settings.theme;
    document.documentElement.dataset.theme = t === 'auto' ? ((window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light') : t;
  };

  // ---------- state ----------
  App.state = { project: null, sel: { bus: null, msg: null, sig: null }, screen: 'spec', filePath: null, dirty: false };
  const S = App.state;
  App.bus = () => S.project.buses.find(b => b.id === S.sel.bus) || S.project.buses[0] || null;
  App.msg = () => { const b = App.bus(); return b && b.messages.find(m => m.id === S.sel.msg) || null; };
  App.sig = () => { const m = App.msg(); return m && m.signals.find(s => s.id === S.sel.sig) || null; };
  App.select = (bus, msg, sig) => { S.sel = { bus: bus || null, msg: msg || null, sig: sig || null }; App.render(); };
  App.find = (sigId) => { for (const b of S.project.buses) for (const m of b.messages) for (const s of m.signals) if (s.id === sigId) return { b, m, s }; return null; };
  App.ensureSel = () => {
    const p = S.project; if (!p.buses.length) { S.sel = { bus: null, msg: null, sig: null }; return; }
    if (!S.sel.bus || !p.buses.find(b => b.id === S.sel.bus)) { S.sel.bus = p.buses[0].id; S.sel.msg = null; S.sel.sig = null; }
    const bb = App.bus();
    if (S.sel.msg && !bb.messages.find(m => m.id === S.sel.msg)) { S.sel.msg = null; S.sel.sig = null; }
    const m = App.msg(); if (S.sel.sig && (!m || !m.signals.find(s => s.id === S.sel.sig))) S.sel.sig = null;
  };

  // ---------- undo ----------
  const undo = [], redo = [];
  App.edit = (fn, opts) => {
    undo.push(JSON.stringify(S.project)); if (undo.length > 150) undo.shift(); redo.length = 0;
    fn(); S.dirty = true; App.autosave();
    if (!(opts && opts.norender)) App.render(); else App.renderChrome();
  };
  App.undo = () => { if (!undo.length) return; redo.push(JSON.stringify(S.project)); S.project = JSON.parse(undo.pop()); S.dirty = true; App.autosave(); App.ensureSel(); App.render(); };
  App.redo = () => { if (!redo.length) return; undo.push(JSON.stringify(S.project)); S.project = JSON.parse(redo.pop()); S.dirty = true; App.autosave(); App.ensureSel(); App.render(); };
  App.canUndo = () => undo.length > 0; App.canRedo = () => redo.length > 0;
  let asTimer = null;
  App.autosave = () => { clearTimeout(asTimer); asTimer = setTimeout(() => LS.set('autosave', { project: S.project, filePath: S.filePath, t: Date.now() }), 400); };
  App.loadProject = (p, filePath) => {
    undo.length = 0; redo.length = 0; S.project = App.normalize(p); S.filePath = filePath || null; S.dirty = false;
    S.sel = { bus: null, msg: null, sig: null }; App.ensureSel(); App.autosave(); App.render();
    if (App.sim) App.sim.reset();
  };
  App.normalize = (p) => {
    p.buses = p.buses || [];
    for (const b of p.buses) {
      const d = C.newBus(b.name);
      for (const k in d) if (b[k] === undefined) b[k] = d[k];
      if (!b.timing || !b.timing.nominal) b.timing = { nominal: C.defaultTiming(b.bitrate), data: C.defaultTiming(b.dataBitrate) };
      if (!b.timing.data) b.timing.data = C.defaultTiming(b.dataBitrate);
      for (const n of b.nodes) { const dn = C.newNode(); for (const k in dn) if (n[k] === undefined) n[k] = dn[k]; }
      for (const m of b.messages) {
        const dm = C.newMessage(); for (const k in dm) if (m[k] === undefined) m[k] = dm[k];
        for (const s of m.signals) { const ds = C.newSignal(); for (const k in ds) if (s[k] === undefined) s[k] = ds[k]; }
      }
    }
    return p;
  };

  // ---------- file I/O (Electron bridge or browser fallback) ----------
  const bridge = window.canssmNative || null;
  App.native = !!bridge;
  App.openFile = (accept) => new Promise((resolve) => {
    if (bridge) { bridge.openFile(accept).then(r => resolve(r && { name: r.name, path: r.path, bytes: new Uint8Array(r.bytes) })); return; }
    const inp = h('input', { type: 'file', accept: accept.map(a => '.' + a).join(',') });
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return resolve(null); resolve({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) }); };
    inp.click();
  });
  App.saveFile = async (name, data, ext, pathHint) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    if (bridge) return bridge.saveFile({ name, ext, bytes: Array.from ? bytes : bytes, path: pathHint || null });
    const url = URL.createObjectURL(new Blob([bytes]));
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return name;
  };
  App.text = (bytes) => {
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes.slice(3));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  };
  App.baseName = (n) => String(n || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

  // ---------- toast / modal ----------
  App.toast = (msg, ms) => {
    const t = h('div', { class: 'toast' }, msg); document.body.append(t);
    setTimeout(() => t.remove(), ms || 2600);
  };
  App.modal = (title, body, buttons) => new Promise((resolve) => {
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const bg = h('div', { class: 'modal-bg', onmousedown: (e) => { if (e.target === bg) close(null); } },
      h('div', { class: 'modal' }, h('div', { class: 'mh' }, title), h('div', { class: 'mb' }, body),
        h('div', { class: 'mf' }, (buttons || [{ label: 'OK', value: true, primary: true }]).map(b => h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => close(b.value) }, b.label)))));
    document.body.append(bg); document.addEventListener('keydown', onKey);
  });
  App.reportView = (rep) => h('div', null,
    h('p', null, `Messages: ${rep.messages} · Signals: ${rep.signals}`),
    rep.warnings.length ? h('div', null, h('b', null, 'Warnings'), h('ul', null, rep.warnings.slice(0, 50).map(w => h('li', null, w)))) : null,
    rep.skipped.length ? h('div', null, h('b', null, 'Skipped'), h('ul', null, rep.skipped.slice(0, 50).map(w => h('li', null, w)))) : null,
    !rep.warnings.length && !rep.skipped.length ? h('p', { class: 'muted' }, 'Nothing was skipped.') : null);

  // ---------- project actions ----------
  App.newProject = async () => {
    if (S.dirty && !(await App.modal('New project', 'Discard unsaved changes?', [{ label: 'Cancel', value: false }, { label: 'Discard', value: true, primary: true }]))) return;
    const p = C.newProject(); const b = C.newBus('CAN1'); b.bitrate = App.settings.defBitrate; b.dataBitrate = App.settings.defDataBitrate;
    b.timing = { nominal: C.defaultTiming(b.bitrate), data: C.defaultTiming(b.dataBitrate) };
    b.nodes = [Object.assign(C.newNode('OurNode', 0), { ours: true })];
    p.buses.push(b); App.loadProject(p);
  };
  App.openProject = async () => {
    const f = await App.openFile(['canssm', 'json']); if (!f) return;
    try { const p = JSON.parse(App.text(f.bytes)); if (p.format !== 'canssm-project') throw new Error('Not a CANssm project file'); App.loadProject(p, f.path); App.toast('Opened ' + f.name); }
    catch (e) { App.modal('Open failed', String(e.message || e)); }
  };
  App.saveProject = async (as) => {
    const name = (F.sanitize(S.project.name) || 'project') + '.canssm';
    const r = await App.saveFile(name, JSON.stringify(S.project, null, 1), 'canssm', as ? null : S.filePath);
    if (r) { if (App.native) S.filePath = r; S.dirty = false; App.autosave(); App.renderChrome(); App.toast('Saved ' + App.baseName(r) + (App.native ? ' (backup kept as .bak)' : '')); }
  };
  App.mergeBuses = async (buses, rep, label) => {
    const choice = await App.modal(label + ' – import report', h('div', null, App.reportView(rep),
      h('p', { class: 'muted' }, 'Add the imported bus(es) to this project, or replace a bus with the same name?')),
      [{ label: 'Cancel', value: null }, { label: 'Replace same-name bus', value: 'replace' }, { label: 'Add', value: 'add', primary: true }]);
    if (!choice) return;
    App.edit(() => {
      for (const nb of buses) {
        const ix = S.project.buses.findIndex(b => b.name === nb.name);
        if (choice === 'replace' && ix >= 0) { nb.id = S.project.buses[ix].id; S.project.buses[ix] = nb; }
        else { if (ix >= 0) nb.name = nb.name + '_imported'; S.project.buses.push(nb); }
      }
      if (S.project.name === 'Untitled' && buses[0]) S.project.name = buses[0].name;
      S.sel = { bus: buses[0] ? buses[0].id : null, msg: null, sig: null };
    });
  };
  App.importFmt = async (fmt) => {
    const ext = { dbc: ['dbc'], arxml: ['arxml', 'xml'], xlsx: ['xlsx', 'xls'] }[fmt];
    const f = await App.openFile(ext); if (!f) return;
    try {
      if (fmt === 'dbc') { const r = F.dbcImport(App.text(f.bytes), App.baseName(f.name)); await App.mergeBuses([r.bus], r.report, 'DBC'); }
      else if (fmt === 'arxml') { const r = F.arxmlImport(App.text(f.bytes)); await App.mergeBuses(r.buses, r.report, 'ARXML'); }
      else if (fmt === 'xlsx') await App.importXlsx(f);
    } catch (e) { console.error(e); App.modal('Import failed', String(e.message || e)); }
  };
  App.importXlsx = async (f) => {
    const wb = XLSX.read(f.bytes, { type: 'array' });
    let prof = App.profile();
    const sheetSel = h('select', null, wb.SheetNames.map(n => h('option', { value: n }, n)));
    const profSel = h('select', null, App.settings.profiles.map(p => h('option', { value: p.id, selected: p.id === prof.id }, p.name)));
    const prev = h('div');
    const analyze = () => {
      prof = App.settings.profiles.find(p => p.id === profSel.value);
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetSel.value], { header: 1, defval: '' });
      const an = F.xlsxAnalyze(aoa, prof); prev.innerHTML = '';
      if (!an.ok) { prev.append(h('p', { class: 'lvl-error' }, `Section titles "${prof.msgTitle}" / "${prof.sigTitle}" not found in column A of this sheet.`)); return null; }
      const mapTbl = (title, map) => h('div', null, h('b', null, title),
        h('table', { class: 't' }, h('tr', null, h('th', null, 'Column header in file'), h('th', null, 'Mapped to')),
          map.filter(x => x.header !== '').map(x => h('tr', null, h('td', { class: 'ro' }, String(x.header)), h('td', { class: 'ro ' + (x.field ? '' : 'lvl-warn') }, x.field || 'not mapped (ignored)')))));
      prev.append(h('p', null, `${an.msgRows.length} message rows, ${an.sigRows.length} signal rows found.`),
        h('div', { class: 'cols-ed' }, mapTbl(prof.msgTitle, an.msgMap), mapTbl(prof.sigTitle, an.sigMap)));
      return an;
    };
    sheetSel.onchange = analyze; profSel.onchange = analyze;
    const body = h('div', null, h('div', { class: 'row' }, h('label', { class: 'f' }, h('span', null, 'Sheet'), sheetSel), h('label', { class: 'f' }, h('span', null, 'Localized format profile'), profSel)), h('br'), prev);
    let an = analyze();
    const ok = await App.modal('Import XLSX – column matching preview', body, [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }]);
    an = an && analyze();
    if (!ok || !an) return;
    const r = F.xlsxImport(an, App.settings.conv, S.project.buses);
    await App.mergeBuses(r.buses, r.report, 'XLSX');
  };
  App.exportFmt = async (fmt) => {
    const p = S.project, b = App.bus();
    try {
      if (fmt === 'dbc') { if (!b) return; await App.saveFile(F.sanitize(b.name) + '.dbc', F.dbcExport(b), 'dbc'); }
      else if (fmt === 'arxml') await App.saveFile(F.sanitize(p.name) + '.arxml', F.arxmlExport(p), 'arxml');
      else if (fmt === 'a2l') await App.saveFile(F.sanitize(p.name) + '.a2l', F.a2lExport(p), 'a2l');
      else if (fmt === 'xlsx') await App.saveFile(F.sanitize(p.name) + '.xlsx', F.xlsxExport(XLSX, p.buses, App.profile(), App.settings.conv), 'xlsx');
      App.toast('Exported ' + fmt.toUpperCase());
    } catch (e) { console.error(e); App.modal('Export failed', String(e.message || e)); }
  };

  // ---------- shell ----------
  const ICON = {
    spec: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
    bitmap: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
    byteorder: '<path d="M4 7h11l-3-3M20 17H9l3 3"/><path d="M4 12h16" opacity=".4"/>',
    sim: '<path d="M2 16h20"/><path d="M6 16V8M12 16v-5M18 16V9"/><circle cx="6" cy="6" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="18" cy="7" r="2"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };
  const icon = (k) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', 18); s.setAttribute('height', 18); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = ICON[k]; return s; };
  App.SCREENS = [['spec', 'Specification'], ['bitmap', 'Bit Mapping'], ['byteorder', 'Byte Order View'], ['sim', 'Bus Simulation'], ['config', 'Configuration']];
  App.renderers = {};

  const logo = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', 24); s.setAttribute('height', 24); s.setAttribute('viewBox', '0 0 32 32');
    s.innerHTML = '<rect class="logo-bg" width="32" height="32" rx="8"/><path d="M5 22h22" stroke="#fff" stroke-opacity=".45" stroke-width="2"/><path d="M5 22v-6h4v6M11 22v-11h4v11M17 22v-6h4v6M23 22v-11h4v11" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>'; return s; };
  const TI = {
    new: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
    open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    imp: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>', exp: '<path d="M12 15V3M7 8l5-5 5 5M4 19h16"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>', sample: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>'
  };
  const ti = (k, sz) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', sz || 16); s.setAttribute('height', sz || 16); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = TI[k]; return s; };
  App.THEMES = [['auto', 'Follow Windows', ['#f6f7fb', '#111219', '#6b5cf6']], ['light', 'Light', ['#f6f7fb', '#ffffff', '#6b5cf6']], ['dark', 'Dark', ['#111219', '#1f212c', '#8b7dff']],
    ['navy', 'Midnight Navy', ['#08132c', '#112146', '#4d8dff']], ['sage', 'Sage', ['#eef2ea', '#f9fbf6', '#3f8a4f']], ['ember', 'Ember', ['#150d09', '#261912', '#f2783a']]];

  const menu = (label, items, opts) => {
    const wrap = h('div', { class: 'menu' });
    const btn = h('button', { class: 'btn' + (opts && opts.primary ? ' primary' : ''), title: opts && opts.title || null, onclick: (e) => { e.stopPropagation(); document.querySelectorAll('.menu.open').forEach(m => m !== wrap && m.classList.remove('open')); wrap.classList.toggle('open'); } }, label, h('span', { style: { opacity: .6, fontSize: '10px' } }, '▾'));
    wrap.append(btn, h('div', { class: 'dd' + (opts && opts.right ? ' right' : ''), onclick: (e) => e.stopPropagation() }, items.map((it) => {
      if (typeof it === 'string') return h('div', { class: 'ddl' }, it);
      if (it.nodeType) return it;
      const [l, f, sm] = it; return h('button', { onclick: () => { wrap.classList.remove('open'); f(); } }, l, sm ? h('small', null, sm) : null);
    })));
    return wrap;
  };
  document.addEventListener('click', () => document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')));
  App.setTheme = (k) => { App.settings.theme = k; App.saveSettings(); App.applyTheme(); App.render(); };
  const themeMenu = () => {
    const wrap = menu([ti('theme'), 'Theme'], [], { right: true, title: 'Change theme' });
    const dd = wrap.querySelector('.dd');
    const fill = () => { dd.innerHTML = ''; dd.append(h('div', { class: 'ddl' }, 'Theme'), ...App.THEMES.map(([k, l, c]) => h('button', { class: App.settings.theme === k ? 'cur' : '', onclick: () => { wrap.classList.remove('open'); App.setTheme(k); } },
      h('span', { class: 'tsw' }, c.map(x => h('i', { style: { background: x } }))), l, App.settings.theme === k ? h('small', null, '✓') : null))); };
    wrap.firstChild.addEventListener('click', fill); fill();
    return wrap;
  };

  App.buildShell = () => {
    const root = document.getElementById('app'); root.innerHTML = '';
    App.el = {};
    const pn = h('input', { class: 'projname', value: S.project.name, title: 'Project name', onchange: (e) => App.edit(() => { S.project.name = e.target.value || 'Untitled'; }, { norender: true }) });
    App.el.projname = pn;
    App.el.undo = h('button', { class: 'btn icon', title: 'Undo (Ctrl+Z)', onclick: App.undo }, ti('undo'));
    App.el.redo = h('button', { class: 'btn icon', title: 'Redo (Ctrl+Y)', onclick: App.redo }, ti('redo'));
    App.el.save = h('button', { class: 'btn icon', title: 'Save project (Ctrl+S)', onclick: () => App.saveProject() }, ti('save'));
    const header = h('header', null,
      h('div', { class: 'brand' }, logo(), 'CANssm'), pn, h('span', { class: 'hsep' }),
      h('button', { class: 'btn icon', title: 'New project (Ctrl+N)', onclick: App.newProject }, ti('new')),
      h('button', { class: 'btn icon', title: 'Open project (Ctrl+O)', onclick: App.openProject }, ti('open')),
      App.el.save,
      menu('⋯', ['Project', ['Save as…', () => App.saveProject(true), 'Ctrl+Shift+S'], ['Load sample project', () => App.loadProject(window.CANssmSample())]], { title: 'More' }),
      h('span', { class: 'hsep' }),
      menu([ti('imp'), 'Import'], ['Import into project', ['DBC…', () => App.importFmt('dbc'), '.dbc'], ['ARXML…', () => App.importFmt('arxml'), '.arxml'], ['XLSX (localized)…', () => App.importFmt('xlsx'), '.xlsx']]),
      menu([ti('exp'), 'Export file'], ['Export', ['DBC – selected bus', () => App.exportFmt('dbc'), '.dbc'], ['ARXML – AUTOSAR 4.3', () => App.exportFmt('arxml'), '.arxml'], ['XLSX – localized profile', () => App.exportFmt('xlsx'), '.xlsx'], ['A2L – measurements', () => App.exportFmt('a2l'), '.a2l']], { primary: true }),
      h('span', { class: 'hsep' }), App.el.undo, App.el.redo,
      h('div', { class: 'spacer' }), themeMenu());
    const nav = h('nav', null, h('div', { class: 'navlbl' }, 'Views'));
    App.SCREENS.forEach(([k, label], i) => nav.append(h('button', { 'data-k': k, onclick: () => App.go(k) }, icon(k), label, h('kbd', null, '^' + (i + 1)))));
    nav.append(h('div', { class: 'navsep' }), h('div', { class: 'navfoot' }, 'CANssm v1.0'));
    App.el.nav = nav;
    App.el.main = h('main');
    App.el.footer = h('footer');
    root.append(header, nav, App.el.main, App.el.footer);
  };
  App.go = (k) => { if (S.screen === 'sim' && k !== 'sim' && App.sim) App.sim.pause(); S.screen = k; App.render(); App.el.main.scrollTop = 0; };

  App.renderChrome = () => {
    if (!App.el) return;
    App.el.projname.value = S.project.name;
    App.el.undo.disabled = !App.canUndo(); App.el.redo.disabled = !App.canRedo();
    App.el.save.classList.toggle('on', S.dirty); App.el.save.title = S.dirty ? 'Save project (Ctrl+S) – unsaved changes' : 'Save project (Ctrl+S)';
    document.title = (S.dirty ? '• ' : '') + S.project.name + ' – CANssm';
    App.el.nav.querySelectorAll('button[data-k]').forEach(b => b.classList.toggle('active', b.dataset.k === S.screen));
    // footer
    const f = App.el.footer; f.innerHTML = '';
    for (const b of S.project.buses) {
      const L = C.busLoad(b, App.settings.loadMode).total * 100;
      const col = L >= App.settings.red ? 'var(--err)' : L >= App.settings.amber ? 'var(--warn)' : 'var(--ok)';
      f.append(h('span', { class: 'loadpill', title: `${b.name}: ${App.settings.loadMode === 'worst' ? 'worst-case' : 'actual-value'} bus load` },
        h('b', null, b.name), h('span', { class: 'loadbar' }, h('i', { style: { width: Math.min(100, L) + '%', background: col } })), h('span', { style: { color: col } }, L.toFixed(1) + '%')));
    }
    const v = C.validate(S.project); const ne = v.filter(x => x.level === 'error').length, nw = v.length - ne;
    const ours = (App.bus() && App.bus().nodes.find(n => n.ours));
    f.append(h('span', { class: 'spacer' }),
      ours ? h('span', null, '★ Our node: ', h('b', null, ours.name)) : null,
      h('span', { class: ne ? 'lvl-error' : nw ? 'lvl-warn' : '' }, ne + nw ? `${ne} errors · ${nw} warnings` : '✓ No issues'),
      h('span', { class: 'faint' }, `Start bit: ${App.settings.conv} · ${App.profile().name}`),
      h('span', { class: 'offline' }, h('i'), 'Offline · nothing is uploaded · autosaved locally'));
  };
  App.render = () => {
    App.ensureSel();
    App.renderChrome();
    const main = App.el.main, st = main.scrollTop;
    const r = App.renderers[S.screen];
    if (S.screen !== 'sim' && App.sim) App.sim.detach();
    main.innerHTML = '';
    main.append(r ? r() : h('div', { class: 'empty' }, 'Not available'));
    main.scrollTop = st;
  };

  // keyboard (layout-independent via e.code)
  document.addEventListener('keydown', (e) => {
    const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ' && !e.shiftKey && !inField) { e.preventDefault(); App.undo(); }
    else if (mod && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) && !inField) { e.preventDefault(); App.redo(); }
    else if (mod && e.code === 'KeyS') { e.preventDefault(); App.saveProject(e.shiftKey); }
    else if (mod && e.code === 'KeyO') { e.preventDefault(); App.openProject(); }
    else if (mod && e.code === 'KeyN') { e.preventDefault(); App.newProject(); }
    else if (mod && /^Digit[1-5]$/.test(e.code)) { e.preventDefault(); App.go(App.SCREENS[+e.code.slice(5) - 1][0]); }
    else if (S.screen === 'sim' && App.sim && !inField && !mod) App.sim.key(e);
  });
  window.addEventListener('beforeunload', (e) => { if (S.dirty && !App.native) { e.preventDefault(); e.returnValue = ''; } });

  App.start = () => {
    App.applyTheme();
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { App.applyTheme(); App.render(); });
    const as = LS.get('autosave', null);
    S.project = App.normalize(as && as.project ? as.project : window.CANssmSample());
    S.filePath = as && as.filePath || null;
    App.ensureSel();
    App.buildShell();
    App.render();
    if (bridge && bridge.onBeforeClose) bridge.onBeforeClose(async () => {
      if (!S.dirty) return true;
      const r = await App.modal('Unsaved changes', 'Save changes before closing?', [{ label: 'Cancel', value: 'cancel' }, { label: 'Close without saving', value: 'discard' }, { label: 'Save', value: 'save', primary: true }]);
      if (r === 'save') { await App.saveProject(); return !S.dirty; }
      return r === 'discard';
    });
  };
})();
