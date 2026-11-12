/* Screen 1 – Specification */
(function () {
  'use strict';
  const C = window.CANssmCore, F = window.CANssmFormats, App = window.App, h = App.h, S = App.state;
  S.open = S.open || new Set(); S.specMode = 'table'; S.treeFilter = ''; S.sort = {};

  App.softRender = () => setTimeout(() => {
    const a = document.activeElement, fk = a && a.dataset && a.dataset.fk;
    App.render();
    if (fk) { const el = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (el) { el.focus(); if (el.select && el.type !== 'checkbox') try { el.select(); } catch (e) { } } }
  }, 0);
  const change = (fn) => { App.edit(fn, { norender: true }); App.softRender(); };

  // ---------- generic editable table ----------
  const cell = (tk, row, col) => {
    const fk = `${tk}:${row.id}:${col.key}`;
    const v = col.get(row);
    if (col.type === 'ro') return h('td', { class: 'ro' + (col.mono ? ' mono' : '') }, v);
    if (col.type === 'html') return h('td', { class: col.cls || 'ro' }, v);
    if (col.type === 'check') return h('td', { style: { textAlign: 'center' } }, h('input', { type: 'checkbox', 'data-fk': fk, checked: !!v, disabled: col.disabled && col.disabled(row), onchange: (e) => change(() => col.set(row, e.target.checked)) }));
    if (col.type === 'select') return h('td', null, h('select', { 'data-fk': fk, onchange: (e) => change(() => col.set(row, e.target.value)) },
      (typeof col.options === 'function' ? col.options(row) : col.options).map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return h('option', { value: val, selected: String(val) === String(v) }, lab); })));
    return h('td', null, h('input', {
      'data-fk': fk, value: v == null ? '' : v, class: col.mono ? 'mono' : null, style: col.w ? { minWidth: col.w + 'px' } : null, title: col.title ? col.title(row) : null,
      onchange: (e) => {
        let val = e.target.value;
        if (col.type === 'num') { val = val.trim() === '' ? 0 : Number(val.replace(',', '.')); if (!Number.isFinite(val)) { e.target.value = v; App.toast('Not a number'); return; } }
        change(() => col.set(row, val));
      },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }
    }));
  };
  App.table = (tk, cols, rows, opts) => {
    opts = opts || {};
    const sort = S.sort[tk];
    if (sort) {
      const col = cols.find(c => c.key === sort.key);
      if (col) {
        const key = col.sortVal || col.get;
        rows = rows.slice().sort((a, b) => { const x = key(a), y = key(b); const r = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return sort.dir * r; });
      }
    }
    const thead = h('tr', null, cols.map(c => h('th', {
      class: c.nosort ? null : 'sortable', title: c.tip || null,
      onclick: c.nosort ? null : () => { const cur = S.sort[tk]; S.sort[tk] = cur && cur.key === c.key ? (cur.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }; App.render(); }
    }, c.label, sort && sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')));
    return h('div', { class: 'tbl-wrap', style: opts.maxH ? { maxHeight: opts.maxH } : null },
      h('table', { class: 't' }, h('thead', null, thead),
        h('tbody', null, rows.map(r => h('tr', { class: opts.selected && opts.selected(r) ? 'sel' : null, onclick: opts.onRow ? (e) => { if (!/INPUT|SELECT|BUTTON/.test(e.target.tagName)) opts.onRow(r); } : null },
          cols.map(c => cell(tk, r, c)))))));
  };

  const list = (v) => String(v || '').split(/[,;\s]+/).filter(Boolean);
  const nodeOpts = (b) => [['', '—']].concat(b.nodes.map(n => [n.name, n.name]));
  const conv = () => App.settings.conv;

  // ---------- column defs ----------
  App.msgCols = (b, withOpen) => [
    withOpen ? { key: 'open', label: '', nosort: true, type: 'html', cls: 'act', get: (m) => h('button', { class: 'btn sm', onclick: () => App.select(b.id, m.id) }, 'Open') } : null,
    { key: 'name', label: 'Name', get: m => m.name, set: (m, v) => m.name = F.sanitize(v), w: 120 },
    { key: 'id', label: 'ID', mono: true, get: m => C.fmtId(m), sortVal: m => m.canId, set: (m, v) => { const n = C.parseId(v); if (Number.isFinite(n)) { m.canId = n; if (n > 0x7FF) m.extended = true; } }, w: 90 },
    { key: 'ext', label: 'Ext', type: 'check', tip: 'Extended 29-bit ID', get: m => m.extended, set: (m, v) => m.extended = v },
    { key: 'fd', label: 'FD', type: 'check', tip: 'CAN FD frame', get: m => m.fd, set: (m, v) => { m.fd = v; if (!v) m.dlc = Math.min(8, m.dlc); } },
    { key: 'brs', label: 'BRS', type: 'check', tip: 'Bit-rate switch', get: m => m.fd && m.brs, disabled: m => !m.fd, set: (m, v) => m.brs = v },
    { key: 'dlc', label: 'DLC', type: 'select', options: m => (m.fd ? C.FD_LEN : C.FD_LEN.slice(0, 9)).map((l, i) => [i, `${i}  (${l} B)`]), get: m => m.dlc, set: (m, v) => m.dlc = +v },
    { key: 'len', label: 'Bytes', type: 'ro', get: m => C.msgLen(m), sortVal: m => C.msgLen(m) },
    { key: 'cycle', label: 'Cycle (ms)', type: 'num', get: m => m.cycle, set: (m, v) => m.cycle = Math.max(0, v), w: 60 },
    { key: 'send', label: 'Send type', type: 'select', options: ['Cyclic', 'Event', 'Cyclic+Event'], get: m => m.sendType, set: (m, v) => m.sendType = v },
    { key: 'sender', label: 'Sender', type: 'select', options: () => nodeOpts(b), get: m => m.sender, set: (m, v) => m.sender = v },
    { key: 'rx', label: 'Receivers', get: m => (m.receivers || []).join(', '), set: (m, v) => { m.receivers = list(v); ensureNodes(b, m.receivers); }, w: 120, title: () => 'Comma separated node names' },
    withOpen ? { key: 'nsig', label: 'Signals', type: 'ro', get: m => m.signals.length } : null,
    { key: 'comment', label: 'Comment', get: m => m.comment, set: (m, v) => m.comment = v, w: 140 }
  ].filter(Boolean);
  const ensureNodes = (b, names) => { for (const n of names) if (n && !b.nodes.some(x => x.name === n)) b.nodes.push(C.newNode(n, b.cableLength)); };

  App.sigCols = (b, m) => [
    { key: 'clr', label: '', nosort: true, type: 'html', cls: 'act', get: (s) => h('span', { class: 'swatch', style: { background: App.sigColor(m.signals.indexOf(s)) } }) },
    { key: 'name', label: 'Name', get: s => s.name, set: (s, v) => s.name = F.sanitize(v), w: 120 },
    { key: 'start', label: 'Start', tip: `Start bit (Motorola = ${conv()} position, Intel = LSB)`, type: 'num', get: s => C.displayStart(s, conv()), set: (s, v) => s.startBit = C.fromDisplayStart(Math.max(0, v | 0), s, conv()), w: 44 },
    { key: 'len', label: 'Len', type: 'num', get: s => s.length, set: (s, v) => { const lsb = C.lsbPos(s); s.length = Math.max(1, Math.min(64, v | 0)); if (s.byteOrder === 'Motorola' && conv() === 'LSB') s.startBit = C.motorolaMsbFromLsb(lsb, s.length); }, w: 36 },
    { key: 'order', label: 'Byte order', type: 'select', options: ['Intel', 'Motorola'], get: s => s.byteOrder, set: (s, v) => C.switchByteOrder(s, v) },
    { key: 'type', label: 'Type', type: 'select', options: ['Unsigned', 'Signed', 'Float32', 'Float64'], get: s => s.valueType, set: (s, v) => { s.valueType = v; if (v === 'Float32') s.length = 32; if (v === 'Float64') s.length = 64; } },
    { key: 'factor', label: 'Factor', type: 'num', get: s => App.fmtNum(s.factor), sortVal: s => s.factor, set: (s, v) => s.factor = v || 1, w: 54 },
    { key: 'offset', label: 'Offset', type: 'num', get: s => App.fmtNum(s.offset), sortVal: s => s.offset, set: (s, v) => s.offset = v, w: 50 },
    { key: 'min', label: 'Min', type: 'num', get: s => App.fmtNum(s.min), sortVal: s => s.min, set: (s, v) => s.min = v, w: 64 },
    { key: 'max', label: 'Max', type: 'num', get: s => App.fmtNum(s.max), sortVal: s => s.max, set: (s, v) => s.max = v, w: 72 },
    { key: 'unit', label: 'Unit', get: s => s.unit, set: (s, v) => s.unit = v, w: 40 },
    { key: 'init', label: 'Initial', type: 'num', tip: 'Initial physical value (used by Bus Simulation)', get: s => App.fmtNum(s.initial), sortVal: s => s.initial, set: (s, v) => s.initial = v, w: 50 },
    { key: 'rx', label: 'Receivers', get: s => (s.receivers || []).join(', '), set: (s, v) => { s.receivers = list(v); ensureNodes(b, s.receivers); }, w: 100 },
    { key: 'vt', label: 'Value table', get: s => F.vtToText(s.valueTable), set: (s, v) => s.valueTable = F.textToVt(v), w: 120, title: () => 'e.g. 0=Off; 1=On' },
    { key: 'comment', label: 'Comment', get: s => s.comment, set: (s, v) => s.comment = v, w: 120 },
    { key: 'act', label: '', nosort: true, type: 'html', cls: 'act', get: (s) => h('span', null,
      h('button', { class: 'btn sm icon', title: 'Duplicate', onclick: () => App.edit(() => { const c = Object.assign(JSON.parse(JSON.stringify(s)), { id: C.uid('s'), name: s.name + '_copy' }); m.signals.splice(m.signals.indexOf(s) + 1, 0, c); }) }, '⧉'),
      h('button', { class: 'btn sm icon danger', title: 'Delete', onclick: () => App.edit(() => { m.signals.splice(m.signals.indexOf(s), 1); if (S.sel.sig === s.id) S.sel.sig = null; }) }, '✕')) }
  ];

  // ---------- tree ----------
  const renderTree = () => {
    const p = S.project, f = S.treeFilter.toLowerCase();
    const items = h('div', { class: 'items' });
    const match = (t) => !f || String(t).toLowerCase().includes(f);
    for (const b of p.buses) {
      const bOpen = S.open.has(b.id) || !!f || S.sel.bus === b.id && !S.open.has('c' + b.id);
      items.append(h('div', { class: 'ti' + (S.sel.bus === b.id && !S.sel.msg ? ' sel' : ''), onclick: () => App.select(b.id) },
        h('span', { class: 'tw', onclick: (e) => { e.stopPropagation(); if (bOpen) { S.open.delete(b.id); S.open.add('c' + b.id); } else { S.open.add(b.id); S.open.delete('c' + b.id); } App.render(); } }, bOpen ? '▾' : '▸'),
        h('b', { class: 'nm' }, b.name), h('span', { class: 'pill' }, b.protocol), h('span', { class: 'faint' }, b.messages.length)));
      if (!bOpen) continue;
      const msgs = b.messages.slice().sort((x, y) => x.canId - y.canId);
      for (const m of msgs) {
        const sigs = m.signals.filter(s => match(s.name));
        if (f && !match(m.name) && !match(C.fmtId(m)) && !sigs.length) continue;
        const mOpen = S.open.has(m.id) || (!!f && sigs.length > 0) || S.sel.msg === m.id;
        const el = h('div', {
          class: 'ti l1' + (S.sel.msg === m.id && !S.sel.sig ? ' sel' : ''), onclick: () => App.select(b.id, m.id), draggable: 'true',
          ondragstart: (e) => e.dataTransfer.setData('text/canssm-msg', m.id),
          ondragover: (e) => { if (e.dataTransfer.types.includes('text/canssm-sig')) { e.preventDefault(); el.classList.add('drop'); } },
          ondragleave: () => el.classList.remove('drop'),
          ondrop: (e) => { el.classList.remove('drop'); const sid = e.dataTransfer.getData('text/canssm-sig'); const fnd = App.find(sid); if (fnd && fnd.m !== m) App.edit(() => { fnd.m.signals.splice(fnd.m.signals.indexOf(fnd.s), 1); m.signals.push(fnd.s); S.sel = { bus: b.id, msg: m.id, sig: sid }; }); }
        },
          h('span', { class: 'tw', onclick: (e) => { e.stopPropagation(); S.open.has(m.id) ? S.open.delete(m.id) : S.open.add(m.id); App.render(); } }, m.signals.length ? (mOpen ? '▾' : '▸') : ''),
          h('span', { class: 'id' }, C.fmtId(m)), h('span', { class: 'nm' }, m.name), m.fd ? h('span', { class: 'pill acc' }, 'FD') : null);
        items.append(el);
        if (!mOpen) continue;
        m.signals.forEach((s, i) => {
          if (f && !match(s.name) && !match(m.name)) return;
          items.append(h('div', { class: 'ti l2' + (S.sel.sig === s.id ? ' sel' : ''), draggable: 'true', title: 'Drag onto another message to move',
            ondragstart: (e) => e.dataTransfer.setData('text/canssm-sig', s.id), onclick: () => App.select(b.id, m.id, s.id) },
            h('span', { class: 'swatch', style: { background: App.sigColor(i) } }), h('span', { class: 'nm' }, s.name), h('span', { class: 'id' }, `${C.displayStart(s, conv())}|${s.length}`)));
        });
      }
    }
    if (!p.buses.length) items.append(h('div', { class: 'empty' }, 'No bus yet. Add one or import a file.'));
    const addBus = () => App.edit(() => { const b = C.newBus('CAN' + (p.buses.length + 1)); b.bitrate = App.settings.defBitrate; b.dataBitrate = App.settings.defDataBitrate; b.timing = { nominal: C.defaultTiming(b.bitrate), data: C.defaultTiming(b.dataBitrate) }; b.nodes = [Object.assign(C.newNode('OurNode', 0), { ours: true })]; p.buses.push(b); S.sel = { bus: b.id, msg: null, sig: null }; });
    const addMsg = () => { const b = App.bus(); if (!b) return; App.edit(() => { const used = new Set(b.messages.map(m => m.canId)); let id = 0x100; while (used.has(id)) id++; const m = C.newMessage('Message_' + id.toString(16).toUpperCase(), id); m.fd = false; const ours = b.nodes.find(n => n.ours); m.sender = ours ? ours.name : ''; b.messages.push(m); S.sel = { bus: b.id, msg: m.id, sig: null }; S.open.add(b.id); }); };
    const addSig = () => { const b = App.bus(), m = App.msg(); if (!m) { App.toast('Select a message first'); return; } App.edit(() => {
      const used = new Set(); m.signals.forEach(s => C.signalPositions(s).forEach(p => used.add(p)));
      let st = 0; while (used.has(st) && st < C.msgLen(m) * 8) st++;
      const s = C.newSignal('Signal_' + (m.signals.length + 1)); s.startBit = st; s.length = Math.min(8, Math.max(1, C.msgLen(m) * 8 - st)); s.max = 2 ** s.length - 1; s.receivers = m.receivers.slice();
      m.signals.push(s); S.sel.sig = s.id; S.open.add(m.id); }); };
    const dup = () => {
      const b = App.bus(), m = App.msg(), s = App.sig();
      if (s) return App.edit(() => { const c = Object.assign(JSON.parse(JSON.stringify(s)), { id: C.uid('s'), name: s.name + '_copy' }); m.signals.push(c); S.sel.sig = c.id; });
      if (m) return App.edit(() => { const c = JSON.parse(JSON.stringify(m)); c.id = C.uid('m'); c.name += '_copy'; const used = new Set(b.messages.map(x => x.canId)); while (used.has(c.canId)) c.canId++; c.signals.forEach(x => x.id = C.uid('s')); b.messages.push(c); S.sel.msg = c.id; });
      if (b) return App.edit(() => { const c = JSON.parse(JSON.stringify(b)); c.id = C.uid('b'); c.name += '_copy'; c.messages.forEach(x => { x.id = C.uid('m'); x.signals.forEach(y => y.id = C.uid('s')); }); c.nodes.forEach(n => n.id = C.uid('n')); p.buses.push(c); S.sel = { bus: c.id, msg: null, sig: null }; });
    };
    const del = async () => {
      const b = App.bus(), m = App.msg(), s = App.sig();
      if (s) return App.edit(() => { m.signals.splice(m.signals.indexOf(s), 1); S.sel.sig = null; });
      if (m) return App.edit(() => { b.messages.splice(b.messages.indexOf(m), 1); S.sel.msg = null; });
      if (b && await App.modal('Delete bus', `Delete bus "${b.name}" with ${b.messages.length} messages?`, [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true }]))
        App.edit(() => { p.buses.splice(p.buses.indexOf(b), 1); S.sel = { bus: null, msg: null, sig: null }; });
    };
    return h('div', { class: 'card tree' },
      h('div', { class: 'tb' },
        h('input', { placeholder: 'Search name or ID…', value: S.treeFilter, 'data-fk': 'treefilter', oninput: (e) => { S.treeFilter = e.target.value; App.softRender(); } }),
        h('button', { class: 'btn sm', onclick: addBus }, '+ Bus'), h('button', { class: 'btn sm', onclick: addMsg }, '+ Msg'), h('button', { class: 'btn sm', onclick: addSig }, '+ Sig'),
        h('button', { class: 'btn sm icon', title: 'Duplicate selected', onclick: dup }, '⧉'), h('button', { class: 'btn sm icon danger', title: 'Delete selected', onclick: del }, '✕')),
      items);
  };

  // ---------- forms ----------
  const field = (label, input) => h('label', { class: 'f' }, h('span', null, label), input);
  const inp = (v, set, opts) => h('input', Object.assign({ value: v == null ? '' : v, onchange: (e) => { let x = e.target.value; if (opts && opts.num) { x = Number(x); if (!Number.isFinite(x)) { App.toast('Not a number'); e.target.value = v; return; } } change(() => set(x)); } }, opts && opts.attrs || {}));
  const sel = (v, options, set) => h('select', { onchange: (e) => change(() => set(e.target.value)) }, options.map(o => { const [a, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: a, selected: String(a) === String(v) }, l); }));

  const busView = (b) => {
    const renameNode = (n, nv) => { const old = n.name; n.name = F.sanitize(nv); for (const m of b.messages) { if (m.sender === old) m.sender = n.name; m.receivers = m.receivers.map(r => r === old ? n.name : r); m.signals.forEach(s => s.receivers = s.receivers.map(r => r === old ? n.name : r)); } };
    const nodeCols = [
      { key: 'ours', label: 'Our node', type: 'html', cls: 'act', nosort: true, get: n => h('input', { type: 'radio', name: 'ours_' + b.id, checked: n.ours, onchange: () => App.edit(() => b.nodes.forEach(x => x.ours = x === n)) }) },
      { key: 'name', label: 'Name', get: n => n.name, set: renameNode, w: 120 },
      { key: 'pos', label: 'Position (m)', type: 'num', get: n => n.position, set: (n, v) => n.position = Math.max(0, Math.min(b.cableLength, v)), w: 70 },
      { key: 'tx', label: 'Sends', type: 'ro', get: n => b.messages.filter(m => m.sender === n.name).length },
      { key: 'rx', label: 'Receives', type: 'ro', get: n => b.messages.filter(m => m.receivers.includes(n.name)).length },
      { key: 'comment', label: 'Comment', get: n => n.comment, set: (n, v) => n.comment = v, w: 180 },
      { key: 'act', label: '', type: 'html', cls: 'act', nosort: true, get: n => h('button', { class: 'btn sm icon danger', title: 'Delete node', onclick: () => App.edit(() => b.nodes.splice(b.nodes.indexOf(n), 1)) }, '✕') }
    ];
    const msgs = b.messages.slice().sort((x, y) => x.canId - y.canId);
    return [
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Bus ', h('span', { class: 'pill acc' }, b.name)),
        h('div', { class: 'cb grid-form' },
          field('Name', inp(b.name, v => b.name = F.sanitize(v))),
          field('Protocol', sel(b.protocol, ['CAN', 'CAN FD'], v => { b.protocol = v; if (v === 'CAN') b.messages.forEach(m => { m.fd = false; m.dlc = Math.min(8, m.dlc); }); })),
          field('Nominal bitrate (bit/s)', inp(b.bitrate, v => { b.bitrate = v; if (Math.abs(C.timingDerived(b.timing.nominal).bitrate - v) > 1) b.timing.nominal = C.defaultTiming(v, b.timing.nominal.fclk); }, { num: true })),
          b.protocol === 'CAN FD' ? field('Data bitrate (bit/s)', inp(b.dataBitrate, v => { b.dataBitrate = v; if (Math.abs(C.timingDerived(b.timing.data).bitrate - v) > 1) b.timing.data = C.defaultTiming(v, b.timing.data.fclk); }, { num: true })) : null,
          field('Cable length (m)', inp(b.cableLength, v => b.cableLength = Math.max(1, v), { num: true })),
          field('Propagation (ns/m)', inp(b.propDelayNsPerM, v => b.propDelayNsPerM = Math.max(0, v), { num: true })),
          field('Comment', inp(b.comment, v => b.comment = v)))),
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Nodes ', h('small', null, 'exactly one is "our node"'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm', onclick: () => App.edit(() => b.nodes.push(C.newNode('Node' + (b.nodes.length + 1), b.cableLength))) }, '+ Node')),
        h('div', { class: 'cb' }, App.table('nodes' + b.id, nodeCols, b.nodes))),
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Messages ', h('small', null, `${b.messages.length} messages · ${b.messages.reduce((a, m) => a + m.signals.length, 0)} signals`)),
        h('div', { class: 'cb' }, msgs.length ? App.table('msgs' + b.id, App.msgCols(b, true), msgs, { maxH: '520px', onRow: (m) => App.select(b.id, m.id) }) : h('div', { class: 'empty' }, 'No messages. Use "+ Msg" in the tree.')))
    ];
  };

  const msgView = (b, m) => {
    const cols = App.msgCols(b, false);
    const form = h('div', { class: 'cb grid-form' }, cols.map(c => {
      const td = cell('mform', m, c), el = td.firstChild || h('span', null, td.textContent);
      if (el.style) el.style.width = '100%';
      return field(c.label, el);
    }));
    const used = new Set(); m.signals.forEach(s => C.signalPositions(s).forEach(p => used.add(p)));
    const freeBits = C.msgLen(m) * 8 - [...used].filter(p => p < C.msgLen(m) * 8).length;
    return [
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Message ', h('span', { class: 'pill acc mono' }, C.fmtId(m)), ' ', h('b', null, m.name),
        h('span', { class: 'spacer' }), h('button', { class: 'btn sm', onclick: () => App.go('bitmap') }, 'Bit Mapping →')), form),
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Signals ', h('small', null, `${m.signals.length} signals · ${freeBits} free bits of ${C.msgLen(m) * 8} · start bit for Motorola = ${conv()} position`)),
        h('div', { class: 'cb' }, m.signals.length ? App.table('sigs' + m.id, App.sigCols(b, m), m.signals, { selected: (s) => s.id === S.sel.sig, onRow: (s) => { S.sel.sig = s.id; App.render(); } })
          : h('div', { class: 'empty' }, 'No signals. Use "+ Sig" in the tree.')))
    ];
  };

  const textView = (b) => {
    const ta = h('textarea', { rows: 30, style: { width: '100%', minHeight: '60vh' }, spellcheck: 'false' }, F.dbcExport(b));
    return [h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Text (DBC) – bus ', h('span', { class: 'pill acc' }, b.name), h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', onclick: () => { ta.value = F.dbcExport(b); } }, 'Reset'),
      h('button', { class: 'btn sm primary', onclick: async () => {
        const r = F.dbcImport(ta.value, b.name);
        const ok = await App.modal('Apply text', App.reportView(r.report), [{ label: 'Cancel', value: false }, { label: 'Apply', value: true, primary: true }]);
        if (!ok) return;
        App.edit(() => {
          const posOf = new Map(b.nodes.map(n => [n.name, n]));
          r.bus.nodes.forEach(n => { const o = posOf.get(n.name); if (o) { n.position = o.position; n.ours = o.ours; n.id = o.id; } });
          if (!r.bus.nodes.some(n => n.ours) && r.bus.nodes.length) r.bus.nodes[0].ours = true;
          const keep = { id: b.id, timing: b.timing, cableLength: b.cableLength, propDelayNsPerM: b.propDelayNsPerM, ourClockDevPct: b.ourClockDevPct };
          const oldIds = new Map(b.messages.map(m => [m.name, m]));
          r.bus.messages.forEach(m => { const o = oldIds.get(m.name); if (o) { m.id = o.id; m.signals.forEach(s => { const os = o.signals.find(x => x.name === s.name); if (os) s.id = os.id; }); } });
          Object.assign(b, r.bus, keep);
        });
      } }, 'Apply')),
      h('div', { class: 'cb' }, ta, h('p', { class: 'faint' }, 'Edit the DBC text and press Apply. Comments, value tables, cycle times and CAN FD attributes are parsed back into the model.')))];
  };

  const validView = () => {
    const b = App.bus(); const v = C.validate(S.project).filter(x => !b || x.bus === b.id);
    return h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Validation ', h('small', null, v.length ? `${v.length} issues` : 'no issues')),
      v.length ? h('div', { class: 'valid' }, v.map(x => h('div', { onclick: () => App.select(x.bus, x.msg, x.sig) }, h('span', { class: 'lvl-' + x.level }, x.level === 'error' ? '●' : '▲'), x.text)))
        : h('div', { class: 'cb faint' }, '✓ All checks passed'));
  };

  App.renderers.spec = () => {
    const b = App.bus(), m = App.msg();
    const right = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } });
    if (!b) right.append(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Create a bus or import DBC / ARXML / XLSX to start.')));
    else if (S.specMode === 'text') right.append(...textView(b));
    else if (m) right.append(...msgView(b, m));
    else right.append(...busView(b));
    if (b) right.append(validView());
    return h('div', { class: 'page' },
      h('div', { class: 'page-h' }, h('h1', null, 'Specification'),
        h('div', { class: 'seg' }, h('button', { class: S.specMode === 'table' ? 'on' : '', onclick: () => { S.specMode = 'table'; App.render(); } }, 'Table'),
          h('button', { class: S.specMode === 'text' ? 'on' : '', onclick: () => { S.specMode = 'text'; App.render(); } }, 'Text (DBC)')),
        b ? h('span', { class: 'muted' }, m ? `${b.name} › ${m.name}` : b.name) : null),
      h('div', { class: 'split' }, renderTree(), right));
  };
})();
