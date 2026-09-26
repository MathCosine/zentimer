const { chromium } = require('./browser');
(async () => {
  const b = await chromium.launch();
  const errs = []; let pass = 0, fail = 0;
  const check = (n, got, want) => { const ok = JSON.stringify(got)===JSON.stringify(want);
    console.log(`  ${ok?'ok  ':'FAIL'}  ${n}`); if(!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    ok?pass++:fail++; };
  const aim = p => p.evaluate(() => {
    const a = document.getElementById('aim');
    if (a.hidden) return null;
    return { lines: [...a.querySelectorAll('.aim-line')].map(l => ({
        name: l.querySelector('.aim-name').textContent,
        num: l.querySelector('.aim-num').textContent,
        met: l.classList.contains('is-met'),
        fill: l.querySelector('.aim-fill').style.width,
        count: l.querySelector('.aim-count').textContent,
        over: l.classList.contains('is-over') })),
      warn: a.querySelector('.aim-warn') ? a.querySelector('.aim-warn').textContent : null,
      clear: a.querySelector('.aim-clear') ? a.querySelector('.aim-clear').textContent : null }; });

  const p = await (await b.newContext({viewport:{width:440,height:1000}})).newPage();
  p.on('pageerror', e => errs.push('PAGE: '+e.message));
  p.on('console', m => { const t=m.text(); if(m.type()==='error' && !/ERR_TUNNEL|ERR_CONN|Failed to load|jsdelivr/.test(t)) errs.push('CON: '+t); });
  await p.goto('http://127.0.0.1:8899/app/'); await p.waitForTimeout(1100);

  console.log('--- nothing due, nothing asked of you ---');
  check('it stays out of the way', await aim(p), null);

  console.log('--- only big things are spread ---');
  await p.evaluate(() => {
    const on = n => { const d = new Date(); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    // forty minutes due in five days: nobody does eight minutes of it a day
    Store.addTask({ title: 'MSB Worksheet', due: on(5), mins: 40 });
  });
  await p.waitForTimeout(800);
  check('a small one waits for its day', await aim(p), null);
  await p.evaluate(() => Store.tasks().forEach(t => Store.removeTask(t.id)));
  await p.waitForTimeout(500);

  console.log('--- work is spread to finish two days early ---');
  await p.evaluate(() => {
    const on = n => { const d = new Date(); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    /* Six hours due in six days. Finishing two days early means it has to be
       done by day four, and today is one of those days, so five days share it. */
    Store.addTask({ title: 'MSB Big project', due: on(6), mins: 360 });
  });
  await p.waitForTimeout(800);
  check('six hours over five days is seventy minutes', (await aim(p)).lines[0].num, '1h 10m');

  check('and it says how many things', await p.evaluate(() =>
    document.querySelector('.aim-count').textContent), '1 thing');

  console.log('--- a big one is offered a slice at a time ---');
  const slice = await p.evaluate(() => {
    const q = document.getElementById('queue');
    const row = q.querySelector('.queue-row');
    return { mins: row.querySelector('.queue-mins').textContent }; });
  check('the queue says what fraction of it', slice.mins, '1h 10m \u00b7 19%');
  await p.evaluate(() => document.querySelector('.queue-row').click());
  await p.waitForTimeout(700);
  check('and the block is that slice, not the whole project', await p.evaluate(() => {
    const b = Store.blocks(Store.dayKey())[0];
    return b.end - b.start; }), 70);
  await p.evaluate(() => {
    Store.blocks(Store.dayKey()).forEach(b => Store.removeBlock(b.id)); });
  await p.waitForTimeout(500);

  console.log('--- something due tomorrow is all today ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => Store.removeTask(t.id));
    const d = new Date(); d.setDate(d.getDate() + 1);
    Store.addTask({ title: 'PHY Essay', due: Store.dayKey(d), mins: 90 });
  });
  await p.waitForTimeout(800);
  check('no room to spread it, so all of it', (await aim(p)).lines[0].num, '1h 30m');

  console.log('--- practice is a day’s worth, not a deadline ---');
  await p.evaluate(() => {
    ['USACO','OTIS','Physics','SAT'].forEach(n =>
      Store.addTask({ title: 'EXTRA ' + n, repeat: 'daily', mins: 30 }));
    const t = Store.tags().find(x => x.name === 'EXTRA');
    Store.setTagKind(t.id, 'practice', 2);
  });
  await p.waitForTimeout(800);
  const both = await aim(p);
  check('two rows now', both.lines.map(l => l.name), ['homework','practice']);
  check('two of the four drills is an hour', both.lines[1].num, '1h');
  check('and it counts them', await p.evaluate(() =>
    [...document.querySelectorAll('.aim-count')].map(c => c.textContent)), ['1 thing','0 of 2']);

  console.log('--- doing the work fills the bar ---');
  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY Essay');
    Store.logTime(t.id, null, 90 * 60000); });
  await p.waitForTimeout(800);
  const after = await aim(p);
  check('homework reads done', { num: after.lines[0].num, met: after.lines[0].met }, { num: 'done ✓', met: true });
  check('practice still waiting', after.lines[1].met, false);
  check('and it does not say you are finished yet', after.clear, null);

  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'EXTRA USACO');
    Store.logTime(t.id, null, 60 * 60000); });
  await p.waitForTimeout(800);
  check('with both met it says so', (await aim(p)).clear, 'deadlines are covered — the rest is yours');

  console.log('--- ticking it off counts, with no timer at all ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => Store.removeTask(t.id));
    Store.state().logs.length = 0;
    const d = new Date(); d.setDate(d.getDate() + 1);
    Store.addTask({ title: 'MSB WA1', due: Store.dayKey(d), mins: 45 });
    Store.addTask({ title: 'PHY Mastering', due: Store.dayKey(d), mins: 60 });
  });
  await p.waitForTimeout(800);
  const fresh = await aim(p);
  check('an hour and three quarters to do', fresh.lines[0].num, '1h 45m');
  check('nothing done yet', fresh.lines[0].fill, '0%');

  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'MSB WA1');
    Store.toggleDone(t.id, Store.dayKey()); });
  await p.waitForTimeout(800);
  const ticked = await aim(p);
  check('the bar moves by what it was going to take', ticked.lines[0].fill, '43%');
  check('and an hour is left', ticked.lines[0].num, '1h');
  check('one thing, not two', ticked.lines[0].count, '1 thing');

  // a timer on a different task adds to the same bar
  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY Mastering');
    Store.logTime(t.id, null, 20 * 60000); });
  await p.waitForTimeout(800);
  check('a timer adds to it too', (await aim(p)).lines[0].num, '40m');

  /* The task the timer ran against is then ticked off: its credit replaces
     those twenty minutes rather than stacking on top of them. */
  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY Mastering');
    Store.toggleDone(t.id, Store.dayKey()); });
  await p.waitForTimeout(800);
  const finished = await aim(p);
  check('finishing it does not count the timer twice', finished.lines[0].fill, '100%');
  check('and the day is done', finished.lines[0].num, 'done \u2713');

  console.log('--- yesterday\u2019s work is not today\u2019s ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => Store.removeTask(t.id));
    Store.state().logs.length = 0;
    const on = n => { const d = new Date(); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    // three finished days ago, and two still to do
    ['MSB Old one','PHY Old two','LATIN Old three'].forEach(title => {
      const t = Store.addTask({ title: title, due: on(1), mins: 60 });
      Store.toggleDone(t.id, Store.dayKey());
      t.doneAt = Date.now() - 3 * 86400000;
    });
    Store.addTask({ title: 'MSB WA1', due: on(1), mins: 45 });
    Store.addTask({ title: 'PHY Workbook', due: on(2), mins: 30 });
    Store.quiet();
  });
  await p.reload(); await p.waitForTimeout(1200);
  const morning = await aim(p);
  check('the day starts empty however much is behind you', morning.lines[0].fill, '0%');
  check('with only what is still to do on it', morning.lines[0].num, '1h 15m');
  check('and only those counted', morning.lines[0].count, '2 things');

  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'MSB WA1');
    Store.toggleDone(t.id, Store.dayKey()); });
  await p.waitForTimeout(800);
  check('and doing one today moves it', (await aim(p)).lines[0].fill, '60%');

  console.log('--- work you were not asked for counts too ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => Store.removeTask(t.id));
    Store.state().logs.length = 0;
    const on = n => { const d = new Date(); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    Store.addTask({ title: 'MSB WA1', due: on(1), mins: 45 });          // what today is asking for
    Store.addTask({ title: 'TAA Reading', mins: 30 });                  // no deadline at all
    Store.addTask({ title: 'PHY Later worksheet', due: on(6), mins: 40 });   // not today's problem
  });
  await p.waitForTimeout(800);
  check('today asks for the one thing', (await aim(p)).lines[0].num, '45m');

  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'TAA Reading');
    Store.toggleDone(t.id, Store.dayKey()); });
  await p.waitForTimeout(800);
  const off = await aim(p);
  check('doing something with no deadline still counts', off.lines[0].fill, '40%');
  check('and what today asks for has not changed', off.lines[0].num, '45m');

  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY Later worksheet');
    Store.toggleDone(t.id, Store.dayKey()); });
  await p.waitForTimeout(800);
  check('nor does getting ahead on next week', (await aim(p)).lines[0].num, '45m');
  check('but it is on the bar', (await aim(p)).lines[0].fill, '61%');

  console.log('--- and it will say what is on the bar ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => Store.removeTask(t.id));
    Store.state().logs.length = 0;
    const on = n => { const d = new Date(); d.setDate(d.getDate() + n); return Store.dayKey(d); };
    for (let i = 0; i < 4; i++) {                   // finished, but not today
      const t = Store.addTask({ title: 'MSB Old ' + i, due: on(-2), mins: 60 });
      Store.toggleDone(t.id, Store.dayKey());
      t.doneAt = Date.now() - (2 + i) * 86400000;
    }
    Store.addTask({ title: 'PHY Workbook', due: on(2), mins: 30 });
    Store.addTask({ title: 'LATIN Unit Test', due: on(2), mins: 60 });
    Store.quiet();
  });
  await p.reload(); await p.waitForTimeout(1300);
  await p.locator('.aim-why').click(); await p.waitForTimeout(500);
  check('with nothing done it says so', await p.evaluate(() =>
    document.querySelector('.aim-what').textContent), 'nothing yet today \u2014 the bar is empty');

  await p.evaluate(() => {
    const t = Store.tasks().find(x => x.title === 'PHY Workbook');
    Store.toggleDone(t.id, Store.dayKey());
    const l = Store.tasks().find(x => x.title === 'LATIN Unit Test');
    Store.logTime(l.id, null, 25 * 60000); });
  await p.waitForTimeout(800);
  const bits = await p.evaluate(() =>
    [...document.querySelectorAll('.aim-bit')].map(n => [...n.children].map(c => c.textContent)));
  check('and otherwise names every piece of it',
    [[bits[0][0], /^ticked off \d/.test(bits[0][1]), bits[0][2]], bits[1]],
    [['PHY Workbook', true, '30m'], ['LATIN Unit Test', 'timed', '25m']]);

  await p.evaluate(() => Store.logTime(null, null, 15 * 60000));   // a session against nothing
  await p.waitForTimeout(800);
  check('a session on nothing in particular is named too', await p.evaluate(() =>
    [...document.querySelectorAll('.aim-bit-name')].map(n => n.textContent)
      .indexOf('a session on nothing in particular') > -1), true);
  await p.locator('.aim-why').click(); await p.waitForTimeout(400);
  check('and it folds away again', await p.evaluate(() => !document.querySelector('.aim-what')), true);

  console.log('--- and when the day is asking too much ---');
  await p.evaluate(() => {
    Store.tasks().forEach(t => Store.removeTask(t.id));
    const d = new Date(); d.setDate(d.getDate() + 1);
    Store.addTask({ title: 'MSB Enormous', due: Store.dayKey(d), mins: 480 });
  });
  await p.waitForTimeout(800);
  const heavy = await aim(p);
  check('the row is marked', heavy.lines[0].over, true);
  check('and it says what to do about it', heavy.warn,
    'more than a day holds — push something back or accept a late one');

  console.log('--- the ceiling is yours to set ---');
  await p.click('#settingsBtn'); await p.waitForTimeout(700);
  check('it shows the hours', await p.evaluate(() => {
    const g = [...document.querySelectorAll('.set-group')].find(x =>
      x.querySelector('.set-title') && x.querySelector('.set-title').textContent === 'a full day');
    return [...g.querySelectorAll('.set-number')].map(i => i.value); }), ['5.5','4']);
  await p.evaluate(() => {
    const g = [...document.querySelectorAll('.set-group')].find(x =>
      x.querySelector('.set-title') && x.querySelector('.set-title').textContent === 'a full day');
    const input = g.querySelector('.set-number');
    input.value = '9'; input.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(700);
  await p.click('#settingsClose'); await p.waitForTimeout(600);
  check('raising it clears the warning', (await aim(p)).warn, null);
  await p.reload(); await p.waitForTimeout(1200);
  check('and it is remembered', await p.evaluate(() => Plan.caps().work), 540);

  console.log(`\n${pass} passed, ${fail} failed, ${errs.length} console errors`);
  errs.slice(0,5).forEach(e => console.log('  !', e));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
