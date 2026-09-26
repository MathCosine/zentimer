const { chromium } = require('./browser');
const { start } = require('./fakedb.js');
const makeClient = require('./fakeclient.js');

const APP = 'http://127.0.0.1:8899/app/';
const DB = 'http://127.0.0.1:8901';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const USER = '11111111-1111-1111-1111-111111111111';

async function device(browser, label, errs) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  await ctx.route(CDN, route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: makeClient(DB, USER)
  }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(label + ' PAGE: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load resource/.test(t)) errs.push(label + ' CON: ' + t); });
  await p.goto(APP);
  await p.waitForTimeout(1200);
  p.label = label;
  return p;
}

const add = async (p, title) => { await p.fill('#taskInput', title); await p.press('#taskInput', 'Enter'); await p.waitForTimeout(150); };
const titles = p => p.evaluate(() => [...document.querySelectorAll('.task-title')].map(t => t.textContent).sort());
const status = p => p.evaluate(() => Store.remote.status());
const reload = async p => { await p.reload(); await p.waitForTimeout(1400); };

(async () => {
  const db = await start(8901);
  const browser = await chromium.launch();
  const errs = [];
  let pass = 0, fail = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++;
  };

  console.log('\n--- one device writes, a second picks it up ---');
  const a = await device(browser, 'A', errs);
  check('A connects', await status(a), 'synced');
  await add(a, 'PHY Mastering');
  await add(a, 'MSB Reading');
  await a.waitForTimeout(1200);

  const b = await device(browser, 'B', errs);
  check('B pulls what A wrote', await titles(b), ['MSB Reading', 'PHY Mastering']);

  console.log('\n--- both edit at once: under one document, one of these was lost ---');
  await add(a, 'EXTRA OTIS');
  await add(b, 'LATIN Vocab');
  await a.waitForTimeout(1200); await b.waitForTimeout(1200);
  await reload(a); await reload(b);
  const both = ['EXTRA OTIS', 'LATIN Vocab', 'MSB Reading', 'PHY Mastering'];
  check('A has both edits', await titles(a), both);
  check('B has both edits', await titles(b), both);

  console.log('\n--- a delete travels, and does not come back ---');
  await a.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'MSB Reading');
    Store.removeTask(t.id);
  });
  await a.waitForTimeout(1200);
  await reload(b);
  check('B sees the delete', await titles(b), ['EXTRA OTIS', 'LATIN Vocab', 'PHY Mastering']);
  await reload(b);
  check('it stays deleted after another pull', await titles(b), ['EXTRA OTIS', 'LATIN Vocab', 'PHY Mastering']);

  console.log('\n--- an edit made with no connection goes up when there is one ---');
  await b.context().setOffline(true);
  await add(b, 'CHEM Lab');
  await b.waitForTimeout(800);
  check('B queued it', await b.evaluate(() => Store.pending() > 0), true);
  await b.context().setOffline(false);
  await b.evaluate(() => Sync.flush());
  await b.waitForTimeout(1000);
  await reload(a);
  check('A receives it once B is back', (await titles(a)).includes('CHEM Lab'), true);

  console.log('\n--- how far in a task is travels with it ---');
  await a.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'CHEM Lab');
    Store.updateTask(t.id, { progress: 50 });
  });
  await a.waitForTimeout(1200);
  await reload(b);
  check('the other device sees it', await b.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'CHEM Lab');
    return t ? t.progress : 'missing'; }), 50);

  console.log('\n--- the same task edited on both: the later one wins, nothing vanishes ---');
  await a.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY Mastering');
    Store.updateTask(t.id, { title: 'PHY Mastering — from A' });
  });
  await a.waitForTimeout(1100);
  await b.evaluate(() => {
    const t = Store.tasks().find(x => x.title.startsWith('PHY Mastering'));
    Store.updateTask(t.id, { title: 'PHY Mastering — from B' });
  });
  await b.waitForTimeout(1100);
  await reload(a);
  const after = await titles(a);
  check('one winner, no duplicate', after.filter(t => t.startsWith('PHY Mastering')).length, 1);
  check('the later edit is the one kept', after.some(t => t.endsWith('from B')), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 6).forEach(e => console.log('  !', e));
  await browser.close();
  db.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
