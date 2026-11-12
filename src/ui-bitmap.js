/* Screen 2 – Bit Mapping, Screen 3 – Byte Order View */
(function () {
  'use strict';
  const C = window.CANssmCore, F = window.CANssmFormats, App = window.App, h = App.h, S = App.state;
  const conv = () => App.settings.conv;

  // message picker shared by both screens
  const msgPicker = () => h('select', { style: { minWidth: '260px' }, onchange: (e) => { const [b, m] = e.target.value.split('|'); App.select(b, m); } },
    h('option', { value: '|' }, '— select a message —'),
    S.project.buses.map(b => h('optgroup', { label: b.name }, b.messages.slice().sort((x, y) => x.canId - y.canId).map(m => h('option', { value: b.id + '|' + m.id, selected: S.sel.msg === m.id }, `${C.fmtId(m)}  ${m.name}`)))));

  let tip = null;
  const showTip = (e, html) => { if (!tip) { tip = h('div', { class: 'tip' }); document.body.append(tip); } tip.innerHTML = html; tip.style.display = 'block'; const r = tip.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - r.width - 8, e.clientX + 14) + 'px'; tip.style.top = Math.min(innerHeight - r.height - 8, e.clientY + 14) + 'px'; };
  const hideTip = () => { if (tip) tip.style.display = 'none'; };

  // ---------------- Bit Mapping ----------------
  App.renderers.bitmap = () => {
    const b = App.bus(), m = App.msg();
    const page = h('div', { class: 'page' }, h('div', { class: 'page-h' }, h('h1', null, 'Bit Mapping'), msgPicker(),
      m ? h('span', { class: 'muted' }, `${b.name} · ${m.fd ? 'CAN FD' : 'CAN'} · ${C.msgLen(m)} bytes · ${m.signals.length} signals`) : null));
    if (!m) { page.append(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Select a message to see its bit layout.'))); return page; }
    const len = C.msgLen(m), owner = new Map();
    const posOf = new Map();
    m.signals.forEach((s, i) => {
      const pos = C.signalPositions(s); posOf.set(s.id, pos);
      pos.forEach((p, k) => { if (!owner.has(p)) owner.set(p, []); owner.get(p).push({ s, i, k }); });
    });
    const grid = h('div', { class: 'bm' });
    grid.append(h('div', { class: 'hd' }, 'byte \\ bit'));
    for (let bit = 7; bit >= 0; bit--) grid.append(h('div', { class: 'hd' }, 'bit ' + bit));
    const cells = new Map();
    for (let by = 0; by < len; by++) {
      grid.append(h('div', { class: 'bl' }, 'Byte ' + by));
      for (let bit = 7; bit >= 0; bit--) {
        const p = by * 8 + bit, own = owner.get(p) || [];
        const c = h('div', { class: 'c', 'data-p': p }, h('span', { class: 'bn' }, p));
        if (own.length) {
          const { s, i, k } = own[0];
          c.classList.add('s');
          c.style.background = App.sigColor(i, 0.22); c.style.borderColor = App.sigColor(i, 0.9); c.style.color = 'var(--text)';
          if (own.length > 1) c.classList.add('ov');
          const pos = posOf.get(s.id);
          if (k === pos.length - 1) c.append(h('span', null, s.name.length > 12 ? s.name.slice(0, 11) + '…' : s.name));
          const tags = []; if (k === pos.length - 1) tags.push('MSB'); if (k === 0) tags.push('LSB');
          if (tags.length) c.append(h('span', { class: 'tag', style: { color: App.sigColor(i) } }, tags.join('/')));
          const endK = s.byteOrder === 'Motorola' ? 0 : pos.length - 1;
          if (k === endK) c.append(h('span', { class: 'grip', title: 'Drag to resize', style: { color: App.sigColor(i) } }));
          if (S.sel.sig === s.id) c.classList.add('hl');
          c.addEventListener('mousemove', (e) => { if (drag) return; showTip(e, own.map(o => `<b>${App.esc(o.s.name)}</b> · bit ${o.k} of ${o.s.length}<br>${o.s.byteOrder}, start ${C.displayStart(o.s, conv())}, ${App.fmtNum(o.s.factor)}×raw${o.s.offset ? (o.s.offset > 0 ? '+' : '') + App.fmtNum(o.s.offset) : ''} ${App.esc(o.s.unit)}`).join('<hr style="opacity:.3">') + (own.length > 1 ? '<br><b style="color:#ff8a8a">Overlap!</b>' : '')); });
          c.addEventListener('mouseleave', hideTip);
          c.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.preventDefault(); hideTip(); startDrag(e.target.classList.contains('grip') ? 'resize' : 'move', s, p); });
        }
        cells.set(p, c); grid.append(c);
      }
    }
    // drag
    let drag = null;
    const candidate = (target) => {
      const s = drag.s, t = Object.assign({}, s);
      if (drag.mode === 'move') {
        if (s.byteOrder === 'Intel') t.startBit = s.startBit + (target - drag.grab);
        else t.startBit = C.fromMIndex(C.mIndex(s.startBit) + C.mIndex(target) - C.mIndex(drag.grab));
      } else {
        if (s.byteOrder === 'Intel') t.length = target - s.startBit + 1;
        else t.length = C.mIndex(target) - C.mIndex(s.startBit) + 1;
        if (t.length < 1 || t.length > 64) return null;
      }
      if (t.startBit < 0) return null;
      const pos = C.signalPositions(t);
      if (pos.some(p => p < 0 || p >= len * 8)) return null;
      return { t, pos };
    };
    const clearGhost = () => cells.forEach(c => c.classList.remove('ghost'));
    const startDrag = (mode, s, p) => {
      drag = { mode, s, grab: p, cand: null };
      const mv = (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY), c = el && el.closest && el.closest('.c'); if (!c) return;
        const cand = candidate(+c.dataset.p); clearGhost(); drag.cand = cand;
        if (cand) cand.pos.forEach(q => cells.get(q) && cells.get(q).classList.add('ghost'));
      };
      const up = () => {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
        const d = drag; drag = null; clearGhost();
        if (d.cand && (d.cand.t.startBit !== s.startBit || d.cand.t.length !== s.length)) App.edit(() => { s.startBit = d.cand.t.startBit; s.length = d.cand.t.length; S.sel.sig = s.id; });
        else if (S.sel.sig !== s.id) { S.sel.sig = s.id; App.render(); }
      };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    };
    const used = owner.size, ovl = [...owner.values()].filter(o => o.length > 1).length;
    const legendCols = [
      { key: 'c', label: '', nosort: true, type: 'html', cls: 'act', get: s => h('span', { class: 'swatch', style: { background: App.sigColor(m.signals.indexOf(s)) } }) },
      { key: 'name', label: 'Signal', type: 'ro', get: s => s.name },
      { key: 'start', label: `Start (${conv()})`, type: 'ro', get: s => C.displayStart(s, conv()) },
      { key: 'len', label: 'Len', type: 'ro', get: s => s.length },
      { key: 'msb', label: 'MSB bit', type: 'ro', get: s => C.msbPos(s) },
      { key: 'lsb', label: 'LSB bit', type: 'ro', get: s => C.lsbPos(s) },
      { key: 'ord', label: 'Order', type: 'ro', get: s => s.byteOrder },
      { key: 'go', label: '', type: 'html', cls: 'act', nosort: true, get: s => h('button', { class: 'btn sm', onclick: () => { S.sel.sig = s.id; App.go('byteorder'); } }, 'Byte Order →') }
    ];
    page.append(h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 440px', gap: '14px', alignItems: 'start' } },
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Layout ', h('small', null, 'drag a signal to move it · drag the striped edge to resize · Ctrl+Z to undo')),
        h('div', { class: 'cb', style: { overflow: 'auto' } }, grid)),
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Legend ', h('small', null, `${used}/${len * 8} bits used`), ovl ? h('span', { class: 'pill err' }, ovl + ' overlapping bits') : null),
        h('div', { class: 'cb' }, App.table('legend' + m.id, legendCols, m.signals, { selected: s => s.id === S.sel.sig, onRow: (s) => { S.sel.sig = s.id; App.render(); } })))));
    return page;
  };

  // ---------------- Byte Order View ----------------
  const layoutSvg = (s, title, rowsFrom, rowsTo, accent) => {
    const sv = App.svg, cw = 46, ch = 44, lx = 74, ty = 46;
    const W = lx + 8 * cw + 16, H = ty + (rowsTo - rowsFrom + 1) * ch + 30;
    const pos = C.signalPositions(s), at = new Map(pos.map((p, i) => [p, i]));
    const cx = (p) => lx + (7 - (p & 7)) * cw + cw / 2, cy = (p) => ty + ((p >> 3) - rowsFrom) * ch + ch - 10;
    const g = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${W * 1.25}px`, role: 'img', 'aria-label': title });
    g.append(sv('defs', null, sv('marker', { id: 'ah' + title.length + s.byteOrder, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, sv('path', { d: 'M0 0L10 5L0 10z', fill: accent }))));
    g.append(sv('text', { x: 0, y: 16, 'font-size': 14, 'font-weight': 600, fill: 'var(--text)' }, title));
    for (let bit = 7; bit >= 0; bit--) g.append(sv('text', { x: lx + (7 - bit) * cw + cw / 2, y: ty - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text3)', 'font-family': 'var(--mono)' }, 'bit ' + bit));
    for (let by = rowsFrom; by <= rowsTo; by++) {
      g.append(sv('text', { x: 0, y: ty + (by - rowsFrom) * ch + ch / 2 + 4, 'font-size': 12, fill: 'var(--text2)', 'font-family': 'var(--mono)' }, 'Byte ' + by));
      for (let bit = 7; bit >= 0; bit--) {
        const p = by * 8 + bit, i = at.get(p), x = lx + (7 - bit) * cw + 2, y = ty + (by - rowsFrom) * ch + 2;
        const isMsb = i === pos.length - 1, isLsb = i === 0;
        g.append(sv('rect', { x, y, width: cw - 4, height: ch - 4, rx: 5, fill: i == null ? 'var(--panel2)' : isMsb ? accent : 'color-mix(in srgb, ' + accent + ' 16%, var(--panel))', stroke: i == null ? 'var(--line)' : accent, 'stroke-width': isLsb ? 2.2 : 1 }));
        g.append(sv('text', { x: x + cw - 7, y: y + 11, 'text-anchor': 'end', 'font-size': 8.5, fill: isMsb ? '#fff' : 'var(--text3)', 'font-family': 'var(--mono)' }, p));
        if (i != null) g.append(sv('text', { x: x + (cw - 4) / 2, y: y + ch / 2 + 1, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: isMsb ? '#fff' : 'var(--text)', 'font-family': 'var(--mono)' }, i));
      }
    }
    // reading-order path MSB -> LSB
    let d = '';
    for (let i = pos.length - 1; i >= 0; i--) {
      const p = pos[i], x = cx(p), y = cy(p);
      if (i === pos.length - 1) { d = `M${x} ${y}`; continue; }
      const q = pos[i + 1];
      if ((q >> 3) === (p >> 3)) d += ` L${x} ${y}`;
      else {
        // route around the cells: down into the gap under q's row, left to the margin, to p's row, then in from the left
        const yb = ty + ((q >> 3) - rowsFrom + 1) * ch - 1, xm = lx - 6, xq = cx(q) + 14;
        d += ` L${xq} ${cy(q)} L${xq} ${yb} L${xm} ${yb} L${xm} ${y} L${x} ${y}`;
      }
    }
    if (pos.length > 1) g.append(sv('path', { d, fill: 'none', stroke: accent, 'stroke-width': 1.6, 'stroke-dasharray': '1 0', opacity: 0.75, 'marker-end': `url(#ah${title.length + s.byteOrder})` }));
    const msb = pos[pos.length - 1], lsb = pos[0];
    g.append(sv('text', { x: lx, y: H - 8, 'font-size': 11.5, fill: 'var(--text2)' }, `MSB bit ${msb} (byte ${msb >> 3}) → LSB bit ${lsb} (byte ${lsb >> 3})`));
    return g;
  };

  App.renderers.byteorder = () => {
    const b = App.bus(), m = App.msg();
    let s = App.sig(); if (!s && m && m.signals.length) { s = m.signals[0]; S.sel.sig = s.id; }
    const page = h('div', { class: 'page' }, h('div', { class: 'page-h' }, h('h1', null, 'Byte Order View'), msgPicker(),
      m ? h('select', { onchange: (e) => { S.sel.sig = e.target.value; App.render(); } }, m.signals.map(x => h('option', { value: x.id, selected: s && x.id === s.id }, x.name))) : null,
      s ? h('div', { class: 'seg' }, ['Intel', 'Motorola'].map(o => h('button', { class: s.byteOrder === o ? 'on' : '', title: 'Change this signal\'s byte order (keeps LSB position)', onclick: () => { if (s.byteOrder !== o) App.edit(() => C.switchByteOrder(s, o)); } }, o))) : null));
    if (!s) { page.append(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Select a message with at least one signal.'))); return page; }
    const other = Object.assign({}, s); C.switchByteOrder(other, s.byteOrder === 'Motorola' ? 'Intel' : 'Motorola');
    const len = C.msgLen(m);
    const bytes = (x) => C.signalPositions(x).map(p => p >> 3);
    const all = bytes(s).concat(bytes(other)).filter(v => v >= 0);
    const r0 = Math.max(0, Math.min(...all)), r1 = Math.min(Math.max(len - 1, r0), Math.max(...all));
    const otherOk = C.signalPositions(other).every(p => p >= 0 && p < len * 8);

    // encode / decode
    const enc = h('div'), dec = h('div');
    const physIn = h('input', { type: 'text', value: App.fmtNum(s.initial), style: { width: '140px' } });
    const hexIn = h('input', { type: 'text', class: 'mono', style: { width: '100%' } });
    const vtText = (raw) => { const e = (s.valueTable || []).find(v => v.value === Number(raw)); return e ? ` (“${e.text}”)` : ''; };
    const sigBytes = new Set(bytes(s));
    const bytesView = (arr) => h('div', { class: 'bytes' }, Array.from(arr).map((v, i) => [h('span', { class: sigBytes.has(i) ? 'hit' : '' }, v.toString(16).toUpperCase().padStart(2, '0')), ' ']));
    const doEnc = () => {
      const phys = Number(String(physIn.value).replace(',', '.')); enc.innerHTML = '';
      if (!Number.isFinite(phys)) { enc.append(h('p', { class: 'lvl-error' }, 'Enter a number')); return; }
      const r = C.physToBits(s, phys);
      const binary = r.bits.toString(2).padStart(s.length, '0').replace(/(.{4})(?=.)/g, '$1 ');
      const vals = {}; vals[s.id] = phys; const payload = C.encodeMessage(m, vals);
      hexIn.value = C.hex(payload);
      enc.append(h('div', { class: 'kv' },
        h('b', null, 'Raw value'), h('span', { class: 'mono' }, String(r.raw), vtText(r.raw), r.clamped ? h('span', { class: 'pill err' }, 'clamped to range') : null),
        h('b', null, 'Raw (hex)'), h('span', { class: 'mono' }, '0x' + r.bits.toString(16).toUpperCase().padStart(Math.ceil(s.length / 4), '0')),
        h('b', null, `Binary (${s.length} bits, MSB→LSB)`), h('span', { class: 'binary' }, binary),
        h('b', null, 'Payload'), bytesView(payload)), h('p', { class: 'faint' }, 'Other signals use their initial values. Highlighted bytes contain this signal.'));
      doDec();
    };
    const doDec = () => {
      dec.innerHTML = '';
      const parts = hexIn.value.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, ' ').trim().split(/\s+/).filter(Boolean);
      const arr = new Uint8Array(len);
      const joined = parts.length === 1 && parts[0].length > 2 ? parts[0].match(/.{1,2}/g) : parts;
      (joined || []).slice(0, len).forEach((x, i) => arr[i] = parseInt(x, 16) || 0);
      const bits = C.readSignal(arr, s), r = C.bitsToPhys(s, bits);
      dec.append(h('div', { class: 'kv' },
        h('b', null, 'Bytes used'), bytesView(arr),
        h('b', null, 'Raw value'), h('span', { class: 'mono' }, String(r.raw), vtText(r.raw)),
        h('b', null, 'Physical value'), h('span', { class: 'mono', style: { fontWeight: 700 } }, `${App.fmtNum(r.phys, 12)} ${s.unit}`)));
    };
    physIn.addEventListener('input', doEnc); hexIn.addEventListener('input', doDec);
    doEnc();

    const msbConv = s.byteOrder === 'Motorola' ? C.msbPos(s) : null;
    page.append(
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Signal ', h('b', null, s.name), ' ', h('small', null, `${m.name} ${C.fmtId(m)}`)),
        h('div', { class: 'cb', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '6px 24px' } },
          h('div', { class: 'kv' }, h('b', null, 'Byte order'), h('span', null, s.byteOrder, s.byteOrder === 'Motorola' ? ' (big endian)' : ' (little endian)'),
            h('b', null, 'Length'), h('span', null, s.length + ' bits'), h('b', null, 'Value type'), h('span', null, s.valueType)),
          h('div', { class: 'kv' }, h('b', null, 'MSB position'), h('span', { class: 'mono' }, C.msbPos(s)), h('b', null, 'LSB position'), h('span', { class: 'mono' }, C.lsbPos(s)),
            h('b', null, 'Bytes spanned'), h('span', { class: 'mono' }, [...sigBytes].sort((a, c) => a - c).join(', '))),
          h('div', { class: 'kv' },
            h('b', null, 'Start bit (MSB conv.)'), h('span', { class: 'mono' }, s.byteOrder === 'Motorola' ? msbConv : C.lsbPos(s) + ' (Intel: LSB)'),
            h('b', null, 'Start bit (LSB conv.)'), h('span', { class: 'mono' }, C.lsbPos(s)),
            h('b', null, 'Active convention'), h('span', null, h('span', { class: 'pill acc' }, conv()), ' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.go('config'); } }, 'change'))))),
      h('div', { class: 'bo-wrap' },
        h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Current: ', s.byteOrder), h('div', { class: 'cb' }, layoutSvg(s, `${s.name} – ${s.byteOrder}`, r0, r1, 'var(--accent)'))),
        h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Comparison: ', other.byteOrder, ' ', h('small', null, 'same LSB position')),
          h('div', { class: 'cb' }, otherOk ? layoutSvg(other, `${s.name} – ${other.byteOrder}`, r0, r1, 'var(--warn)') : h('div', { class: 'empty' }, `In ${other.byteOrder} order this signal would not fit in the ${len}-byte payload.`)))),
      h('div', { class: 'bo-wrap' },
        h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Encode ', h('small', null, 'physical value → bytes')),
          h('div', { class: 'cb' }, h('div', { class: 'row' }, h('label', { class: 'f' }, h('span', null, `Physical value (${s.unit || 'no unit'})`), physIn),
            h('span', { class: 'faint' }, `= raw × ${App.fmtNum(s.factor)} + ${App.fmtNum(s.offset)}`)), h('br'), enc)),
        h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Decode ', h('small', null, 'payload bytes (hex) → value')),
          h('div', { class: 'cb' }, h('label', { class: 'f' }, h('span', null, 'Payload hex, e.g. 00 00 2E E0'), hexIn), h('br'), dec))));
    return page;
  };
})();
