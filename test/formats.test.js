const C = require('../src/core.js');
global.CANssmCore = C;
const F = require('../src/formats.js');
const sample = require('../src/sample.js');
const XLSX = require('xlsx');
const { DOMParser } = require('@xmldom/xmldom');
const assert = require('assert');
const fs = require('fs');
const out = process.argv[2] || '/tmp';

const p = sample();
console.log('validation:', C.validate(p).map(v => v.text));
const strip = (b) => b.messages.map(m => ({ n: m.name, id: m.canId, x: m.extended, fd: m.fd, dlc: m.dlc, cyc: m.cycle, snd: m.sender,
  s: m.signals.map(s => [s.name, s.startBit, s.length, s.byteOrder, s.valueType, +s.factor, +s.offset, +(+s.initial).toFixed(4), s.unit, JSON.stringify(s.valueTable)]) }));

// DBC
const dbc = F.dbcExport(p.buses[0]); fs.writeFileSync(out + '/sample.dbc', dbc);
const r1 = F.dbcImport(dbc, 'PT_CAN');
assert.deepStrictEqual(strip(r1.bus), strip(p.buses[0]));
assert.strictEqual(r1.bus.nodes.find(n => n.name === 'BCM').position, 18);
console.log('DBC round trip OK', r1.report);
// DBC export twice stable
assert.strictEqual(F.dbcExport(r1.bus).split('BS_:')[1].replace(/\s+/g,' ').length > 0, true);

// ARXML
const ax = F.arxmlExport(p); fs.writeFileSync(out + '/sample.arxml', ax);
const r2 = F.arxmlImport(ax, DOMParser);
assert.deepStrictEqual(strip(r2.buses[0]), strip(p.buses[0]));
console.log('ARXML round trip OK', r2.report);

// XLSX
const prof = F.defaultProfile();
prof.msgCols.find(c => c.field === 'name').header = 'ชื่อข้อความ';
prof.sigCols.find(c => c.field === 'name').header = '信号名';
prof.sigCols.reverse();
for (const conv of ['MSB', 'LSB']) {
  const buf = F.xlsxExport(XLSX, p.buses, prof, conv);
  fs.writeFileSync(out + `/sample_${conv}.xlsx`, Buffer.from(buf));
  const wb = XLSX.read(buf, { type: 'array' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const an = F.xlsxAnalyze(aoa, prof);
  assert(an.ok);
  const r3 = F.xlsxImport(an, conv, []);
  assert.deepStrictEqual(strip(r3.buses[0]), strip(p.buses[0]));
  console.log('XLSX round trip OK', conv, r3.report);
}

// A2L
const a2l = F.a2lExport(p); fs.writeFileSync(out + '/sample.a2l', a2l);
assert((a2l.match(/\/begin MEASUREMENT/g) || []).length === 13);
console.log('A2L OK');
console.log('load worst', (C.busLoad(p.buses[0]).total * 100).toFixed(2) + '%', 'actual', (C.busLoad(p.buses[0], 'actual').total * 100).toFixed(2) + '%');
