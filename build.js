// Bundles CANssm into a single offline HTML file: dist/index.html
const fs = require('fs'), path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const js = ['node_modules/xlsx/dist/xlsx.full.min.js', 'src/core.js', 'src/formats.js', 'src/sample.js', 'src/ui-base.js', 'src/ui-spec.js', 'src/ui-bitmap.js', 'src/ui-sim.js', 'src/ui-config.js'];
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'">
<title>CANssm</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#123a8c"/><path d="M5 22v-6h4v6M11 22v-11h4v11M17 22v-6h4v6M23 22v-11h4v11" fill="none" stroke="#fff" stroke-width="2"/></svg>')}">
<style>${r('src/styles.css')}</style></head>
<body><div id="app"></div>
${js.map(f => `<script>${safe(r(f))}</script>`).join('\n')}
<script>App.start();</script>
</body></html>`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(0), 'KB');
