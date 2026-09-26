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
  // the first worker is not news: it is the code the page already loaded
  check('and it does not announce itself as an update', await p.evaluate(() =>
    !!document.querySelector('.update-bar')), false);

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

  /* And the trap this was found in: a browser already carrying the old
     cache-first worker. That worker keeps answering while a tab stays open, so
     the new one sits waiting and every reload comes back with the same old
     code. Escaping it must not need anyone to notice a bar and click it. */
  console.log('\n--- a browser stuck on the old worker gets out by itself ---');
  const OLD_SW = `
    var VERSION = 'pip-old';
    var SHELL = ['./', './app/', './app/index.html', './assets/plan.js', './assets/store.js',
                 './assets/style.css', './assets/app.js', './assets/offline.js', './assets/sync.js',
                 './assets/settings.js', './assets/pet.js', './assets/music.js', './assets/config.js'];
    self.addEventListener('install', function (e) {
      e.waitUntil(caches.open(VERSION).then(function (c) {
        return Promise.all(SHELL.map(function (u) {
          return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); })); }));
    });
    self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
    self.addEventListener('message', function (e) { if (e.data === 'skip-waiting') self.skipWaiting(); });
    self.addEventListener('fetch', function (e) {
      if (e.request.method !== 'GET') return;
      if (new URL(e.request.url).origin !== self.location.origin) return;
      e.respondWith(caches.match(e.request).then(function (hit) {
        if (hit) { fetch(e.request).then(function (r) {
          if (r && r.ok) caches.open(VERSION).then(function (c) { c.put(e.request, r); }); }).catch(function () {});
          return hit; }
        return fetch(e.request); }));
    });`;

  const realSw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const realPlan = fs.readFileSync(plan, 'utf8').replace("window.PIP_FIX = 'the new one';\n", '');
  fs.writeFileSync(path.join(root, 'sw.js'), OLD_SW);
  fs.writeFileSync(plan, realPlan);

  const stuck = await b.newContext({ viewport: { width: 430, height: 950 } });
  const q = await stuck.newPage();
  q.on('pageerror', e => errs.push('STUCK: ' + e.message));
  await q.goto(base + '/app/'); await q.waitForTimeout(1500);
  await q.evaluate(() => navigator.serviceWorker.ready);
  await q.reload(); await q.waitForTimeout(1200);
  check('the old worker is the one answering', await q.evaluate(() => !!navigator.serviceWorker.controller), true);
  check('and there is no fix in sight', await q.evaluate(() => window.PIP_FIX || null), null);

  // the deploy: the new worker, and a fix in the code it serves
  fs.writeFileSync(path.join(root, 'sw.js'), realSw);
  fs.writeFileSync(plan, "window.PIP_FIX = 'the new one';\n" + realPlan);

  let arrived = null;
  for (let go = 1; go <= 2 && !arrived; go++) {
    await q.reload(); await q.waitForTimeout(2000);
    arrived = await q.evaluate(() => window.PIP_FIX || null);
    if (arrived) console.log('        (it arrived on reload ' + go + ', with nothing clicked)');
  }
  check('two reloads and it is current, untouched', arrived, 'the new one');
  check('nothing was broken getting there', await q.evaluate(() => typeof window.Store), 'object');
  await q.close(); await stuck.close();

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await b.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(fail || errs.length ? 1 : 0);
})();
