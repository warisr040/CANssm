/* CANssm sample project */
(function (root) {
  const C = root.CANssmCore || require('./core.js');
  root.CANssmSample = () => {
    const p = C.newProject(); p.name = 'Sample Powertrain';
    const b = C.newBus('PT_CAN'); b.cableLength = 30;
    b.nodes = [
      Object.assign(C.newNode('ECM', 0), { comment: 'Engine control module' }),
      Object.assign(C.newNode('TCU', 8), { comment: 'Transmission control unit' }),
      Object.assign(C.newNode('BCM', 18), { ours: true, comment: 'Body control module (our node)' }),
      Object.assign(C.newNode('ABS', 30), { comment: 'Brake controller' })
    ];
    const sig = (o) => Object.assign(C.newSignal(o.name), o);
    const m1 = Object.assign(C.newMessage('EngineData', 0x1A0), { sender: 'ECM', receivers: ['BCM', 'ABS', 'TCU'], cycle: 10, comment: 'Engine speed and temperatures' });
    m1.signals = [
      sig({ name: 'CoolantTemp', startBit: 0, length: 8, offset: -40, min: -40, max: 215, unit: '°C', initial: 90, receivers: ['BCM'] }),
      sig({ name: 'EngineState', startBit: 8, length: 2, max: 3, initial: 2, receivers: ['BCM', 'TCU'], valueTable: [{ value: 0, text: 'Off' }, { value: 1, text: 'Cranking' }, { value: 2, text: 'Running' }, { value: 3, text: 'Error' }] }),
      sig({ name: 'EngineRPM', startBit: 23, length: 16, byteOrder: 'Motorola', factor: 0.25, max: 16383.75, unit: 'rpm', initial: 3000, receivers: ['BCM', 'ABS', 'TCU'] }),
      sig({ name: 'Throttle', startBit: 32, length: 10, factor: 0.1, max: 102.3, unit: '%', initial: 23.5, receivers: ['TCU'] })
    ];
    const m2 = Object.assign(C.newMessage('VehicleSpeed', 0x0B4), { sender: 'ABS', receivers: ['BCM', 'ECM'], cycle: 20, dlc: 4 });
    m2.signals = [
      sig({ name: 'VehSpeed', startBit: 7, length: 13, byteOrder: 'Motorola', factor: 0.05, max: 409.55, unit: 'km/h', initial: 60, receivers: ['BCM', 'ECM'] }),
      sig({ name: 'SpeedValid', startBit: 16, length: 1, max: 1, initial: 1, receivers: ['BCM'] })
    ];
    const m3 = Object.assign(C.newMessage('GearInfo', 0x1F0), { sender: 'TCU', receivers: ['ECM', 'BCM'], cycle: 50, dlc: 2 });
    m3.signals = [
      sig({ name: 'Gear', startBit: 0, length: 4, min: -1, max: 8, offset: -1, initial: 3, receivers: ['ECM', 'BCM'] })
    ];
    const m4 = Object.assign(C.newMessage('BodyStatus', 0x3C0), { sender: 'BCM', receivers: ['ECM'], cycle: 100, dlc: 8 });
    m4.signals = [
      sig({ name: 'DoorOpen', startBit: 0, length: 4, max: 15, initial: 0, receivers: ['ECM'] }),
      sig({ name: 'AmbientTemp', startBit: 8, length: 12, valueType: 'Signed', factor: 0.1, min: -204.8, max: 204.7, unit: '°C', initial: 31.5, receivers: ['ECM'] })
    ];
    const m5 = Object.assign(C.newMessage('BatteryFD', 0x18FF5010), { extended: true, fd: true, brs: true, dlc: 12, sender: 'ECM', receivers: ['BCM'], cycle: 100, comment: 'CAN FD 20-byte battery frame' });
    m5.signals = [
      sig({ name: 'PackVoltage', startBit: 0, length: 16, factor: 0.01, max: 655.35, unit: 'V', initial: 398.4, receivers: ['BCM'] }),
      sig({ name: 'PackCurrent', startBit: 16, length: 16, valueType: 'Signed', factor: 0.1, min: -3276.8, max: 3276.7, unit: 'A', initial: -12.5, receivers: ['BCM'] }),
      sig({ name: 'CellTempMax', startBit: 32, length: 8, offset: -40, min: -40, max: 215, unit: '°C', initial: 35, receivers: ['BCM'] }),
      sig({ name: 'SOC', startBit: 63, length: 10, byteOrder: 'Motorola', factor: 0.1, max: 102.3, unit: '%', initial: 76.4, receivers: ['BCM'] })
    ];
    b.messages = [m1, m2, m3, m4, m5];
    p.buses = [b];
    return p;
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CANssmSample;
})(typeof globalThis !== 'undefined' ? globalThis : this);
