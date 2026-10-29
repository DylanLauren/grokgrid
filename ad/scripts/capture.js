// Shoots the GrokGrid UI for the ad. BASE=https://grokgrid.fun node capture.js <outdir>
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'https://grokgrid.fun/';
const OUT = process.argv[2] || '../ui';
(async () => {
  const b = await chromium.launch(process.platform === 'linux' ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
  const shots = [
    ['intro', '', 1600, 1000, 0, false], ['desk', '', 1600, 1000, 1, false], ['stats', '#stats', 1600, 1000, 1, false],
    ['matrix', '#matrix', 1600, 1000, 1, false], ['grid', '#grid', 1600, 1000, 1, false], ['calls', '#calls', 1600, 1000, 1, false],
    ['m-matrix-full', '#matrix', 430, 932, 1, true], ['m-stats-full', '#stats', 430, 932, 1, true], ['m-desk', '', 430, 932, 1, false],
    ['m-calls', '#calls', 430, 932, 1, false], ['m-grid-full', '#grid', 430, 932, 1, true],
  ].filter((s) => !process.env.ONLY || process.env.ONLY.split(',').includes(s[0]));
  for (const [name, hash, w, h, enter, full] of shots) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 3 : 2 });
    try { await p.goto(BASE + hash, { waitUntil: 'networkidle', timeout: 60000 }); } catch (e) { console.log(name, 'nav slow'); }
    await p.waitForTimeout(3000);
    if (enter) { try { await p.getByRole('button', { name: /enter/i }).click({ timeout: 8000 }); } catch (e) { console.log(name, 'no enter'); } }
    await p.waitForTimeout(4000);
    // the first-visit tour card covers the room; close it like a returning visitor would
    for (let i = 0; i < 3 && enter; i++) {
      try { await p.getByText('skip', { exact: true }).first().click({ timeout: 2500 }); } catch (e) {}
      await p.waitForTimeout(1500);
    }
    await p.waitForTimeout(3000);
    await p.screenshot({ timeout: 120000, fullPage: full, path: `${OUT}/${name}.png` });
    console.log('ok', name);
    await p.close();
  }
  await b.close();
})();
