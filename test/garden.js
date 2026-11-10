/* The garden: a study session grows a plant in the pot as it goes, and the
   plant goes into the garden when it ends -- a false start grows nothing, a
   session stopped early grows what it grew. Five in a week grow a tree. It
   keeps across a reload, reaches a second device on the same account, and a
   new week starts a new row. And the pets are gone. */
const { chromium } = require('./browser');
const { start } = require('./fakedb.js');
const makeClient = require('./fakeclient.js');
const DB = 'http://127.0.0.1:8902';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const USER = '55555555-5555-5555-5555-555555555555';
const AT = new Date(2026, 10, 9, 16, 0);               // a Monday, four in the afternoon
const MIN = 60 * 1000;

(async () => {
  const db = await start(8902);
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  async function device(label) {
    const ctx = await b.newContext({ viewport: { width: 430, height: 950 } });
    await ctx.route(CDN, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: makeClient(DB, USER) }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(label + ' PAGE: ' + e.message));
    p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load/.test(t)) errs.push(label + ' CON: ' + t); });
    await p.clock.install({ time: AT });
    await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(2500);
    return p;
  }
  const pot = p => p.evaluate(() => { const s = document.querySelector('#potNow svg'); return { kind: s.dataset.kind, g: +s.dataset.g }; });
  const toast = p => p.evaluate(() => { const t = [...document.querySelectorAll('.toast-text')].pop(); return t ? t.textContent : null; });
  const count = p => p.evaluate(() => Garden.count());
  // a session: start, so many minutes of it, and either let it finish or stop it
  async function session(p, mins, stop) {
    if (await p.evaluate(() => document.body.dataset.mode === 'break')) { await p.click('#reset'); await p.clock.runFor(300); }
    await p.click('#startPause'); await p.clock.runFor(500);
    await p.clock.fastForward(mins * MIN); await p.clock.runFor(1500);
    if (stop) { await p.click('#reset'); await p.clock.runFor(500); }
  }

  const a = await device('A');

  console.log('--- the pets have gone; a seed is waiting ---');
  check('no pets anywhere', await a.evaluate(() => [!!window.Pet, !!document.getElementById('petCanvas'), !!document.getElementById('petBtn')]), [false, false, false]);
  check('an empty pot with a seed in it', (await pot(a)).g, 0);
  check('and it says so', await a.evaluate(() => document.getElementById('timerDoing').textContent), 'a seed, ready to grow');

  console.log('\n--- a session grows a plant ---');
  await a.click('#startPause'); await a.clock.runFor(800);
  const first = await pot(a);
  check('starting plants a seed of some kind', !!first.kind, true);
  await a.clock.fastForward(10 * MIN); await a.clock.runFor(1500);
  const ten = await pot(a);
  await a.clock.fastForward(12 * MIN); await a.clock.runFor(1500);
  const twentytwo = await pot(a);
  check('it grows as the session goes', [ten.g > 0.2, twentytwo.g > ten.g], [true, true]);
  check('and it is the same plant all along', [ten.kind, twentytwo.kind], [first.kind, first.kind]);
  check('saying what it is growing', await a.evaluate(() => /^growing an? /.test(document.getElementById('timerDoing').textContent)), true);

  await a.clock.fastForward(9 * MIN); await a.clock.runFor(2000);
  check('when the session ends, it goes into the garden', await count(a), 1);
  check('as tall as the session was long', await a.evaluate(() => Garden.last().mins), 30);
  check('and says so', /into your garden$/.test(await toast(a)), true);
  check('the break shows what just grew', await a.evaluate(k => [document.body.dataset.mode, document.querySelector('#potNow svg').dataset.kind], first.kind),
    ['break', first.kind]);
  check('and it sits under the timer with this week’s others', await a.evaluate(() => document.querySelectorAll('#sill .g-plant').length), 1);

  console.log('\n--- a false start grows nothing; stopping early grows what it grew ---');
  await session(a, 3, true);
  check('three minutes, then reset: nothing', await count(a), 1);
  await session(a, 12, true);
  check('twelve minutes, then reset: a small plant', [await count(a), await a.evaluate(() => Garden.last().mins)], [2, 12]);
  check('said in its size', /12m tall/.test(await toast(a)), true);

  console.log('\n--- five in a week grow a tree ---');
  await session(a, 31);
  await session(a, 31);
  check('four, and the sill says one more', await a.evaluate(() => document.querySelector('#sill .sill-words').textContent), 'one more session grows a tree');
  await session(a, 31);
  check('the fifth grows a tree, and it says which', /^five plants grew into an? /.test(await toast(a)), true);
  await a.click('#potNow'); await a.clock.runFor(800);
  check('the garden shows the tree, and the sill starts again', await a.evaluate(() => ({
    sum: document.querySelector('.g-sum').textContent.replace(/ · [^·]*grown$/, ''),
    trees: document.querySelectorAll('.g-shelf .g-tree').length,
    loose: document.querySelectorAll('.g-shelf .g-plant').length,
    sill: document.querySelectorAll('#sill .g-plant').length })), { sum: '5 plants · 1 tree', trees: 1, loose: 0, sill: 0 });
  await a.click('#gardenClose'); await a.clock.runFor(300);

  console.log('\n--- it keeps, and it follows the account ---');
  await a.reload(); await a.clock.runFor(3000);
  check('after a reload', await count(a), 5);
  check('saved with the account', (await (await fetch(DB + '/__dump', { method: 'POST', body: '{}' })).json()).prefs
    .map(r => (r.data && r.data.garden || []).length), [5]);
  const bdev = await device('B');
  await bdev.clock.runFor(3000);
  check('a second device grows the same garden', await count(bdev), 5);
  check('the same plants, drawn the same', await bdev.evaluate(() => Garden.weeks()[0].plants.map(p => p.kind)),
    await a.evaluate(() => Garden.weeks()[0].plants.map(p => p.kind)));

  console.log('\n--- a new week ---');
  await a.clock.fastForward(7 * 24 * 60 * MIN); await a.clock.runFor(3000);
  check('the sill is empty again', await a.evaluate(() => [document.querySelectorAll('#sill .g-plant').length,
    document.querySelector('#sill .sill-words').textContent]), [0, 'five sessions grow a tree']);
  await a.click('#potNow'); await a.clock.runFor(800);
  check('and last week’s tree stands in the grove', await a.evaluate(() => document.querySelectorAll('.g-grove .g-tree').length), 1);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await b.close(); db.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
