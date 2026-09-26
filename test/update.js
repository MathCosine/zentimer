/* A fix has to reach the app. The service worker precaches the shell, which is
   what makes it open with no network -- but for the app's own code that has to
   mean "the network first, the cache when there is none", or a push lands a
   load late and the app goes on running yesterday's code.

   So: a real copy of the site, served from disk, installed as a service worker,
   then the file on disk changes -- exactly what a deploy is -- and the next
   load has to be running the new one. And then, with the network gone, the
   thing still has to open. */
const { chromium } = require('./browser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.webmanifest':'application/manifest+json',
  '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-deploy-'));
  const site = path.resolve(__dirname, '..');
  ['index.html', 'privacy.html', 'sw.js', 'manifest.webmanifest', 'app', 'assets'].forEach(name =>
    fs.cpSync(path.join(site, name), path.join(root, name), { recursive: true }));

  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(req.url.split('?')[0]);
    if (file.endsWith('/')) file += 'index.html';
    const full = path.join(root, file);
    fs.readFile(full, (err, body) => {
      if (err) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'text/plain',
                           'cache-control': 'no-cache' });
      res.end(body);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if (!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  const ctx = await b.newContext({ viewport: { width: 430, height: 950 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGE: ' + e.message));

  console.log('--- the first visit installs it ---');
  await p.goto(base + '/app/'); await p.waitForTimeout(1500);
  await p.evaluate(() => navigator.serviceWorker.ready);
  check('a worker is in charge', await p.evaluate(() => !!navigator.serviceWorker.controller), true);
  check('the app is running', await p.evaluate(() => typeof window.Plan), 'object');

  console.log('\n--- then a fix is pushed ---');
  const plan = path.join(root, 'assets', 'plan.js');
  fs.writeFileSync(plan, "window.PIP_FIX = 'the new one';\n" + fs.readFileSync(plan, 'utf8'));

  await p.reload(); await p.waitForTimeout(1500);
  check('the very next load has it', await p.evaluate(() => window.PIP_FIX || null), 'the new one');
  check('and the app still works', await p.evaluate(() => typeof window.Store), 'object');

  console.log('\n--- and it can say which version it is running ---');
  await p.click('#settingsBtn'); await p.waitForTimeout(900);
  const says = () => p.evaluate(() => {
    const n = document.querySelector('.app-version'); return n ? n.textContent : null; });
  check('the settings name it', /^pip-/.test(await says() || ''), true);
  await p.locator('button', { hasText: 'check for updates' }).click(); await p.waitForTimeout(1500);
  check('and looking for a newer one answers', await says(), 'this is the latest');
  await p.click('#settingsClose'); await p.waitForTimeout(500);

  console.log('\n--- and it still opens with the network gone ---');
  await ctx.setOffline(true);
  await p.reload(); await p.waitForTimeout(2500);
  check('the desk is there', await p.evaluate(() => !!document.querySelector('.bar')), true);
  check('with its styles', await p.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--ink').trim().length > 0), true);
  await ctx.setOffline(false);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await b.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(fail || errs.length ? 1 : 0);
})();
