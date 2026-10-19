/* A database a version behind the page: schema.sql not run since links
   between tasks were added. Everything else still syncs, the links stay on
   the device that made them -- even when another device edits the task --
   and once the SQL has been run they go up by themselves. */
const { chromium } = require('./browser');
const { start } = require('./fakedb.js');
const makeClient = require('./fakeclient.js');
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const USER = '55555555-5555-5555-5555-555555555555';
const DB = 'http://127.0.0.1:8901';
const post = (path, body) => fetch(DB + path, { method: 'POST', body: JSON.stringify(body || {}) }).then(r => r.json());
const OLD_TASKS = ['id', 'user_id', 'list_id', 'title', 'tags', 'due', 'repeat', 'weekday', 'at', 'mins', 'done', 'done_at',
  'progress', 'rank', 'completions', 'skips', 'ord', 'created', 'updated', 'deleted_at'];

(async () => {
  const db = await start(8901);
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };
  async function device() {
    const ctx = await b.newContext({ viewport: { width: 430, height: 900 } });
    await ctx.route(CDN, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: makeClient(DB, USER) }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('PAGE: ' + e.message));
    p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load/.test(t)) errs.push('CON: ' + t); });
    await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1800);
    return p;
  }
  const serverTasks = async () => (await post('/__dump')).tasks.filter(r => r.user_id === USER && !r.deleted_at);

  await post('/__columns', { columns: { tasks: OLD_TASKS } });
  const a = await device();
  console.log('--- links made on a database without the column ---');
  await a.evaluate(() => {
    const r = Store.addTask({ title: 'BIO Read chapter 5', mins: 40 });
    const q = Store.addTask({ title: 'BIO Chapter 5 quiz', mins: 30 });
    Store.link(r.id, q.id);
  });
  await a.waitForTimeout(3500);
  check('the tasks still sync', (await serverTasks()).map(r => r.title).sort(), ['BIO Chapter 5 quiz', 'BIO Read chapter 5']);
  check('without the column the database does not have', (await serverTasks()).some(r => 'needs' in r), false);
  check('it knows which column the database is missing', await a.evaluate(() => Sync.behind()), ['tasks.needs']);
  await a.click('#menuBtn'); await a.waitForTimeout(300);
  check('and says what to run', await a.evaluate(() => /needs supabase\/schema\.sql run again/.test(document.getElementById('syncStatus').textContent)), true);
  await a.keyboard.press('Escape');
  check('and the link stays here', await a.evaluate(() => Store.tasks().find(t => /quiz/.test(t.title)).needs.length), 1);

  console.log('\n--- another device edits the task ---');
  const bDev = await device();
  await bDev.evaluate(() => { const q = Store.tasks().find(t => /quiz/.test(t.title)); Store.updateTask(q.id, { title: 'BIO Chapter 5 quiz (friday)' }); });
  await bDev.waitForTimeout(3000);
  await a.reload(); await a.waitForTimeout(3500);
  check('the edit arrives', await a.evaluate(() => Store.tasks().map(t => t.title).sort()), ['BIO Chapter 5 quiz (friday)', 'BIO Read chapter 5']);
  check('and the link is not wiped by a database that never had it', await a.evaluate(() =>
    Store.tasks().find(t => /quiz/.test(t.title)).needs.length), 1);

  console.log('\n--- once schema.sql has been run ---');
  await post('/__columns', { columns: null });
  await a.reload(); await a.waitForTimeout(3500);
  check('the link goes up by itself', (await serverTasks()).filter(r => (r.needs || []).length).map(r => r.title), ['BIO Chapter 5 quiz (friday)']);
  check('and sync is happy again', await a.evaluate(() => [Store.remote.status(), Sync.behind()]), ['synced', []]);
  await bDev.reload(); await bDev.waitForTimeout(3500);
  check('the other device has it now', await bDev.evaluate(() => Store.tasks().find(t => /quiz/.test(t.title)).needs.length), 1);

  await b.close(); db.close();
  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.forEach(e => console.log('  ' + e));
  process.exit(fail || errs.length ? 1 : 0);
})();
