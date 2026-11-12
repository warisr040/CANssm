/* CANssm core: data model, bit math, encode/decode, frame builder, bit timing, bus load */
(function (root) {
  'use strict';
  const C = {};

  // ---------- ids / model ----------
  let _id = 0;
  C.uid = (p) => (p || 'x') + Date.now().toString(36) + (++_id).toString(36);

  C.FD_LEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];
  C.dlcToLen = (dlc, fd) => fd ? C.FD_LEN[Math.max(0, Math.min(15, dlc | 0))] : Math.min(8, dlc | 0);
  C.lenToDlc = (len, fd) => {
    if (!fd) return Math.min(8, len | 0);
    for (let i = 0; i < 16; i++) if (C.FD_LEN[i] >= len) return i;
    return 15;
  };

  C.defaultTiming = (bitrate, fclk, spTarget) => {
    fclk = fclk || 80e6; spTarget = spTarget || (bitrate > 1e6 ? 0.8 : 0.875);
    const cands = C.timingCandidates(fclk, bitrate, spTarget).filter(c => Math.abs(c.sp - spTarget) < 0.03);
    cands.sort((a, b) => Math.abs(a.ntq - 16) - Math.abs(b.ntq - 16));
    const best = cands[0];
    return best ? { fclk, brp: best.brp, prop: best.prop, ps1: best.ps1, ps2: best.ps2, sjw: best.sjw }
      : { fclk, brp: 10, prop: 5, ps1: 8, ps2: 2, sjw: 2 };
  };

  C.newBus = (name) => ({
    id: C.uid('b'), name: name || 'CAN1', protocol: 'CAN FD', bitrate: 500000, dataBitrate: 2000000,
    cableLength: 40, propDelayNsPerM: 5,
    timing: { nominal: C.defaultTiming(500000), data: C.defaultTiming(2000000) },
    ourClockDevPct: 0, comment: '', nodes: [], messages: [], extra: []
  });
  C.newNode = (name, pos) => ({ id: C.uid('n'), name: name || 'Node', ours: false, position: pos || 0, comment: '' });
  C.newMessage = (name, id) => ({
    id: C.uid('m'), name: name || 'Message', canId: id || 0x100, extended: false, fd: false, brs: true,
    dlc: 8, cycle: 100, sendType: 'Cyclic', sender: '', receivers: [], comment: '', signals: []
  });
  C.newSignal = (name) => ({
    id: C.uid('s'), name: name || 'Signal', startBit: 0, length: 8, byteOrder: 'Intel', valueType: 'Unsigned',
    factor: 1, offset: 0, min: 0, max: 255, unit: '', initial: 0, receivers: [], valueTable: [], comment: ''
  });
  C.newProject = () => ({ format: 'canssm-project', version: 1, name: 'Untitled', buses: [] });

  C.msgLen = (m) => C.dlcToLen(m.dlc, m.fd);

  // ---------- bit positions ----------
  // Absolute bit position p = byte*8 + bitInByte (bit 0 = LSB of byte).
  // Internal startBit: Intel = LSB position; Motorola = MSB position (DBC convention).
  // Returns array pos[i] = absolute position of signal bit i (i=0 LSB ... len-1 MSB).
  C.signalPositions = (s) => {
    const len = Math.max(1, s.length | 0), out = new Array(len);
    if (s.byteOrder === 'Motorola') {
      let p = s.startBit | 0;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = p;
        p = (p % 8 === 0) ? p + 15 : p - 1;
      }
    } else {
      for (let i = 0; i < len; i++) out[i] = (s.startBit | 0) + i;
    }
    return out;
  };
  C.lsbPos = (s) => C.signalPositions(s)[0];
  C.msbPos = (s) => { const p = C.signalPositions(s); return p[p.length - 1]; };
  // Motorola: convert LSB position -> MSB position for a given length
  C.motorolaMsbFromLsb = (lsb, len) => {
    let p = lsb;
    for (let i = 1; i < len; i++) p = (p % 8 === 7) ? p - 15 : p + 1;
    return p;
  };
  // Displayed start bit per convention ('MSB' | 'LSB'); Intel always LSB.
  C.displayStart = (s, conv) => (s.byteOrder === 'Motorola' && conv === 'LSB') ? C.lsbPos(s) : s.startBit;
  C.fromDisplayStart = (v, s, conv) => (s.byteOrder === 'Motorola' && conv === 'LSB') ? C.motorolaMsbFromLsb(v, s.length) : v;
  // Convert startBit when byte order changes, keeping the LSB position where possible
  C.switchByteOrder = (s, newOrder) => {
    if (s.byteOrder === newOrder) return;
    const lsb = C.lsbPos(s);
    s.byteOrder = newOrder;
    s.startBit = newOrder === 'Motorola' ? C.motorolaMsbFromLsb(lsb, s.length) : lsb;
  };
  // Motorola "linear" index (sawtooth order): m = byte*8 + (7-bit)
  C.mIndex = (p) => (p >> 3) * 8 + (7 - (p & 7));
  C.fromMIndex = (m) => (m >> 3) * 8 + (7 - (m & 7));

  // ---------- encode / decode ----------
  const pow2 = (n) => 1n << BigInt(n);
  C.rawRange = (s) => {
    const n = s.length | 0;
    if (s.valueType === 'Float32' || s.valueType === 'Float64') return null;
    if (s.valueType === 'Signed') return [-(pow2(n - 1)), pow2(n - 1) - 1n];
    return [0n, pow2(n) - 1n];
  };
  C.physRange = (s) => {
    const r = C.rawRange(s); if (!r) return null;
    const a = Number(r[0]) * s.factor + s.offset, b = Number(r[1]) * s.factor + s.offset;
    return [Math.min(a, b), Math.max(a, b)];
  };
  // physical -> unsigned bit pattern (BigInt)
  C.physToBits = (s, phys) => {
    const n = s.length | 0;
    if (s.valueType === 'Float32' || s.valueType === 'Float64') {
      const raw = (phys - s.offset) / (s.factor || 1);
      const dv = new DataView(new ArrayBuffer(8));
      if (s.valueType === 'Float32') { dv.setFloat32(0, raw); return { raw, bits: BigInt(dv.getUint32(0)) }; }
      dv.setFloat64(0, raw); return { raw, bits: dv.getBigUint64(0) };
    }
    let raw = BigInt(Math.round((phys - s.offset) / (s.factor || 1)));
    const [lo, hi] = C.rawRange(s);
    let clamped = false;
    if (raw < lo) { raw = lo; clamped = true; }
    if (raw > hi) { raw = hi; clamped = true; }
    const bits = raw < 0n ? (raw + pow2(n)) : raw;
    return { raw: raw, bits, clamped };
  };
  C.bitsToPhys = (s, bits) => {
    const n = s.length | 0;
    let raw;
    if (s.valueType === 'Float32') { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, Number(bits & 0xffffffffn)); raw = dv.getFloat32(0); }
    else if (s.valueType === 'Float64') { const dv = new DataView(new ArrayBuffer(8)); dv.setBigUint64(0, bits); raw = dv.getFloat64(0); }
    else {
      raw = bits;
      if (s.valueType === 'Signed' && (bits & pow2(n - 1))) raw = bits - pow2(n);
      raw = Number(raw);
    }
    return { raw, phys: raw * s.factor + s.offset };
  };
  C.writeSignal = (bytes, s, bits) => {
    const pos = C.signalPositions(s);
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i], b = p >> 3; if (b >= bytes.length) continue;
      if ((bits >> BigInt(i)) & 1n) bytes[b] |= (1 << (p & 7)); else bytes[b] &= ~(1 << (p & 7));
    }
  };
  C.readSignal = (bytes, s) => {
    const pos = C.signalPositions(s); let v = 0n;
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i], b = p >> 3;
      if (b < bytes.length && (bytes[b] >> (p & 7)) & 1) v |= (1n << BigInt(i));
    }
    return v;
  };
  C.encodeMessage = (m, values) => {
    const bytes = new Uint8Array(C.msgLen(m));
    for (const s of m.signals) {
      const v = values && values[s.id] != null ? values[s.id] : s.initial;
      C.writeSignal(bytes, s, C.physToBits(s, Number(v) || 0).bits);
    }
    return bytes;
  };
  C.hex = (bytes) => Array.from(bytes, b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  C.fmtId = (m) => '0x' + (m.canId >>> 0).toString(16).toUpperCase().padStart(m.extended ? 8 : 3, '0');
  C.parseId = (t) => {
    t = String(t).trim(); if (!t) return NaN;
    if (/^0x/i.test(t)) return parseInt(t, 16);
    if (/[a-f]/i.test(t) || /h$/i.test(t)) return parseInt(t.replace(/h$/i, ''), 16);
    return parseInt(t, 10);
  };

  // ---------- validation ----------
  C.validate = (proj) => {
    const out = [];
    for (const bus of proj.buses) {
      const ids = new Map(), mnames = new Set();
      for (const m of bus.messages) {
        const key = (m.extended ? 'x' : 's') + m.canId;
        if (ids.has(key)) out.push({ level: 'error', bus: bus.id, msg: m.id, text: `Duplicate ID ${C.fmtId(m)} (${ids.get(key)} / ${m.name})` });
        else ids.set(key, m.name);
        if (mnames.has(m.name)) out.push({ level: 'warn', bus: bus.id, msg: m.id, text: `Duplicate message name "${m.name}"` });
        mnames.add(m.name);
        if (!m.fd && m.dlc > 8) out.push({ level: 'error', bus: bus.id, msg: m.id, text: `${m.name}: classic CAN DLC above 8` });
        if (m.fd && bus.protocol !== 'CAN FD') out.push({ level: 'error', bus: bus.id, msg: m.id, text: `${m.name}: CAN FD frame on a classic CAN bus` });
        if (!m.extended && m.canId > 0x7FF) out.push({ level: 'error', bus: bus.id, msg: m.id, text: `${m.name}: standard ID above 0x7FF` });
        if (m.extended && m.canId > 0x1FFFFFFF) out.push({ level: 'error', bus: bus.id, msg: m.id, text: `${m.name}: extended ID above 0x1FFFFFFF` });
        const len = C.msgLen(m), owner = new Map(), snames = new Set();
        for (const s of m.signals) {
          if (snames.has(s.name)) out.push({ level: 'warn', bus: bus.id, msg: m.id, sig: s.id, text: `${m.name}: duplicate signal name "${s.name}"` });
          snames.add(s.name);
          const pos = C.signalPositions(s); let past = false;
          for (const p of pos) {
            if (p < 0 || (p >> 3) >= len) { past = true; continue; }
            if (owner.has(p)) {
              const o = owner.get(p);
              if (!o.reported) { out.push({ level: 'error', bus: bus.id, msg: m.id, sig: s.id, text: `${m.name}: ${s.name} overlaps ${o.name} (bit ${p})` }); o.reported = true; }
            } else owner.set(p, { name: s.name });
          }
          if (past) out.push({ level: 'error', bus: bus.id, msg: m.id, sig: s.id, text: `${m.name}: ${s.name} extends past the ${len}-byte payload` });
          if ((s.valueType === 'Float32' && s.length !== 32) || (s.valueType === 'Float64' && s.length !== 64))
            out.push({ level: 'error', bus: bus.id, msg: m.id, sig: s.id, text: `${m.name}: ${s.name} float length must be ${s.valueType === 'Float32' ? 32 : 64}` });
          const pr = C.physRange(s);
          if (pr && (s.min < pr[0] - 1e-9 || s.max > pr[1] + 1e-9))
            out.push({ level: 'warn', bus: bus.id, msg: m.id, sig: s.id, text: `${m.name}: ${s.name} min/max outside representable ${+pr[0].toPrecision(10)}…${+pr[1].toPrecision(10)}` });
        }
      }
      const ours = bus.nodes.filter(n => n.ours);
      if (bus.nodes.length && ours.length !== 1) out.push({ level: 'warn', bus: bus.id, text: `${bus.name}: mark exactly one node as "our node" (currently ${ours.length})` });
      for (const ph of ['nominal', 'data']) {
        if (ph === 'data' && bus.protocol !== 'CAN FD') continue;
        for (const w of C.timingWarnings(bus, ph)) out.push({ level: 'warn', bus: bus.id, text: `${bus.name} ${ph} timing: ${w}` });
      }
    }
    return out;
  };

  // ---------- bit timing ----------
  C.timingDerived = (t) => {
    const ntq = 1 + t.prop + t.ps1 + t.ps2, tq = t.brp / t.fclk;
    return { ntq, tq, bitTime: tq * ntq, bitrate: 1 / (tq * ntq), sp: (1 + t.prop + t.ps1) / ntq };
  };
  C.timingWarnings = (bus, ph) => {
    const t = bus.timing[ph], d = C.timingDerived(t), w = [];
    const target = ph === 'data' ? bus.dataBitrate : bus.bitrate;
    if (Math.abs(d.bitrate - target) / target > 0.001) w.push(`bitrate ${C.fmtRate(d.bitrate)} ≠ bus ${C.fmtRate(target)}`);
    if (t.sjw > t.ps1 || t.sjw > t.ps2) w.push('SJW larger than Phase_Seg1 or Phase_Seg2');
    if (d.ntq < 8 || d.ntq > (ph === 'data' ? 49 : 385)) w.push(`${d.ntq} TQ per bit is outside typical controller range`);
    const lo = ph === 'data' ? 0.6 : 0.75, hi = ph === 'data' ? 0.9 : 0.9;
    if (d.sp < lo || d.sp > hi) w.push(`sample point ${(d.sp * 100).toFixed(1)}% outside ${lo * 100}–${hi * 100}%`);
    return w;
  };
  C.fmtRate = (r) => r >= 1e6 ? (+(r / 1e6).toFixed(3)) + ' Mbps' : (+(r / 1e3).toFixed(3)) + ' kbps';
  // valid combos for target bitrate & sample point
  C.timingCandidates = (fclk, bitrate, spTarget) => {
    const out = [];
    for (let brp = 1; brp <= 64; brp++) {
      const ntqF = fclk / brp / bitrate, ntq = Math.round(ntqF);
      if (Math.abs(ntqF - ntq) > 1e-9 || ntq < 8 || ntq > 80) continue;
      const tseg1 = Math.round(spTarget * ntq) - 1, ps2 = ntq - 1 - tseg1;
      if (ps2 < 1 || tseg1 < 2) continue;
      const prop = Math.max(1, Math.floor(tseg1 / 2)), ps1 = tseg1 - prop;
      out.push({ brp, ntq, prop, ps1, ps2, sjw: Math.min(ps2, ps1), sp: (1 + tseg1) / ntq });
    }
    out.sort((a, b) => Math.abs(a.sp - spTarget) - Math.abs(b.sp - spTarget) || a.brp - b.brp);
    return out;
  };

  // ---------- CRC ----------
  const crcBits = (bits, poly, width, init) => {
    let crc = init, top = 1 << (width - 1), mask = (1 << width) - 1;
    for (const b of bits) {
      const nxt = b ^ ((crc & top) ? 1 : 0);
      crc = (crc << 1) & mask;
      if (nxt) crc ^= poly;
    }
    return crc;
  };
  const toBits = (v, n) => { const a = []; for (let i = n - 1; i >= 0; i--) a.push((v >>> i) & 1); return a; };
  C._crcBits = crcBits;

  // ---------- frame builder ----------
  // Returns array of bits: {v, field, stuff, fixedStuff, phase:'nominal'|'data', dataPos}
  C.buildFrame = (m, bytes) => {
    const raw = []; // unstuffed sequence with metadata
    const push = (field, vals, extra) => { for (const v of vals) raw.push(Object.assign({ v, field }, extra || {})); };
    const len = bytes.length, dlc = C.lenToDlc(len, m.fd);
    push('SOF', [0]);
    if (m.extended) {
      push('ID', toBits(m.canId >>> 18, 11));
      push('SRR', [1]); push('IDE', [1]);
      push('ID', toBits(m.canId & 0x3FFFF, 18));
      if (m.fd) { push('RRS', [0]); push('FDF', [1]); push('res', [0]); }
      else { push('RTR', [0]); push('r1', [0]); push('r0', [0]); }
    } else {
      push('ID', toBits(m.canId & 0x7FF, 11));
      if (m.fd) { push('RRS', [0]); push('IDE', [0]); push('FDF', [1]); push('res', [0]); }
      else { push('RTR', [0]); push('IDE', [0]); push('r0', [0]); }
    }
    if (m.fd) { push('BRS', [m.brs ? 1 : 0]); push('ESI', [0]); }
    push('DLC', toBits(dlc, 4));
    for (let b = 0; b < len; b++) for (let k = 7; k >= 0; k--) raw.push({ v: (bytes[b] >> k) & 1, field: 'DATA', dataPos: b * 8 + k, byte: b });

    // dynamic stuffing over SOF..end of data (classic: through CRC)
    const out = [];
    let last = -1, run = 0, stuffCount = 0;
    const emit = (bit, isDataPhase) => {
      out.push(bit);
      if (bit.v === last) run++; else { last = bit.v; run = 1; }
      if (run === 5) {
        const sb = { v: 1 - bit.v, field: bit.field, stuff: true };
        out.push(sb); stuffCount++; last = sb.v; run = 1;
      }
    };
    if (!m.fd) {
      const crc = crcBits(raw.map(b => b.v), 0x4599, 15, 0);
      push('CRC', toBits(crc, 15));
      for (const b of raw) emit(b);
    } else {
      for (const b of raw) emit(b);
      // stuff count: gray code of (stuffCount mod 8) + even parity, preceded by fixed stuff bit
      const g = [0, 1, 3, 2, 6, 7, 5, 4][stuffCount % 8], gb = toBits(g, 3), par = (gb[0] ^ gb[1] ^ gb[2]);
      const crcLen = len <= 16 ? 17 : 21, poly = len <= 16 ? 0x1685B : 0x102899;
      const sc = gb.concat([par]);
      // CRC covers SOF..stuff count including dynamic stuff bits, excluding fixed stuff bits
      const crcIn = out.map(b => b.v).concat(sc);
      const crc = crcBits(crcIn, poly, crcLen, 1 << (crcLen - 1));
      const fieldBits = sc.map(v => ({ v, field: 'SBC' })).concat(toBits(crc, crcLen).map(v => ({ v, field: 'CRC' })));
      // fixed stuff bit before first bit and after every 4 bits
      let prev = out[out.length - 1].v;
      for (let i = 0; i < fieldBits.length; i++) {
        if (i % 4 === 0) { out.push({ v: 1 - prev, field: fieldBits[i].field, stuff: true, fixedStuff: true }); prev = 1 - prev; }
        out.push(fieldBits[i]); prev = fieldBits[i].v;
      }
      out.push({ v: 1 - prev, field: 'CRC', stuff: true, fixedStuff: true });
    }
    out.push({ v: 1, field: 'CRC delim' });
    out.push({ v: 0, field: 'ACK' });
    out.push({ v: 1, field: 'ACK delim' });
    for (let i = 0; i < 7; i++) out.push({ v: 1, field: 'EOF' });
    for (let i = 0; i < 3; i++) out.push({ v: 1, field: 'IFS' });
    // phases: data phase from bit after BRS through CRC delimiter (when BRS=1)
    let inData = false;
    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      b.phase = inData ? 'data' : 'nominal';
      if (m.fd && m.brs && b.field === 'BRS' && !b.stuff) inData = true;
      if (b.field === 'CRC delim') { b.phase = 'data'; inData = false; if (!(m.fd && m.brs)) b.phase = 'nominal'; }
      b.index = i;
    }
    out.stuffCount = stuffCount;
    return out;
  };

  // ---------- bus load ----------
  C.frameBitsWorst = (m, bus) => {
    const n = C.msgLen(m);
    if (!m.fd) {
      return m.extended ? { nominal: 67 + 8 * n + Math.floor((54 + 8 * n - 1) / 4), data: 0 }
        : { nominal: 47 + 8 * n + Math.floor((34 + 8 * n - 1) / 4), data: 0 };
    }
    const arb = m.extended ? 33 : 14; // SOF..BRS (approx incl. control bits)
    const arbStuff = Math.floor((arb - 1) / 4);
    const crcLen = n <= 16 ? 17 : 21, fixed = Math.ceil((4 + crcLen) / 4) + 1;
    const dataPh = 1 + 4 + 8 * n; // ESI, DLC, data
    const dynStuff = Math.floor((dataPh - 1) / 4);
    const tail = 2 + 7 + 3; // ACK, ACK delim, EOF, IFS
    const d = dataPh + dynStuff + 4 + crcLen + fixed + 1; // + CRC delim
    if (m.brs && bus.protocol === 'CAN FD') return { nominal: arb + arbStuff + tail, data: d };
    return { nominal: arb + arbStuff + tail + d, data: 0 };
  };
  C.frameTime = (bits, bus) => bits.nominal / bus.bitrate + (bits.data ? bits.data / bus.dataBitrate : 0);
  C.frameBitsActual = (m, bus) => {
    const f = C.buildFrame(m, C.encodeMessage(m));
    const r = { nominal: 0, data: 0 };
    for (const b of f) r[b.phase === 'data' && m.fd && m.brs ? 'data' : 'nominal']++;
    return r;
  };
  C.busLoad = (bus, mode) => {
    const rows = []; let total = 0;
    for (const m of bus.messages) {
      const bits = mode === 'actual' ? C.frameBitsActual(m, bus) : C.frameBitsWorst(m, bus);
      const t = C.frameTime(bits, bus);
      const per = m.cycle > 0 ? m.cycle / 1000 : 0;
      const load = per ? t / per : 0;
      total += load;
      rows.push({ m, bits, time: t, freq: per ? 1 / per : 0, load });
    }
    return { total, rows };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  root.CANssmCore = C;
})(typeof globalThis !== 'undefined' ? globalThis : this);
