const C = require('../src/core.js');
const assert = require('assert');
const bitsOf = (s) => { const a = []; for (const ch of Buffer.from(s)) for (let i = 7; i >= 0; i--) a.push((ch >> i) & 1); return a; };
const chk = bitsOf('123456789');
assert.strictEqual(C._crcBits(chk, 0x4599, 15, 0), 0x059E, 'CRC15');
assert.strictEqual(C._crcBits(chk, 0x1685B, 17, 0), 0x04F03, 'CRC17');
assert.strictEqual(C._crcBits(chk, 0x102899, 21, 0), 0x0ED841, 'CRC21');

// Motorola RPM start 23 len 16
const s = Object.assign(C.newSignal('RPM'), { byteOrder: 'Motorola', startBit: 23, length: 16, factor: 0.25, max: 16383.75 });
assert.deepStrictEqual(C.signalPositions(s).slice().reverse(), [23,22,21,20,19,18,17,16,31,30,29,28,27,26,25,24]);
assert.strictEqual(C.lsbPos(s), 24);
assert.strictEqual(C.motorolaMsbFromLsb(24, 16), 23);
const m = Object.assign(C.newMessage('EngineData', 0x1A0), { signals: [s] });
s.initial = 3000;
assert.strictEqual(C.hex(C.encodeMessage(m)), '00 00 2E E0 00 00 00 00');
assert.strictEqual(C.bitsToPhys(s, C.readSignal(C.encodeMessage(m), s)).phys, 3000);
// Intel signed
const t = Object.assign(C.newSignal('T'), { startBit: 4, length: 12, valueType: 'Signed', factor: 0.1, offset: 0 });
const by = new Uint8Array(8); C.writeSignal(by, t, C.physToBits(t, -12.3).bits);
assert.strictEqual(C.bitsToPhys(t, C.readSignal(by, t)).phys.toFixed(1), '-12.3');
// switch order keeps LSB
C.switchByteOrder(t, 'Motorola'); assert.strictEqual(C.lsbPos(t), 4);
// float
const f = Object.assign(C.newSignal('F'), { valueType: 'Float32', length: 32, startBit: 0 });
const fb = new Uint8Array(8); C.writeSignal(fb, f, C.physToBits(f, 1.5).bits);
assert.strictEqual(C.bitsToPhys(f, C.readSignal(fb, f)).phys, 1.5);

// frames
const fr = C.buildFrame(m, C.encodeMessage(m));
assert.strictEqual(fr[0].field, 'SOF');
// no 6 equal consecutive bits before CRC delim
let run = 0, last = -1;
for (const b of fr) { if (b.field === 'CRC delim') break; run = b.v === last ? run + 1 : 1; last = b.v; assert(run <= 5, 'stuffing'); }
const fd = Object.assign(C.newMessage('FD', 0x123), { fd: true, dlc: 15, signals: [] });
const ff = C.buildFrame(fd, new Uint8Array(64));
assert(ff.some(b => b.phase === 'data'));
console.log('classic bits', fr.length, 'fd64 bits', ff.length, 'stuffs', ff.stuffCount);

// timing
const tm = C.defaultTiming(500000); const d = C.timingDerived(tm);
assert.strictEqual(Math.round(d.bitrate), 500000); console.log('timing', tm, d.sp);
const td = C.defaultTiming(2000000); console.log('data timing', td, C.timingDerived(td).sp);
// load worst-case: std 8 bytes = 135 bits
assert.strictEqual(C.frameBitsWorst(m, {}).nominal, 135);
console.log('core OK');
