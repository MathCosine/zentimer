const { chromium } = require('playwright');
const { start } = require('./fakedb.js');
const makeClient = require('./fakeclient.js');

const APP = 'http://127.0.0.1:8899/app/';
const DB = 'http://127.0.0.1:8901';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const USER = '11111111-1111-1111-1111-111111111111';

async function device(browser, label, errs) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  await ctx.route(CDN, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: makeClient(DB, USER) }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(label + ': ' + e.message));
  return p;
}
const titles = p => p.evaluate(() => [...document.querySelectorAll('.task-title')].map(t => t.textContent).sort());
const post = (path, body) => fetch(DB + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());

(async () => {
  const db = await start(8901);
  const browser = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++;
  };

  console.log('\n--- an account still on the old single document ---');
  await post('/__seedLegacy', { user: USER, doc: {
    version: 1,
    lists: [{ id: 'l_school', name: 'School', order: 0 }],
    tags: [{ id: 'g_phy', name: 'PHY', color: 'coral' }],
    tasks: [
      { id: 't_old1', listId: 'l_school', title: 'PHY Workbook Week 5', tags: ['g_phy'], due: null,
        repeat: 'none', weekday: null, at: null, mins: 30, done: false, completions: {}, skips: {}, order: 0 },
      { id: 't_old2', listId: 'l_school', title: 'MSB Lecture 2', tags: [], due: null,
        repeat: 'daily', weekday: null, at: 540, mins: 45, done: false, completions: {}, skips: {}, order: 1 }
    ],
    blocks: [{ id: 'b_old1', date: '2026-09-22', start: 600, end: 660, taskId: 't_old1', title: 'PHY Workbook Week 5', done: false, ranOver: 0 }],
    logs: [{ id: 's_old1', taskId: 't_old1', blockId: 'b_old1', date: '2026-09-22', ms: 1800000, at: Date.now() }],
    updated: 5
  }});

  const a = await device(browser, 'A', errs);
  await a.goto(APP); await a.waitForTimeout(1600);
  check('the old document becomes rows', await titles(a), ['MSB Lecture 2', 'PHY Workbook Week 5']);

  const dump = await post('/__dump', {});
  check('tasks written as rows', dump.tasks.length, 2);
  check('tags carried across', dump.tags.map(t => t.name), ['PHY']);
  check('blocks carried across', dump.blocks.length, 1);
  check('block times mapped to start_min/end_min', [dump.blocks[0].start_min, dump.blocks[0].end_min], [600, 660]);
  check('repeat and time survive the trip', [dump.tasks.find(t => t.id === 't_old2').repeat,
                                              dump.tasks.find(t => t.id === 't_old2').at], ['daily', 540]);
  check('the old document is left where it is', dump.pip_state.length, 1);
  check('the account is marked migrated', dump.prefs[0].migrated, true);

  console.log('\n--- running it twice changes nothing ---');
  await a.reload(); await a.waitForTimeout(1600);
  const again = await post('/__dump', {});
  check('no duplicates on a second run', again.tasks.length, 2);
  check('still two tasks on screen', await titles(a), ['MSB Lecture 2', 'PHY Workbook Week 5']);

  console.log('\n--- the bug that started this: a blank browser signs in ---');
  const c = await device(browser, 'C', errs);
  await c.goto(APP); await c.waitForTimeout(1600);
  check('the empty browser receives the data', await titles(c), ['MSB Lecture 2', 'PHY Workbook Week 5']);
  const afterBlank = await post('/__dump', {});
  check('and did not wipe the server', afterBlank.tasks.filter(t => !t.deleted_at).length, 2);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await browser.close(); db.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
