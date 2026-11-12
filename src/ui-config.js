/* Screen 5 – Configuration */
(function () {
  'use strict';
  const C = window.CANssmCore, F = window.CANssmFormats, App = window.App, h = App.h, S = App.state;
  const save = (rerender) => { App.saveSettings(); if (rerender !== false) App.render(); else App.renderChrome(); };

  const colEditor = (prof, key, defs, title) => {
    const cols = prof[key];
    const box = h('div');
    let dragIx = -1;
    cols.forEach((c, i) => {
      const row = h('div', { class: 'colrow', draggable: 'true',
        ondragstart: () => { dragIx = i; row.classList.add('dragging'); }, ondragend: () => row.classList.remove('dragging'),
        ondragover: (e) => { e.preventDefault(); row.classList.add('over'); }, ondragleave: () => row.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); row.classList.remove('over'); if (dragIx < 0 || dragIx === i) return; const [x] = cols.splice(dragIx, 1); cols.splice(i, 0, x); save(); } },
        h('span', { class: 'drag', title: 'Drag to reorder' }, '⋮⋮'),
        h('select', { onchange: (e) => { c.field = e.target.value; save(); } }, defs.map(([f, d]) => h('option', { value: f, selected: f === c.field }, d))),
        h('input', { value: c.header, placeholder: 'Column header', onchange: (e) => { c.header = e.target.value; save(false); renderPreview(); } }),
        h('span', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } },
          h('input', { type: 'checkbox', checked: c.visible, title: 'Visible in export', onchange: (e) => { c.visible = e.target.checked; save(false); renderPreview(); } }),
          h('button', { class: 'btn sm icon danger', title: 'Remove column', onclick: () => { cols.splice(i, 1); save(); } }, '✕')));
      box.append(row);
    });
    const missing = defs.filter(([f]) => !cols.some(c => c.field === f));
    return h('div', { class: 'card' }, h('div', { class: 'ch' }, title, h('small', null, 'field → header text · drag to reorder · tick = visible')),
      h('div', { class: 'cb' },
        h('div', { class: 'colrow', style: { fontWeight: 600, color: 'var(--text2)' } }, h('span'), h('span', null, 'Field'), h('span', null, 'Header in XLSX (any language)'), h('span', null, 'Show')),
        box,
        missing.length ? h('div', { class: 'row', style: { marginTop: '8px' } }, 'Add column:', missing.map(([f, d]) => h('button', { class: 'btn sm', onclick: () => { cols.push({ field: f, header: d, visible: true }); save(); } }, '+ ' + d))) : null));
  };

  let renderPreview = () => { };

  App.renderers.config = () => {
    const st = App.settings, prof = App.profile();
    const page = h('div', { class: 'page' }, h('div', { class: 'page-h' }, h('h1', null, 'Configuration')));
    // ---- profiles
    const profSel = h('select', { onchange: (e) => { st.activeProfile = e.target.value; save(); } }, st.profiles.map(p => h('option', { value: p.id, selected: p.id === prof.id }, p.name)));
    const exportProfile = () => App.saveFile(F.sanitize(prof.name) + '.canssm-profile.json', JSON.stringify(Object.assign({ format: 'canssm-xlsx-profile' }, prof), null, 1), 'json');
    const importProfile = async () => {
      const f = await App.openFile(['json']); if (!f) return;
      try { const p = JSON.parse(App.text(f.bytes)); if (p.format !== 'canssm-xlsx-profile' || !p.msgCols || !p.sigCols) throw new Error('Not a CANssm profile file');
        delete p.format; p.id = C.uid('p'); if (st.profiles.some(x => x.name === p.name)) p.name += ' (imported)'; st.profiles.push(p); st.activeProfile = p.id; save(); App.toast('Profile imported'); }
      catch (e) { App.modal('Import failed', String(e.message || e)); }
    };
    const preview = h('div', { class: 'tbl-wrap', style: { maxHeight: '320px' } });
    renderPreview = () => {
      preview.innerHTML = '';
      const aoa = F.xlsxAoa(S.project.buses, prof, st.conv);
      const msgEnd = aoa.findIndex((r, i) => i > 1 && !r.length);
      const rows = aoa.slice(0, Math.min(msgEnd, 5)).concat([['…']], aoa.slice(msgEnd, msgEnd + 6));
      const width = Math.max(...aoa.map(r => r.length));
      preview.append(h('table', { class: 't' }, rows.map((r, i) => h('tr', null, Array.from({ length: width }, (_, k) => {
        const v = r[k], isTitle = r.length === 1 && v !== '…', isHdr = i > 0 && (rows[i - 1].length === 1 && rows[i - 1][0] !== '…');
        return h(isHdr ? 'th' : 'td', { class: isTitle ? '' : 'ro', style: isTitle ? { fontWeight: 700, color: 'var(--accent)' } : null }, v == null ? '' : String(v));
      })))));
    };
    page.append(h('div', { class: 'card' }, h('div', { class: 'ch' }, 'XLSX localized format ', h('small', null, 'used for both XLSX export and import')),
      h('div', { class: 'cb' },
        h('div', { class: 'row' }, h('label', { class: 'f' }, h('span', null, 'Active profile'), profSel),
          h('button', { class: 'btn sm', onclick: () => { const p = F.defaultProfile('New profile ' + (st.profiles.length + 1)); st.profiles.push(p); st.activeProfile = p.id; save(); } }, '+ New'),
          h('button', { class: 'btn sm', onclick: () => { const p = JSON.parse(JSON.stringify(prof)); p.id = C.uid('p'); p.name += ' (copy)'; st.profiles.push(p); st.activeProfile = p.id; save(); } }, 'Duplicate'),
          h('button', { class: 'btn sm danger', disabled: st.profiles.length < 2, onclick: async () => { if (await App.modal('Delete profile', `Delete "${prof.name}"?`, [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true }])) { st.profiles = st.profiles.filter(p => p !== prof); st.activeProfile = st.profiles[0].id; save(); } } }, 'Delete'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm', onclick: importProfile }, 'Import profile…'), h('button', { class: 'btn sm', onclick: exportProfile }, 'Export profile…')),
        h('br'),
        h('div', { class: 'grid-form' },
          h('label', { class: 'f' }, h('span', null, 'Profile name'), h('input', { value: prof.name, onchange: (e) => { prof.name = e.target.value || 'Profile'; save(); } })),
          h('label', { class: 'f' }, h('span', null, 'Sheet name'), h('input', { value: prof.sheetName, onchange: (e) => { prof.sheetName = e.target.value || 'Specification'; save(false); } })),
          h('label', { class: 'f' }, h('span', null, 'Section 1 title (PDU level)'), h('input', { value: prof.msgTitle, onchange: (e) => { prof.msgTitle = e.target.value || 'CAN Message'; save(false); renderPreview(); } })),
          h('label', { class: 'f' }, h('span', null, 'Section 2 title (signal level)'), h('input', { value: prof.sigTitle, onchange: (e) => { prof.sigTitle = e.target.value || 'Signal'; save(false); renderPreview(); } }))),
        h('p', { class: 'faint' }, 'Value formats: ID as 0xXXX (standard) / 0xXXXXXXXX (extended); byte order as "Motorola" / "Intel"; start bit follows the convention below. On import, headers are matched by these names (default English names are also recognised).'))),
      h('div', { class: 'cols-ed' }, colEditor(prof, 'msgCols', F.MSG_FIELDS, 'Section 1 – ' + prof.msgTitle + ' '), colEditor(prof, 'sigCols', F.SIG_FIELDS, 'Section 2 – ' + prof.sigTitle + ' ')),
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Preview ', h('small', null, 'first rows of the flat sheet with the current project'), h('span', { class: 'spacer' }), h('button', { class: 'btn sm primary', onclick: () => App.exportFmt('xlsx') }, 'Export XLSX…')), h('div', { class: 'cb' }, preview)));
    renderPreview();

    // ---- app settings
    const num = (k, label, step) => h('label', { class: 'f' }, h('span', null, label), h('input', { type: 'number', step: step || 1, value: st[k], onchange: (e) => { const v = +e.target.value; if (Number.isFinite(v)) { st[k] = v; save(false); } } }));
    page.append(h('div', { class: 'card' }, h('div', { class: 'ch' }, 'App settings'),
      h('div', { class: 'cb', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('div', null, h('b', null, 'Motorola start-bit convention'),
          h('div', { class: 'row', style: { marginTop: '6px' } },
            h('label', { class: 'row' }, h('input', { type: 'radio', name: 'conv', checked: st.conv === 'MSB', onchange: () => { st.conv = 'MSB'; save(); } }), 'Start bit = MSB position (DBC / Vector, default)'),
            h('label', { class: 'row' }, h('input', { type: 'radio', name: 'conv', checked: st.conv === 'LSB', onchange: () => { st.conv = 'LSB'; save(); } }), 'Start bit = LSB position')),
          h('p', { class: 'faint' }, 'Affects how Motorola start bits are shown and typed in tables and in XLSX. Signals are stored once internally; DBC and ARXML always use their own (MSB-based) convention.')),
        h('div', { class: 'grid-form' },
          num('amber', 'Bus load amber at (%)'), num('red', 'Bus load red at (%)'),
          num('defBitrate', 'Default nominal bitrate (bit/s)'), num('defDataBitrate', 'Default data bitrate (bit/s)'),
          num('simSpeed', 'Default simulation speed (bit/s)', 'any'),
          h('label', { class: 'f' }, h('span', null, 'Theme'), h('select', { onchange: (e) => { st.theme = e.target.value; save(false); App.applyTheme(); App.render(); } },
            App.THEMES.map(([v, l]) => h('option', { value: v, selected: st.theme === v }, l))))),
        h('div', { class: 'row' }, h('button', { class: 'btn sm danger', onclick: async () => { if (await App.modal('Reset settings', 'Reset all settings and XLSX profiles to defaults?', [{ label: 'Cancel', value: false }, { label: 'Reset', value: true, primary: true }])) { localStorage.removeItem('canssm.settings'); location.reload(); } } }, 'Reset settings…'),
          h('span', { class: 'faint' }, 'Settings and profiles are stored on this computer only.')))),
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Keyboard shortcuts ', h('small', null, 'work on any keyboard layout (Thai, English, Chinese, Japanese…)')),
        h('div', { class: 'cb kv' }, ...[['Ctrl+1 … Ctrl+5', 'Switch screen'], ['Ctrl+S / Ctrl+Shift+S', 'Save / Save as'], ['Ctrl+O / Ctrl+N', 'Open / New project'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Space', 'Simulation play / pause'], ['→', 'Simulation: step to next sample point'], ['N', 'Simulation: next frame'], ['Esc', 'Simulation: stop']].flatMap(([k, v]) => [h('b', { class: 'mono' }, k), h('span', null, v)]))));
    return page;
  };
})();
