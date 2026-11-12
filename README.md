# CANssm – CAN Signal Specification Modifier (v1.0)

Offline Windows tool to read, edit and visualise CAN / CAN FD signal specifications and simulate the bus bit by bit.

## Screens
1. **Specification** – bus / node / message / signal tables, DBC text mode, live validation
2. **Bit Mapping** – byte × bit grid, drag to move / resize signals, overlap detection
3. **Byte Order View** – Motorola vs Intel bit order, encode / decode values
4. **Bus Simulation** – topology, bit timing (time quanta), frame + bit animation, signals our node sees, bus load
5. **Configuration** – XLSX localized format profiles, start-bit convention, app settings

## Formats
DBC, ARXML (AUTOSAR 4.3), XLSX (localized) – import + export. A2L – export only (MEASUREMENT per signal, ECU_ADDRESS 0x0).

## Build
```
npm install            # xlsx, playwright-core (tests), @xmldom/xmldom (tests)
node build.js          # -> dist/index.html (single offline file, also runs in a browser)
node test/core.test.js && node test/formats.test.js
cd pack && npm install -D electron@37 electron-builder@26 resedit@2
copy ../dist/index.html app/ ; copy ../electron/* .
npx electron-builder --win --x64   # -> release/CANssm-1.0.0-portable.exe
```
