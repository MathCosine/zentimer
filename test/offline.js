const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };

  const ctx = await b.newContext({ viewport:{width:430,height:900} });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });

  await p.goto('http://127.0.0.1:8899/app/');
  await p.waitForTimeout(2500);
  check('the worker registered', await p.evaluate(() =>
    navigator.serviceWorker.getRegistration().then(r => !!r)), true);
  check('it took control', await p.evaluate(() => !!navigator.serviceWorker.controller), true);

  const cached = await p.evaluate(async () => {
    const names = await caches.keys();
    const c = await caches.open(names[0]);
    const keys = await c.keys();
    return keys.map(k => new URL(k.url).pathname).sort();
  });
  console.log('    precached: ' + cached.length + ' files');
  check('the shell is in the cache', ['/app/index.html','/assets/app.js','/assets/style.css','/assets/store.js']
    .every(f => cached.includes(f)), true);
  check('the font came too', cached.some(f => f.endsWith('.woff2')), true);

  console.log('\n--- with the network gone ---');
  await p.fill('#taskInput','PHY before going offline'); await p.press('#taskInput','Enter'); await p.waitForTimeout(400);
  await ctx.setOffline(true);
  await p.reload(); await p.waitForTimeout(1600);
  check('the app still opens', await p.evaluate(() => !!document.getElementById('taskInput')), true);
  check('and the work is there', await p.evaluate(() =>
    [...document.querySelectorAll('.task-title')].map(t=>t.textContent)), ['PHY before going offline']);
  await p.fill('#taskInput','MSB added while offline'); await p.press('#taskInput','Enter'); await p.waitForTimeout(400);
  check('you can still add', await p.evaluate(() => document.querySelectorAll('.task').length), 2);
  check('styles came from the cache', await p.evaluate(() =>
    getComputedStyle(document.querySelector('.card')).borderRadius !== '0px'), true);

  console.log('\n--- the front page offline too ---');
  await p.goto('http://127.0.0.1:8899/'); await p.waitForTimeout(1200);
  check('front page opens', await p.evaluate(() => /keeps your day honest/i.test(document.body.innerText)), true);

  await ctx.setOffline(false);
  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,6).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
