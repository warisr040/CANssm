/* Screen 4 – Bus Simulation */
(function () {
  'use strict';
  const C = window.CANssmCore, App = window.App, h = App.h, S = App.state;
  const SPEEDS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 50, 200, 1000];
  const FIELD_NAMES = { 'SOF': 'SOF', 'ID': 'ID', 'SRR': 'SRR', 'IDE': 'IDE', 'RTR': 'RTR', 'RRS': 'RRS', 'FDF': 'FDF', 'res': 'res', 'r0': 'r0', 'r1': 'r1', 'BRS': 'BRS', 'ESI': 'ESI', 'DLC': 'DLC', 'DATA': 'Data', 'SBC': 'Stuff count', 'CRC': 'CRC', 'CRC delim': 'CRC del', 'ACK': 'ACK', 'ACK delim': 'ACK del', 'EOF': 'EOF', 'IFS': 'IFS' };

  const sim = App.sim = {
    busId: null, source: 'all', speed: App.settings.simSpeed || 1, playing: false, view: 'both',
    frame: null, t: 0, readPtr: 0, vt: 0, due: new Map(), rx: new Map(), lastTs: 0, raf: 0, dom: null, pending: [], frameNo: 0, lastValue: new Map()
  };
  const ourNode = (b) => b.nodes.find(n => n.ours) || null;
  const receives = (b, m, node) => node && (m.receivers.includes(node.name) || m.signals.some(s => s.receivers.includes(node.name)));
  const sigReceived = (m, s, node) => node && (s.receivers.length ? s.receivers.includes(node.name) : m.receivers.includes(node.name));
  const phaseKey = (b, m, bit) => (bit.phase === 'data' && m.fd && m.brs && b.protocol === 'CAN FD') ? 'data' : 'nominal';
  const fmtT = (s) => { const a = Math.abs(s); return a >= 1e-3 ? (s * 1e3).toFixed(3) + ' ms' : a >= 1e-6 ? (s * 1e6).toFixed(3) + ' µs' : (s * 1e9).toFixed(1) + ' ns'; };

  // ---------- schedule ----------
  sim.schedule = (b, m, bits, delay) => {
    const dev = (+b.ourClockDevPct || 0) / 100, n = bits.length, sc = new Array(n);
    let t = 0;
    for (let i = 0; i < n; i++) {
      const T = b.timing[phaseKey(b, m, bits[i])], d = C.timingDerived(T);
      sc[i] = { s: t, dur: d.bitTime, ph: phaseKey(b, m, bits[i]), T, tq: d.tq };
      t += d.bitTime;
    }
    let rStart = delay;
    for (let i = 0; i < n; i++) {
      const x = sc[i], T = x.T, rtq = x.tq * (1 + dev);
      x.rtq = rtq; x.ext = 0; x.kind = null; x.err = 0;
      if (i === 0) { rStart = x.s + delay; x.kind = 'hard'; }
      else if (bits[i - 1].v === 1 && bits[i].v === 0) {
        const edge = x.s + delay, e = (edge - rStart) / rtq - 0.5;
        x.kind = 'resync'; x.err = e;
        if (Math.abs(e) > 0.5) {
          if (e > 0) x.ext = Math.min(e, T.sjw);
          else { const c = Math.min(-e, T.sjw); rStart -= c * rtq; sc[i - 1].rEnd = rStart; sc[i - 1].ps2cut = c; x.ext = -c; }
        }
      }
      x.rStart = rStart;
      x.rSample = rStart + (1 + T.prop + T.ps1 + Math.max(0, x.ext)) * rtq;
      x.rEnd = x.rSample + T.ps2 * rtq;
      rStart = x.rEnd;
    }
    // what value is on the wire at our node at sample time
    let j = 0;
    for (let i = 0; i < n; i++) {
      const st = sc[i].rSample - delay;
      while (j < n - 1 && sc[j + 1].s <= st) j++;
      while (j > 0 && sc[j].s > st) j--;
      sc[i].read = bits[j].v; sc[i].ok = j === i;
    }
    sc.total = t;
    return sc;
  };

  // ---------- frames ----------
  const candidates = (b) => {
    const our = ourNode(b);
    if (sim.source !== 'all' && sim.source !== 'rx') { const m = b.messages.find(x => x.id === sim.source); return m ? [m] : []; }
    return b.messages.filter(m => sim.source === 'all' || receives(b, m, our));
  };
  const arbKey = (m) => m.extended ? ((m.canId >>> 18) * 2 + 1) * 2 ** 18 + (m.canId & 0x3FFFF) : (m.canId * 2) * 2 ** 18;
  sim.buildFrame = (b, m) => {
    const bytes = C.encodeMessage(m), bits = C.buildFrame(m, bytes);
    const our = ourNode(b), sender = b.nodes.find(n => n.name === m.sender) || null;
    const ours = our && sender && our.id === sender.id;
    const dist = our && sender ? Math.abs(our.position - sender.position) : 0;
    const delay = ours ? 0 : dist * (b.propDelayNsPerM || 0) * 1e-9;
    const sched = sim.schedule(b, m, bits, delay);
    return { m, bytes, bits, sched, sender, our, ours, delay, rx: receives(b, m, our) };
  };
  sim.nextFrame = (b) => {
    const list = candidates(b); if (!list.length) { sim.frame = null; return; }
    for (const m of list) if (!sim.due.has(m.id)) sim.due.set(m.id, 0);
    let ready = list.filter(m => sim.due.get(m.id) <= sim.vt + 1e-12);
    if (!ready.length) { sim.vt = Math.min(...list.map(m => sim.due.get(m.id))); ready = list.filter(m => sim.due.get(m.id) <= sim.vt + 1e-12); }
    ready.sort((x, y) => arbKey(x) - arbKey(y));
    const m = ready[0];
    sim.pending = ready.slice(1).map(x => x.name);
    sim.frame = sim.buildFrame(b, m);
    const per = m.cycle > 0 ? m.cycle / 1000 : 0.1;
    sim.due.set(m.id, sim.due.get(m.id) + per);
    sim.vt += sim.frame.sched.total;
    sim.t = 0; sim.readPtr = 0; sim.frameNo++;
    // reset slots of this message's signals
    for (const s of m.signals) if (sigReceived(m, s, sim.frame.our)) sim.rx.set(s.id, { bits: new Array(s.length).fill(null), fresh: -1 });
    if (sim.dom) sim.buildStrip();
  };
  sim.reset = () => { sim.frame = null; sim.t = 0; sim.vt = 0; sim.due = new Map(); sim.rx = new Map(); sim.lastValue = new Map(); sim.frameNo = 0; sim.pending = []; };
  sim.refreshFrame = (b) => { // after edits: rebuild current frame keeping position
    if (!sim.frame) return;
    const m = b.messages.find(x => x.id === sim.frame.m.id);
    if (!m) { sim.frame = null; return; }
    const t = sim.t, rp = sim.readPtr; sim.frame = sim.buildFrame(b, m);
    sim.t = Math.min(t, sim.frame.sched.total); sim.readPtr = Math.min(rp, sim.frame.bits.length);
  };

  // ---------- reading bits ----------
  const processReads = () => {
    const f = sim.frame; if (!f) return;
    while (sim.readPtr < f.bits.length && f.sched[sim.readPtr].rSample <= sim.t) {
      const i = sim.readPtr++, bit = f.bits[i];
      if (bit.field !== 'DATA' || bit.stuff || !f.rx) continue;
      const v = f.sched[i].read;
      for (const s of f.m.signals) {
        if (!sigReceived(f.m, s, f.our)) continue;
        const k = C.signalPositions(s).indexOf(bit.dataPos);
        if (k < 0) continue;
        const r = sim.rx.get(s.id) || { bits: new Array(s.length).fill(null) };
        r.bits[k] = v; r.fresh = k; sim.rx.set(s.id, r);
        if (r.bits.every(x => x != null)) {
          let raw = 0n; r.bits.forEach((x, q) => { if (x) raw |= 1n << BigInt(q); });
          sim.lastValue.set(s.id, C.bitsToPhys(s, raw).phys);
        }
        updateRxRow(s);
      }
    }
  };

  // ---------- loop ----------
  const tick = (ts) => {
    sim.raf = 0;
    const b = App.bus(); if (!b || !sim.dom) return;
    if (sim.playing) {
      const dt = Math.min(0.1, (ts - (sim.lastTs || ts)) / 1000);
      const nominal = C.timingDerived(b.timing.nominal).bitTime;
      sim.t += dt * sim.speed * nominal;
      if (!sim.frame) sim.nextFrame(b);
      if (sim.frame) {
        processReads();
        if (sim.t >= sim.frame.sched.total) { const over = sim.t - sim.frame.sched.total; sim.nextFrame(b); if (sim.frame) { sim.t = Math.min(over, sim.frame.sched.total); processReads(); } }
      }
    }
    sim.lastTs = ts;
    draw();
    if (sim.playing) sim.raf = requestAnimationFrame(tick);
  };
  sim.play = () => { if (sim.playing) return; sim.playing = true; sim.lastTs = 0; if (!sim.raf) sim.raf = requestAnimationFrame(tick); updCtl(); };
  sim.pause = () => { sim.playing = false; if (sim.raf) cancelAnimationFrame(sim.raf); sim.raf = 0; updCtl(); };
  sim.detach = () => { sim.pause(); sim.dom = null; };
  const curIndex = () => { const f = sim.frame; if (!f) return -1; const sc = f.sched; let lo = 0, hi = sc.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sc[mid].s <= sim.t) lo = mid; else hi = mid - 1; } return lo; };
  sim.step = () => {
    const b = App.bus(); if (!b) return; sim.pause();
    if (!sim.frame) { sim.nextFrame(b); sim.t = sim.frame ? sim.frame.sched[0].rSample + 1e-15 : 0; processReads(); draw(); return; }
    const i = curIndex(), sc = sim.frame.sched;
    // move to the next sample point not yet reached
    let k = sim.readPtr < sc.length ? sim.readPtr : sc.length;
    if (k >= sc.length) { sim.nextFrame(b); if (sim.frame) { sim.t = sim.frame.sched[0].rSample + 1e-15; processReads(); } draw(); return; }
    sim.t = Math.max(sim.t, sc[k].rSample + 1e-15); processReads(); draw(); void i;
  };
  sim.next = () => { const b = App.bus(); if (!b) return; sim.nextFrame(b); draw(); };
  sim.stop = () => { sim.pause(); sim.reset(); const b = App.bus(); if (b && sim.dom) { App.render(); } };
  sim.key = (e) => {
    if (e.code === 'Space') { e.preventDefault(); sim.playing ? sim.pause() : sim.play(); }
    else if (e.code === 'ArrowRight' || e.code === 'Period') { e.preventDefault(); sim.step(); }
    else if (e.code === 'KeyN') { e.preventDefault(); sim.next(); }
    else if (e.code === 'Escape') sim.stop();
  };

  // ---------- drawing ----------
  let lastCur = -1;
  const updCtl = () => { if (!sim.dom) return; sim.dom.play.textContent = sim.playing ? '❚❚ Pause' : '▶ Play'; sim.dom.play.classList.toggle('primary', !sim.playing); };
  sim.buildStrip = () => {
    const d = sim.dom, f = sim.frame; d.strip.innerHTML = ''; d.bitEls = []; lastCur = -1;
    d.frameTitle.innerHTML = '';
    if (!f) { d.strip.append(h('div', { class: 'faint' }, 'No frame. Press Play.')); return; }
    const b = App.bus();
    d.frameTitle.append(h('b', null, `${C.fmtId(f.m)} ${f.m.name}`), ` ${f.m.fd ? 'CAN FD' : 'CAN'}${f.m.fd && f.m.brs ? ' + BRS' : ''} · ${f.bits.length} bits on the wire (${f.bits.filter(x => x.stuff).length} stuff) · ${fmtT(f.sched.total)} · `,
      f.sender ? `${f.sender.name} → ${f.m.receivers.join(', ') || '—'}` : 'no sender', ' · ',
      f.ours ? h('span', { class: 'pill acc' }, 'our node transmits (reads back)') : f.rx ? h('span', { class: 'pill acc' }, `${f.our.name} receives`) : h('span', { class: 'pill' }, `${f.our ? f.our.name : 'our node'} ignores this frame`),
      sim.pending.length ? h('span', { class: 'faint' }, ` · waiting (lost arbitration): ${sim.pending.join(', ')}`) : null);
    const sigIdx = new Map(); f.m.signals.forEach((s, i) => C.signalPositions(s).forEach(p => sigIdx.set(p, i)));
    let grp = null, last = null;
    f.bits.forEach((bit, i) => {
      if (bit.field !== last) { grp = h('span', { class: 'fb' }); d.strip.append(h('span', { class: 'fld' }, h('span', { class: 'fl' }, FIELD_NAMES[bit.field] || bit.field), grp)); last = bit.field; }
      const el = h('span', { class: 'bit' + (bit.v === 0 ? ' d0' : '') + (bit.stuff ? ' stuff' : '') + (bit.fixedStuff ? ' fixed' : '') + (bit.phase === 'data' && f.m.fd && f.m.brs ? ' dp' : ''),
        title: `#${i} ${bit.field}${bit.stuff ? (bit.fixedStuff ? ' fixed stuff bit' : ' stuff bit') : ''}${bit.dataPos != null ? ' · payload bit ' + bit.dataPos : ''} = ${bit.v} (${bit.v ? 'recessive' : 'dominant'})`,
        onclick: () => { sim.pause(); sim.t = f.sched[i].s + 1e-15; sim.readPtr = Math.min(sim.readPtr, f.bits.length); processReads(); draw(); } }, bit.stuff ? 'S' : bit.v);
      if (bit.field === 'DATA' && !bit.stuff && sigIdx.has(bit.dataPos)) { const c = App.sigColor(sigIdx.get(bit.dataPos)); el.style.background = App.sigColor(sigIdx.get(bit.dataPos), 0.25); el.style.borderColor = c; }
      grp.append(el); d.bitEls.push(el);
    });
    void b;
  };
  const updateRxRow = (s) => {
    const d = sim.dom; if (!d || !d.rxRows) return;
    const row = d.rxRows.get(s.id); if (!row) return;
    const r = sim.rx.get(s.id), cells = row.cells;
    for (let k = 0; k < s.length; k++) {
      const el = cells[s.length - 1 - k], v = r ? r.bits[k] : null;
      el.textContent = v == null ? '·' : v; el.classList.toggle('got', v != null);
      if (r && r.fresh === k) { el.classList.remove('new'); void el.offsetWidth; el.classList.add('new'); }
    }
    const lv = sim.lastValue.get(s.id), done = r && r.bits.every(x => x != null);
    row.val.textContent = done ? `✓ ${App.fmtNum(lv, 8)} ${s.unit}` : lv != null ? `last ${App.fmtNum(lv, 8)} ${s.unit}` : '';
    row.val.style.color = done ? 'var(--ok)' : 'var(--text3)';
  };

  const draw = () => {
    const d = sim.dom; if (!d) return;
    const f = sim.frame, i = curIndex();
    // strip
    if (d.bitEls && i !== lastCur) {
      for (let k = 0; k < d.bitEls.length; k++) { const el = d.bitEls[k]; el.classList.toggle('done', k < i); el.classList.toggle('cur', k === i); }
      lastCur = i;
      const el = d.bitEls[i]; if (el && sim.playing) { const p = d.strip, r = el.offsetTop - p.offsetTop; if (r < p.scrollTop || r > p.scrollTop + p.clientHeight - 30) p.scrollTop = r - 40; }
    }
    d.status.textContent = f ? `frame #${sim.frameNo} · bit ${i}/${f.bits.length} · t = ${fmtT(sim.t)} · virtual bus time ${fmtT(sim.vt)}` : '—';
    drawTopo(); drawBitView();
  };

  const drawTopo = () => {
    const d = sim.dom, b = App.bus(), f = sim.frame; if (!d.topo) return;
    const segs = d.topoSegs, L = b.cableLength || 1, ns = (b.propDelayNsPerM || 0) * 1e-9;
    const levelAt = (x) => { // x in metres
      if (!f || !f.sender) return 1;
      const tt = sim.t - Math.abs(x - f.sender.position) * ns; if (tt < 0) return 1;
      const sc = f.sched; let lo = 0, hi = sc.length - 1; if (tt >= sc.total) return 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sc[mid].s <= tt) lo = mid; else hi = mid - 1; }
      return f.bits[lo].v;
    };
    segs.forEach((r, k) => { const v = levelAt((k + 0.5) / segs.length * L); r.setAttribute('fill', v ? 'var(--rec)' : 'var(--dom)'); r.setAttribute('height', v ? 4 : 8); r.setAttribute('y', v ? 108 : 106); });
    for (const [id, g] of d.topoNodes) {
      const isTx = f && f.sender && f.sender.id === id, isRx = f && f.m.receivers.includes(g.name);
      g.box.setAttribute('stroke', isTx ? 'var(--warn)' : isRx ? 'var(--ok)' : g.ours ? 'var(--accent)' : 'var(--line2)');
      g.box.setAttribute('stroke-width', isTx || isRx || g.ours ? 2.2 : 1.2);
      g.role.textContent = isTx ? 'TX' : isRx ? 'RX' : '';
      g.role.setAttribute('fill', isTx ? 'var(--warn)' : 'var(--ok)');
    }
  };

  const drawBitView = () => {
    const d = sim.dom, cv = d.canvas; if (!cv || sim.view === 'frame') return;
    const b = App.bus(), f = sim.frame;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
    const cText = col('--text'), cText2 = col('--text2'), cText3 = col('--text3'), cLine = col('--line'), cDom = col('--dom'), cRec = col('--rec'), cAcc = col('--accent'), cOk = col('--ok'), cErr = col('--err'), cWarn = col('--warn');
    g.font = '12px ' + col('--sans'); g.textBaseline = 'middle';
    if (!f) { g.fillStyle = cText3; g.fillText('Press Play or Step to start the simulation.', 20, H / 2); return; }
    const i = curIndex(), sc = f.sched, cur = sc[i], bit = f.bits[i];
    const span = cur.dur * 3.2, t0 = sim.t - span * 0.45, L = 150, R = W - 16, PW = R - L;
    const X = (t) => L + (t - t0) / span * PW;
    const lanes = { tx: 66, at: 136, tq: 202 };
    const amp = 18;
    // labels
    g.fillStyle = cText2; g.font = '600 12px ' + col('--sans');
    g.fillText(`${f.sender ? f.sender.name : '?'} drives (TX)`, 12, lanes.tx);
    g.fillText(`At ${f.our ? f.our.name : 'our node'}`, 12, lanes.at - 7);
    g.font = '11px ' + col('--sans'); g.fillStyle = cText3; g.fillText(`+${fmtT(f.delay)} propagation`, 12, lanes.at + 9);
    g.font = '600 12px ' + col('--sans'); g.fillStyle = cText2; g.fillText(`${f.our ? f.our.name : 'Our node'} bit timing`, 12, lanes.tq + 4);
    g.save(); g.beginPath(); g.rect(L, 0, PW, H); g.clip();
    // bit boundaries + waveforms
    const wave = (yc, shift, color) => {
      g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
      let first = true, prevY = null;
      const y = (v) => yc + (v ? -amp : amp);
      let k = Math.max(0, i - 4);
      // idle before frame
      if (k === 0) { const xs = X(shift + 0); if (xs > L) { g.moveTo(L, y(1)); g.lineTo(xs, y(1)); first = false; prevY = y(1); } }
      for (; k < sc.length && sc[k].s + shift < t0 + span; k++) {
        const xa = X(sc[k].s + shift), xb = X(sc[k].s + sc[k].dur + shift), yy = y(f.bits[k].v);
        if (first) { g.moveTo(xa, yy); first = false; } else if (prevY !== yy) g.lineTo(xa, yy);
        g.lineTo(xb, yy); prevY = yy;
        if (!f.bits[k].v) { g.save(); g.fillStyle = color; g.globalAlpha = 0.1; g.fillRect(xa, yc - amp, xb - xa, amp * 2); g.restore(); }
      }
      g.stroke();
    };
    for (let k = Math.max(0, i - 4); k < sc.length && sc[k].s < t0 + span; k++) {
      const xa = X(sc[k].s), xb = X(sc[k].s + sc[k].dur);
      g.strokeStyle = cLine; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(xa, 22); g.lineTo(xa, lanes.at + amp + 6); g.stroke(); g.setLineDash([]);
      g.textBaseline = 'middle';
      const bk = f.bits[k];
      g.textAlign = 'center'; g.font = '10.5px ' + col('--sans'); g.fillStyle = cText3;
      g.fillText(`#${k} ${FIELD_NAMES[bk.field] || bk.field}${bk.stuff ? ' (stuff)' : ''}${bk.dataPos != null ? ' b' + bk.dataPos : ''}`, (xa + xb) / 2, 12);
      g.font = '700 13px ' + col('--mono'); g.fillStyle = bk.stuff ? cWarn : cText;
      g.fillText(bk.stuff ? 'S' : String(bk.v), (xa + xb) / 2, 32);
    }
    wave(lanes.tx, 0, cDom);
    wave(lanes.at, f.delay, cDom);
    // receiver timing segments
    const segC = [col('--seg-sync'), col('--seg-prop'), col('--seg-ps1'), col('--seg-ps2')];
    for (let k = Math.max(0, i - 4); k < sc.length && sc[k].rStart < t0 + span; k++) {
      const x = sc[k], T = x.T, rtq = x.rtq;
      const ps2 = (x.rEnd - x.rSample) / rtq;
      const segs = [1, T.prop, T.ps1 + Math.max(0, x.ext), ps2];
      let t = x.rStart;
      segs.forEach((n, q) => {
        const xa = X(t), xb = X(t + n * rtq);
        g.fillStyle = segC[q]; g.globalAlpha = 0.22; g.fillRect(xa, lanes.tq - 12, xb - xa, 24); g.globalAlpha = 1;
        g.strokeStyle = segC[q]; g.lineWidth = 1; g.strokeRect(xa + 0.5, lanes.tq - 12 + 0.5, xb - xa - 1, 23);
        if (xb - xa > 34) { g.fillStyle = segC[q]; g.font = '600 10.5px ' + col('--sans'); g.textAlign = 'center'; g.fillText(['Sync', 'Prop', 'PS1', 'PS2'][q] + (q === 2 && x.ext > 0 ? '+' + x.ext.toFixed(1) : '') + (q === 3 && x.ps2cut ? '−' + x.ps2cut.toFixed(1) : ''), (xa + xb) / 2, lanes.tq); }
        // TQ ticks
        if (rtq / span * PW > 5) { g.strokeStyle = segC[q]; g.globalAlpha = 0.45; for (let z = 1; z < n; z++) { const xt = X(t + z * rtq); g.beginPath(); g.moveTo(xt, lanes.tq + 6); g.lineTo(xt, lanes.tq + 12); g.stroke(); } g.globalAlpha = 1; }
        t += n * rtq;
      });
      // sample point
      const xs = X(x.rSample), done = sim.t >= x.rSample;
      g.strokeStyle = done ? (x.ok ? cOk : cErr) : cText3; g.lineWidth = 1.5; g.setLineDash(done ? [] : [2, 3]);
      g.beginPath(); g.moveTo(xs, lanes.at - amp - 4); g.lineTo(xs, lanes.tq + 14); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.moveTo(xs - 6, lanes.tq + 22); g.lineTo(xs + 6, lanes.tq + 22); g.lineTo(xs, lanes.tq + 14); g.closePath();
      g.fillStyle = done ? (x.ok ? cOk : cErr) : cText3; g.fill();
      g.beginPath(); g.arc(xs, lanes.tq + 36, 10, 0, Math.PI * 2);
      if (done) { g.fillStyle = x.ok ? cOk : cErr; g.fill(); g.fillStyle = '#fff'; } else { g.strokeStyle = cText3; g.lineWidth = 1; g.stroke(); g.fillStyle = cText3; }
      g.font = '700 12px ' + col('--mono'); g.textAlign = 'center'; g.fillText(done ? String(x.read) : '?', xs, lanes.tq + 36.5);
      if (x.kind === 'hard') { g.fillStyle = cAcc; g.font = '10.5px ' + col('--sans'); g.fillText('hard sync', X(x.rStart) + 26, lanes.tq - 20); }
    }
    // cursor
    const xc = X(sim.t);
    g.strokeStyle = cAcc; g.lineWidth = 2; g.beginPath(); g.moveTo(xc, 4); g.lineTo(xc, lanes.tq + 50); g.stroke();
    g.fillStyle = cAcc; g.beginPath(); g.moveTo(xc - 5, 2); g.lineTo(xc + 5, 2); g.lineTo(xc, 9); g.fill();
    g.restore();
    // info line
    const T = cur.T, dd = C.timingDerived(T);
    g.textAlign = 'left'; g.font = '12px ' + col('--sans'); g.fillStyle = cText;
    const y0 = lanes.tq + 66;
    g.fillText(`Bit #${i}  ${FIELD_NAMES[bit.field] || bit.field}${bit.stuff ? (bit.fixedStuff ? ' fixed stuff bit' : ' stuff bit (discarded by receiver)') : ''}${bit.dataPos != null && !bit.stuff ? ' · payload bit ' + bit.dataPos : ''}  =  ${bit.v} (${bit.v ? 'recessive' : 'dominant'})`, 12, y0);
    g.fillStyle = cText2;
    g.fillText(`${cur.ph === 'data' ? 'Data' : 'Nominal'} phase · ${C.fmtRate(dd.bitrate)} · ${fmtT(dd.bitTime)}/bit · ${dd.ntq} TQ × ${fmtT(dd.tq)} · sample point ${(dd.sp * 100).toFixed(1)}%`, 12, y0 + 18);
    let note = cur.kind === 'hard' ? 'Hard synchronization on the SOF edge: our node restarts its bit timing when the falling edge arrives.' : '';
    if (cur.kind === 'resync') note = Math.abs(cur.err) <= 0.5 ? `Recessive→dominant edge inside Sync_Seg: phase error ${cur.err.toFixed(2)} TQ, no correction.` : cur.ext > 0 ? `Edge late by ${cur.err.toFixed(2)} TQ → Phase_Seg1 lengthened by ${cur.ext.toFixed(2)} TQ (SJW ${T.sjw}).` : `Edge early by ${(-cur.err).toFixed(2)} TQ → previous Phase_Seg2 shortened by ${(-cur.ext).toFixed(2)} TQ (SJW ${T.sjw}).`;
    if (sim.t >= cur.rSample && !cur.ok) note = 'Sample point fell outside this bit – timing settings cannot tolerate this delay/deviation (bit error).';
    g.fillStyle = cur.ok ? cText3 : cErr; g.fillText(note, 12, y0 + 36);
  };

  // ---------- screen ----------
  const timingCard = (b) => {
    const ph = b.protocol === 'CAN FD' ? ['nominal', 'data'] : ['nominal'];
    const set = (p, k, v) => App.edit(() => { b.timing[p][k] = v; sim.refreshFrame(b); });
    const num = (p, k, min, max, mul) => h('input', { type: 'number', min, max, step: mul ? 'any' : 1, value: mul ? b.timing[p][k] / mul : b.timing[p][k], style: { width: '100%' },
      onchange: (e) => { let v = Number(e.target.value); if (!Number.isFinite(v)) return; v = mul ? v * mul : Math.round(v); set(p, k, Math.max(min * (mul || 1), mul ? v : Math.min(max, v))); } });
    const der = ph.map(p => C.timingDerived(b.timing[p]));
    const row = (label, cells, tip) => [h('div', { class: 'th', title: tip || null }, label), ...cells];
    const g = h('div', { class: 'timing-grid' },
      h('div'), ...ph.map(p => h('div', { class: 'th' }, p === 'nominal' ? 'Nominal (arbitration)' : 'Data phase (FD)')),
      ...row('CAN clock (MHz)', ph.map(p => num(p, 'fclk', 1, 1000, 1e6))),
      ...row('Prescaler (BRP)', ph.map(p => num(p, 'brp', 1, 1024))),
      ...row('Sync_Seg', ph.map(() => h('span', { class: 'faint' }, '1 TQ (fixed)'))),
      ...row('Prop_Seg', ph.map(p => num(p, 'prop', 1, 255)), 'Compensates physical delay on the bus'),
      ...row('Phase_Seg1', ph.map(p => num(p, 'ps1', 1, 255)), 'Before the sample point; lengthened by resynchronization'),
      ...row('Phase_Seg2', ph.map(p => num(p, 'ps2', 1, 128)), 'After the sample point; shortened by resynchronization'),
      ...row('SJW', ph.map(p => num(p, 'sjw', 1, 128)), 'Max TQ adjustment per resynchronization'),
      ...row('TDC offset (TQ)', ph.map(p => p === 'data' ? h('input', { type: 'number', min: 0, value: b.timing.data.tdc || 0, style: { width: '100%' }, onchange: (e) => set('data', 'tdc', Math.max(0, +e.target.value | 0)) }) : h('span', { class: 'faint' }, '—')), 'Transmitter delay compensation (informational)'),
      ...row('TQ', der.map(d => h('span', { class: 'mono' }, fmtT(d.tq)))),
      ...row('TQ per bit', der.map(d => h('span', { class: 'mono' }, d.ntq))),
      ...row('Bitrate', der.map((d, k) => h('span', { class: 'mono', style: { color: Math.abs(d.bitrate - (ph[k] === 'data' ? b.dataBitrate : b.bitrate)) > 1 ? 'var(--err)' : 'var(--ok)' } }, C.fmtRate(d.bitrate)))),
      ...row('Sample point', der.map(d => h('span', { class: 'mono' }, (d.sp * 100).toFixed(1) + ' %'))));
    const warns = ph.flatMap(p => C.timingWarnings(b, p).map(w => `${p}: ${w}`));
    // bit diagram
    const segBar = (p) => { const T = b.timing[p], n = 1 + T.prop + T.ps1 + T.ps2; const segs = [['Sync', 1, '--seg-sync'], ['Prop', T.prop, '--seg-prop'], ['PS1', T.ps1, '--seg-ps1'], ['PS2', T.ps2, '--seg-ps2']];
      return h('div', { style: { display: 'flex', height: '26px', borderRadius: '5px', overflow: 'hidden', border: '1px solid var(--line)', position: 'relative' } },
        segs.map(([l, k, c]) => h('div', { title: `${l}: ${k} TQ`, style: { flex: k, background: `color-mix(in srgb, var(${c}) 28%, var(--panel))`, borderRight: `1px solid var(${c})`, color: `var(${c})`, fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } }, k * 40 / n > 4 ? `${l} ${k}` : String(k))),
        h('div', { style: { position: 'absolute', left: ((1 + T.prop + T.ps1) / n * 100) + '%', top: '-2px', bottom: '-2px', width: '2px', background: 'var(--text)' }, title: 'Sample point' })); };
    // calculator
    const calcOut = h('div');
    const calcPh = h('select', null, ph.map(p => h('option', { value: p }, p)));
    const calcSp = h('input', { type: 'number', value: 87.5, step: 0.5, style: { width: '80px' } });
    const runCalc = () => {
      const p = calcPh.value, T = b.timing[p], target = p === 'data' ? b.dataBitrate : b.bitrate;
      const list = C.timingCandidates(T.fclk, target, (+calcSp.value || 87.5) / 100).slice(0, 10);
      calcOut.innerHTML = '';
      if (!list.length) { calcOut.append(h('p', { class: 'lvl-warn' }, `No exact combination for ${C.fmtRate(target)} at ${T.fclk / 1e6} MHz.`)); return; }
      calcOut.append(h('div', { class: 'row', style: { marginTop: '8px' } }, list.map(c => h('button', { class: 'btn sm', title: 'Apply', onclick: () => App.edit(() => { Object.assign(b.timing[p], { brp: c.brp, prop: c.prop, ps1: c.ps1, ps2: c.ps2, sjw: c.sjw }); sim.refreshFrame(b); }) },
        `BRP ${c.brp} · ${c.ntq} TQ · ${c.prop}/${c.ps1}/${c.ps2} · SP ${(c.sp * 100).toFixed(1)}%`))));
    };
    const presets = [['', 'Presets…'], ['n|80|500000', 'Nominal 500 kbps @ 80 MHz'], ['n|80|250000', 'Nominal 250 kbps @ 80 MHz'], ['n|80|1000000', 'Nominal 1 Mbps @ 80 MHz'], ['n|40|500000', 'Nominal 500 kbps @ 40 MHz'], ['n|20|500000', 'Nominal 500 kbps @ 20 MHz'],
      ['d|80|2000000', 'Data 2 Mbps @ 80 MHz'], ['d|80|4000000', 'Data 4 Mbps @ 80 MHz'], ['d|80|5000000', 'Data 5 Mbps @ 80 MHz'], ['d|40|2000000', 'Data 2 Mbps @ 40 MHz']];
    const pre = h('select', { onchange: (e) => { const v = e.target.value; if (!v) return; const [k, mhz, br] = v.split('|'); const p = k === 'n' ? 'nominal' : 'data'; if (p === 'data' && b.protocol !== 'CAN FD') { App.toast('Bus is classic CAN'); return; }
      App.edit(() => { if (p === 'nominal') b.bitrate = +br; else b.dataBitrate = +br; b.timing[p] = C.defaultTiming(+br, +mhz * 1e6); sim.refreshFrame(b); }); } }, presets.map(([v, l]) => h('option', { value: v }, l)));
    const card = h('div', { class: 'card' + (S.timingOpen ? '' : ' collapsed') },
      h('div', { class: 'ch' }, 'Bit timing (time quanta) ', h('small', null, ph.map((p, k) => `${p} ${C.fmtRate(der[k].bitrate)} · ${der[k].ntq} TQ · SP ${(der[k].sp * 100).toFixed(1)}%`).join('  |  ')),
        warns.length ? h('span', { class: 'pill err' }, warns.length + ' warnings') : null,
        h('button', { class: 'btn sm tog', onclick: (e) => { S.timingOpen = !S.timingOpen; card.classList.toggle('collapsed', !S.timingOpen); e.target.textContent = S.timingOpen ? 'Hide' : 'Configure'; } }, S.timingOpen ? 'Hide' : 'Configure')),
      h('div', { class: 'cb' },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '18px' } },
          h('div', null, g, warns.length ? h('ul', { class: 'warnlist' }, warns.map(w => h('li', null, w))) : null),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
            ...ph.map(p => h('div', null, h('div', { class: 'muted', style: { marginBottom: '4px' } }, (p === 'nominal' ? 'Nominal' : 'Data') + ' bit, split into time quanta (vertical line = sample point)'), segBar(p))),
            h('div', { class: 'row' }, pre),
            h('div', null, h('b', null, 'Calculator'), h('div', { class: 'row' }, 'Phase', calcPh, 'Target sample point %', calcSp, h('button', { class: 'btn sm', onclick: runCalc }, 'Find combinations')), calcOut),
            h('div', { class: 'grid-form' },
              h('label', { class: 'f' }, h('span', null, 'Our node clock deviation (%)'), h('input', { type: 'number', step: 0.1, value: b.ourClockDevPct || 0, onchange: (e) => App.edit(() => { b.ourClockDevPct = Math.max(-5, Math.min(5, +e.target.value || 0)); sim.refreshFrame(b); }) })),
              h('label', { class: 'f' }, h('span', null, 'Cable length (m)'), h('input', { type: 'number', value: b.cableLength, onchange: (e) => App.edit(() => { b.cableLength = Math.max(1, +e.target.value || 1); sim.refreshFrame(b); }) })),
              h('label', { class: 'f' }, h('span', null, 'Propagation (ns/m)'), h('input', { type: 'number', step: 0.1, value: b.propDelayNsPerM, onchange: (e) => App.edit(() => { b.propDelayNsPerM = Math.max(0, +e.target.value || 0); sim.refreshFrame(b); }) })))))));
    return card;
  };

  const topoSvg = (b) => {
    const sv = App.svg, W = 1000, our = ourNode(b);
    const X = (pos) => 70 + (pos / (b.cableLength || 1)) * (W - 140);
    const svg = sv('svg', { class: 'topo', viewBox: `0 0 ${W} 150`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Bus topology' });
    svg.append(sv('rect', { x: 40, y: 104, width: W - 80, height: 12, rx: 6, fill: 'var(--panel2)', stroke: 'var(--line)' }));
    const segs = []; const N = 120;
    for (let k = 0; k < N; k++) { const x0 = X(k / N * b.cableLength), x1 = X((k + 1) / N * b.cableLength); const r = sv('rect', { x: x0, y: 108, width: Math.max(1, x1 - x0 + 0.6), height: 4, fill: 'var(--rec)' }); svg.append(r); segs.push(r); }
    svg.append(sv('rect', { x: 34, y: 100, width: 8, height: 20, rx: 2, fill: 'var(--text3)' }), sv('rect', { x: W - 42, y: 100, width: 8, height: 20, rx: 2, fill: 'var(--text3)' }));
    svg.append(sv('text', { x: 40, y: 140, 'font-size': 12, fill: 'var(--text3)' }, `0 m · 120 Ω`), sv('text', { x: W - 40, y: 140, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--text3)' }, `${b.cableLength} m · 120 Ω`));
    svg.append(sv('text', { x: W / 2, y: 140, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--text2)' }, `${b.name} · ${C.fmtRate(b.bitrate)}${b.protocol === 'CAN FD' ? ' / ' + C.fmtRate(b.dataBitrate) : ''} · blue = dominant (0), grey = recessive (1)`));
    const nodes = new Map();
    const sorted = b.nodes.slice().sort((a, c) => a.position - c.position);
    sorted.forEach((n, k) => {
      const x = X(n.position), bw = 104, y = (k % 2) ? 46 : 14;
      const box = sv('rect', { x: x - bw / 2, y, width: bw, height: 34, rx: 7, fill: n.ours ? 'var(--accent-weak)' : 'var(--panel)', stroke: 'var(--line2)' });
      const role = sv('text', { x: x + bw / 2 - 6, y: y + 12, 'text-anchor': 'end', 'font-size': 10, 'font-weight': 700 }, '');
      svg.append(sv('line', { x1: x, y1: y + 34, x2: x, y2: 104, stroke: 'var(--line2)', 'stroke-width': 1.5 }), box, role,
        sv('text', { x, y: y + 15, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600, fill: 'var(--text)' }, (n.ours ? '★ ' : '') + n.name),
        sv('text', { x, y: y + 28, 'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--text3)' }, `${n.position} m${our && !n.ours ? ' · ' + Math.round(Math.abs(n.position - our.position) * b.propDelayNsPerM) + ' ns' : n.ours ? ' · our node' : ''}`));
      nodes.set(n.id, { box, role, name: n.name, ours: n.ours });
    });
    return { svg, segs, nodes };
  };

  const loadCard = (b) => {
    const mode = App.settings.loadMode, L = C.busLoad(b, mode);
    const card = h('div', { class: 'card' + (S.loadOpen ? '' : ' collapsed') },
      h('div', { class: 'ch' }, 'Bus load ', h('small', null, `${(L.total * 100).toFixed(2)}% (${mode === 'worst' ? 'worst-case stuffing' : 'actual bits with initial values'})`),
        h('div', { class: 'seg', style: { marginLeft: '8px' } }, [['worst', 'Worst case'], ['actual', 'Actual']].map(([k, l]) => h('button', { class: mode === k ? 'on' : '', onclick: () => { App.settings.loadMode = k; App.saveSettings(); App.render(); } }, l))),
        h('button', { class: 'btn sm tog', onclick: (e) => { S.loadOpen = !S.loadOpen; card.classList.toggle('collapsed', !S.loadOpen); e.target.textContent = S.loadOpen ? 'Hide' : 'Details'; } }, S.loadOpen ? 'Hide' : 'Details')),
      h('div', { class: 'cb' }, App.table('load' + b.id, [
        { key: 'id', label: 'ID', type: 'ro', mono: true, get: r => C.fmtId(r.m), sortVal: r => r.m.canId },
        { key: 'name', label: 'Message', type: 'ro', get: r => r.m.name },
        { key: 'bits', label: 'Frame bits (nominal + data)', type: 'ro', get: r => r.bits.data ? `${r.bits.nominal} + ${r.bits.data}` : r.bits.nominal, sortVal: r => r.bits.nominal + r.bits.data },
        { key: 'time', label: 'Frame time', type: 'ro', get: r => fmtT(r.time), sortVal: r => r.time },
        { key: 'freq', label: 'Rate (Hz)', type: 'ro', get: r => r.freq ? App.fmtNum(r.freq, 6) : 'event', sortVal: r => r.freq },
        { key: 'load', label: 'Load %', type: 'ro', get: r => (r.load * 100).toFixed(3), sortVal: r => r.load }
      ], L.rows),
        h('p', { class: 'faint' }, 'Classic CAN worst case: 47 + 8n + ⌊(34 + 8n − 1)/4⌋ bits (standard ID), 67 + 8n + ⌊(54 + 8n − 1)/4⌋ (extended). CAN FD: arbitration bits at the nominal rate + data-phase bits at the data rate. Event-only messages are excluded.')));
    return card;
  };

  App.renderers.sim = () => {
    const b = App.bus();
    const page = h('div', { class: 'page' });
    if (!b) { page.append(h('div', { class: 'card' }, h('div', { class: 'empty' }, 'No bus.'))); return page; }
    if (sim.busId !== b.id) { sim.busId = b.id; sim.reset(); }
    else sim.refreshFrame(b);
    const our = ourNode(b);
    const busSel = h('select', { onchange: (e) => { sim.pause(); App.select(e.target.value); } }, S.project.buses.map(x => h('option', { value: x.id, selected: x.id === b.id }, x.name)));
    const srcSel = h('select', { onchange: (e) => { sim.source = e.target.value; sim.reset(); App.render(); } },
      h('option', { value: 'all', selected: sim.source === 'all' }, 'All messages (scheduled by cycle + arbitration)'),
      h('option', { value: 'rx', selected: sim.source === 'rx' }, 'Only messages our node receives'),
      h('optgroup', { label: 'Single message' }, b.messages.map(m => h('option', { value: m.id, selected: sim.source === m.id }, `${C.fmtId(m)} ${m.name}`))));
    const speedSel = h('select', { onchange: (e) => { sim.speed = +e.target.value; App.settings.simSpeed = sim.speed; App.saveSettings(); custom.value = sim.speed; } },
      SPEEDS.map(v => h('option', { value: v, selected: v === sim.speed }, v < 1 ? `${v} bit/s (1 bit = ${1 / v} s)` : `${v} bit/s`)), SPEEDS.includes(sim.speed) ? null : h('option', { value: sim.speed, selected: true }, `${sim.speed} bit/s`));
    const custom = h('input', { type: 'number', min: 0.01, step: 'any', value: sim.speed, title: 'Custom speed (bit/s)', style: { width: '80px' }, onchange: (e) => { const v = +e.target.value; if (v > 0) { sim.speed = v; App.settings.simSpeed = v; App.saveSettings(); } } });
    const play = h('button', { class: 'btn primary', onclick: () => sim.playing ? sim.pause() : sim.play(), title: 'Space' }, '▶ Play');
    const topo = topoSvg(b);
    const canvas = h('canvas', { class: 'bitview' });
    const strip = h('div', { class: 'strip' }), frameTitle = h('div', { class: 'muted', style: { marginBottom: '8px' } }), status = h('span', { class: 'faint mono' });
    // receive table
    const rxRows = new Map();
    const rxList = [];
    for (const m of b.messages) for (const s of m.signals) if (our && m.sender !== our.name && sigReceived(m, s, our)) rxList.push({ m, s });
    const rxBody = h('tbody');
    for (const { m, s } of rxList) {
      const cells = []; const bitsBox = h('div', { class: 'rxbits' });
      for (let k = s.length - 1; k >= 0; k--) { const c = h('span', { title: `signal bit ${k}${k === s.length - 1 ? ' (MSB)' : k === 0 ? ' (LSB)' : ''}` }, '·'); cells.push(c); bitsBox.append(c); }
      const val = h('em'); bitsBox.append(val);
      rxRows.set(s.id, { cells, val });
      rxBody.append(h('tr', null, h('td', { class: 'ro' }, h('span', { class: 'swatch', style: { background: App.sigColor(m.signals.indexOf(s)) } }), h('b', null, s.name), h('div', { class: 'faint', style: { fontSize: '11px' } }, `${m.name} ${C.fmtId(m)}`)), h('td', null, bitsBox)));
    }
    const viewSeg = h('div', { class: 'seg' }, [['both', 'Frame + Bit'], ['frame', 'Frame'], ['bit', 'Bit']].map(([k, l]) => h('button', { class: sim.view === k ? 'on' : '', onclick: () => { sim.view = k; App.render(); } }, l)));
    page.append(
      h('div', { class: 'page-h' }, h('h1', null, 'Bus Simulation'), busSel, our ? h('span', { class: 'pill acc' }, '★ Our node: ' + our.name) : h('span', { class: 'pill err' }, 'No "our node" – set one in Specification')),
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Bus topology ', h('small', null, 'the bus line shows the level travelling from the transmitter to each node')), h('div', { class: 'cb' }, topo.svg)),
      timingCard(b),
      h('div', { class: 'card' }, h('div', { class: 'cb sim-ctl' },
        play, h('button', { class: 'btn', onclick: sim.step, title: '→ key: advance to the next sample point' }, '⏭ Step bit'), h('button', { class: 'btn', onclick: sim.next, title: 'N key' }, '⏭⏭ Next frame'), h('button', { class: 'btn', onclick: sim.stop, title: 'Esc' }, '⏹ Stop'),
        h('span', { class: 'faint' }, '|'), 'Speed', speedSel, custom, h('span', { class: 'faint' }, `real ${C.fmtRate(b.bitrate)} slowed down`),
        h('span', { class: 'faint' }, '|'), 'Frames', srcSel, viewSeg, h('span', { class: 'spacer' }), status)),
      sim.view !== 'bit' ? h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Frame view ', h('small', null, 'whole frame bit by bit · S = stuff bit · click a bit to jump')), h('div', { class: 'cb' }, frameTitle, strip,
        h('div', { class: 'legend', style: { marginTop: '8px' } }, h('span', null, h('i', { style: { background: 'color-mix(in srgb, var(--dom) 30%, var(--panel))' } }), 'dominant 0'), h('span', null, h('i', { style: { background: 'var(--panel2)', border: '1px solid var(--line)' } }), 'recessive 1'), h('span', null, h('i', { style: { background: 'var(--warn)' } }), 'stuff bit'), h('span', null, h('i', { style: { background: 'var(--seg-prop)' } }), 'underline = FD data phase'), h('span', null, 'data bits use their signal colour')))) : null,
      sim.view !== 'frame' ? h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Bit view ', h('small', null, 'how each bit is driven, travels and is sampled by our node')), h('div', { class: 'cb' }, canvas,
        h('div', { class: 'legend' }, [['--seg-sync', 'Sync_Seg'], ['--seg-prop', 'Prop_Seg'], ['--seg-ps1', 'Phase_Seg1'], ['--seg-ps2', 'Phase_Seg2'], ['--ok', 'sampled OK'], ['--err', 'bit error']].map(([c, l]) => h('span', null, h('i', { style: { background: `var(${c})` } }), l))))) : null,
      h('div', { class: 'card' }, h('div', { class: 'ch' }, 'Signals our node sees ', h('small', null, our ? `${rxList.length} signals received by ${our.name} · bits fill MSB → LSB slots as they are read` : '')),
        h('div', { class: 'cb' }, rxList.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Signal Name'), h('th', null, 'Bit transferring'))), rxBody) : h('div', { class: 'empty' }, 'Our node receives no signals on this bus.'))),
      loadCard(b));
    sim.dom = { play, strip, frameTitle, status, canvas: sim.view !== 'frame' ? canvas : null, topo: topo.svg, topoSegs: topo.segs, topoNodes: topo.nodes, rxRows, bitEls: [] };
    sim.buildStrip(); updCtl();
    rxList.forEach(({ s }) => updateRxRow(s));
    requestAnimationFrame(() => { draw(); if (sim.playing) { sim.lastTs = 0; if (!sim.raf) sim.raf = requestAnimationFrame(tick); } });
    return page;
  };
  window.addEventListener('resize', () => { if (sim.dom) draw(); });
})();
