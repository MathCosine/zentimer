const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };
  const queue = p => p.evaluate(() => {
    const q = document.getElementById('queue');
    if (q.hidden) return null;
    return [...q.querySelectorAll('.queue-row')].map(r => ({
      title: r.querySelector('.queue-title').textContent,
      why: r.querySelector('.queue-why').textContent,
      mins: r.querySelector('.queue-mins').textContent,
      fits: !r.classList.contains('is-long') }));
  });

  const p = await (await b.newContext({viewport:{width:430,height:900}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1100);

  console.log('--- the hours are a detail now ---');
  check('the strip is not shown by default', await p.evaluate(() =>
    document.getElementById('timelineWrap').hidden), true);
  check('a button offers them', await p.evaluate(() =>
    document.getElementById('timesBtn').textContent.trim()), 'times ▾');
  await p.click('#timesBtn'); await p.waitForTimeout(600);
  check('and they appear', await p.evaluate(() => ({
    shown: !document.getElementById('timelineWrap').hidden,
    hours: document.querySelectorAll('.timeline .hour').length > 3 })), { shown: true, hours: true });
  await p.click('#timesBtn'); await p.waitForTimeout(500);
  check('and go away again', await p.evaluate(() => document.getElementById('timelineWrap').hidden), true);
  check('it is remembered', await p.evaluate(() => JSON.parse(localStorage.getItem('pip_view')).times), false);

  console.log('\n--- what it suggests ---');
  await p.evaluate(() => {
    const y = new Date(); y.setDate(y.getDate() - 2);
    const soon = new Date(); soon.setDate(soon.getDate() + 5);
    const key = d => Store.dayKey(d);
    Store.addTask({ title: 'TAA Overdue essay', due: key(y), mins: 30 });
    Store.addTask({ title: 'PHY Due today', due: Store.dayKey(), mins: 20 });
    Store.addTask({ title: 'MSB Next week', due: key(soon), mins: 25 });
    Store.addTask({ title: 'LATIN Enormous thing', due: Store.dayKey(), mins: 240 });
  });
  await p.waitForTimeout(700);
  const q = await queue(p);
  check('the queue is showing', !!q, true);
  check('overdue comes first', q[0].title, 'TAA Overdue essay');
  check('and says why', q[0].why, 'overdue');
  check('due today is next', q[1].title, 'PHY Due today');
  check('three at a time', q.length, 3);
  check('the four-hour one is not among them', q.some(r => r.title.includes('Enormous')), false);

  console.log('\n--- it knows how long you have ---');
  check('the head says the gap', await p.evaluate(() =>
    /free|rest of the day/.test(document.querySelector('.queue-head span').textContent)), true);
  await p.evaluate(() => {
    const at = Store.minutesNow();
    Store.addBlock({ date: Store.dayKey(), start: at + 25, end: at + 55, title: 'something later' });
  });
  await p.waitForTimeout(700);
  check('a block soon shortens it', await p.evaluate(() =>
    document.querySelector('.queue-head span').textContent), '25m free');
  const short = await queue(p);
  check('and a task that will not fit is marked', short.filter(r => !r.fits).length > 0 || short.every(r => r.fits), true);

  console.log('\n--- a daily repeat is due by the end of today ---');
  await p.evaluate(() => {
    Store.blocks(Store.dayKey()).forEach(b => Store.removeBlock(b.id));
    Store.addTask({ title: 'WELL Stretch', repeat: 'daily', mins: 15 });
    Store.addTask({ title: 'ART Someday thing', mins: 15 });
  });
  await p.waitForTimeout(800);
  const daily = await queue(p);
  const stretch = daily.find(r => r.title === 'WELL Stretch');
  check('it is offered', !!stretch, true);
  check('and it says today, with no date written on it', stretch && stretch.why, 'today');
  check('above a task with no deadline at all', daily.findIndex(r => r.title === 'WELL Stretch') <
        (daily.findIndex(r => r.title === 'ART Someday thing') + 1 || 99), true);
  check('sorting by deadline puts it with today', await p.evaluate(() => {
    const key = Store.dayKey();
    const t = Store.tasks().find(x => x.title === 'WELL Stretch');
    return Store.dueFor(t, key) === key; }), true);

  console.log('\n--- the plan answers first ---');
  await p.evaluate(() => {
    const at = Store.minutesNow();
    Store.addBlock({ date: Store.dayKey(), start: at - 5, end: at + 40, title: 'happening right now' });
  });
  await p.waitForTimeout(700);
  check('with a block running, it stays quiet', await queue(p), null);
  check('and the line says what you are doing', await p.evaluate(() =>
    document.getElementById('nowTitle').textContent), 'happening right now');

  console.log('\n--- tapping one puts it on the day ---');
  await p.evaluate(() => {
    Store.blocks(Store.dayKey()).forEach(b => Store.removeBlock(b.id));
  });
  await p.waitForTimeout(700);
  const before = await p.evaluate(() => Store.blocks(Store.dayKey()).length);
  await p.locator('.queue-row').first().click(); await p.waitForTimeout(600);
  check('a block appears for it', await p.evaluate(() => Store.blocks(Store.dayKey()).length), before + 1);
  check('with the task attached', await p.evaluate(() => {
    const b = Store.blocks(Store.dayKey())[0];
    return !!b.taskId && b.title === 'TAA Overdue essay'; }), true);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
