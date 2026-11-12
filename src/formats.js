/* CANssm file formats: DBC, ARXML (AUTOSAR 4.3), XLSX (localized profiles), A2L export */
(function (root) {
  'use strict';
  const C = root.CANssmCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const F = {};

  const q = (s) => '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const num = (v) => { const n = +v; return Number.isFinite(n) ? +n.toPrecision(15) : 0; };
  const sanitize = (s) => String(s || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || '_';

  // ======================= DBC =======================
  F.dbcExport = (bus) => {
    const L = [];
    L.push('VERSION ""', '', 'NS_ :', '\tNS_DESC_', '\tCM_', '\tBA_DEF_', '\tBA_', '\tVAL_', '\tBA_DEF_DEF_', '\tSIG_VALTYPE_', '', 'BS_:', '');
    L.push('BU_: ' + bus.nodes.map(n => sanitize(n.name)).join(' '), '', '');
    const dbcId = (m) => (m.extended ? (m.canId | 0x80000000) >>> 0 : m.canId);
    for (const m of bus.messages) {
      L.push(`BO_ ${dbcId(m)} ${sanitize(m.name)}: ${C.msgLen(m)} ${m.sender ? sanitize(m.sender) : 'Vector__XXX'}`);
      for (const s of m.signals) {
        const rx = (s.receivers && s.receivers.length ? s.receivers : (m.receivers || [])).map(sanitize);
        L.push(` SG_ ${sanitize(s.name)} : ${s.startBit}|${s.length}@${s.byteOrder === 'Motorola' ? 0 : 1}${s.valueType === 'Signed' ? '-' : '+'} (${num(s.factor)},${num(s.offset)}) [${num(s.min)}|${num(s.max)}] ${q(s.unit)} ${rx.length ? rx.join(',') : 'Vector__XXX'}`);
      }
      L.push('');
    }
    L.push('');
    if (bus.comment) L.push(`CM_ ${q(bus.comment)};`);
    for (const n of bus.nodes) if (n.comment) L.push(`CM_ BU_ ${sanitize(n.name)} ${q(n.comment)};`);
    for (const m of bus.messages) {
      if (m.comment) L.push(`CM_ BO_ ${dbcId(m)} ${q(m.comment)};`);
      for (const s of m.signals) if (s.comment) L.push(`CM_ SG_ ${dbcId(m)} ${sanitize(s.name)} ${q(s.comment)};`);
    }
    L.push('BA_DEF_  "BusType" STRING ;');
    L.push('BA_DEF_  "Baudrate" INT 1000 1000000;');
    L.push('BA_DEF_  "BaudrateCANFD" INT 1000 16000000;');
    L.push('BA_DEF_ BO_  "GenMsgCycleTime" INT 0 65535;');
    L.push('BA_DEF_ BO_  "GenMsgSendType" ENUM  "Cyclic","Event","CyclicIfActive","NoMsgSendType","IfActive","CyclicAndEvent";');
    L.push('BA_DEF_ BO_  "VFrameFormat" ENUM  "StandardCAN","ExtendedCAN","reserved","reserved","reserved","reserved","reserved","reserved","reserved","reserved","reserved","reserved","reserved","reserved","StandardCAN_FD","ExtendedCAN_FD";');
    L.push('BA_DEF_ BO_  "CANFD_BRS" ENUM  "0","1";');
    L.push('BA_DEF_ SG_  "GenSigStartValue" FLOAT -1e100 1e100;');
    L.push('BA_DEF_ BU_  "NodePosition_m" FLOAT 0 100000;');
    L.push('BA_DEF_DEF_  "BusType" "CAN";', 'BA_DEF_DEF_  "GenMsgCycleTime" 0;', 'BA_DEF_DEF_  "GenMsgSendType" "NoMsgSendType";',
      'BA_DEF_DEF_  "VFrameFormat" "StandardCAN";', 'BA_DEF_DEF_  "CANFD_BRS" "1";', 'BA_DEF_DEF_  "GenSigStartValue" 0;', 'BA_DEF_DEF_  "NodePosition_m" 0;');
    L.push(`BA_ "BusType" ${q(bus.protocol === 'CAN FD' ? 'CAN FD' : 'CAN')};`);
    L.push(`BA_ "Baudrate" ${bus.bitrate};`);
    if (bus.protocol === 'CAN FD') L.push(`BA_ "BaudrateCANFD" ${bus.dataBitrate};`);
    for (const n of bus.nodes) L.push(`BA_ "NodePosition_m" BU_ ${sanitize(n.name)} ${num(n.position)};`);
    const sendTypes = ['Cyclic', 'Event', 'CyclicIfActive', 'NoMsgSendType', 'IfActive', 'CyclicAndEvent'];
    for (const m of bus.messages) {
      if (m.cycle) L.push(`BA_ "GenMsgCycleTime" BO_ ${dbcId(m)} ${Math.round(m.cycle)};`);
      const st = { 'Cyclic': 0, 'Event': 1, 'Cyclic+Event': 5 }[m.sendType];
      if (st != null) L.push(`BA_ "GenMsgSendType" BO_ ${dbcId(m)} ${st};`);
      const ff = m.fd ? (m.extended ? 15 : 14) : (m.extended ? 1 : 0);
      L.push(`BA_ "VFrameFormat" BO_ ${dbcId(m)} ${ff};`);
      if (m.fd) L.push(`BA_ "CANFD_BRS" BO_ ${dbcId(m)} ${m.brs ? 1 : 0};`);
      for (const s of m.signals) {
        const raw = C.physToBits(s, +s.initial || 0).raw;
        if (Number(raw) !== 0) L.push(`BA_ "GenSigStartValue" SG_ ${dbcId(m)} ${sanitize(s.name)} ${Number(raw)};`);
      }
    }
    for (const m of bus.messages) for (const s of m.signals) {
      if (s.valueTable && s.valueTable.length)
        L.push(`VAL_ ${dbcId(m)} ${sanitize(s.name)} ${s.valueTable.map(e => `${e.value} ${q(e.text)}`).join(' ')} ;`);
    }
    for (const m of bus.messages) for (const s of m.signals) {
      if (s.valueType === 'Float32' || s.valueType === 'Float64') L.push(`SIG_VALTYPE_ ${dbcId(m)} ${sanitize(s.name)} : ${s.valueType === 'Float32' ? 1 : 2};`);
    }
    if (bus.extra && bus.extra.length) { L.push(''); for (const x of bus.extra) L.push(x); }
    return L.join('\r\n') + '\r\n';
  };

  // tokenizer for statement content
  const tokenize = (s) => {
    const t = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        let j = i + 1, v = '';
        while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && j + 1 < s.length) { v += s[j + 1]; j += 2; } else v += s[j++]; }
        t.push({ str: v }); i = j + 1; continue;
      }
      if (/[;:,|@()\[\]]/.test(c)) { t.push(c); i++; continue; }
      let j = i; while (j < s.length && !/[\s;:,|@()\[\]"]/.test(s[j])) j++;
      t.push(s.slice(i, j)); i = j;
    }
    return t;
  };

  F.dbcImport = (text, name) => {
    const bus = C.newBus(name || 'CAN');
    bus.protocol = 'CAN'; bus.messages = []; bus.nodes = []; bus.extra = [];
    const report = { messages: 0, signals: 0, skipped: [], warnings: [] };
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const byDbcId = new Map(); let cur = null;
    const attrDefs = {}; const pendingAttr = [];
    let i = 0;
    const knownStmt = /^(CM_|BA_DEF_DEF_|BA_DEF_|BA_|VAL_|SIG_VALTYPE_|VAL_TABLE_|BA_DEF_REL_|BA_REL_|BA_DEF_DEF_REL_|SIG_GROUP_|EV_|ENVVAR_DATA_|BO_TX_BU_|SG_MUL_VAL_|SIGTYPE_|SIG_TYPE_REF_|CAT_DEF_|CAT_|FILTER|SGTYPE_)/;
    const readStmt = () => { // read until ';' outside quotes
      let s = '', inq = false;
      while (i < lines.length) {
        const ln = lines[i++]; s += (s ? '\n' : '') + ln;
        for (let k = 0; k < ln.length; k++) { if (ln[k] === '\\') { k++; continue; } if (ln[k] === '"') inq = !inq; }
        if (!inq && /;\s*$/.test(ln)) break;
      }
      return s;
    };
    while (i < lines.length) {
      const line = lines[i]; const tl = line.trim();
      if (!tl) { i++; cur = tl ? cur : cur; continue; }
      let mm;
      if ((mm = tl.match(/^BU_\s*:(.*)$/))) {
        i++; const names = mm[1].trim().split(/\s+/).filter(Boolean);
        names.forEach((n, k) => bus.nodes.push(C.newNode(n, 0)));
        continue;
      }
      if ((mm = tl.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/))) {
        i++;
        const rawId = Number(mm[1]) >>> 0, ext = (rawId & 0x80000000) !== 0;
        const m = C.newMessage(mm[2], ext ? rawId & 0x1FFFFFFF : rawId);
        m.extended = ext; const len = +mm[3];
        m.fd = len > 8; m.dlc = C.lenToDlc(len, m.fd); m.sender = mm[4] === 'Vector__XXX' ? '' : mm[4];
        m.cycle = 0; m.sendType = 'Cyclic';
        bus.messages.push(m); byDbcId.set(rawId, m); cur = m; report.messages++;
        continue;
      }
      if ((mm = tl.match(/^SG_\s+(\w+)\s*(M|m\d+M?)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(([^,]*),([^)]*)\)\s*\[([^|]*)\|([^\]]*)\]\s*"((?:[^"\\]|\\.)*)"\s*(.*)$/))) {
        i++;
        if (!cur) { report.skipped.push('SG_ outside BO_: ' + mm[1]); continue; }
        const s = C.newSignal(mm[1]);
        s.startBit = +mm[3]; s.length = +mm[4]; s.byteOrder = mm[5] === '0' ? 'Motorola' : 'Intel';
        s.valueType = mm[6] === '-' ? 'Signed' : 'Unsigned';
        s.factor = +mm[7] || 0; s.offset = +mm[8] || 0; s.min = +mm[9] || 0; s.max = +mm[10] || 0; s.unit = mm[11];
        s.receivers = mm[12].split(/[\s,]+/).filter(x => x && x !== 'Vector__XXX');
        s.initial = s.offset; // raw 0 by default
        if (mm[2]) report.warnings.push(`${cur.name}.${s.name}: multiplexing not supported, imported as plain signal`);
        cur.signals.push(s); report.signals++;
        continue;
      }
      if (/^SG_\s/.test(tl)) { i++; report.skipped.push('Unparsed signal: ' + tl.slice(0, 60)); continue; }
      if (/^(VERSION|NS_|BS_|\s)/.test(tl) || /^(NS_DESC_|CM_|BA_DEF_|BA_|VAL_|BA_DEF_DEF_|SIG_VALTYPE_)\s*$/.test(tl)) {
        if (/^NS_\s*:/.test(tl)) { i++; while (i < lines.length && /^\s+\S/.test(lines[i])) i++; continue; }
        i++; continue;
      }
      if (knownStmt.test(tl)) {
        const stmt = readStmt();
        const tk = tokenize(stmt.replace(/;\s*$/, ''));
        const kw = tk[0];
        if (kw === 'CM_') {
          if (tk[1] && tk[1].str != null) bus.comment = tk[1].str;
          else if (tk[1] === 'BO_') { const m = byDbcId.get(Number(tk[2]) >>> 0); if (m) m.comment = tk[3].str; }
          else if (tk[1] === 'SG_') { const m = byDbcId.get(Number(tk[2]) >>> 0); const s = m && m.signals.find(x => x.name === tk[3]); if (s) s.comment = tk[4].str; }
          else if (tk[1] === 'BU_') { const n = bus.nodes.find(x => x.name === tk[2]); if (n) n.comment = tk[3].str; }
          else bus.extra.push(stmt);
        } else if (kw === 'BA_DEF_') {
          let k = 1, obj = ''; if (['BO_', 'SG_', 'BU_', 'EV_'].includes(tk[1])) { obj = tk[1]; k = 2; }
          const nm = tk[k] && tk[k].str; const type = tk[k + 1];
          const enums = type === 'ENUM' ? tk.slice(k + 2).filter(x => x && x.str != null).map(x => x.str) : null;
          attrDefs[nm] = { obj, type, enums };
          if (!['BusType', 'Baudrate', 'BaudrateCANFD', 'GenMsgCycleTime', 'GenMsgSendType', 'VFrameFormat', 'CANFD_BRS', 'GenSigStartValue', 'NodePosition_m'].includes(nm)) bus.extra.push(stmt);
        } else if (kw === 'BA_DEF_DEF_') {
          const nm = tk[1] && tk[1].str;
          if (!['BusType', 'Baudrate', 'BaudrateCANFD', 'GenMsgCycleTime', 'GenMsgSendType', 'VFrameFormat', 'CANFD_BRS', 'GenSigStartValue', 'NodePosition_m'].includes(nm)) bus.extra.push(stmt);
        } else if (kw === 'BA_') {
          pendingAttr.push({ tk, stmt });
        } else if (kw === 'VAL_') {
          const m = byDbcId.get(Number(tk[1]) >>> 0); const s = m && m.signals.find(x => x.name === tk[2]);
          if (s) { const vt = []; for (let k = 3; k + 1 < tk.length; k += 2) if (tk[k + 1] && tk[k + 1].str != null) vt.push({ value: Number(tk[k]), text: tk[k + 1].str }); s.valueTable = vt; }
          else bus.extra.push(stmt);
        } else if (kw === 'SIG_VALTYPE_') {
          const m = byDbcId.get(Number(tk[1]) >>> 0); const s = m && m.signals.find(x => x.name === tk[2]);
          const v = tk[tk.length - 1]; if (s) s.valueType = v === '1' ? 'Float32' : v === '2' ? 'Float64' : s.valueType;
        } else bus.extra.push(stmt);
        continue;
      }
      // unknown line: keep
      bus.extra.push(line); i++;
    }
    const enumVal = (nm, v) => { const d = attrDefs[nm]; if (d && d.enums && /^\d+$/.test(String(v))) return d.enums[+v]; return v; };
    for (const { tk, stmt } of pendingAttr) {
      const nm = tk[1] && tk[1].str; const val = (t) => t && t.str != null ? t.str : t;
      if (tk[2] === 'BO_') {
        const m = byDbcId.get(Number(tk[3]) >>> 0); const v = val(tk[4]); if (!m) continue;
        if (nm === 'GenMsgCycleTime') m.cycle = +v;
        else if (nm === 'GenMsgSendType') { const e = enumVal(nm, v); m.sendType = /CyclicAndEvent/i.test(e) ? 'Cyclic+Event' : /^Cyclic/i.test(e) ? 'Cyclic' : /Event|IfActive/i.test(e) ? 'Event' : 'Cyclic'; }
        else if (nm === 'VFrameFormat') { const e = String(enumVal(nm, v)); m.fd = /FD/i.test(e); if (/Extended/i.test(e)) m.extended = true; m.dlc = C.lenToDlc(C.dlcToLen(m.dlc, true), m.fd); }
        else if (nm === 'CANFD_BRS') m.brs = String(enumVal(nm, v)) === '1';
        else bus.extra.push(stmt);
      } else if (tk[2] === 'SG_') {
        const m = byDbcId.get(Number(tk[3]) >>> 0); const s = m && m.signals.find(x => x.name === tk[4]);
        if (s && nm === 'GenSigStartValue') s.initial = num(C.bitsToPhys(s, 0n).phys + Number(val(tk[5])) * s.factor);
        else bus.extra.push(stmt);
      } else if (tk[2] === 'BU_') {
        const n = bus.nodes.find(x => x.name === tk[3]);
        if (n && nm === 'NodePosition_m') n.position = +val(tk[4]); else bus.extra.push(stmt);
      } else if (tk[2] === 'EV_' || tk[2] === 'BU_SG_REL_' || tk[2] === 'BU_BO_REL_') bus.extra.push(stmt);
      else {
        const v = val(tk[2]);
        if (nm === 'BusType') bus.protocol = /FD/i.test(v) ? 'CAN FD' : 'CAN';
        else if (nm === 'Baudrate') bus.bitrate = +v;
        else if (nm === 'BaudrateCANFD') bus.dataBitrate = +v;
        else bus.extra.push(stmt);
      }
    }
    if (bus.messages.some(m => m.fd)) bus.protocol = 'CAN FD';
    for (const m of bus.messages) {
      // message receivers = union of signal receivers
      const set = new Set(); m.signals.forEach(s => s.receivers.forEach(r => set.add(r))); m.receivers = [...set];
      if (!m.cycle) m.sendType = m.sendType === 'Cyclic' ? 'Event' : m.sendType;
    }
    // spread nodes along the bus if no positions
    if (bus.nodes.length && bus.nodes.every(n => !n.position)) bus.nodes.forEach((n, k) => n.position = Math.round(bus.cableLength * k / Math.max(1, bus.nodes.length - 1)));
    if (bus.nodes.length && !bus.nodes.some(n => n.ours)) bus.nodes[0].ours = true;
    bus.timing = { nominal: C.defaultTiming(bus.bitrate), data: C.defaultTiming(bus.dataBitrate) };
    return { bus, report };
  };

  // ======================= ARXML =======================
  const x = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  F.arxmlExport = (proj) => {
    const o = [];
    const P = (s) => o.push(s);
    P('<?xml version="1.0" encoding="UTF-8"?>');
    P('<AUTOSAR xmlns="http://autosar.org/schema/r4.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://autosar.org/schema/r4.0 AUTOSAR_4-3-0.xsd">');
    P('<AR-PACKAGES>');
    const pkg = (name, body) => { P(`<AR-PACKAGE><SHORT-NAME>${name}</SHORT-NAME><ELEMENTS>`); body(); P('</ELEMENTS></AR-PACKAGE>'); };
    const sn = sanitize;
    const allNodes = new Map(); proj.buses.forEach(b => b.nodes.forEach(n => allNodes.set(sn(n.name), n)));
    // Clusters
    pkg('Cluster', () => {
      for (const b of proj.buses) {
        P(`<CAN-CLUSTER><SHORT-NAME>${sn(b.name)}</SHORT-NAME>${b.comment ? `<DESC><L-2 L="EN">${x(b.comment)}</L-2></DESC>` : ''}<CAN-CLUSTER-VARIANTS><CAN-CLUSTER-CONDITIONAL>`);
        P(`<BAUDRATE>${b.bitrate}</BAUDRATE><PHYSICAL-CHANNELS><CAN-PHYSICAL-CHANNEL><SHORT-NAME>${sn(b.name)}_Channel</SHORT-NAME>`);
        P('<COMM-CONNECTORS>');
        for (const n of b.nodes) P(`<COMMUNICATION-CONNECTOR-REF-CONDITIONAL><COMMUNICATION-CONNECTOR-REF DEST="CAN-COMMUNICATION-CONNECTOR">/ECU/${sn(n.name)}/${sn(n.name)}_${sn(b.name)}</COMMUNICATION-CONNECTOR-REF></COMMUNICATION-CONNECTOR-REF-CONDITIONAL>`);
        P('</COMM-CONNECTORS><FRAME-TRIGGERINGS>');
        for (const m of b.messages) {
          const ports = [];
          if (m.sender) ports.push(`/ECU/${sn(m.sender)}/${sn(m.sender)}_${sn(b.name)}/FP_${sn(m.name)}_Tx`);
          for (const r of (m.receivers || [])) ports.push(`/ECU/${sn(r)}/${sn(r)}_${sn(b.name)}/FP_${sn(m.name)}_Rx`);
          P(`<CAN-FRAME-TRIGGERING><SHORT-NAME>FT_${sn(m.name)}</SHORT-NAME>`);
          if (ports.length) P('<FRAME-PORT-REFS>' + ports.map(p => `<FRAME-PORT-REF DEST="FRAME-PORT">${p}</FRAME-PORT-REF>`).join('') + '</FRAME-PORT-REFS>');
          P(`<FRAME-REF DEST="CAN-FRAME">/Frame/${sn(b.name)}/${sn(m.name)}</FRAME-REF>`);
          P(`<PDU-TRIGGERINGS><PDU-TRIGGERING-REF-CONDITIONAL><PDU-TRIGGERING-REF DEST="PDU-TRIGGERING">/Cluster/${sn(b.name)}/${sn(b.name)}_Channel/PT_${sn(m.name)}</PDU-TRIGGERING-REF></PDU-TRIGGERING-REF-CONDITIONAL></PDU-TRIGGERINGS>`);
          P(`<CAN-ADDRESSING-MODE>${m.extended ? 'EXTENDED' : 'STANDARD'}</CAN-ADDRESSING-MODE><CAN-FRAME-RX-BEHAVIOR>${m.fd ? 'CAN-FD' : 'CAN-20'}</CAN-FRAME-RX-BEHAVIOR><CAN-FRAME-TX-BEHAVIOR>${m.fd ? 'CAN-FD' : 'CAN-20'}</CAN-FRAME-TX-BEHAVIOR>`);
          P(`<IDENTIFIER>${m.canId}</IDENTIFIER>`);
          P('</CAN-FRAME-TRIGGERING>');
        }
        P('</FRAME-TRIGGERINGS><I-SIGNAL-TRIGGERINGS>');
        for (const m of b.messages) for (const s of m.signals) P(`<I-SIGNAL-TRIGGERING><SHORT-NAME>ST_${sn(m.name)}_${sn(s.name)}</SHORT-NAME><I-SIGNAL-REF DEST="I-SIGNAL">/ISignal/${sn(b.name)}/${sn(m.name)}_${sn(s.name)}</I-SIGNAL-REF></I-SIGNAL-TRIGGERING>`);
        P('</I-SIGNAL-TRIGGERINGS><PDU-TRIGGERINGS>');
        for (const m of b.messages) {
          P(`<PDU-TRIGGERING><SHORT-NAME>PT_${sn(m.name)}</SHORT-NAME><I-PDU-REF DEST="I-SIGNAL-I-PDU">/PDU/${sn(b.name)}/${sn(m.name)}</I-PDU-REF><I-SIGNAL-TRIGGERINGS>`);
          for (const s of m.signals) P(`<I-SIGNAL-TRIGGERING-REF-CONDITIONAL><I-SIGNAL-TRIGGERING-REF DEST="I-SIGNAL-TRIGGERING">/Cluster/${sn(b.name)}/${sn(b.name)}_Channel/ST_${sn(m.name)}_${sn(s.name)}</I-SIGNAL-TRIGGERING-REF></I-SIGNAL-TRIGGERING-REF-CONDITIONAL>`);
          P('</I-SIGNAL-TRIGGERINGS></PDU-TRIGGERING>');
        }
        P('</PDU-TRIGGERINGS></CAN-PHYSICAL-CHANNEL></PHYSICAL-CHANNELS><PROTOCOL-NAME>CAN</PROTOCOL-NAME>');
        if (b.protocol === 'CAN FD') P(`<CAN-FD-BAUDRATE>${b.dataBitrate}</CAN-FD-BAUDRATE>`);
        P('</CAN-CLUSTER-CONDITIONAL></CAN-CLUSTER-VARIANTS></CAN-CLUSTER>');
      }
    });
    // ECUs
    pkg('ECU', () => {
      for (const [name, n] of allNodes) {
        P(`<ECU-INSTANCE><SHORT-NAME>${name}</SHORT-NAME>${n.comment ? `<DESC><L-2 L="EN">${x(n.comment)}</L-2></DESC>` : ''}<CONNECTORS>`);
        for (const b of proj.buses) {
          if (!b.nodes.some(k => sn(k.name) === name)) continue;
          P(`<CAN-COMMUNICATION-CONNECTOR><SHORT-NAME>${name}_${sn(b.name)}</SHORT-NAME><ECU-COMM-PORT-INSTANCES>`);
          for (const m of b.messages) {
            if (sn(m.sender) === name) P(`<FRAME-PORT><SHORT-NAME>FP_${sn(m.name)}_Tx</SHORT-NAME><COMMUNICATION-DIRECTION>OUT</COMMUNICATION-DIRECTION></FRAME-PORT>`);
            if ((m.receivers || []).some(r => sn(r) === name)) P(`<FRAME-PORT><SHORT-NAME>FP_${sn(m.name)}_Rx</SHORT-NAME><COMMUNICATION-DIRECTION>IN</COMMUNICATION-DIRECTION></FRAME-PORT>`);
          }
          P('</ECU-COMM-PORT-INSTANCES></CAN-COMMUNICATION-CONNECTOR>');
        }
        P('</CONNECTORS></ECU-INSTANCE>');
      }
    });
    // per bus sub packages for frames, pdus, signals
    const sub = (name, fn) => { P(`<AR-PACKAGE><SHORT-NAME>${name}</SHORT-NAME><AR-PACKAGES>`); for (const b of proj.buses) { P(`<AR-PACKAGE><SHORT-NAME>${sn(b.name)}</SHORT-NAME><ELEMENTS>`); fn(b); P('</ELEMENTS></AR-PACKAGE>'); } P('</AR-PACKAGES></AR-PACKAGE>'); };
    sub('Frame', (b) => {
      for (const m of b.messages) P(`<CAN-FRAME><SHORT-NAME>${sn(m.name)}</SHORT-NAME>${m.comment ? `<DESC><L-2 L="EN">${x(m.comment)}</L-2></DESC>` : ''}<FRAME-LENGTH>${C.msgLen(m)}</FRAME-LENGTH><PDU-TO-FRAME-MAPPINGS><PDU-TO-FRAME-MAPPING><SHORT-NAME>${sn(m.name)}</SHORT-NAME><PACKING-BYTE-ORDER>MOST-SIGNIFICANT-BYTE-LAST</PACKING-BYTE-ORDER><PDU-REF DEST="I-SIGNAL-I-PDU">/PDU/${sn(b.name)}/${sn(m.name)}</PDU-REF><START-POSITION>0</START-POSITION></PDU-TO-FRAME-MAPPING></PDU-TO-FRAME-MAPPINGS></CAN-FRAME>`);
    });
    sub('PDU', (b) => {
      for (const m of b.messages) {
        P(`<I-SIGNAL-I-PDU><SHORT-NAME>${sn(m.name)}</SHORT-NAME><LENGTH>${C.msgLen(m)}</LENGTH><I-PDU-TIMING-SPECIFICATIONS><I-PDU-TIMING>`);
        if (m.cycle > 0 && m.sendType !== 'Event') P(`<TRANSMISSION-MODE-DECLARATION><TRANSMISSION-MODE-TRUE-TIMING><CYCLIC-TIMING><TIME-PERIOD><VALUE>${num(m.cycle / 1000)}</VALUE></TIME-PERIOD></CYCLIC-TIMING>${m.sendType === 'Cyclic+Event' ? '<EVENT-CONTROLLED-TIMING><NUMBER-OF-REPETITIONS>0</NUMBER-OF-REPETITIONS></EVENT-CONTROLLED-TIMING>' : ''}</TRANSMISSION-MODE-TRUE-TIMING></TRANSMISSION-MODE-DECLARATION>`);
        else P('<TRANSMISSION-MODE-DECLARATION><TRANSMISSION-MODE-TRUE-TIMING><EVENT-CONTROLLED-TIMING><NUMBER-OF-REPETITIONS>0</NUMBER-OF-REPETITIONS></EVENT-CONTROLLED-TIMING></TRANSMISSION-MODE-TRUE-TIMING></TRANSMISSION-MODE-DECLARATION>');
        P('</I-PDU-TIMING></I-PDU-TIMING-SPECIFICATIONS><I-SIGNAL-TO-PDU-MAPPINGS>');
        for (const s of m.signals) P(`<I-SIGNAL-TO-I-PDU-MAPPING><SHORT-NAME>${sn(m.name)}_${sn(s.name)}</SHORT-NAME><I-SIGNAL-REF DEST="I-SIGNAL">/ISignal/${sn(b.name)}/${sn(m.name)}_${sn(s.name)}</I-SIGNAL-REF><PACKING-BYTE-ORDER>${s.byteOrder === 'Motorola' ? 'MOST-SIGNIFICANT-BYTE-FIRST' : 'MOST-SIGNIFICANT-BYTE-LAST'}</PACKING-BYTE-ORDER><START-POSITION>${s.startBit}</START-POSITION><TRANSFER-PROPERTY>PENDING</TRANSFER-PROPERTY></I-SIGNAL-TO-I-PDU-MAPPING>`);
        P('</I-SIGNAL-TO-PDU-MAPPINGS><UNUSED-BIT-PATTERN>0</UNUSED-BIT-PATTERN></I-SIGNAL-I-PDU>');
      }
    });
    sub('ISignal', (b) => {
      for (const m of b.messages) for (const s of m.signals) {
        const raw = Number(C.physToBits(s, +s.initial || 0).raw);
        const bt = s.valueType === 'Float32' ? 'FLOAT32' : s.valueType === 'Float64' ? 'FLOAT64' : (s.valueType === 'Signed' ? 'SINT' : 'UINT') + (s.length <= 8 ? 8 : s.length <= 16 ? 16 : s.length <= 32 ? 32 : 64);
        P(`<I-SIGNAL><SHORT-NAME>${sn(m.name)}_${sn(s.name)}</SHORT-NAME>${s.comment ? `<DESC><L-2 L="EN">${x(s.comment)}</L-2></DESC>` : ''}<DATA-TYPE-POLICY>LEGACY</DATA-TYPE-POLICY><INIT-VALUE><NUMERICAL-VALUE-SPECIFICATION><VALUE>${raw}</VALUE></NUMERICAL-VALUE-SPECIFICATION></INIT-VALUE><LENGTH>${s.length}</LENGTH>`);
        P(`<NETWORK-REPRESENTATION-PROPS><SW-DATA-DEF-PROPS-VARIANTS><SW-DATA-DEF-PROPS-CONDITIONAL><BASE-TYPE-REF DEST="SW-BASE-TYPE">/BaseType/${bt}</BASE-TYPE-REF><COMPU-METHOD-REF DEST="COMPU-METHOD">/CompuMethod/${sn(b.name)}/CM_${sn(m.name)}_${sn(s.name)}</COMPU-METHOD-REF>${s.unit ? `<UNIT-REF DEST="UNIT">/Unit/U_${sn(s.unit) }</UNIT-REF>` : ''}</SW-DATA-DEF-PROPS-CONDITIONAL></SW-DATA-DEF-PROPS-VARIANTS></NETWORK-REPRESENTATION-PROPS>`);
        P(`<SYSTEM-SIGNAL-REF DEST="SYSTEM-SIGNAL">/SystemSignal/${sn(b.name)}/${sn(m.name)}_${sn(s.name)}</SYSTEM-SIGNAL-REF></I-SIGNAL>`);
      }
    });
    sub('SystemSignal', (b) => { for (const m of b.messages) for (const s of m.signals) P(`<SYSTEM-SIGNAL><SHORT-NAME>${sn(m.name)}_${sn(s.name)}</SHORT-NAME><DYNAMIC-LENGTH>false</DYNAMIC-LENGTH></SYSTEM-SIGNAL>`); });
    sub('CompuMethod', (b) => {
      for (const m of b.messages) for (const s of m.signals) {
        const vt = s.valueTable && s.valueTable.length;
        const cat = vt ? 'SCALE_LINEAR_AND_TEXTTABLE' : (s.factor === 1 && s.offset === 0 ? 'IDENTICAL' : 'LINEAR');
        const rr = C.rawRange(s);
        P(`<COMPU-METHOD><SHORT-NAME>CM_${sn(m.name)}_${sn(s.name)}</SHORT-NAME><CATEGORY>${cat}</CATEGORY>`);
        if (cat !== 'IDENTICAL') {
          P('<COMPU-INTERNAL-TO-PHYS><COMPU-SCALES>');
          if (vt) for (const e of s.valueTable) P(`<COMPU-SCALE><LOWER-LIMIT INTERVAL-TYPE="CLOSED">${e.value}</LOWER-LIMIT><UPPER-LIMIT INTERVAL-TYPE="CLOSED">${e.value}</UPPER-LIMIT><COMPU-CONST><VT>${x(e.text)}</VT></COMPU-CONST></COMPU-SCALE>`);
          P(`<COMPU-SCALE>${rr ? `<LOWER-LIMIT INTERVAL-TYPE="CLOSED">${rr[0]}</LOWER-LIMIT><UPPER-LIMIT INTERVAL-TYPE="CLOSED">${rr[1]}</UPPER-LIMIT>` : ''}<COMPU-RATIONAL-COEFFS><COMPU-NUMERATOR><V>${num(s.offset)}</V><V>${num(s.factor)}</V></COMPU-NUMERATOR><COMPU-DENOMINATOR><V>1</V></COMPU-DENOMINATOR></COMPU-RATIONAL-COEFFS></COMPU-SCALE>`);
          P('</COMPU-SCALES></COMPU-INTERNAL-TO-PHYS>');
        }
        P('</COMPU-METHOD>');
      }
    });
    const units = new Set(); proj.buses.forEach(b => b.messages.forEach(m => m.signals.forEach(s => s.unit && units.add(s.unit))));
    pkg('Unit', () => { for (const u of units) P(`<UNIT><SHORT-NAME>U_${sn(u)}</SHORT-NAME><DISPLAY-NAME>${x(u)}</DISPLAY-NAME></UNIT>`); });
    pkg('BaseType', () => {
      for (const n of ['UINT8', 'UINT16', 'UINT32', 'UINT64', 'SINT8', 'SINT16', 'SINT32', 'SINT64', 'FLOAT32', 'FLOAT64'])
        P(`<SW-BASE-TYPE><SHORT-NAME>${n}</SHORT-NAME><CATEGORY>FIXED_LENGTH</CATEGORY><BASE-TYPE-SIZE>${n.match(/\d+/)[0]}</BASE-TYPE-SIZE><BASE-TYPE-ENCODING>${n[0] === 'S' ? '2C' : n[0] === 'F' ? 'IEEE754' : 'NONE'}</BASE-TYPE-ENCODING></SW-BASE-TYPE>`);
    });
    P('</AR-PACKAGES></AUTOSAR>');
    return o.filter(Boolean).join('\n') + '\n';
  };

  // ARXML import (DOM based; works in browser and with a DOMParser polyfill)
  F.arxmlImport = (text, DOMParserImpl) => {
    const DP = DOMParserImpl || root.DOMParser;
    const doc = new DP().parseFromString(text, 'application/xml');
    const report = { messages: 0, signals: 0, skipped: [], warnings: [] };
    const kids = (el, tag) => el ? Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.localName === tag) : [];
    const kid = (el, tag) => kids(el, tag)[0];
    const all = (el, tag) => Array.from(el.getElementsByTagNameNS ? el.getElementsByTagNameNS('*', tag) : el.getElementsByTagName(tag));
    const first = (el, tag) => all(el, tag)[0];
    const txt = (el, tag) => { const e = tag ? first(el, tag) : el; return e ? e.textContent.trim() : ''; };
    // path index
    const idx = new Map();
    const walk = (el, path) => {
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType !== 1) continue;
        const sh = kid(c, 'SHORT-NAME');
        let p = path;
        if (sh) { p = path + '/' + sh.textContent.trim(); idx.set(p, c); }
        walk(c, p);
      }
    };
    walk(doc.documentElement, '');
    const ref = (el, tag) => { const r = first(el, tag); return r ? idx.get(r.textContent.trim()) : null; };
    const shortName = (el) => { const s = el && kid(el, 'SHORT-NAME'); return s ? s.textContent.trim() : ''; };
    // port -> ecu name + direction
    const portInfo = new Map();
    for (const ecu of all(doc, 'ECU-INSTANCE')) {
      const en = shortName(ecu);
      for (const fp of all(ecu, 'FRAME-PORT')) portInfo.set(fp, { ecu: en, dir: txt(fp, 'COMMUNICATION-DIRECTION') });
    }
    const buses = [];
    for (const cl of all(doc, 'CAN-CLUSTER')) {
      const bus = C.newBus(shortName(cl)); bus.messages = []; bus.nodes = []; bus.protocol = 'CAN';
      bus.bitrate = +txt(cl, 'BAUDRATE') || 500000;
      const fdb = txt(cl, 'CAN-FD-BAUDRATE'); if (fdb) { bus.protocol = 'CAN FD'; bus.dataBitrate = +fdb; }
      const nodeNames = new Set();
      for (const ft of all(cl, 'CAN-FRAME-TRIGGERING')) {
        const frame = ref(ft, 'FRAME-REF'); if (!frame) { report.skipped.push('Frame triggering without frame: ' + shortName(ft)); continue; }
        const m = C.newMessage(shortName(frame), +txt(ft, 'IDENTIFIER'));
        m.extended = txt(ft, 'CAN-ADDRESSING-MODE') === 'EXTENDED';
        m.fd = /FD/.test(txt(ft, 'CAN-FRAME-TX-BEHAVIOR') || txt(ft, 'CAN-FRAME-RX-BEHAVIOR'));
        const flen = +txt(frame, 'FRAME-LENGTH') || 8; if (flen > 8) m.fd = true;
        m.dlc = C.lenToDlc(flen, m.fd);
        m.comment = txt(frame, 'L-2');
        m.receivers = []; m.sender = '';
        for (const pr of all(ft, 'FRAME-PORT-REF')) {
          const port = idx.get(pr.textContent.trim()); const inf = port && portInfo.get(port);
          if (!inf) continue; nodeNames.add(inf.ecu);
          if (inf.dir === 'OUT') m.sender = inf.ecu; else if (!m.receivers.includes(inf.ecu)) m.receivers.push(inf.ecu);
        }
        m.cycle = 0; m.sendType = 'Event';
        for (const ptm of all(frame, 'PDU-TO-FRAME-MAPPING')) {
          const pdu = ref(ptm, 'PDU-REF'); if (!pdu) continue;
          const pOff = +txt(ptm, 'START-POSITION') || 0;
          const tp = first(pdu, 'TIME-PERIOD'); if (tp) { m.cycle = Math.round(+txt(tp, 'VALUE') * 1000); m.sendType = first(pdu, 'EVENT-CONTROLLED-TIMING') ? 'Cyclic+Event' : 'Cyclic'; }
          if (pdu.localName !== 'I-SIGNAL-I-PDU') report.warnings.push(`${m.name}: PDU type ${pdu.localName} imported without signals`);
          for (const mp of all(pdu, 'I-SIGNAL-TO-I-PDU-MAPPING')) {
            const isig = ref(mp, 'I-SIGNAL-REF'); if (!isig) { if (first(mp, 'I-SIGNAL-GROUP-REF')) continue; report.skipped.push('Mapping without signal: ' + shortName(mp)); continue; }
            const s = C.newSignal(shortName(isig));
            const pre = m.name + '_'; if (s.name.startsWith(pre)) s.name = s.name.slice(pre.length);
            s.length = +txt(isig, 'LENGTH') || 1;
            s.byteOrder = txt(mp, 'PACKING-BYTE-ORDER') === 'MOST-SIGNIFICANT-BYTE-FIRST' ? 'Motorola' : 'Intel';
            s.startBit = (+txt(mp, 'START-POSITION') || 0) + pOff * 8;
            s.comment = txt(isig, 'L-2');
            const bt = ref(isig, 'BASE-TYPE-REF');
            if (bt) { const enc = txt(bt, 'BASE-TYPE-ENCODING'), nm = shortName(bt); if (/2C/.test(enc) || /^S/i.test(nm)) s.valueType = 'Signed'; if (/IEEE|FLOAT/i.test(enc + nm)) s.valueType = s.length === 64 ? 'Float64' : 'Float32'; }
            let cm = ref(isig, 'COMPU-METHOD-REF');
            if (!cm) { const ss = ref(isig, 'SYSTEM-SIGNAL-REF'); if (ss) cm = ref(ss, 'COMPU-METHOD-REF'); }
            if (cm) {
              s.valueTable = [];
              for (const sc of all(cm, 'COMPU-SCALE')) {
                const vt = first(sc, 'VT'), rc = first(sc, 'COMPU-RATIONAL-COEFFS');
                if (vt) s.valueTable.push({ value: +txt(sc, 'LOWER-LIMIT'), text: vt.textContent.trim() });
                if (rc) {
                  const nv = all(first(rc, 'COMPU-NUMERATOR'), 'V').map(v => +v.textContent);
                  const dv = all(first(rc, 'COMPU-DENOMINATOR'), 'V').map(v => +v.textContent);
                  const d = dv[0] || 1; s.offset = (nv[0] || 0) / d; s.factor = (nv[1] != null ? nv[1] : 1) / d;
                }
              }
              const u = ref(cm, 'UNIT-REF'); if (u) s.unit = txt(u, 'DISPLAY-NAME') || shortName(u).replace(/^U_/, '');
            }
            const u2 = ref(isig, 'UNIT-REF'); if (u2) s.unit = txt(u2, 'DISPLAY-NAME') || shortName(u2).replace(/^U_/, '');
            const pr = C.physRange(s); if (pr) { s.min = num(pr[0]); s.max = num(pr[1]); }
            const iv = first(isig, 'INIT-VALUE'); if (iv) { const v = txt(iv, 'VALUE'); if (v !== '') s.initial = num(+v * s.factor + s.offset); } else s.initial = s.offset;
            s.receivers = m.receivers.slice();
            m.signals.push(s); report.signals++;
          }
        }
        bus.messages.push(m); report.messages++;
        if (m.sender) nodeNames.add(m.sender);
      }
      [...nodeNames].forEach(n => bus.nodes.push(C.newNode(n, 0)));
      bus.nodes.forEach((n, k) => n.position = Math.round(bus.cableLength * k / Math.max(1, bus.nodes.length - 1)));
      if (bus.nodes.length) bus.nodes[0].ours = true;
      if (bus.messages.some(m => m.fd)) bus.protocol = 'CAN FD';
      bus.timing = { nominal: C.defaultTiming(bus.bitrate), data: C.defaultTiming(bus.dataBitrate) };
      buses.push(bus);
    }
    if (!buses.length) report.warnings.push('No CAN-CLUSTER found');
    return { buses, report };
  };

  // ======================= A2L (export only) =======================
  F.a2lExport = (proj) => {
    const L = [];
    const used = new Set(); const uniq = (n) => { let k = n, i = 2; while (used.has(k)) k = n + '_' + i++; used.add(k); return k; };
    L.push('ASAP2_VERSION 1 71', `/begin PROJECT ${sanitize(proj.name || 'CANssm')} "Exported by CANssm"`, `  /begin MODULE CAN "CAN signals"`);
    L.push('    /begin MOD_COMMON ""', '      BYTE_ORDER MSB_LAST', '    /end MOD_COMMON');
    const groups = [];
    for (const b of proj.buses) for (const m of b.messages) {
      const refs = [];
      for (const s of m.signals) {
        const name = uniq(sanitize(s.name)); refs.push(name);
        const cmName = 'CM_' + name;
        const fmt = '"%' + Math.max(4, String(Math.round(Math.abs(s.max) || 0)).length + 4) + '.' + Math.min(6, Math.max(0, (String(num(s.factor)).split('.')[1] || '').length)) + '"';
        const vt = s.valueTable && s.valueTable.length;
        if (vt) {
          L.push(`    /begin COMPU_METHOD ${cmName} "${s.name}" TAB_VERB "%.0" ${q(s.unit)}`, `      COMPU_TAB_REF VT_${name}`, '    /end COMPU_METHOD');
          L.push(`    /begin COMPU_VTAB VT_${name} "" TAB_VERB ${s.valueTable.length}`);
          for (const e of s.valueTable) L.push(`      ${e.value} ${q(e.text)}`);
          L.push('    /end COMPU_VTAB');
        } else {
          L.push(`    /begin COMPU_METHOD ${cmName} "${s.name}" LINEAR ${fmt} ${q(s.unit)}`, `      COEFFS_LINEAR ${num(s.factor)} ${num(s.offset)}`, '    /end COMPU_METHOD');
        }
        const n = s.length;
        const dt = s.valueType === 'Float32' ? 'FLOAT32_IEEE' : s.valueType === 'Float64' ? 'FLOAT64_IEEE'
          : (s.valueType === 'Signed' ? ['SBYTE', 'SWORD', 'SLONG', 'A_INT64'] : ['UBYTE', 'UWORD', 'ULONG', 'A_UINT64'])[n <= 8 ? 0 : n <= 16 ? 1 : n <= 32 ? 2 : 3];
        const lo = vt ? Math.min(...s.valueTable.map(e => e.value)) : s.min, hi = vt ? Math.max(...s.valueTable.map(e => e.value)) : s.max;
        L.push(`    /begin MEASUREMENT ${name} ${q((s.comment || s.name) + ' [' + m.name + ' ' + C.fmtId(m) + ']')}`);
        L.push(`      ${dt} ${cmName} 0 0 ${num(lo)} ${num(hi)}`);
        L.push('      ECU_ADDRESS 0x0');
        L.push(`      BYTE_ORDER ${s.byteOrder === 'Motorola' ? 'MSB_FIRST' : 'MSB_LAST'}`);
        if (!/FLOAT/.test(dt) && ![8, 16, 32, 64].includes(n)) L.push(`      BIT_MASK 0x${((1n << BigInt(n)) - 1n).toString(16).toUpperCase()}`);
        if (s.unit) L.push(`      PHYS_UNIT ${q(s.unit)}`);
        L.push('    /end MEASUREMENT');
      }
      groups.push({ name: uniq('G_' + sanitize(m.name)), m, refs });
    }
    for (const g of groups) {
      L.push(`    /begin GROUP ${g.name} ${q(g.m.name + ' ' + C.fmtId(g.m))}`);
      if (g.refs.length) { L.push('      /begin REF_MEASUREMENT'); for (const r of g.refs) L.push('        ' + r); L.push('      /end REF_MEASUREMENT'); }
      L.push('    /end GROUP');
    }
    L.push('  /end MODULE', '/end PROJECT');
    return L.join('\r\n') + '\r\n';
  };

  // ======================= XLSX (localized profiles) =======================
  F.MSG_FIELDS = [
    ['bus', 'Bus'], ['name', 'Message Name'], ['id', 'ID'], ['idType', 'ID Type'], ['frameType', 'Frame Type'], ['brs', 'BRS'],
    ['dlc', 'DLC'], ['length', 'Length (byte)'], ['cycle', 'Cycle (ms)'], ['sendType', 'Send Type'], ['sender', 'Sender'],
    ['receivers', 'Receivers'], ['comment', 'Comment']
  ];
  F.SIG_FIELDS = [
    ['bus', 'Bus'], ['message', 'Message Name'], ['id', 'Message ID'], ['name', 'Signal Name'], ['startBit', 'Start Bit'], ['length', 'Length (bit)'],
    ['byteOrder', 'Byte Order'], ['valueType', 'Value Type'], ['factor', 'Factor'], ['offset', 'Offset'], ['min', 'Min'], ['max', 'Max'],
    ['unit', 'Unit'], ['initial', 'Initial Value'], ['receivers', 'Receivers'], ['valueTable', 'Value Table'], ['comment', 'Comment']
  ];
  F.defaultProfile = (name) => ({
    id: C.uid('p'), name: name || 'Default – EN', sheetName: 'Specification',
    msgTitle: 'CAN Message', sigTitle: 'Signal',
    msgCols: F.MSG_FIELDS.map(([f, h]) => ({ field: f, header: h, visible: true })),
    sigCols: F.SIG_FIELDS.map(([f, h]) => ({ field: f, header: h, visible: f !== 'id' }))
  });
  const vtToText = (vt) => (vt || []).map(e => `${e.value}=${e.text}`).join('; ');
  const textToVt = (t) => String(t || '').split(/[;\n]/).map(x => x.trim()).filter(Boolean).map(x => { const k = x.indexOf('='); return k < 0 ? null : { value: +x.slice(0, k).trim(), text: x.slice(k + 1).trim() }; }).filter(e => e && Number.isFinite(e.value));

  F.msgValue = (bus, m, f) => ({
    bus: bus.name, name: m.name, id: C.fmtId(m), idType: m.extended ? 'Extended' : 'Standard', frameType: m.fd ? 'CAN FD' : 'CAN',
    brs: m.fd ? (m.brs ? 'Yes' : 'No') : '', dlc: m.dlc, length: C.msgLen(m), cycle: m.cycle, sendType: m.sendType, sender: m.sender,
    receivers: (m.receivers || []).join(', '), comment: m.comment
  })[f];
  F.sigValue = (bus, m, s, f, conv) => ({
    bus: bus.name, message: m.name, id: C.fmtId(m), name: s.name, startBit: C.displayStart(s, conv), length: s.length, byteOrder: s.byteOrder,
    valueType: s.valueType, factor: s.factor, offset: s.offset, min: s.min, max: s.max, unit: s.unit, initial: s.initial,
    receivers: (s.receivers || []).join(', '), valueTable: vtToText(s.valueTable), comment: s.comment
  })[f];

  // returns array of arrays (AOA) for one sheet
  F.xlsxAoa = (buses, prof, conv) => {
    const mc = prof.msgCols.filter(c => c.visible), sc = prof.sigCols.filter(c => c.visible);
    const aoa = [];
    aoa.push([prof.msgTitle]); aoa.push(mc.map(c => c.header));
    for (const b of buses) for (const m of b.messages) aoa.push(mc.map(c => F.msgValue(b, m, c.field)));
    aoa.push([]);
    aoa.push([prof.sigTitle]); aoa.push(sc.map(c => c.header));
    for (const b of buses) for (const m of b.messages) for (const s of m.signals) aoa.push(sc.map(c => F.sigValue(b, m, s, c.field, conv)));
    return aoa;
  };
  F.xlsxExport = (XLSX, buses, prof, conv) => {
    const aoa = F.xlsxAoa(buses, prof, conv);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const widths = [];
    aoa.forEach(r => r.forEach((v, i) => { widths[i] = Math.max(widths[i] || 8, Math.min(50, String(v == null ? '' : v).length + 2)); }));
    ws['!cols'] = widths.map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (prof.sheetName || 'Specification').slice(0, 31));
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  };

  // Build mapping preview from an AOA
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  F.xlsxAnalyze = (aoa, prof) => {
    const findTitle = (title, from) => { for (let r = from || 0; r < aoa.length; r++) if (aoa[r] && norm(aoa[r][0]) === norm(title)) return r; return -1; };
    const matchCols = (hdr, cols, defs) => {
      return hdr.map((h, i) => {
        const n = norm(h); if (!n) return { col: i, header: h, field: null };
        let c = cols.find(c => norm(c.header) === n);
        if (!c) { const d = defs.find(([f, dh]) => norm(dh) === n || norm(f) === n); if (d) c = { field: d[0] }; }
        return { col: i, header: h, field: c ? c.field : null };
      });
    };
    let mr = findTitle(prof.msgTitle), sr = findTitle(prof.sigTitle, mr + 1);
    const res = { ok: mr >= 0 && sr >= 0, msgTitleRow: mr, sigTitleRow: sr, msgMap: [], sigMap: [], msgRows: [], sigRows: [] };
    if (!res.ok) return res;
    res.msgMap = matchCols(aoa[mr + 1] || [], prof.msgCols, F.MSG_FIELDS);
    res.sigMap = matchCols(aoa[sr + 1] || [], prof.sigCols, F.SIG_FIELDS);
    const take = (start, end) => { const rows = []; for (let r = start; r < end; r++) { const row = aoa[r]; if (row && row.some(v => v !== '' && v != null)) rows.push(row); } return rows; };
    res.msgRows = take(mr + 2, sr); res.sigRows = take(sr + 2, aoa.length);
    return res;
  };
  F.xlsxImport = (an, conv, existingBuses) => {
    const report = { messages: 0, signals: 0, skipped: [], warnings: [] };
    const buses = new Map();
    const getBus = (name) => {
      name = String(name || 'CAN1').trim() || 'CAN1';
      if (!buses.has(name)) { const b = C.newBus(name); b.messages = []; b.nodes = []; const ex = (existingBuses || []).find(x => x.name === name); if (ex) { Object.assign(b, { protocol: ex.protocol, bitrate: ex.bitrate, dataBitrate: ex.dataBitrate, timing: JSON.parse(JSON.stringify(ex.timing)), cableLength: ex.cableLength }); b.nodes = JSON.parse(JSON.stringify(ex.nodes)); } buses.set(name, b); }
      return buses.get(name);
    };
    const rec = (row, map) => { const o = {}; for (const mm of map) if (mm.field) o[mm.field] = row[mm.col]; return o; };
    const list = (v) => String(v || '').split(/[,;\s]+/).filter(Boolean);
    const msgByKey = new Map();
    for (const row of an.msgRows) {
      const o = rec(row, an.msgMap);
      if (!o.name && o.id == null) continue;
      const b = getBus(o.bus);
      const m = C.newMessage(String(o.name || 'Msg_' + o.id).trim(), C.parseId(o.id));
      if (!Number.isFinite(m.canId)) { report.skipped.push('Bad ID for message ' + m.name); continue; }
      m.extended = o.idType != null ? /ext/i.test(o.idType) : m.canId > 0x7FF;
      m.fd = o.frameType != null ? /fd/i.test(o.frameType) : false;
      m.brs = o.brs == null || o.brs === '' ? true : /^(y|yes|1|true|on)$/i.test(String(o.brs));
      if (o.dlc !== undefined && o.dlc !== '') m.dlc = +o.dlc; else if (o.length != null && o.length !== '') m.dlc = C.lenToDlc(+o.length, m.fd);
      if (+m.dlc > 8 && !m.fd) m.fd = true;
      m.cycle = +o.cycle || 0; m.sendType = o.sendType ? (/both|\+|and/i.test(o.sendType) ? 'Cyclic+Event' : /cyc/i.test(o.sendType) ? 'Cyclic' : 'Event') : (m.cycle ? 'Cyclic' : 'Event');
      m.sender = String(o.sender || '').trim(); m.receivers = list(o.receivers); m.comment = String(o.comment || '');
      b.messages.push(m); msgByKey.set(b.name + '|' + m.name, m); msgByKey.set(b.name + '|#' + m.canId, m); report.messages++;
      for (const n of [m.sender, ...m.receivers]) if (n && !b.nodes.some(x => x.name === n)) b.nodes.push(C.newNode(n, 0));
    }
    for (const row of an.sigRows) {
      const o = rec(row, an.sigMap);
      if (!o.name) continue;
      const bname = String(o.bus || '').trim() || (buses.size === 1 ? [...buses.keys()][0] : 'CAN1');
      const b = getBus(bname);
      let m = msgByKey.get(b.name + '|' + String(o.message || '').trim());
      if (!m && o.id != null && o.id !== '') m = msgByKey.get(b.name + '|#' + C.parseId(o.id));
      if (!m) { report.skipped.push(`Signal ${o.name}: message "${o.message}" not found`); continue; }
      const s = C.newSignal(String(o.name).trim());
      s.byteOrder = /moto|big/i.test(o.byteOrder || '') ? 'Motorola' : 'Intel';
      s.length = +o.length || 1;
      s.startBit = C.fromDisplayStart(+o.startBit || 0, s, conv);
      s.valueType = /float64|double/i.test(o.valueType || '') ? 'Float64' : /float/i.test(o.valueType || '') ? 'Float32' : /sign/i.test(o.valueType || '') && !/unsign/i.test(o.valueType || '') ? 'Signed' : 'Unsigned';
      for (const k of ['factor', 'offset', 'min', 'max', 'initial']) if (o[k] !== undefined && o[k] !== '') s[k] = +o[k];
      if (o.factor === undefined || o.factor === '') s.factor = 1;
      s.unit = String(o.unit || ''); s.receivers = o.receivers != null ? list(o.receivers) : m.receivers.slice();
      s.valueTable = textToVt(o.valueTable); s.comment = String(o.comment || '');
      m.signals.push(s); report.signals++;
      for (const n of s.receivers) if (!b.nodes.some(x => x.name === n)) b.nodes.push(C.newNode(n, 0));
    }
    for (const b of buses.values()) {
      if (b.messages.some(m => m.fd)) b.protocol = 'CAN FD';
      if (b.nodes.every(n => !n.position)) b.nodes.forEach((n, k) => n.position = Math.round(b.cableLength * k / Math.max(1, b.nodes.length - 1)));
      if (b.nodes.length && !b.nodes.some(n => n.ours)) b.nodes[0].ours = true;
    }
    return { buses: [...buses.values()], report };
  };

  F.vtToText = vtToText; F.textToVt = textToVt; F.sanitize = sanitize;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
  root.CANssmFormats = F;
})(typeof globalThis !== 'undefined' ? globalThis : this);
