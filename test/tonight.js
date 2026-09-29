/* Time till bed, and an evening that plans to it. The clock is pinned, so the
   same workload can be looked at at four in the afternoon, half past eight,
   half past ten and twenty-five to midnight -- which is the whole point: the
   right thing to do next depends on how long is left to do it in. */
const { chromium } = require('./browser');

const seed = () => {
  const on = n => { const d = new Date(Store.dayKey() + 'T12:00'); d.setDate(d.getDate() + n); return Store.dayKey(d); };
  Store.addTask({ title: 'PHY Workbook Week 5', due: on(1), mins: 45 });
  Store.addTask({ title: 'PHY Mastering Week 5', due: on(1), mins: 40 });
  Store.addTask({ title: 'LATIN Unit Test 1', due: on(2), mins: 60 });
  Store.addTask({ title: 'ANALYSIS Problem Set 2', due: on(3), mins: 90 });
  Store.addTask({ title: 'TAA Research essay', due: on(8), mins: 360 });
  Store.addTask({ title: 'WELL Monthly PE Log', due: on(4), mins: 15 });
  ['USACO Prep', 'OTIS', 'HMMT', 'SAT English'].forEach(n =>
    Store.addTask({ title: 'EXTRA ' + n, repeat: 'daily', mins: 45 }));
  Store.quiet();
};

(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok ? pass++ : fail++; };

  async function at(hh, mm, before, after) {
    const ctx = await b.newContext({ viewport: { width: 430, height: 950 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(hh + ':' + mm + ' ' + e.message));
    p.on('console', m => { const t = m.text();
      if (m.type() === 'error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: ' + t); });
    await p.clock.install({ time: new Date(2026, 8, 27, hh, mm) });
    await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(1500);
    if (before) await p.evaluate(before);
    await p.evaluate(seed);
    if (after) await p.evaluate(after);
    await p.clock.runFor(1200);
    const r = await p.evaluate(() => ({
      head: (document.querySelector('.queue-head span') || {}).textContent || null,
      tonight: (document.querySelector('.aim-tonight') || {}).textContent || null,
      mode: ((document.querySelector('.aim-tonight') || {}).className || '').replace('aim-tonight is-', ''),
      rows: [...document.querySelectorAll('.queue-row')].map(n => n.querySelector('.queue-title').textContent),
      whys: [...document.querySelectorAll('.queue-row')].map(n => n.querySelector('.queue-why').textContent),
      mins: [...document.querySelectorAll('.queue-row')].map(n => n.querySelector('.queue-mins').textContent),
      clear: (document.querySelector('.aim-clear') || {}).textContent || null
    }));
    await ctx.close();
    return r;
  }

  console.log('--- four in the afternoon: time for all of it ---');
  const four = await at(16, 0);
  check('it says how long till bed', four.head, '8h till bed');
  check('and with time for all of it, no warning under the bars', four.tonight, null);
  check('so the rows are a mix: a deadline first', four.rows[0], 'PHY Workbook Week 5');
  check('then a change of gear', four.rows[1].indexOf('EXTRA'), 0);

  console.log('\n--- half past eight: not all of it fits ---');
  const eight = await at(20, 30);
  check('three and a half hours', eight.head, '3h 30m till bed');
  check('it says so', eight.mode, 'tight');
  check('both things due tomorrow lead, same class or not', eight.rows.slice(0, 2),
    ['PHY Workbook Week 5', 'PHY Mastering Week 5']);
  check('then practice gets its row, ahead of homework that can wait', eight.rows[2].indexOf('EXTRA'), 0);
  check('and the line says how much of it', /then 1h 5m of practice/.test(eight.tonight), true);
  check('and the far-off essay is named as waiting', /TAA Research essay can wait till tomorrow/.test(eight.tonight), true);

  console.log('\n--- ten o\u2019clock with a lot due: forget practice, hit the deadlines ---');
  const tenish = await at(22, 0);
  check('two hours', tenish.head, '2h till bed');
  check('the deadlines lead', tenish.rows.slice(0, 2), ['PHY Workbook Week 5', 'PHY Mastering Week 5']);
  check('and the next nearest is started, not a drill', tenish.rows[2], 'LATIN Unit Test 1');
  check('no practice offered at all', tenish.rows.some(t => /^EXTRA/.test(t)), false);
  check('and the line says practice waits', /deadlines first, practice waits/.test(tenish.tonight), true);

  console.log('\n--- half past ten with little due: practice cut down, not cut out ---');
  const light = await at(22, 30, () => {}, () => {
    // only one sheet due tomorrow; the rest is far off, and the drills are an hour each
    Store.tasks().filter(t => /Mastering|LATIN|ANALYSIS/.test(t.title)).forEach(t => Store.removeTask(t.id));
    Store.tasks().filter(t => /^EXTRA/.test(t.title)).forEach(t => Store.updateTask(t.id, { mins: 60 }));
  });
  check('the sheet due tomorrow first', light.rows[0], 'PHY Workbook Week 5');
  check('then an hour\u2019s drill, cut to what is left', light.rows[1].indexOf('EXTRA'), 0);
  check('and it says so', light.mins[1], '45m of 1h');

  console.log('\n--- half past ten: only the deadlines ---');
  const ten = await at(22, 30);
  check('an hour and a half', ten.head, '1h 30m till bed');
  check('the evening is the two things due tomorrow', ten.rows, ['PHY Workbook Week 5', 'PHY Mastering Week 5']);
  check('and no drill is pushed in front of them', ten.rows.some(t => /^EXTRA/.test(t)), false);

  console.log('\n--- twenty-five to midnight: not even those fit ---');
  const late = await at(23, 35);
  check('twenty-five minutes', late.head, '25m till bed');
  check('it says it is a crunch', late.mode, 'crunch');
  check('what is due tomorrow comes first, even though it will not fit',
    late.rows, ['PHY Workbook Week 5', 'PHY Mastering Week 5']);
  check('and says why, not how long it needs', late.whys[0], 'due tomorrow');
  check('a quick thing due on Thursday does not jump the queue', late.rows.indexOf('WELL Monthly PE Log'), -1);

  console.log('\n--- effort counts as well as nearness ---');
  const ctx = await b.newContext({ viewport: { width: 430, height: 950 } });
  const q = await ctx.newPage();
  q.on('pageerror', e => errs.push('effort ' + e.message));
  await q.clock.install({ time: new Date(2026, 8, 27, 15, 0) });
  await q.goto('http://127.0.0.1:8899/app/'); await q.clock.runFor(1500);
  await q.evaluate(() => {
    const on = n => { const d = new Date(Store.dayKey() + 'T12:00'); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    Store.addTask({ title: 'MSB Worksheet', due: on(2), mins: 30 });          // near, small
    Store.addTask({ title: 'TAA Big project', due: on(3), mins: 600 });       // further, and ten hours of it
    Store.quiet();
  });
  await q.clock.runFor(1200);
  const effort = await q.evaluate(() => [...document.querySelectorAll('.queue-row')].map(n =>
    n.querySelector('.queue-title').textContent + ' | ' + n.querySelector('.queue-mins').textContent));
  check('ten hours due in three days comes before half an hour due in two', effort[0].indexOf('TAA Big project'), 0);
  check('as a slice of it, not all ten hours', / \u00b7 \d+%$/.test(effort[0]), true);
  check('and the near one is still there', effort.some(r => r.indexOf('MSB Worksheet') === 0), true);
  await ctx.close();

  console.log('\n--- homework done: the evening is practice ---');
  const done = await at(20, 0, null, () => {
    Store.tasks().filter(t => !/^EXTRA/.test(t.title)).forEach(t => Store.toggleDone(t.id, Store.dayKey()));
  });
  check('the head says the rest of the evening can be practice', done.head, 'homework done \u00b7 4h till bed');
  check('and offers it', done.rows.every(t => /^EXTRA/.test(t)), true);

  const more = await at(20, 0, null, () => {
    Store.tasks().filter(t => !/^EXTRA/.test(t.title)).forEach(t => Store.toggleDone(t.id, Store.dayKey()));
    Store.tasks().filter(t => /USACO|OTIS/.test(t.title)).forEach(t => Store.toggleDone(t.id, Store.dayKey()));
  });
  check('with the day\u2019s worth done too, more is still on offer', more.whys.every(w => w === 'extra practice'), true);
  check('and the bars say how long there is for it', /4h till bed for extra practice/.test(more.clear || ''), true);

  console.log('\n--- it keeps time on its own ---');
  {
    const ctx = await b.newContext({ viewport: { width: 430, height: 950 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('live ' + e.message));
    await p.clock.install({ time: new Date(2026, 8, 27, 22, 20) });
    await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(1500);
    await p.evaluate(seed); await p.clock.runFor(1200);
    const read = () => p.evaluate(() => ({
      head: document.querySelector('.queue-head span').textContent,
      mode: ((document.querySelector('.aim-tonight') || {}).className || '').replace('aim-tonight is-', '') }));
    const first = await read();
    check('twenty past ten: an hour forty', first.head, '1h 40m till bed');
    check('and tight', first.mode, 'tight');
    // nothing is touched: only the clock moves
    await p.clock.fastForward('10:00'); await p.clock.runFor(1000);
    check('ten minutes later it says so by itself', (await read()).head, '1h 30m till bed');
    await p.clock.fastForward('50:00'); await p.clock.runFor(1000);
    const later = await read();
    check('and at twenty past eleven', later.head, '40m till bed');
    check('the evening has tipped into a crunch without a click', later.mode, 'crunch');
    await ctx.close();
  }

  console.log('\n--- the whole plan, all the way down ---');
  {
    const ctx = await b.newContext({ viewport: { width: 646, height: 1000 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('plan ' + e.message));
    await p.clock.install({ time: new Date(2026, 8, 27, 20, 30) });
    await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(1500);
    await p.evaluate(seed); await p.clock.runFor(1200);
    await p.locator('.aim-why', { hasText: 'plan' }).click(); await p.clock.runFor(500);
    const plan = await p.evaluate(() => ({
      lines: [...document.querySelectorAll('.aim-plan .plan-line')].map(n => ({
        at: n.querySelector('.plan-at').textContent, name: n.querySelector('.plan-name').textContent,
        why: n.querySelector('.plan-why').textContent, mins: n.querySelector('.plan-mins').textContent })),
      note: (document.querySelector('.plan-note') || {}).textContent || null,
      waits: [...document.querySelectorAll('.aim-plan .plan-sub ~ .plan-line .plan-name')].map(n => n.textContent),
      next: [...document.querySelectorAll('.queue-row .queue-title')].map(n => n.textContent) }));
    check('it starts now', plan.lines[0].at, '20:30');
    check('with what is due tomorrow first', plan.lines.slice(0, 2).map(l => l.name), ['PHY Workbook Week 5', 'PHY Mastering Week 5']);
    check('and each step starts when the one before ends', plan.lines[1].at, '21:15');
    check('then a practice session, cut to what the evening has', /^EXTRA/.test(plan.lines[2].name) && plan.lines[2].why === 'practice', true);
    check('then the homework that fits', plan.lines.some(l => l.name === 'LATIN Unit Test 1'), true);
    check('it says when it would all be done', /^done by /.test(plan.note || ''), true);
    check('and what it has left out', plan.waits.indexOf('TAA Research essay') > -1 && plan.waits.indexOf('ANALYSIS Problem Set 2') > -1, true);
    check('up next is the top of the plan', plan.next.slice(0, 2), plan.lines.slice(0, 2).map(l => l.name));
    await p.locator('.aim-plan .plan-line').nth(3).click(); await p.clock.runFor(500);
    check('a step opens the task it names', await p.evaluate(() => !!document.querySelector('.task-edit')), true);
    await ctx.close();
  }
  {
    // four in the afternoon is not late: a lot due in two days does not cost practice
    const ctx = await b.newContext({ viewport: { width: 646, height: 1000 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('afternoon ' + e.message));
    await p.clock.install({ time: new Date(2026, 8, 27, 16, 0) });
    await p.goto('http://127.0.0.1:8899/app/'); await p.clock.runFor(1500);
    await p.evaluate(() => {
      const on = n => { const d = new Date(Store.dayKey() + 'T12:00'); d.setDate(d.getDate() + n); return Store.dayKey(d); };
      for (let i = 0; i < 8; i++) Store.addTask({ title: 'LATIN Load ' + i, due: on(i < 3 ? 1 : 2), mins: 60 });
      Store.addTask({ title: 'EXTRA OTIS', repeat: 'daily', mins: 60 });
    });
    await p.clock.runFor(1200);
    await p.locator('.aim-why', { hasText: 'plan' }).click(); await p.clock.runFor(500);
    check('at four with a heavy two days, practice is still in the plan', await p.evaluate(() =>
      [...document.querySelectorAll('.aim-plan .plan-why')].some(n => n.textContent === 'practice')), true);
    await ctx.close();
  }

  console.log('\n--- bedtime is yours to set ---');
  const early = await at(22, 30, () => Plan.setDay(Plan.dayStart(), 23 * 60));
  check('with bed at eleven, half past ten is half an hour', early.head, '30m till bed');
  check('which is a crunch', early.mode, 'crunch');

  console.log('\n--- time that is already spoken for comes off ---');
  const dinner = await at(20, 30, () => {
    Store.addBlock({ date: Store.dayKey(), start: 21 * 60, end: 22 * 60, title: 'dinner' });
  });
  check('an hour of dinner is an hour less', /2h 30m till bed/.test(dinner.tonight), true);

  console.log('\n--- past bedtime ---');
  const after = await at(0, 20);             // twenty past midnight: still the evening before
  check('it says so', after.head, 'past bedtime');
  check('and what is due tomorrow is all it offers', after.rows,
    ['PHY Workbook Week 5', 'PHY Mastering Week 5']);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0, 5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
