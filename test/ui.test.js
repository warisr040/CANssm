// Headless smoke test: loads dist/index.html, visits every screen, plays the simulation, screenshots.
const { chromium } = require('playwright-core');
const out = process.argv[2] || '/tmp';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file:///root/canssm/dist/index.html');
  await page.waitForTimeout(400);
  const shot = async (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: false });
  // spec bus view
  await shot('1_spec_bus');
  // select message EngineData
  await page.click('.ti.l1:has-text("EngineData")');
  await page.waitForTimeout(200); await shot('1_spec_msg');
  // edit a cell: change factor of first signal
  const inp = page.locator('table.t tbody tr').nth(0).locator('input').nth(0);
  await inp.fill('CoolantTemperature'); await inp.press('Tab'); await page.waitForTimeout(150);
  const nm = await page.locator('.ti.l2').first().textContent();
  console.log('renamed tree item:', nm);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
  await page.click('text=Text (DBC)'); await page.waitForTimeout(150); await shot('1_spec_text');
  await page.click('.seg >> text=Table');
  // bitmap
  await page.keyboard.press('Control+2'); await page.waitForTimeout(200); await shot('2_bitmap');
  // drag a signal: Throttle from bit 32 -> 40
  const c32 = page.locator('.bm .c[data-p="34"]'), c42 = page.locator('.bm .c[data-p="42"]');
  const b1 = await c32.boundingBox(), b2 = await c42.boundingBox();
  await page.mouse.move(b1.x + 20, b1.y + 20); await page.mouse.down(); await page.mouse.move(b2.x + 20, b2.y + 20, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => App.state.project.buses[0].messages[0].signals.find(s => s.name === 'Throttle').startBit);
  console.log('Throttle start after drag:', st);
  await shot('2_bitmap_after_drag');
  await page.keyboard.press('Control+z');
  // byte order
  await page.keyboard.press('Control+3'); await page.waitForTimeout(200);
  await page.selectOption('.page-h select >> nth=1', { label: 'EngineRPM' }); await page.waitForTimeout(200);
  await shot('3_byteorder');
  const payload = await page.locator('.bytes').first().textContent();
  console.log('RPM payload:', payload.trim());
  // sim
  await page.keyboard.press('Control+4'); await page.waitForTimeout(300);
  await page.click('text=Configure'); await page.waitForTimeout(100);
  await page.selectOption('.sim-ctl select >> nth=0', '50');
  await page.click('text=▶ Play'); await page.waitForTimeout(2500);
  await shot('4_sim_playing');
  await page.click('text=❚❚ Pause');
  await page.selectOption('.sim-ctl select >> nth=0', '0.5');
  await page.click('text=▶ Play'); await page.waitForTimeout(1300); await page.click('text=❚❚ Pause');
  await page.locator('canvas.bitview').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/4_sim_bitview.png` });
  for (let i = 0; i < 6; i++) await page.click('text=⏭ Step bit');
  await page.locator('text=Signals our node sees').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/4_sim_rx.png` });
  const rxState = await page.evaluate(() => [...App.sim.rx.entries()].map(([k, v]) => v.bits.filter(x => x != null).length));
  console.log('rx bits filled:', rxState);
  // full frame speed to complete reads
  await page.selectOption('.sim-ctl select >> nth=0', '1000'); await page.click('text=▶ Play'); await page.waitForTimeout(2500); await page.click('text=❚❚ Pause');
  const vals = await page.evaluate(() => { const o = {}; for (const [k, v] of App.sim.lastValue) { const f = App.find(k); o[f.s.name] = +v.toFixed(3); } return o; });
  console.log('decoded by our node:', JSON.stringify(vals));
  await page.locator('text=Signals our node sees').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/4_sim_rx_done.png` });
  // config
  await page.keyboard.press('Control+5'); await page.waitForTimeout(200); await shot('5_config');
  // dark theme
  await page.evaluate(() => App.setTheme('dark')); await page.keyboard.press('Control+4'); await page.waitForTimeout(300); await shot('6_dark_sim');
  await page.keyboard.press('Control+2'); await page.waitForTimeout(200); await shot('6_dark_bitmap');
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
